import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  hoyArgentina, deFechaDB, aFechaDB, esFechaValida, sumarDias, diasEntre, periodoDe, finDePeriodo,
} from '../lib/fechas';
import { obtenerConfigCobro, tipoFacturaPara } from './facturasSuscripcion.service';

// =============================================================================
// Cobro de SmartGym a los gimnasios (panel SuperAdmin).
//
// El plan se mide por SOCIOS ACTIVOS del mes: socios (persona con rol SOCIO, sin
// baja) con alguna membresía (no CANCELADA ni BAJA_CAMBIO_PLAN) que toque el mes.
// El pago se registra a mano: cada pago corre "pagado hasta" N meses.
// =============================================================================

export const MEDIOS_PAGO_SUSCRIPCION = ['TRANSFERENCIA', 'EFECTIVO', 'MERCADO_PAGO', 'OTRO'] as const;
export type MedioPagoSuscripcion = typeof MEDIOS_PAGO_SUSCRIPCION[number];

export type EstadoCobro = 'SIN_PLAN' | 'PRUEBA' | 'AL_DIA' | 'POR_VENCER' | 'VENCIDO';

/** Avisa "por vencer" cuando faltan 7 días o menos. */
export const DIAS_AVISO_COBRO = 7;

import { CobroError } from '../lib/cobroError';
export { CobroError };

// ----------------------------------------------------------------------------- reglas puras

/** Suma meses a una fecha cualquiera. Si el día no existe (31/02), queda en el último del mes. */
export function sumarMesesFecha(fecha: string, meses: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m - 1 + meses + 1, 0)).getUTCDate();
  const r = new Date(Date.UTC(a, m - 1 + meses, Math.min(d, ultimo)));
  return deFechaDB(r);
}

/** Período que cubre un pago: desde + N meses, menos un día. 01/12 x 1 mes = 01/12 a 31/12. */
export function periodoCubierto(desde: string, meses: number): { desde: string; hasta: string } {
  return { desde, hasta: sumarDias(sumarMesesFecha(desde, meses), -1) };
}

/** Desde cuándo corre el próximo pago si no se indica: el día siguiente a "pagado hasta", o hoy. */
export function desdeSugerido(pagadoHasta: string | null, hoy: string): string {
  return pagadoHasta ? sumarDias(pagadoHasta, 1) : hoy;
}

export function estadoCobro(
  e: { planComercialId: string | null; pruebaHasta: string | null; pagadoHasta: string | null },
  hoy: string,
): EstadoCobro {
  const pagado = e.pagadoHasta && e.pagadoHasta >= hoy;
  if (pagado) return diasEntre(hoy, e.pagadoHasta!) <= DIAS_AVISO_COBRO ? 'POR_VENCER' : 'AL_DIA';
  if (e.pruebaHasta && e.pruebaHasta >= hoy) return 'PRUEBA';
  if (!e.planComercialId && !e.pagadoHasta) return 'SIN_PLAN';
  return 'VENCIDO';
}

interface PlanLite { id: string; nombre: string; maxSocios: number | null; precioMensual: number | null; orden: number; activo: boolean }

/** El plan más chico (activo) en el que entran esos socios activos. */
export function planSugerido(planes: PlanLite[], sociosActivos: number): PlanLite | null {
  const orden = planes.filter(p => p.activo).sort((a, b) =>
    (a.maxSocios ?? Infinity) - (b.maxSocios ?? Infinity) || a.orden - b.orden);
  return orden.find(p => p.maxSocios === null || sociosActivos <= p.maxSocios) ?? null;
}

/** Precio mensual que paga el gimnasio: el acordado si lo hay, si no el del plan. */
export function precioMensualDe(precioAcordado: number | null, plan: PlanLite | null): number | null {
  if (precioAcordado !== null) return precioAcordado;
  return plan?.precioMensual ?? null;
}

const num = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));
const fecha = (d: Date | null | undefined) => (d ? deFechaDB(d) : null);

function planLite(p: { id: string; nombre: string; maxSocios: number | null; precioMensual: Prisma.Decimal | null; orden: number; activo: boolean }): PlanLite {
  return { id: p.id, nombre: p.nombre, maxSocios: p.maxSocios, precioMensual: num(p.precioMensual), orden: p.orden, activo: p.activo };
}

