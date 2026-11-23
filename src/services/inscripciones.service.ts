// =============================================================================
// SmartGym · Inscripciones (membresías)
//
// Reglas (ver claude/SMARTGYM-CUOTA-MENSUAL-CAMBIO-PLAN.md en el proyecto):
//  - Todo se valida contra la empresa del JWT (nunca se confía en un id suelto).
//  - Planes MES_CALENDARIO: una inscripción por mes (periodo = día 1), monto
//    según el día de pago (bonificado / normal / recargo, ver calcularCuota).
//  - Planes DIAS: comportamiento de siempre (fecha_inicio + duracion_dias).
//  - Un solo plan ACTIVA por socio (índice único en la base): siempre se da de
//    baja/vence la anterior ANTES de activar la nueva, en la misma transacción.
//  - Cambio de plan: la actual queda BAJA_CAMBIO_PLAN y la nueva apunta a ella
//    (inscripcion_origen_id). Nunca se edita ni se borra historial ni pagos.
// =============================================================================
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/httpError';
import { calcularCuota, configDeEmpresa, SELECT_REGLA_EMPRESA } from '../lib/calcularCuota';
import {
  hoyArgentina, fechaArgentina, deFechaDB, aFechaDB, sumarDias, periodoDe,
  finDePeriodo, sumarMeses, maxFecha, minFecha, formatoMes, formatoFecha,
} from '../lib/fechas';
import {
  CrearInscripcionInput, CambiarEstadoInput, CambiarPlanInput, PreviewAltaInput,
} from '../schemas/inscripciones.schema';

type Tx = Prisma.TransactionClient;
type PlanRow = Prisma.PlanGetPayload<{}>;
type InscripcionConPlan = Prisma.InscripcionGetPayload<{ include: { plan: true } }>;

/** Estados que son historial cerrado: no cuentan como "la inscripción vigente". */
const ESTADOS_HISTORICOS = ['BAJA_CAMBIO_PLAN', 'CANCELADA'];

export interface PlanCuota {
  modalidad:   'DIAS' | 'MES_CALENDARIO';
  periodo:     string | null;   // 'YYYY-MM-01' o null
  fechaInicio: string;
  fechaFin:    string;
  tramo:       'BONIFICADO' | 'NORMAL' | 'RECARGO' | null;
  monto:       number;
}

// ── Helpers de verificación por empresa ────────────────────────────────────

async function planDeEmpresa(tx: Tx, empresaId: string, planId: string): Promise<PlanRow> {
  const plan = await tx.plan.findFirst({ where: { id: planId, empresaId, activo: true, deletedAt: null } });
  if (!plan) throw new HttpError(404, 'Plan no encontrado o inactivo');
  return plan;
}

async function inscripcionDeEmpresa(tx: Tx, empresaId: string, id: string): Promise<InscripcionConPlan> {
  const ins = await tx.inscripcion.findFirst({ where: { id, plan: { empresaId } }, include: { plan: true } });
  if (!ins) throw new HttpError(404, 'Inscripción no encontrada');
  return ins;
}

async function verificarSocio(tx: Tx, empresaId: string, personaRolId: string) {
  const pr = await tx.personaRol.findFirst({ where: { id: personaRolId, persona: { empresaId, deletedAt: null } } });
  if (!pr) throw new HttpError(404, 'Socio no encontrado');
  return pr;
}

async function verificarSucursal(tx: Tx, empresaId: string, sucursalId: string) {
  const s = await tx.sucursal.findFirst({ where: { id: sucursalId, empresaId, deletedAt: null } });
  if (!s) throw new HttpError(404, 'Sucursal no encontrada');
  return s;
}

async function verificarMedioPago(tx: Tx, empresaId: string, medioPagoId: string) {
  const m = await tx.medioPago.findFirst({ where: { id: medioPagoId, empresaId, activo: true } });
  if (!m) throw new HttpError(404, 'Medio de pago no encontrado');
  return m;
}

async function configTramos(tx: Tx, empresaId: string) {
  const e = await tx.empresa.findUniqueOrThrow({ where: { id: empresaId }, select: SELECT_REGLA_EMPRESA });
  return configDeEmpresa(e);
}

