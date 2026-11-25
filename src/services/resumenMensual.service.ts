import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { finDePeriodo, sumarMeses, esFechaValida, deFechaDB } from '../lib/fechas';
import { listarPorEstadoCuota, EstadoCuota, DIAS_POR_VENCER } from './estadoCuota.service';

// =============================================================================
// Resumen mensual para el dueño del gimnasio (se manda el día 1 por mail).
//
// Todo en hora argentina (UTC-3 fijo, sin horario de verano): el mes va de las
// 0:00 del día 1 a las 0:00 del día 1 del mes siguiente.
//
//   - Cobrado: pagos APROBADOS cuyo medio de pago es del gimnasio (cuotas y ventas).
//   - Cuotas: foto al último día del mes, con la misma regla que la lista de
//     Socios y el Inicio (listarPorEstadoCuota).
//   - Ingresos: asistencias de las sucursales del gimnasio.
//   - Dejaron de venir: socios vigentes que vinieron el mes anterior y este no.
//     Solo se listan si el gimnasio registra los ingresos de verdad (ver
//     MIN_COBERTURA_INGRESOS); si no, el mail lo dice y empuja a usar la
//     Pantalla de ingreso.
// =============================================================================

/** Proporción mínima de socios vigentes que tienen que haber registrado al menos un
 *  ingreso en el mes para que "dejaron de venir" signifique algo. */
export const MIN_COBERTURA_INGRESOS = 0.25;
/** Cuántos nombres se listan en el mail (el resto, con un link a la lista). */
export const MAX_DEJARON_EN_MAIL = 10;

/** 'YYYY-MM-01' -> instante de las 0:00 de Argentina de ese día */
export function inicioMesAR(periodo: string): Date {
  return new Date(`${periodo}T00:00:00-03:00`);
}

export interface TotalCobro { total: number; cantidad: number }
export interface ResumenMensual {
  empresaId:   string;
  periodo:     string;          // 'YYYY-MM-01'
  fotoCuotas:  string;          // día de la foto de cuotas (último del mes)
  cobrado: {
    total: number; cantidad: number;
    cuotas: TotalCobro; ventas: TotalCobro;
    porMedio: { medio: string; total: number; cantidad: number }[];
    mesAnterior: TotalCobro;
  };
  cuotas: Record<EstadoCuota, number> & { totalSocios: number };
  ingresos: {
    total: number; sociosDistintos: number;
    mesAnterior: { total: number; sociosDistintos: number };
    cobertura: number;          // socios distintos con ingreso / socios vigentes
    suficientes: boolean;       // ¿alcanza para listar "dejaron de venir"?
  };
  dejaronDeVenir: {
    personaId: string; nombre: string; ultimaVisita: string; estadoCuota: EstadoCuota;
    telefono: string | null;
  }[];
  altas: number;
}

const num = (v: unknown) => Number(v ?? 0);

async function cobradoEntre(empresaId: string, desde: Date, hasta: Date) {
  const filas = await prisma.$queryRaw<{ medio: string; es_cuota: boolean; total: Prisma.Decimal; cantidad: bigint }[]>`
    SELECT mp.nombre AS medio, (p.inscripcion_id IS NOT NULL) AS es_cuota,
           sum(p.monto) AS total, count(*) AS cantidad
      FROM pagos p
      JOIN medios_pago mp ON mp.id = p.medio_pago_id
     WHERE mp.empresa_id = ${empresaId}::uuid
       AND p.estado = 'APROBADO'
       AND p.fecha >= ${desde} AND p.fecha < ${hasta}
     GROUP BY mp.nombre, (p.inscripcion_id IS NOT NULL)`;
  const cuotas = { total: 0, cantidad: 0 };
  const ventas = { total: 0, cantidad: 0 };
  const medios = new Map<string, { total: number; cantidad: number }>();
  for (const f of filas) {
    const t = num(f.total); const c = num(f.cantidad);
    const lado = f.es_cuota ? cuotas : ventas;
    lado.total += t; lado.cantidad += c;
    const m = medios.get(f.medio) ?? { total: 0, cantidad: 0 };
    m.total += t; m.cantidad += c; medios.set(f.medio, m);
  }
  const porMedio = [...medios.entries()]
    .map(([medio, v]) => ({ medio, ...v }))
    .sort((a, b) => b.total - a.total);
  return {
    total: cuotas.total + ventas.total, cantidad: cuotas.cantidad + ventas.cantidad,
    cuotas, ventas, porMedio,
  };
}

