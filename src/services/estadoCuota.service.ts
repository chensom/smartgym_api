import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { hoyArgentina, deFechaDB, diasEntre } from '../lib/fechas';

// =============================================================================
// Estado de la cuota de cada socio (para la lista de Socios con filtros).
//
// Misma regla que la Pantalla de ingreso (lib/membresiaVigente.ts, si cambia una
// cambiar la otra): cuenta la membresía que cubre hoy; si ninguna, la de fin más
// reciente. Sin CANCELADA ni BAJA_CAMBIO_PLAN.
// El cálculo se hace en la base para poder filtrar y paginar por estado.
// =============================================================================

export const ESTADOS_CUOTA = ['AL_DIA', 'POR_VENCER', 'VENCIDA', 'SIN_MEMBRESIA', 'PENDIENTE', 'SUSPENDIDA'] as const;
export type EstadoCuota = typeof ESTADOS_CUOTA[number];

/** "Vence pronto" = vence en 7 días o menos (igual que el Inicio y el aviso por mail). */
export const DIAS_POR_VENCER = 7;

export interface FiltroEstadoCuota {
  estado?: EstadoCuota;
  q?:      string;
  page:    number;
  limit:   number;
  hoy?:    string;   // YYYY-MM-DD; por defecto, hoy en Argentina (se puede fijar para pruebas)
}