// ----------------------------------------------------------------------------- planes

export async function listarPlanes() {
  const planes = await prisma.planComercial.findMany({
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    include: { _count: { select: { empresas: true } } },
  });
  return planes.map(p => ({ ...planLite(p), gimnasios: p._count.empresas }));
}

export interface PlanInput { nombre?: unknown; maxSocios?: unknown; precioMensual?: unknown; orden?: unknown; activo?: unknown }

function validarPlan(b: PlanInput, parcial: boolean) {
  const data: Prisma.PlanComercialUncheckedUpdateInput & Record<string, unknown> = {};
  if (b.nombre !== undefined || !parcial) {
    const n = typeof b.nombre === 'string' ? b.nombre.trim() : '';
    if (!n || n.length > 40) throw new CobroError('El nombre es obligatorio (hasta 40 letras)');
    data.nombre = n;
  }
  if (b.maxSocios !== undefined) {
    if (b.maxSocios === null || b.maxSocios === '') data.maxSocios = null;
    else {
      const m = Number(b.maxSocios);
      if (!Number.isInteger(m) || m <= 0) throw new CobroError('El tope de socios tiene que ser un número entero mayor a 0, o vacío para "sin tope"');
      data.maxSocios = m;
    }
  }
  if (b.precioMensual !== undefined) {
    if (b.precioMensual === null || b.precioMensual === '') data.precioMensual = null;
    else {
      const p = Number(b.precioMensual);
      if (!Number.isFinite(p) || p < 0) throw new CobroError('El precio tiene que ser un número mayor o igual a 0, o vacío para "a medida"');
      data.precioMensual = new Prisma.Decimal(p.toFixed(2));
    }
  }
  if (b.orden !== undefined) {
    const o = Number(b.orden);
    if (!Number.isInteger(o) || o < 0 || o > 999) throw new CobroError('Orden inválido');
    data.orden = o;
  }
  if (b.activo !== undefined) {
    if (typeof b.activo !== 'boolean') throw new CobroError('activo tiene que ser true o false');
    data.activo = b.activo;
  }
  return data;
}

export async function crearPlan(b: PlanInput) {
  const data = validarPlan(b, false) as Prisma.PlanComercialUncheckedCreateInput;
  try {
    return planLite(await prisma.planComercial.create({ data }));
  } catch (e: any) {
    if (e.code === 'P2002') throw new CobroError('Ya existe un plan con ese nombre', 409);
    throw e;
  }
}

export async function editarPlan(id: string, b: PlanInput) {
  const data = validarPlan(b, true);
  if (Object.keys(data).length === 0) throw new CobroError('No hay nada para cambiar');
  try {
    return planLite(await prisma.planComercial.update({ where: { id }, data }));
  } catch (e: any) {
    if (e.code === 'P2025') throw new CobroError('Plan no encontrado', 404);
    if (e.code === 'P2002') throw new CobroError('Ya existe un plan con ese nombre', 409);
    throw e;
  }
}

// ----------------------------------------------------------------------------- uso y socios activos

/** Socios activos por gimnasio en el mes de `periodo` ('YYYY-MM-01'). */
export async function sociosActivosPorEmpresa(periodo: string): Promise<Map<string, number>> {
  const inicio = periodo;
  const fin    = finDePeriodo(periodo);
  const filas = await prisma.$queryRaw<{ empresa_id: string; socios: bigint }[]>`
    SELECT p.empresa_id, count(DISTINCT pr.id) AS socios
      FROM inscripciones i
      JOIN persona_roles pr     ON pr.id = i.persona_rol_id AND pr.fecha_baja IS NULL
      JOIN tipo_roles_persona t ON t.id = pr.tipo_rol_id AND t.nombre = 'SOCIO'
      JOIN personas p           ON p.id = pr.persona_id AND p.deleted_at IS NULL
     WHERE i.estado NOT IN ('CANCELADA', 'BAJA_CAMBIO_PLAN')
       AND i.fecha_inicio <= ${fin}::date
       AND i.fecha_fin    >= ${inicio}::date
     GROUP BY p.empresa_id`;
  return new Map(filas.map(f => [f.empresa_id, Number(f.socios)]));
}