// Ingresos de un socio: la asistencia puede tener el socio, la membresía o las dos.
const SOCIO_DE_ASISTENCIA = Prisma.sql`COALESCE(a.persona_rol_id, i.persona_rol_id)`;

async function ingresosEntre(empresaId: string, desde: Date, hasta: Date) {
  const [f] = await prisma.$queryRaw<{ total: bigint; socios: bigint }[]>`
    SELECT count(*) AS total, count(DISTINCT ${SOCIO_DE_ASISTENCIA}) AS socios
      FROM asistencias a
      JOIN sucursales s        ON s.id = a.sucursal_id
      LEFT JOIN inscripciones i ON i.id = a.inscripcion_id
     WHERE s.empresa_id = ${empresaId}::uuid
       AND a.fecha_hora_ingreso >= ${desde} AND a.fecha_hora_ingreso < ${hasta}`;
  return { total: num(f?.total), sociosDistintos: num(f?.socios) };
}

export async function calcularResumen(empresaId: string, periodo: string): Promise<ResumenMensual> {
  if (!esFechaValida(periodo) || !periodo.endsWith('-01')) throw new Error(`Período inválido: ${periodo}`);

  const anterior   = sumarMeses(periodo, -1);
  const siguiente  = sumarMeses(periodo, 1);
  const desde      = inicioMesAR(periodo);
  const hasta      = inicioMesAR(siguiente);
  const desdeAnt   = inicioMesAR(anterior);
  const fotoCuotas = finDePeriodo(periodo);

  const [cobrado, cobradoAnt, estado, ingresos, ingresosAnt] = await Promise.all([
    cobradoEntre(empresaId, desde, hasta),
    cobradoEntre(empresaId, desdeAnt, desde),
    listarPorEstadoCuota(empresaId, { page: 1, limit: 1, hoy: fotoCuotas }),
    ingresosEntre(empresaId, desde, hasta),
    ingresosEntre(empresaId, desdeAnt, desde),
  ]);

  // Socios "vigentes" = los que deberían estar viniendo
  const vigentes  = estado.conteos.AL_DIA + estado.conteos.POR_VENCER;
  const cobertura = vigentes > 0 ? ingresos.sociosDistintos / vigentes : 0;
  const suficientes = vigentes > 0 && cobertura >= MIN_COBERTURA_INGRESOS;

  // Dejaron de venir: vinieron el mes anterior, este mes no, y siguen siendo socios
  // (cuota al día, por vencer, pendiente, o vencida dentro del mes).
  const dejaron = suficientes ? await prisma.$queryRaw<{
      persona_id: string; nombres: string; apellidos: string; ultima: Date; persona_rol_id: string }[]>`
    WITH ingresos AS (
      SELECT ${SOCIO_DE_ASISTENCIA} AS persona_rol_id, a.fecha_hora_ingreso
        FROM asistencias a
        JOIN sucursales s        ON s.id = a.sucursal_id
        LEFT JOIN inscripciones i ON i.id = a.inscripcion_id
       WHERE s.empresa_id = ${empresaId}::uuid
         AND a.fecha_hora_ingreso < ${hasta}
    )
    SELECT p.id AS persona_id, p.nombres, p.apellidos, pr.id AS persona_rol_id,
           max(g.fecha_hora_ingreso) AS ultima
      FROM ingresos g
      JOIN persona_roles pr ON pr.id = g.persona_rol_id AND pr.fecha_baja IS NULL
      JOIN tipo_roles_persona t ON t.id = pr.tipo_rol_id AND t.nombre = 'SOCIO'
      JOIN personas p ON p.id = pr.persona_id AND p.deleted_at IS NULL AND p.activo
                     AND p.empresa_id = ${empresaId}::uuid
     GROUP BY p.id, p.nombres, p.apellidos, pr.id
    HAVING max(g.fecha_hora_ingreso) >= ${desdeAnt} AND max(g.fecha_hora_ingreso) < ${desde}
     ORDER BY max(g.fecha_hora_ingreso), p.apellidos, p.nombres` : [];

  // Estado de cuota de cada uno (misma regla que la lista) para descartar a los que
  // ya no son socios (sin membresía o vencidos antes de este mes)
  let dejaronDeVenir: ResumenMensual['dejaronDeVenir'] = [];
  if (dejaron.length) {
    const ids = dejaron.map(d => d.persona_id);
    const estados = await prisma.$queryRaw<{ persona_id: string; estado_cuota: EstadoCuota; fecha_fin: Date | null; telefono: string | null }[]>`
      SELECT DISTINCT ON (p.id) p.id AS persona_id, i.fecha_fin,
             CASE
               WHEN i.id IS NULL                                                  THEN 'SIN_MEMBRESIA'
               WHEN i.estado = 'SUSPENDIDA'                                       THEN 'SUSPENDIDA'
               WHEN i.estado = 'PENDIENTE'                                        THEN 'PENDIENTE'
               WHEN i.estado = 'VENCIDA' OR i.fecha_fin < ${fotoCuotas}::date     THEN 'VENCIDA'
               WHEN i.fecha_fin - ${fotoCuotas}::date <= ${DIAS_POR_VENCER}       THEN 'POR_VENCER'
               ELSE 'AL_DIA'
             END AS estado_cuota,
             (SELECT c.valor FROM persona_contactos c
               WHERE c.persona_id = p.id AND c.tipo IN ('CEL', 'WA', 'TEL')
               ORDER BY c.principal DESC LIMIT 1) AS telefono
        FROM personas p
        JOIN persona_roles pr     ON pr.persona_id = p.id AND pr.fecha_baja IS NULL
        JOIN tipo_roles_persona t ON t.id = pr.tipo_rol_id AND t.nombre = 'SOCIO'
        LEFT JOIN inscripciones i ON i.persona_rol_id = pr.id
                                 AND i.estado NOT IN ('CANCELADA', 'BAJA_CAMBIO_PLAN')
       WHERE p.id = ANY(${ids}::uuid[]) AND p.empresa_id = ${empresaId}::uuid
       ORDER BY p.id,
                CASE WHEN i.estado <> 'VENCIDA' AND i.fecha_inicio <= ${fotoCuotas}::date AND i.fecha_fin >= ${fotoCuotas}::date
                     THEN CASE WHEN i.estado = 'ACTIVA' THEN 2 ELSE 1 END
                     ELSE 0 END DESC,
                i.fecha_fin DESC NULLS LAST, i.created_at DESC`;
    const porId = new Map(estados.map(e => [e.persona_id, e]));
    dejaronDeVenir = dejaron
      .filter(d => {
        const e = porId.get(d.persona_id);
        if (!e || e.estado_cuota === 'SIN_MEMBRESIA') return false;
        if (e.estado_cuota === 'VENCIDA') return !!e.fecha_fin && deFechaDB(e.fecha_fin) >= periodo;
        return true;
      })
      .map(d => ({
        personaId:    d.persona_id,
        nombre:       `${d.nombres} ${d.apellidos}`,
        ultimaVisita: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(d.ultima),
        estadoCuota:  porId.get(d.persona_id)!.estado_cuota,
        telefono:     porId.get(d.persona_id)!.telefono,
      }));
  }

  const [altas] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(DISTINCT pr.persona_id) AS n
      FROM persona_roles pr
      JOIN tipo_roles_persona t ON t.id = pr.tipo_rol_id AND t.nombre = 'SOCIO'
      JOIN personas p ON p.id = pr.persona_id AND p.deleted_at IS NULL
     WHERE p.empresa_id = ${empresaId}::uuid
       AND pr.fecha_alta >= ${periodo}::date AND pr.fecha_alta < ${siguiente}::date`;

  return {
    empresaId, periodo, fotoCuotas,
    cobrado: { ...cobrado, mesAnterior: { total: cobradoAnt.total, cantidad: cobradoAnt.cantidad } },
    cuotas:  { ...estado.conteos, totalSocios: estado.totalSocios },
    ingresos: { ...ingresos, mesAnterior: ingresosAnt, cobertura, suficientes },
    dejaronDeVenir,
    altas: num(altas?.n),
  };
}
