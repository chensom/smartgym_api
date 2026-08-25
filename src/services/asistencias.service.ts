import { prisma } from '../lib/prisma';

export class AsistenciasService {

  async registrarPorQR(qrCode: string, sucursalId: string) {
    const persona = await prisma.persona.findUnique({
      where:   { qrCode },
      include: {
        roles: {
          where:   { fechaBaja: null },
          include: {
            inscripciones: {
              where:   { estado: 'ACTIVA' },
              include: { plan: { select: { accesoTodasSucursales: true, nombre: true } } },
            },
          },
        },
      },
    });

    if (!persona || !persona.activo) {
      throw Object.assign(new Error('Socio no encontrado o inactivo'), { status: 404 });
    }

    const inscripcionActiva = persona.roles
      .flatMap((r: any) => r.inscripciones)
      .find((i: any) => new Date(i.fechaFin) >= new Date());

    if (!inscripcionActiva) {
      throw Object.assign(new Error('Sin membresía activa o vencida'), { status: 403 });
    }

    const accesoPermitido =
      inscripcionActiva.plan.accesoTodasSucursales ||
      inscripcionActiva.sucursalId === sucursalId;

    if (!accesoPermitido) {
      throw Object.assign(new Error('Tu plan no habilita acceso a esta sucursal'), { status: 403 });
    }

    const asistencia = await prisma.asistencia.create({
      data: {
        inscripcionId:    inscripcionActiva.id,
        sucursalId,
        metodoRegistro:   'QR',
        fechaHoraIngreso: new Date(),
      },
    });

    return {
      asistencia,
      socio: {
        nombres:     persona.nombres,
        apellidos:   persona.apellidos,
        fotoUrl:     persona.fotoUrl,
        plan:        inscripcionActiva.plan.nombre,
        vencimiento: inscripcionActiva.fechaFin,
      },
    };
  }

  async registrarManual(opts: { inscripcionId?: string; personaRolId?: string; sucursalId: string }) {
    const { inscripcionId, personaRolId, sucursalId } = opts;

    if (inscripcionId) {
      await prisma.inscripcion.findFirstOrThrow({
        where: { id: inscripcionId, estado: 'ACTIVA' },
      });
      return prisma.asistencia.create({
        data: { inscripcionId, sucursalId, metodoRegistro: 'MANUAL' },
      });
    }

    if (personaRolId) {
      await prisma.personaRol.findFirstOrThrow({
        where: { id: personaRolId, fechaBaja: null },
      });
      return prisma.asistencia.create({
        data: { personaRolId, sucursalId, metodoRegistro: 'MANUAL' },
      });
    }

    throw new Error('inscripcionId o personaRolId son requeridos');
  }

  async registrarEgreso(asistenciaId: string) {
    return prisma.asistencia.update({
      where: { id: asistenciaId },
      data:  { fechaHoraEgreso: new Date() },
    });
  }

  async listar(opts: {
    sucursalId?: string;
    empresaId:   string;
    desde?:      Date;
    hasta?:      Date;
    page:        number;
    limit:       number;
  }) {
    const { sucursalId, empresaId, desde, hasta, page, limit } = opts;
    const skip = (page - 1) * limit;

    // Filtro por empresa a través de los dos caminos posibles (por inscripción
    // de socio, o por personaRol directo para staff) — antes esto no filtraba
    // por empresa, lo que dejaba ver asistencias de otros gimnasios.
    const where: any = {
      OR: [
        { inscripcion: { personaRol: { persona: { empresaId } } } },
        { personaRol:  { persona: { empresaId } } },
      ],
    };
    if (sucursalId) where.sucursalId = sucursalId;
    if (desde || hasta) {
      where.fechaHoraIngreso = {};
      if (desde) where.fechaHoraIngreso.gte = desde;
      if (hasta) where.fechaHoraIngreso.lte = hasta;
    }

    const [total, asistencias] = await prisma.$transaction([
      prisma.asistencia.count({ where }),
      prisma.asistencia.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fechaHoraIngreso: 'desc' },
        include: {
          sucursal: { select: { nombre: true } },
          inscripcion: {
            include: {
              personaRol: {
                include: {
                  persona: { select: { nombres: true, apellidos: true, fotoUrl: true, qrCode: true } },
                },
              },
            },
          },
          personaRol: {
            include: {
              persona: { select: { nombres: true, apellidos: true, fotoUrl: true, qrCode: true } },
              tipoRol: { select: { nombre: true } },
            },
          },
        },
      }),
    ]);

    return { total, asistencias };
  }
}

export const asistenciasService = new AsistenciasService();