export interface UsoSemana { asistencias: number; inscripciones: number; ultimoIngresoUsuario: string | null }

/** Uso de los últimos 7 días por gimnasio: ingresos registrados, membresías cargadas y último login. */
export async function usoUltimaSemana(ahora: Date = new Date()): Promise<Map<string, UsoSemana>> {
  const desde = new Date(ahora.getTime() - 7 * 86_400_000);
  const [asis, insc, logins] = await Promise.all([
    prisma.$queryRaw<{ empresa_id: string; n: bigint }[]>`
      SELECT s.empresa_id, count(*) AS n FROM asistencias a JOIN sucursales s ON s.id = a.sucursal_id
       WHERE a.fecha_hora_ingreso >= ${desde} GROUP BY s.empresa_id`,
    prisma.$queryRaw<{ empresa_id: string; n: bigint }[]>`
      SELECT s.empresa_id, count(*) AS n FROM inscripciones i JOIN sucursales s ON s.id = i.sucursal_id
       WHERE i.created_at >= ${desde} GROUP BY s.empresa_id`,
    prisma.usuario.groupBy({ by: ['empresaId'], where: { deletedAt: null }, _max: { ultimoLogin: true } }),
  ]);
  const uso = new Map<string, UsoSemana>();
  const de = (id: string) => {
    if (!uso.has(id)) uso.set(id, { asistencias: 0, inscripciones: 0, ultimoIngresoUsuario: null });
    return uso.get(id)!;
  };
  asis.forEach(f => { de(f.empresa_id).asistencias = Number(f.n); });
  insc.forEach(f => { de(f.empresa_id).inscripciones = Number(f.n); });
  logins.forEach(l => { de(l.empresaId).ultimoIngresoUsuario = l._max.ultimoLogin?.toISOString() ?? null; });
  return uso;
}

// ----------------------------------------------------------------------------- cuadro de cobros