/** ¿El socio nunca tuvo una inscripción (sin contar la indicada)? => es alta. */
async function esAlta(tx: Tx, personaRolId: string, excluirId?: string) {
  const previas = await tx.inscripcion.count({
    where: { personaRolId, ...(excluirId ? { id: { not: excluirId } } : {}) },
  });
  return previas === 0;
}

/** ¿Hay una inscripción del socio más nueva que esta (y no es historial)? */
async function hayMasReciente(tx: Tx, ins: InscripcionConPlan) {
  const n = await tx.inscripcion.count({
    where: {
      personaRolId: ins.personaRolId,
      id:           { not: ins.id },
      createdAt:    { gt: ins.createdAt },
      estado:       { notIn: ESTADOS_HISTORICOS },
    },
  });
  return n > 0;
}

/** Calcula fechas y monto de una inscripción nueva para un plan. */
async function planificar(
  tx: Tx, empresaId: string, plan: PlanRow,
  opts: { inicio: string; periodo?: string; hoy: string; esAlta: boolean },
): Promise<PlanCuota> {
  if (plan.modalidadCobro === 'MES_CALENDARIO') {
    const periodo = opts.periodo ?? periodoDe(opts.inicio);
    const cfg = await configTramos(tx, empresaId);
    const { tramo, monto } = calcularCuota(plan, cfg, periodo, opts.hoy, { esAlta: opts.esAlta });
    return {
      modalidad: 'MES_CALENDARIO', periodo,
      fechaInicio: maxFecha(opts.inicio, periodo),
      fechaFin: finDePeriodo(periodo),
      tramo, monto,
    };
  }
  return {
    modalidad: 'DIAS', periodo: null,
    fechaInicio: opts.inicio,
    fechaFin: sumarDias(opts.inicio, plan.duracionDias),
    tramo: null,
    monto: Number(plan.precio),
  };
}

/** Si el socio tiene una ACTIVA ya vencida por fecha, la pasa a VENCIDA. Devuelve la ACTIVA vigente (o null). */
async function vencerActivaCaducada(tx: Tx, personaRolId: string, hoy: string) {
  const activa = await tx.inscripcion.findFirst({ where: { personaRolId, estado: 'ACTIVA' }, include: { plan: true } });
  if (!activa) return null;
  if (deFechaDB(activa.fechaFin) < hoy) {
    await tx.inscripcion.update({ where: { id: activa.id }, data: { estado: 'VENCIDA' } });
    return null;
  }
  return activa;
}

/** Traduce el choque con los índices únicos de la base a un 409 entendible. */
function traducirDuplicado(e: unknown, periodo: string | null): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    const idx = JSON.stringify(e.meta ?? {});
    if (idx.includes('periodo')) {
      throw new HttpError(409, `La cuota de ${periodo ? formatoMes(periodo) : 'ese mes'} para este plan ya está registrada.`);
    }
    throw new HttpError(409, 'El socio ya tiene una inscripción activa.');
  }
  throw e;
}

async function registrarPago(tx: Tx, inscripcionId: string, medioPagoId: string, monto: number, usuarioId: string) {
  return tx.pago.create({
    data: { inscripcionId, medioPagoId, monto, estado: 'APROBADO', usuarioId },
  });
}

const nota = (previa: string | null, agregado: string) =>
  [previa, agregado].filter(Boolean).join(' | ').slice(0, 2000);

// ── Servicio ────────────────────────────────────────────────────────────────

export class InscripcionesService {

