import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { hoyArgentina, deFechaDB, diasEntre } from '../lib/fechas';
import { elegirMembresia, pendienteSiguiente, clasificarCuota } from '../lib/membresiaVigente';

// =============================================================================
// Ficha del socio (etapa 2, parte 2): historial completo de cuotas con sus
// pagos, y sus asistencias. Todo filtrado por la empresa del usuario logueado:
// si la persona no es de esta empresa, se responde como "no existe".
// =============================================================================

export class NoEncontrado extends Error {}

const HISTORICOS = ['CANCELADA', 'BAJA_CAMBIO_PLAN'];

async function rolesDelSocio(empresaId: string, personaId: string) {
  const persona = await prisma.persona.findFirst({
    where:  { id: personaId, empresaId, deletedAt: null },
    select: { id: true, roles: { select: { id: true, fechaBaja: true, tipoRol: { select: { nombre: true } } } } },
  });
  if (!persona) throw new NoEncontrado('Socio no encontrado');
  return persona.roles;
}

// ── Cuotas ───────────────────────────────────────────────────────────────────

export async function cuotasDelSocio(empresaId: string, personaId: string, page: number, limit: number) {
  const hoy   = hoyArgentina();
  const roles = await rolesDelSocio(empresaId, personaId);
  const ids   = roles.map(r => r.id);

  // Estado de hoy: misma regla que la lista y el ingreso (rol SOCIO activo)
  const rolSocio = roles.find(r => !r.fechaBaja && r.tipoRol.nombre === 'SOCIO');
  const vigentes = rolSocio
    ? await prisma.inscripcion.findMany({
        where:   { personaRolId: rolSocio.id, estado: { notIn: HISTORICOS } },
        orderBy: [{ fechaFin: 'desc' }, { createdAt: 'desc' }],
        take:    24,
        include: { plan: { select: { nombre: true } } },
      })
    : [];
  const elegida   = elegirMembresia(vigentes, hoy);
  const siguiente = pendienteSiguiente(vigentes, elegida, hoy);

  const where: Prisma.InscripcionWhereInput = { personaRolId: { in: ids } };
  const [total, inscripciones, totales] = await Promise.all([
    prisma.inscripcion.count({ where }),
    prisma.inscripcion.findMany({
      where,
      orderBy: [{ fechaInicio: 'desc' }, { createdAt: 'desc' }],
      skip:    (page - 1) * limit,
      take:    limit,
      include: {
        plan:     { select: { id: true, nombre: true, tipo: true, modalidadCobro: true, duracionDias: true } },
        sucursal: { select: { nombre: true } },
        pagos: {
          orderBy: { fecha: 'asc' },
          select: {
            id: true, fecha: true, monto: true, estado: true, referenciaExterna: true,
            medioPago: { select: { nombre: true, tipo: true } },
            usuario:   { select: { email: true, persona: { select: { nombres: true, apellidos: true } } } },
          },
        },
      },
    }),
    prisma.pago.aggregate({
      where: { inscripcionId: { not: null }, estado: 'APROBADO', inscripcion: { personaRolId: { in: ids } } },
      _sum:   { monto: true },
      _count: true,
      _max:   { fecha: true },
    }),
  ]);

  return {
    hoy,
    estado: {
      estadoCuota: clasificarCuota(elegida, hoy),
      membresia: elegida ? {
        id:            elegida.id,
        estado:        elegida.estado,
        plan:          elegida.plan.nombre,
        fechaInicio:   deFechaDB(elegida.fechaInicio),
        fechaFin:      deFechaDB(elegida.fechaFin),
        diasRestantes: diasEntre(hoy, deFechaDB(elegida.fechaFin)),
      } : null,
      pendienteSiguiente: siguiente ? {
        id:          siguiente.id,
        fechaInicio: deFechaDB(siguiente.fechaInicio),
        fechaFin:    deFechaDB(siguiente.fechaFin),
      } : null,
    },
    resumen: {
      totalPagado:  Number(totales._sum.monto ?? 0),
      cantidadPagos: totales._count,
      ultimoPago:   totales._max.fecha,
      membresias:   total,
    },
    total,
    cuotas: inscripciones.map(i => ({
      id:            i.id,
      estado:        i.estado,
      plan:          i.plan,
      sucursal:      i.sucursal.nombre,
      fechaInicio:   deFechaDB(i.fechaInicio),
      fechaFin:      deFechaDB(i.fechaFin),
      periodo:       i.periodo ? deFechaDB(i.periodo) : null,
      precio:        Number(i.precioPagado),
      tramoPrecio:   i.tramoPrecio,
      observaciones: i.observaciones,
      createdAt:     i.createdAt,
      esLaDeHoy:     i.id === elegida?.id,
      pagos: i.pagos.map(p => ({
        id:         p.id,
        fecha:      p.fecha,
        monto:      Number(p.monto),
        estado:     p.estado,
        referencia: p.referenciaExterna,
        medio:      p.medioPago.nombre,
        cobradoPor: p.usuario.persona
          ? `${p.usuario.persona.nombres} ${p.usuario.persona.apellidos}`
          : p.usuario.email,
      })),
    })),
  };
}