export async function cuadroCobros(hoy: string = hoyArgentina(), ahora: Date = new Date()) {
  const periodo = periodoDe(hoy);
  const config = await obtenerConfigCobro();
  const [empresas, planesDb, socios, uso] = await Promise.all([
    prisma.empresa.findMany({
      where: { deletedAt: null },
      select: {
        id: true, nombre: true, nombreComercial: true, slug: true, activo: true, createdAt: true,
        planComercialId: true, precioAcordado: true, pruebaHasta: true, pagadoHasta: true, notasCobro: true,
        condicionIva: true, emailCobro: true, cuit: true,
        pagosSuscripcion: {
          where: { anuladoAt: null }, orderBy: [{ fechaPago: 'desc' }, { createdAt: 'desc' }], take: 1,
          select: { fechaPago: true, monto: true, meses: true, medio: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.planComercial.findMany(),
    sociosActivosPorEmpresa(periodo),
    usoUltimaSemana(ahora),
  ]);
  const planes = planesDb.map(planLite);
  const porId  = new Map(planes.map(p => [p.id, p]));

  const filas = empresas.map(e => {
    const plan          = e.planComercialId ? porId.get(e.planComercialId) ?? null : null;
    const sociosActivos = socios.get(e.id) ?? 0;
    const sugerido      = planSugerido(planes, sociosActivos);
    const pagadoHasta   = fecha(e.pagadoHasta);
    const pruebaHasta   = fecha(e.pruebaHasta);
    const estado        = estadoCobro({ planComercialId: e.planComercialId, pruebaHasta, pagadoHasta }, hoy);
    const ultimo        = e.pagosSuscripcion[0];
    return {
      empresaId:       e.id,
      nombre:          e.nombreComercial ?? e.nombre,
      slug:            e.slug,
      activo:          e.activo,
      plan:            plan ? { id: plan.id, nombre: plan.nombre, maxSocios: plan.maxSocios } : null,
      precioAcordado:  num(e.precioAcordado),
      precioMensual:   precioMensualDe(num(e.precioAcordado), plan),
      pruebaHasta,
      pagadoHasta,
      notasCobro:      e.notasCobro,
      condicionIva:    e.condicionIva,
      emailCobro:      e.emailCobro,
      cuit:            e.cuit,
      facturaTipo:     tipoFacturaPara(config.condicionIva, e.condicionIva),
      estado,
      diasVencido:     estado === 'VENCIDO' && pagadoHasta ? diasEntre(pagadoHasta, hoy) : null,
      desdeSugerido:   desdeSugerido(pagadoHasta, hoy),
      sociosActivos,
      planSugerido:    sugerido ? { id: sugerido.id, nombre: sugerido.nombre } : null,
      excedePlan:      !!plan && plan.maxSocios !== null && sociosActivos > plan.maxSocios,
      ultimoPago:      ultimo ? { fechaPago: fecha(ultimo.fechaPago), monto: num(ultimo.monto), meses: ultimo.meses, medio: ultimo.medio } : null,
      usoSemana:       uso.get(e.id) ?? { asistencias: 0, inscripciones: 0, ultimoIngresoUsuario: null },
    };
  });

  // Lo que se espera cobrar por mes: gimnasios activos que no están en prueba, con precio definido.
  const esperadoMensual = filas
    .filter(f => f.activo && f.estado !== 'PRUEBA' && f.precioMensual !== null)
    .reduce((a, f) => a + (f.precioMensual ?? 0), 0);

  return {
    hoy, periodo,
    emisor: { condicionIva: config.condicionIva, puntoVenta: config.puntoVenta },
    resumen: {
      esperadoMensual,
      vencidos:   filas.filter(f => f.activo && f.estado === 'VENCIDO').length,
      porVencer:  filas.filter(f => f.activo && f.estado === 'POR_VENCER').length,
      enPrueba:   filas.filter(f => f.activo && f.estado === 'PRUEBA').length,
      sinPlan:    filas.filter(f => f.activo && f.estado === 'SIN_PLAN').length,
    },
    planes,
    gimnasios: filas,
  };
}

// ----------------------------------------------------------------------------- plan de un gimnasio

export interface CobroEmpresaInput {
  planComercialId?: unknown; precioAcordado?: unknown; pruebaHasta?: unknown; notasCobro?: unknown;
  condicionIva?: unknown; emailCobro?: unknown;
}

const CONDICIONES_IVA = ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL'];

export async function editarCobroEmpresa(empresaId: string, b: CobroEmpresaInput) {
  const data: Prisma.EmpresaUncheckedUpdateInput = {};
  if (b.planComercialId !== undefined) {
    if (b.planComercialId === null || b.planComercialId === '') data.planComercialId = null;
    else {
      if (typeof b.planComercialId !== 'string') throw new CobroError('Plan inválido');
      const plan = await prisma.planComercial.findUnique({ where: { id: b.planComercialId } }).catch(() => null);
      if (!plan) throw new CobroError('Plan no encontrado', 404);
      data.planComercialId = plan.id;
    }
  }
  if (b.precioAcordado !== undefined) {
    if (b.precioAcordado === null || b.precioAcordado === '') data.precioAcordado = null;
    else {
      const p = Number(b.precioAcordado);
      if (!Number.isFinite(p) || p < 0) throw new CobroError('Precio acordado inválido');
      data.precioAcordado = new Prisma.Decimal(p.toFixed(2));
    }
  }
  if (b.pruebaHasta !== undefined) {
    if (b.pruebaHasta === null || b.pruebaHasta === '') data.pruebaHasta = null;
    else {
      if (typeof b.pruebaHasta !== 'string' || !esFechaValida(b.pruebaHasta)) throw new CobroError('Fecha de fin de prueba inválida');
      data.pruebaHasta = aFechaDB(b.pruebaHasta);
    }
  }
  if (b.notasCobro !== undefined) {
    if (b.notasCobro !== null && typeof b.notasCobro !== 'string') throw new CobroError('Notas inválidas');
    data.notasCobro = (b.notasCobro as string | null)?.trim().slice(0, 2000) || null;
  }
  if (b.condicionIva !== undefined) {
    if (b.condicionIva === null || b.condicionIva === '') data.condicionIva = null;
    else {
      if (typeof b.condicionIva !== 'string' || !CONDICIONES_IVA.includes(b.condicionIva)) throw new CobroError('Condición frente al IVA inválida');
      data.condicionIva = b.condicionIva;
    }
  }
  if (b.emailCobro !== undefined) {
    const m = typeof b.emailCobro === 'string' ? b.emailCobro.trim().toLowerCase() : '';
    if (b.emailCobro !== null && m && (m.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m))) throw new CobroError('Mail de cobro inválido');
    data.emailCobro = m || null;
  }
  if (Object.keys(data).length === 0) throw new CobroError('No hay nada para cambiar');
  try {
    const e = await prisma.empresa.update({ where: { id: empresaId }, data });
    return {
      empresaId: e.id, planComercialId: e.planComercialId, precioAcordado: num(e.precioAcordado), pruebaHasta: fecha(e.pruebaHasta),
      notasCobro: e.notasCobro, condicionIva: e.condicionIva, emailCobro: e.emailCobro,
    };
  } catch (e: any) {
    if (e.code === 'P2025' || e.code === 'P2023') throw new CobroError('Gimnasio no encontrado', 404);
    throw e;
  }
}

// ----------------------------------------------------------------------------- pagos

/** Campos del pago sin el PDF (el PDF se baja aparte: no viaja en las listas). */
export const SELECT_PAGO = {
  id: true, empresaId: true, planNombre: true, fechaPago: true, monto: true, meses: true,
  periodoDesde: true, periodoHasta: true, medio: true, referencia: true, notas: true,
  anuladoAt: true, anuladoMotivo: true, createdAt: true,
  facturaTipo: true, facturaPuntoVenta: true, facturaNumero: true, facturaFecha: true,
  facturaCae: true, facturaCaeVto: true, facturaOrigen: true, facturaPdfNombre: true,
  enviadoAt: true, enviadoA: true,
} satisfies Prisma.PagoSuscripcionSelect;

function pagoDto(p: any) {
  return {
    id: p.id, empresaId: p.empresaId, planNombre: p.planNombre,
    fechaPago: fecha(p.fechaPago), monto: num(p.monto), meses: p.meses,
    periodoDesde: fecha(p.periodoDesde), periodoHasta: fecha(p.periodoHasta),
    medio: p.medio, referencia: p.referencia, notas: p.notas,
    anuladoAt: p.anuladoAt?.toISOString() ?? null, anuladoMotivo: p.anuladoMotivo, createdAt: p.createdAt.toISOString(),
    factura: p.facturaNumero ? {
      tipo: p.facturaTipo, puntoVenta: p.facturaPuntoVenta, numero: p.facturaNumero,
      fecha: fecha(p.facturaFecha), cae: p.facturaCae, caeVto: fecha(p.facturaCaeVto),
      origen: p.facturaOrigen, tienePdf: !!p.facturaPdfNombre,
    } : null,
    enviadoAt: p.enviadoAt?.toISOString() ?? null, enviadoA: p.enviadoA ?? null,
  };
}

export async function listarPagos(empresaId: string) {
  const pagos = await prisma.pagoSuscripcion.findMany({
    where: { empresaId }, orderBy: [{ periodoDesde: 'desc' }, { createdAt: 'desc' }], select: SELECT_PAGO,
  });
  return pagos.map(pagoDto);
}

export interface PagoInput {
  fechaPago?: unknown; monto?: unknown; meses?: unknown; medio?: unknown;
  referencia?: unknown; notas?: unknown; periodoDesde?: unknown;
}

/**
 * Registra un pago y corre "pagado hasta". Bloquea la fila del gimnasio para que
 * dos pagos simultáneos no calculen el mismo período.
 */
export async function registrarPago(empresaId: string, b: PagoInput, hoy: string = hoyArgentina()) {
  const fechaPago = b.fechaPago === undefined || b.fechaPago === '' ? hoy : b.fechaPago;
  if (typeof fechaPago !== 'string' || !esFechaValida(fechaPago)) throw new CobroError('Fecha de pago inválida');
  if (fechaPago > hoy) throw new CobroError('La fecha de pago no puede ser futura');
  const monto = Number(b.monto);
  if (!Number.isFinite(monto) || monto <= 0) throw new CobroError('El monto tiene que ser mayor a 0');
  const meses = Number(b.meses ?? 1);
  if (!Number.isInteger(meses) || meses < 1 || meses > 24) throw new CobroError('Meses tiene que ser entre 1 y 24');
  const medio = b.medio ?? 'TRANSFERENCIA';
  if (!MEDIOS_PAGO_SUSCRIPCION.includes(medio as MedioPagoSuscripcion)) throw new CobroError('Medio de pago inválido');
  if (b.periodoDesde !== undefined && b.periodoDesde !== '' &&
      (typeof b.periodoDesde !== 'string' || !esFechaValida(b.periodoDesde))) throw new CobroError('Fecha "desde" inválida');
  const referencia = typeof b.referencia === 'string' ? b.referencia.trim().slice(0, 100) || null : null;
  const notas      = typeof b.notas === 'string' ? b.notas.trim().slice(0, 2000) || null : null;

  return prisma.$transaction(async tx => {
    const filas = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM empresas WHERE id = ${empresaId}::uuid FOR UPDATE`;
    if (filas.length === 0) throw new CobroError('Gimnasio no encontrado', 404);
    const emp = await tx.empresa.findUniqueOrThrow({
      where: { id: empresaId }, include: { planComercial: { select: { id: true, nombre: true } } },
    });
    const pagadoHasta = fecha(emp.pagadoHasta);
    const desde = typeof b.periodoDesde === 'string' && b.periodoDesde ? b.periodoDesde : desdeSugerido(pagadoHasta, hoy);
    const periodo = periodoCubierto(desde, meses);

    // Un pago no puede pisar un período ya pagado (evita cobrar dos veces el mismo mes).
    const pisa = await tx.pagoSuscripcion.findFirst({
      where: { empresaId, anuladoAt: null, periodoDesde: { lte: aFechaDB(periodo.hasta) }, periodoHasta: { gte: aFechaDB(periodo.desde) } },
      select: { periodoDesde: true, periodoHasta: true },
    });
    if (pisa) {
      throw new CobroError(`Ese período se superpone con un pago ya registrado (${fecha(pisa.periodoDesde)} a ${fecha(pisa.periodoHasta)})`, 409);
    }

    const pago = await tx.pagoSuscripcion.create({ select: SELECT_PAGO, data: {
      empresaId, planComercialId: emp.planComercial?.id ?? null, planNombre: emp.planComercial?.nombre ?? null,
      fechaPago: aFechaDB(fechaPago), monto: new Prisma.Decimal(monto.toFixed(2)), meses,
      periodoDesde: aFechaDB(periodo.desde), periodoHasta: aFechaDB(periodo.hasta),
      medio: medio as string, referencia, notas,
    } });
    const nuevoHasta = !pagadoHasta || periodo.hasta > pagadoHasta ? periodo.hasta : pagadoHasta;
    await tx.empresa.update({ where: { id: empresaId }, data: { pagadoHasta: aFechaDB(nuevoHasta) } });
    return { pago: pagoDto(pago), pagadoHasta: nuevoHasta };
  });
}

/** Anula un pago (queda en el historial) y recalcula "pagado hasta" con los pagos que quedan. */
export async function anularPago(pagoId: string, motivo: unknown) {
  const m = typeof motivo === 'string' ? motivo.trim() : '';
  if (m.length < 3) throw new CobroError('Escribí el motivo de la anulación');
  return prisma.$transaction(async tx => {
    const pago = await tx.pagoSuscripcion.findUnique({ where: { id: pagoId }, select: { empresaId: true, anuladoAt: true } }).catch(() => null);
    if (!pago) throw new CobroError('Pago no encontrado', 404);
    if (pago.anuladoAt) throw new CobroError('Ese pago ya estaba anulado', 409);
    await tx.$queryRaw`SELECT id FROM empresas WHERE id = ${pago.empresaId}::uuid FOR UPDATE`;
    const anulado = await tx.pagoSuscripcion.update({
      where: { id: pagoId }, data: { anuladoAt: new Date(), anuladoMotivo: m.slice(0, 500) }, select: SELECT_PAGO,
    });
    const max = await tx.pagoSuscripcion.aggregate({
      where: { empresaId: pago.empresaId, anuladoAt: null }, _max: { periodoHasta: true },
    });
    await tx.empresa.update({ where: { id: pago.empresaId }, data: { pagadoHasta: max._max.periodoHasta } });
    return { pago: pagoDto(anulado), pagadoHasta: fecha(max._max.periodoHasta) };
  });
}