export async function listarPorEstadoCuota(empresaId: string, f: FiltroEstadoCuota) {
  const hoy   = f.hoy ?? hoyArgentina();
  const texto = f.q?.trim();
  const dni   = texto?.replace(/\D/g, '') ?? '';

  // Búsqueda por nombre, apellido o DNI (con o sin puntos), sin importar acentos.
  // "apellido nombre apellido" permite buscar en los dos órdenes ("Benítez Lucía" o "Lucía Benítez").
  const filtroTexto = texto
    ? Prisma.sql`AND (
        unaccent(p.apellidos || ' ' || p.nombres || ' ' || p.apellidos) ILIKE unaccent(${'%' + texto + '%'})
        ${dni.length >= 4
          ? Prisma.sql`OR EXISTS (SELECT 1 FROM persona_documentos d
                                   WHERE d.persona_id = p.id
                                     AND replace(d.numero, '.', '') LIKE ${'%' + dni + '%'})`
          : Prisma.empty}
      )`
    : Prisma.empty;

  // Una fila por socio con su estado de cuota calculado
  const base = Prisma.sql`
    WITH socios AS (
      SELECT DISTINCT ON (p.id)
             p.id AS persona_id, pr.id AS persona_rol_id, pr.numero_socio,
             p.apellidos, p.nombres,
             i.id AS inscripcion_id, i.estado AS ins_estado, i.fecha_fin,
             EXISTS (SELECT 1 FROM inscripciones x
                      WHERE x.persona_rol_id = pr.id AND x.estado = 'PENDIENTE'
                        AND x.fecha_inicio > ${hoy}::date) AS hay_pendiente_futura
        FROM personas p
        JOIN persona_roles pr       ON pr.persona_id = p.id AND pr.fecha_baja IS NULL
        JOIN tipo_roles_persona t   ON t.id = pr.tipo_rol_id AND t.nombre = 'SOCIO'
        LEFT JOIN inscripciones i   ON i.persona_rol_id = pr.id
                                   AND i.estado NOT IN ('CANCELADA', 'BAJA_CAMBIO_PLAN')
       WHERE p.empresa_id = ${empresaId}::uuid
         AND p.deleted_at IS NULL
         ${filtroTexto}
       ORDER BY p.id,
                CASE WHEN i.estado <> 'VENCIDA' AND i.fecha_inicio <= ${hoy}::date AND i.fecha_fin >= ${hoy}::date
                     THEN CASE WHEN i.estado = 'ACTIVA' THEN 2 ELSE 1 END
                     ELSE 0 END DESC,
                i.fecha_fin DESC NULLS LAST, i.created_at DESC
    ),
    con_estado AS (
      SELECT s.*,
             CASE
               WHEN s.inscripcion_id IS NULL                                  THEN 'SIN_MEMBRESIA'
               WHEN s.ins_estado = 'SUSPENDIDA'                               THEN 'SUSPENDIDA'
               WHEN s.ins_estado = 'PENDIENTE'                                THEN 'PENDIENTE'
               WHEN s.ins_estado = 'VENCIDA' OR s.fecha_fin < ${hoy}::date    THEN 'VENCIDA'
               WHEN s.fecha_fin - ${hoy}::date <= ${DIAS_POR_VENCER}          THEN 'POR_VENCER'
               ELSE 'AL_DIA'
             END AS estado_cuota,
             (s.hay_pendiente_futura AND s.ins_estado IS DISTINCT FROM 'PENDIENTE') AS pendiente_siguiente
        FROM socios s
    )`;

  const filtroEstado = f.estado ? Prisma.sql`WHERE estado_cuota = ${f.estado}` : Prisma.empty;
  const offset = (f.page - 1) * f.limit;

  const [conteosRaw, filas] = await Promise.all([
    prisma.$queryRaw<{ estado_cuota: EstadoCuota; cantidad: bigint }[]>`
      ${base} SELECT estado_cuota, count(*) AS cantidad FROM con_estado GROUP BY estado_cuota`,
    prisma.$queryRaw<{ persona_id: string; numero_socio: string | null; inscripcion_id: string | null;
                       fecha_fin: Date | null; estado_cuota: EstadoCuota; pendiente_siguiente: boolean }[]>`
      ${base} SELECT persona_id, numero_socio, inscripcion_id, fecha_fin, estado_cuota, pendiente_siguiente
                FROM con_estado ${filtroEstado}
               ORDER BY apellidos, nombres, persona_id
               LIMIT ${f.limit} OFFSET ${offset}`,
  ]);

  const conteos = Object.fromEntries(ESTADOS_CUOTA.map(e => [e, 0])) as Record<EstadoCuota, number>;
  for (const c of conteosRaw) conteos[c.estado_cuota] = Number(c.cantidad);
  const totalSocios = Object.values(conteos).reduce((a, b) => a + b, 0);
  const total       = f.estado ? conteos[f.estado] : totalSocios;

  // Datos para mostrar (en el mismo orden de la página)
  const ids = filas.map(fl => fl.persona_id);
  const insIds = filas.map(fl => fl.inscripcion_id).filter((x): x is string => !!x);
  const [personas, inscripciones] = await Promise.all([
    prisma.persona.findMany({
      where:  { id: { in: ids }, empresaId },
      select: {
        id: true, nombres: true, apellidos: true, fotoUrl: true,
        contactos:  { orderBy: { principal: 'desc' }, select: { tipo: true, valor: true } },
        documentos: { where: { tipo: 'DNI' }, take: 1, select: { numero: true } },
      },
    }),
    prisma.inscripcion.findMany({
      where:  { id: { in: insIds } },
      select: { id: true, fechaInicio: true, plan: { select: { nombre: true, modalidadCobro: true } } },
    }),
  ]);
  const porId    = new Map(personas.map(p => [p.id, p]));
  const insPorId = new Map(inscripciones.map(i => [i.id, i]));

  const socios = filas.map(fl => {
    const p   = porId.get(fl.persona_id)!;
    const ins = fl.inscripcion_id ? insPorId.get(fl.inscripcion_id) : undefined;
    const fin = fl.fecha_fin ? deFechaDB(fl.fecha_fin) : null;
    const tel = p.contactos.find(c => c.tipo === 'CEL' || c.tipo === 'WA' || c.tipo === 'TEL')?.valor ?? null;
    return {
      personaId:   p.id,
      nombres:     p.nombres,
      apellidos:   p.apellidos,
      fotoUrl:     p.fotoUrl,
      dni:         p.documentos[0]?.numero ?? null,
      telefono:    tel,
      numeroSocio: fl.numero_socio,
      estadoCuota: fl.estado_cuota,
      membresia: ins ? {
        plan:           ins.plan.nombre,
        modalidadCobro: ins.plan.modalidadCobro,
        fechaFin:       fin,
        diasRestantes:  fin ? diasEntre(hoy, fin) : null,
      } : null,
      // Período siguiente ya cargado y sin pagar (ej.: noviembre al día, diciembre pendiente)
      pendienteSiguiente: fl.pendiente_siguiente,
    };
  });

  return { socios, conteos, total, totalSocios, hoy };
}