// ── Asistencias ──────────────────────────────────────────────────────────────

export async function asistenciasDelSocio(empresaId: string, personaId: string, page: number, limit: number) {
  const hoy   = hoyArgentina();
  const roles = await rolesDelSocio(empresaId, personaId);
  const ids   = roles.map(r => r.id);
  if (!ids.length) return { hoy, total: 0, ultima: null, porMes: [], asistencias: [] };

  // Un ingreso puede tener el socio, la membresía, o las dos cosas
  const where: Prisma.AsistenciaWhereInput = {
    OR: [{ personaRolId: { in: ids } }, { inscripcion: { personaRolId: { in: ids } } }],
  };

  const [total, filas, porMes] = await Promise.all([
    prisma.asistencia.count({ where }),
    prisma.asistencia.findMany({
      where,
      orderBy: { fechaHoraIngreso: 'desc' },
      skip:    (page - 1) * limit,
      take:    limit,
      select: {
        id: true, fechaHoraIngreso: true, fechaHoraEgreso: true, metodoRegistro: true,
        sucursal:    { select: { nombre: true } },
        inscripcion: { select: { plan: { select: { nombre: true } } } },
      },
    }),
    // Ingresos por mes (hora argentina), últimos 6 meses incluido el actual
    prisma.$queryRaw<{ mes: string; cantidad: bigint }[]>`
      SELECT to_char(date_trunc('month', a.fecha_hora_ingreso AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'YYYY-MM') AS mes,
             count(*) AS cantidad
        FROM asistencias a
        LEFT JOIN inscripciones i ON i.id = a.inscripcion_id
       WHERE (a.persona_rol_id = ANY(${ids}::uuid[]) OR i.persona_rol_id = ANY(${ids}::uuid[]))
         AND a.fecha_hora_ingreso >= (date_trunc('month', ${hoy}::date) - interval '5 months') AT TIME ZONE 'America/Argentina/Buenos_Aires'
       GROUP BY 1`,
  ]);

  // Los 6 meses siempre presentes (con 0 si no vino), del más viejo al actual
  const conteo = new Map(porMes.map(m => [m.mes, Number(m.cantidad)]));
  const [anio, mes] = hoy.split('-').map(Number);
  const meses = Array.from({ length: 6 }, (_, k) => {
    const d = new Date(Date.UTC(anio, mes - 1 - (5 - k), 1));
    const clave = d.toISOString().slice(0, 7);
    return { mes: clave, cantidad: conteo.get(clave) ?? 0 };
  });

  const ultima = total > 0 && page === 1 ? filas[0]?.fechaHoraIngreso ?? null
    : (await prisma.asistencia.findFirst({ where, orderBy: { fechaHoraIngreso: 'desc' }, select: { fechaHoraIngreso: true } }))?.fechaHoraIngreso ?? null;

  return {
    hoy,
    total,
    ultima,
    porMes: meses,
    asistencias: filas.map(a => ({
      id:      a.id,
      ingreso: a.fechaHoraIngreso,
      egreso:  a.fechaHoraEgreso,
      metodo:  a.metodoRegistro,
      sucursal: a.sucursal.nombre,
      plan:    a.inscripcion?.plan.nombre ?? null,   // null = entró sin membresía
    })),
  };
}
