import { prisma } from '../lib/prisma';
import { CrearPersonaInput } from '../schemas/personas.schema';

export class SociosService {

  // Crear persona + asignarle rol SOCIO en una transacción
  async crearSocio(empresaId: string, sucursalId: string, input: CrearPersonaInput) {
    return prisma.$transaction(async (tx) => {
      // 1. Obtener tipo de rol SOCIO de la empresa
      // Usar tipoRolId del body si viene, sino defaultear a SOCIO
      const tipoRolId = (input as any).tipoRolId;
      const tipoRol = tipoRolId
        ? await tx.tipoRolPersona.findFirstOrThrow({ where: { id: tipoRolId, empresaId } })
        : await tx.tipoRolPersona.findFirstOrThrow({ where: { empresaId, nombre: 'SOCIO', activo: true } });

      // 2. Generar número de socio auto-incremental
      const ultimo = await tx.personaRol.findFirst({
        where:   { tipoRolId: tipoRol.id, numeroSocio: { not: null } },
        orderBy: { numeroSocio: 'desc' },
        select:  { numeroSocio: true },
      });
      const siguienteNum = String((parseInt(ultimo?.numeroSocio || '0') + 1)).padStart(5, '0');

      // 3. Crear persona
      const persona = await tx.persona.create({
        data: {
          empresaId,
          nombres:         input.nombres,
          apellidos:       input.apellidos,
          fechaNacimiento: input.fechaNacimiento ? new Date(input.fechaNacimiento) : null,
          genero:          input.genero ?? null,
          fotoUrl:         input.fotoUrl ?? null,
          qrCode:          `SG-${empresaId.slice(0,8)}-${tipoRol.nombre}-${siguienteNum}`,
          documentos: input.documentos?.length
            ? { createMany: { data: input.documentos.map(d => ({
                tipo:        d.tipo,
                numero:      d.numero,
                vencimiento: d.vencimiento ? new Date(d.vencimiento) : null,
              })) }}
            : undefined,
          contactos: input.contactos?.length
            ? { createMany: { data: input.contactos } }
            : undefined,
        },
        include: {
          documentos: true,
          contactos:  true,
        },
      });

      // 4. Crear rol SOCIO
      const personaRol = await tx.personaRol.create({
        data: {
          personaId:   persona.id,
          tipoRolId:   tipoRol.id,
          sucursalId:  sucursalId ?? null,
          numeroSocio: siguienteNum,
          fechaAlta:   new Date(),
        },
      });

      return { persona, personaRol };
    });
  }

  // Buscar socios con paginación y búsqueda de texto
  async listarSocios(empresaId: string, opts: { q?: string; tipoRolId?: string; page: number; limit: number }) {
    const { q, tipoRolId, page, limit } = opts;
    const skip = (page - 1) * limit;

    const where: any = {
      empresaId,
      deletedAt: null,
      roles: {
        some: {
          ...(tipoRolId ? { tipoRolId } : {}),
          fechaBaja: null,
        },
      },
    };

    if (q) {
      where.OR = [
        { apellidos: { contains: q, mode: 'insensitive' } },
        { nombres:   { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, socios] = await prisma.$transaction([
      prisma.persona.count({ where }),
      prisma.persona.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
        include: {
          roles: {
            where:   { fechaBaja: null },
            include: {
              tipoRol:      true,
              inscripciones: {
                where:   { estado: 'ACTIVA' },
                include: { plan: { select: { nombre: true, tipo: true } } },
                take: 1,
              },
            },
          },
          contactos: { where: { principal: true }, take: 1 },
        },
      }),
    ]);

    return { total, socios };
  }

  // Ficha completa de un socio
  async obtenerSocio(empresaId: string, personaId: string) {
    return prisma.persona.findFirstOrThrow({
      where: { id: personaId, empresaId, deletedAt: null },
      include: {
        documentos:  true,
        contactos:   true,
        direcciones: true,
        roles: {
          include: {
            tipoRol: true,
            inscripciones: {
              orderBy: { createdAt: 'desc' },
              include: { plan: true },
              take: 5,
            },
            certificados: {
              orderBy: { fechaVencimiento: 'desc' },
              take: 3,
            },
          },
        },
      },
    });
  }

  // Soft delete
  async darDeBaja(empresaId: string, personaId: string) {
    return prisma.persona.update({
      where: { id: personaId, empresaId },
      data:  { deletedAt: new Date(), activo: false },
    });
  }
}

export const sociosService = new SociosService();