  // Alta de una inscripción nueva (socio sin plan vigente).
  async crear(empresaId: string, usuarioId: string, input: CrearInscripcionInput) {
    let periodo: string | null = null;
    try {
      return await prisma.$transaction(async (tx) => {
        const plan = await planDeEmpresa(tx, empresaId, input.planId);
        await verificarSocio(tx, empresaId, input.personaRolId);
        await verificarSucursal(tx, empresaId, input.sucursalId);
        if (input.medioPagoId) await verificarMedioPago(tx, empresaId, input.medioPagoId);

        const hoy = hoyArgentina();
        const activa = await vencerActivaCaducada(tx, input.personaRolId, hoy);
        if (activa) {
          throw new HttpError(409,
            `El socio ya tiene una inscripción activa (${activa.plan.nombre}, vence ${formatoFecha(deFechaDB(activa.fechaFin))}). ` +
            'Para cambiar de plan usá "Cambiar plan"; para pagar el período siguiente, "Renovar".');
        }

        const p = await planificar(tx, empresaId, plan, {
          inicio: input.fechaInicio, hoy, esAlta: await esAlta(tx, input.personaRolId),
        });
        periodo = p.periodo;

        const inscripcion = await tx.inscripcion.create({
          data: {
            personaRolId:  input.personaRolId,
            planId:        plan.id,
            sucursalId:    input.sucursalId,
            fechaInicio:   aFechaDB(p.fechaInicio),
            fechaFin:      aFechaDB(p.fechaFin),
            periodo:       p.periodo ? aFechaDB(p.periodo) : null,
            tramoPrecio:   p.tramo,
            precioPagado:  p.monto,
            estado:        input.medioPagoId ? 'ACTIVA' : 'PENDIENTE',
            observaciones: input.observaciones ?? null,
          },
          include: { plan: true },
        });

        if (input.medioPagoId) await registrarPago(tx, inscripcion.id, input.medioPagoId, p.monto, usuarioId);
        return inscripcion;
      });
    } catch (e) { traducirDuplicado(e, periodo); }
  }

  // ── Renovación ──────────────────────────────────────────────────────────

  private async planificarRenovacion(tx: Tx, empresaId: string, ins: InscripcionConPlan, hoy: string): Promise<PlanCuota> {
    if (ESTADOS_HISTORICOS.includes(ins.estado)) {
      throw new HttpError(409, 'No se puede renovar una inscripción dada de baja o cancelada.');
    }
    if (await hayMasReciente(tx, ins)) {
      throw new HttpError(409, 'Esta membresía ya fue renovada: hay una inscripción más reciente. Renová desde la última.');
    }
    if (!ins.plan.activo || ins.plan.deletedAt) {
      throw new HttpError(409, 'El plan de esta inscripción ya no está disponible. Usá "Cambiar plan".');
    }

    const fin = deFechaDB(ins.fechaFin);
    const vigente = ins.estado === 'ACTIVA' && fin >= hoy;

    if (ins.plan.modalidadCobro === 'MES_CALENDARIO') {
      const actual = periodoDe(hoy);
      const siguiente = ins.periodo
        ? sumarMeses(deFechaDB(ins.periodo), 1)
        : (vigente ? periodoDe(sumarDias(fin, 1)) : actual);
      // Si vuelve después de meses sin venir, se cobra el mes actual (no se acumula deuda).
      const periodo = maxFecha(siguiente, actual);
      return planificar(tx, empresaId, ins.plan, { inicio: periodo, periodo, hoy, esAlta: false });
    }

    // DIAS: si todavía está vigente, la nueva arranca donde termina la actual
    // (el socio no pierde días por pagar antes); si no, arranca hoy.
    return planificar(tx, empresaId, ins.plan, { inicio: vigente ? fin : hoy, hoy, esAlta: false });
  }

  async previewRenovacion(empresaId: string, inscripcionId: string) {
    return prisma.$transaction(async (tx) => {
      const ins = await inscripcionDeEmpresa(tx, empresaId, inscripcionId);
      return this.planificarRenovacion(tx, empresaId, ins, hoyArgentina());
    });
  }

