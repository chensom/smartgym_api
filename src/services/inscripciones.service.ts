import { prisma } from '../lib/prisma';
import { CrearInscripcionInput } from '../schemas/inscripciones.schema';
import { addDays } from '../lib/dates';

export class InscripcionesService {

  async crear(empresaId: string, usuarioId: string, input: CrearInscripcionInput) {
    return prisma.$transaction(async (tx) => {
      // 1. Verificar que el plan pertenece a la empresa
      const plan = await tx.plan.findFirstOrThrow({
        where: { id: input.planId, empresaId, activo: true, deletedAt: null },
      });

      // 2. Si ya tiene inscripción activa, la suspendemos para crear la nueva
      const activa = await tx.inscripcion.findFirst({
        where: { personaRolId: input.personaRolId, estado: 'ACTIVA' },
      });
      if (activa) {
        await tx.inscripcion.update({
          where: { id: activa.id },
          data:  { estado: 'SUSPENDIDA' },
        });
      }

      const fechaInicio = new Date(input.fechaInicio);
      const fechaFin    = addDays(fechaInicio, plan.duracionDias);

      // 3. Crear inscripción
      const inscripcion = await tx.inscripcion.create({
        data: {
          personaRolId:  input.personaRolId,
          planId:        input.planId,
          sucursalId:    input.sucursalId,
          fechaInicio,
          fechaFin,
          precioPagado:  plan.precio,
          estado:        input.medioPagoId ? 'ACTIVA' : 'PENDIENTE',
          observaciones: input.observaciones ?? null,
        },
        include: { plan: true },
      });

      // 4. Si viene medio de pago, registrar cobro inmediato
      if (input.medioPagoId) {
        await tx.pago.create({
          data: {
            inscripcionId: inscripcion.id,
            medioPagoId:   input.medioPagoId,
            monto:         plan.precio,
            estado:        'APROBADO',
            usuarioId,
          },
        });
      }

      return inscripcion;
    });
  }

  async renovar(empresaId: string, usuarioId: string, inscripcionId: string, medioPagoId?: string) {
    return prisma.$transaction(async (tx) => {
      const inscripcion = await tx.inscripcion.findFirstOrThrow({
        where:   { id: inscripcionId },
        include: { plan: true },
      });

      // Vencer la inscripción anterior
      await tx.inscripcion.update({
        where: { id: inscripcionId },
        data:  { estado: 'VENCIDA' },
      });

      const fechaInicio = new Date();
      const fechaFin    = addDays(fechaInicio, inscripcion.plan.duracionDias);

      const nueva = await tx.inscripcion.create({
        data: {
          personaRolId:  inscripcion.personaRolId,
          planId:        inscripcion.planId,
          sucursalId:    inscripcion.sucursalId,
          fechaInicio,
          fechaFin,
          precioPagado:  inscripcion.plan.precio,
          estado:        medioPagoId ? 'ACTIVA' : 'PENDIENTE',
        },
      });

      if (medioPagoId) {
        await tx.pago.create({
          data: {
            inscripcionId: nueva.id,
            medioPagoId,
            monto:         inscripcion.plan.precio,
            estado:        'APROBADO',
            usuarioId,
          },
        });
      }

      return nueva;
    });
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
          plan:      { select: { nombre: true, tipo: true, duracionDias: true } },
          sucursal:  { select: { nombre: true } },
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