  async renovar(empresaId: string, usuarioId: string, inscripcionId: string, medioPagoId?: string) {
    let periodo: string | null = null;
    try {
      return await prisma.$transaction(async (tx) => {
        const ins = await inscripcionDeEmpresa(tx, empresaId, inscripcionId);
        const hoy = hoyArgentina();

        // Anti doble cobro: una membresía creada y cobrada hoy no se vuelve a renovar.
        // (Los duplicados de nov-2026 fueron renovaciones repetidas para "corregir" el medio de pago.)
        if (fechaArgentina(ins.createdAt) === hoy) {
          const pagosHoy = await tx.pago.count({ where: { inscripcionId: ins.id, estado: 'APROBADO' } });
          if (pagosHoy > 0) {
            throw new HttpError(409,
              'Esta membresía ya se cobró hoy. Si te equivocaste de medio de pago, usá "Corregir medio de pago".');
          }
        }

        if (medioPagoId) await verificarMedioPago(tx, empresaId, medioPagoId);
        const p = await this.planificarRenovacion(tx, empresaId, ins, hoy);
        periodo = p.periodo;

        // Primero vencer la anterior (índice único: un solo ACTIVA por socio).
        if (ins.estado === 'ACTIVA' || ins.estado === 'PENDIENTE') {
          await tx.inscripcion.update({ where: { id: ins.id }, data: { estado: 'VENCIDA' } });
        }

        const nueva = await tx.inscripcion.create({
          data: {
            personaRolId:  ins.personaRolId,
            planId:        ins.planId,
            sucursalId:    ins.sucursalId,
            fechaInicio:   aFechaDB(p.fechaInicio),
            fechaFin:      aFechaDB(p.fechaFin),
            periodo:       p.periodo ? aFechaDB(p.periodo) : null,
            tramoPrecio:   p.tramo,
            precioPagado:  p.monto,
            estado:        medioPagoId ? 'ACTIVA' : 'PENDIENTE',
          },
        });

        if (medioPagoId) await registrarPago(tx, nueva.id, medioPagoId, p.monto, usuarioId);
        return nueva;
      });
    } catch (e) { traducirDuplicado(e, periodo); }
  }

  // ── Cobrar una inscripción PENDIENTE (el monto se calcula al día del pago) ──

  private async planificarCobro(tx: Tx, empresaId: string, ins: InscripcionConPlan, hoy: string) {
    if (ins.estado !== 'PENDIENTE') throw new HttpError(409, 'Solo se pueden cobrar inscripciones pendientes de pago.');
    let monto = Number(ins.plan.precio);
    let tramo: 'BONIFICADO' | 'NORMAL' | 'RECARGO' | null = null;
    if (ins.plan.modalidadCobro === 'MES_CALENDARIO' && ins.periodo) {
      const cfg = await configTramos(tx, empresaId);
      const r = calcularCuota(ins.plan, cfg, deFechaDB(ins.periodo), hoy,
        { esAlta: await esAlta(tx, ins.personaRolId, ins.id) });
      monto = r.monto; tramo = r.tramo;
    }
    return {
      periodo: ins.periodo ? deFechaDB(ins.periodo) : null,
      fechaInicio: deFechaDB(ins.fechaInicio),
      fechaFin: deFechaDB(ins.fechaFin),
      tramo, monto,
    };
  }

  async previewCobro(empresaId: string, inscripcionId: string) {
    return prisma.$transaction(async (tx) => {
      const ins = await inscripcionDeEmpresa(tx, empresaId, inscripcionId);
      return this.planificarCobro(tx, empresaId, ins, hoyArgentina());
    });
  }

  async cobrar(empresaId: string, usuarioId: string, inscripcionId: string, medioPagoId: string) {
    return prisma.$transaction(async (tx) => {
      const ins = await inscripcionDeEmpresa(tx, empresaId, inscripcionId);
      const { monto, tramo } = await this.planificarCobro(tx, empresaId, ins, hoyArgentina());
      await verificarMedioPago(tx, empresaId, medioPagoId);

      // Si quedó otra ACTIVA del socio, se vence antes de activar esta.
      await tx.inscripcion.updateMany({
        where: { personaRolId: ins.personaRolId, estado: 'ACTIVA', id: { not: ins.id } },
        data:  { estado: 'VENCIDA' },
      });
      const actualizada = await tx.inscripcion.update({
        where: { id: ins.id },
        data:  { estado: 'ACTIVA', precioPagado: monto, tramoPrecio: tramo },
      });
      await registrarPago(tx, ins.id, medioPagoId, monto, usuarioId);
      return actualizada;
    });
  }

  // ── Cambio de plan / disciplina ─────────────────────────────────────────

  private async planificarCambio(tx: Tx, empresaId: string, ins: InscripcionConPlan, nuevoPlan: PlanRow, hoy: string) {
    if (!['ACTIVA', 'PENDIENTE'].includes(ins.estado)) {
      throw new HttpError(409, 'Solo se puede cambiar el plan de una inscripción activa o pendiente.');
    }
    if (await hayMasReciente(tx, ins)) {
      throw new HttpError(409, 'Hay una inscripción más reciente de este socio: cambiá el plan desde esa.');
    }
    if (nuevoPlan.id === ins.planId) throw new HttpError(400, 'El socio ya tiene ese plan.');

    const finActual = deFechaDB(ins.fechaFin);
    const inicio = maxFecha(hoy, deFechaDB(ins.fechaInicio));
    // Período ya pagado y vigente: el plan nuevo hereda la cobertura sin cobrar
    // (el plan nuevo se cobra en la próxima renovación).
    const cubierto = ins.estado === 'ACTIVA' && finActual >= hoy;

    if (cubierto) {
      const p: PlanCuota = {
        modalidad: nuevoPlan.modalidadCobro === 'MES_CALENDARIO' ? 'MES_CALENDARIO' : 'DIAS',
        periodo:   nuevoPlan.modalidadCobro === 'MES_CALENDARIO' ? periodoDe(inicio) : null,
        fechaInicio: inicio,
        fechaFin:    finActual,
        tramo:     null,
        monto:     0,
      };
      return { cubierto, p };
    }
    // No estaba pagado (o ya venció): el plan nuevo se cobra normalmente.
    const p = await planificar(tx, empresaId, nuevoPlan, {
      inicio, hoy, esAlta: false,
      ...(nuevoPlan.modalidadCobro === 'MES_CALENDARIO' && ins.periodo ? { periodo: maxFecha(deFechaDB(ins.periodo), periodoDe(hoy)) } : {}),
    });
    return { cubierto, p };
  }

  async previewCambioPlan(empresaId: string, inscripcionId: string, planId: string) {
    return prisma.$transaction(async (tx) => {
      const ins = await inscripcionDeEmpresa(tx, empresaId, inscripcionId);
      const nuevoPlan = await planDeEmpresa(tx, empresaId, planId);
      const { cubierto, p } = await this.planificarCambio(tx, empresaId, ins, nuevoPlan, hoyArgentina());
      return { ...p, periodoYaPagado: cubierto };
    });
  }

  async cambiarPlan(empresaId: string, usuarioId: string, inscripcionId: string, input: CambiarPlanInput) {
    let periodo: string | null = null;
    try {
      return await prisma.$transaction(async (tx) => {
        const ins = await inscripcionDeEmpresa(tx, empresaId, inscripcionId);
        const nuevoPlan = await planDeEmpresa(tx, empresaId, input.planId);
        const hoy = hoyArgentina();
        const { cubierto, p } = await this.planificarCambio(tx, empresaId, ins, nuevoPlan, hoy);
        periodo = p.periodo;

        if (cubierto && input.medioPagoId) {
          throw new HttpError(400, 'El período actual ya está pagado: el plan nuevo se cobra en la próxima renovación.');
        }
        if (input.medioPagoId) await verificarMedioPago(tx, empresaId, input.medioPagoId);

        // 1) Baja de la actual (primero, por el índice de un solo ACTIVA por socio).
        //    Termina el día del cambio (o antes, si ya había terminado).
        const corte = maxFecha(hoy, deFechaDB(ins.fechaInicio));
        const finBaja = minFecha(corte, deFechaDB(ins.fechaFin));
        await tx.inscripcion.update({
          where: { id: ins.id },
          data: {
            estado:        'BAJA_CAMBIO_PLAN',
            fechaFin:      aFechaDB(finBaja),
            observaciones: nota(ins.observaciones, `Cambio de plan a "${nuevoPlan.nombre}" el ${formatoFecha(hoy)}`),
          },
        });

        // 2) Alta de la nueva, vinculada a la anterior
        const activar = cubierto || !!input.medioPagoId;
        const nueva = await tx.inscripcion.create({
          data: {
            personaRolId:        ins.personaRolId,
            planId:              nuevoPlan.id,
            sucursalId:          ins.sucursalId,
            fechaInicio:         aFechaDB(p.fechaInicio),
            fechaFin:            aFechaDB(p.fechaFin),
            periodo:             p.periodo ? aFechaDB(p.periodo) : null,
            tramoPrecio:         cubierto ? 'CAMBIO_PLAN' : p.tramo,
            precioPagado:        p.monto,
            estado:              activar ? 'ACTIVA' : 'PENDIENTE',
            inscripcionOrigenId: ins.id,
            observaciones:       nota(
              cubierto ? `Viene de "${ins.plan.nombre}" — período cubierto por la inscripción anterior` : `Viene de "${ins.plan.nombre}"`,
              input.observaciones ?? '',
            ),
          },
          include: { plan: true },
        });

        if (!cubierto && input.medioPagoId) await registrarPago(tx, nueva.id, input.medioPagoId, p.monto, usuarioId);
        return nueva;
      });
    } catch (e) { traducirDuplicado(e, periodo); }
  }

  // ── Corregir el medio de pago del último cobro (solo el mismo día y sin caja cerrada) ──

  async corregirMedioPago(empresaId: string, inscripcionId: string, medioPagoId: string) {
    return prisma.$transaction(async (tx) => {
      const ins = await inscripcionDeEmpresa(tx, empresaId, inscripcionId);
      const pago = await tx.pago.findFirst({
        where: { inscripcionId: ins.id, estado: 'APROBADO' },
        orderBy: { fecha: 'desc' },
      });
      if (!pago) throw new HttpError(404, 'Esta inscripción no tiene pagos registrados.');

      const diaPago = fechaArgentina(pago.fecha);
      if (diaPago !== hoyArgentina()) {
        throw new HttpError(409, 'Solo se puede corregir el medio de pago el mismo día del cobro.');
      }
      const cierre = await tx.cierreCaja.findFirst({ where: { sucursalId: ins.sucursalId, fecha: aFechaDB(diaPago) } });
      if (cierre) throw new HttpError(409, 'La caja de hoy ya está cerrada: no se puede corregir el medio de pago.');

      await verificarMedioPago(tx, empresaId, medioPagoId);
      return tx.pago.update({ where: { id: pago.id }, data: { medioPagoId } });
    });
  }

  // ── Preview de un alta (para mostrar el monto antes de cobrar) ──────────

  async previewAlta(empresaId: string, input: PreviewAltaInput) {
    return prisma.$transaction(async (tx) => {
      const plan = await planDeEmpresa(tx, empresaId, input.planId);
      if (input.personaRolId) await verificarSocio(tx, empresaId, input.personaRolId);
      const hoy = hoyArgentina();
      return planificar(tx, empresaId, plan, {
        inicio: input.fechaInicio ?? hoy, hoy,
        esAlta: input.personaRolId ? await esAlta(tx, input.personaRolId) : true,
      });
    });
  }

  // ── Cambio de estado manual ─────────────────────────────────────────────

  async cambiarEstado(empresaId: string, inscripcionId: string, input: CambiarEstadoInput) {
    try {
      return await prisma.$transaction(async (tx) => {
        const ins = await inscripcionDeEmpresa(tx, empresaId, inscripcionId);
        if (ins.estado === 'BAJA_CAMBIO_PLAN') {
          throw new HttpError(409, 'Esta inscripción quedó cerrada por un cambio de plan y no se puede modificar.');
        }
        return tx.inscripcion.update({
          where: { id: ins.id },
          data:  {
            estado: input.estado,
            ...(input.observaciones !== undefined ? { observaciones: input.observaciones } : {}),
          },
        });
      });
    } catch (e) { traducirDuplicado(e, null); }
  }

  async listar(empresaId: string, opts: { personaRolId?: string; estado?: string; page: number; limit: number }) {
    const { personaRolId, estado, page, limit } = opts;
    const skip = (page - 1) * limit;

    const where: any = { plan: { empresaId } };
    if (personaRolId) where.personaRolId = personaRolId;
    if (estado)       where.estado       = estado;

    const [total, inscripciones] = await prisma.$transaction([
      prisma.inscripcion.count({ where }),
      prisma.inscripcion.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          plan:      { select: { nombre: true, tipo: true, duracionDias: true, modalidadCobro: true } },
          sucursal:  { select: { nombre: true } },
          origen:    { select: { id: true, plan: { select: { nombre: true } } } },
          personaRol: {
            include: {
              persona: { select: { nombres: true, apellidos: true, qrCode: true } },
            },
          },
        },
      }),
    ]);

    return { total, inscripciones };
  }
}

export const inscripcionesService = new InscripcionesService();
