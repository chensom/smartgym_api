import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/httpError';
import { calcularCuota, configDeEmpresa, SELECT_REGLA_EMPRESA } from '../lib/calcularCuota';
import { hoyArgentina, deFechaDB, diasEntre, periodoDe, formatoFecha, formatoMes } from '../lib/fechas';
import { elegirMembresia } from '../lib/membresiaVigente';

/** Estados que son historial cerrado: no representan la membresía actual del socio. */
const ESTADOS_HISTORICOS = ['BAJA_CAMBIO_PLAN', 'CANCELADA'];
const DIAS_AVISO_POR_VENCER = 3;

export type TipoAviso = 'SIN_MEMBRESIA' | 'VENCIDA' | 'PAGO_PENDIENTE' | 'SUSPENDIDA' | 'POR_VENCER';

export interface AvisoAsistencia {
  tipo:    TipoAviso;
  nivel:   'warning' | 'info';
  mensaje: string;
  cuotaHoy?: { periodo: string; tramo: string; monto: number }; // planes por mes calendario
}

async function verificarSucursal(empresaId: string, sucursalId: string) {
  const s = await prisma.sucursal.findFirst({ where: { id: sucursalId, empresaId, deletedAt: null } });
  if (!s) throw new HttpError(404, 'Sucursal no encontrada');
}

/**
 * Política acordada (19/11/2026): el socio SIEMPRE puede ingresar; si la
 * membresía está vencida / impaga se registra igual y se devuelve un aviso.
 */
async function evaluarMembresia(
  empresaId: string,
  ins: {
    estado: string; fechaFin: Date;
    plan: { nombre: string; modalidadCobro: string; precio: any; bonifTipo: string | null; bonifValor: any; recargoTipo: string | null; recargoValor: any };
  } | null,
  hoy: string,
): Promise<{ vigente: boolean; aviso: AvisoAsistencia | null }> {
  if (!ins) {
    return { vigente: false, aviso: { tipo: 'SIN_MEMBRESIA', nivel: 'warning', mensaje: 'No tiene membresía registrada' } };
  }
  const fin = deFechaDB(ins.fechaFin);

  if (ins.estado === 'SUSPENDIDA') {
    return { vigente: false, aviso: { tipo: 'SUSPENDIDA', nivel: 'warning', mensaje: `Membresía suspendida (${ins.plan.nombre})` } };
  }
  if (ins.estado === 'PENDIENTE') {
    return { vigente: false, aviso: { tipo: 'PAGO_PENDIENTE', nivel: 'warning', mensaje: `Pago pendiente — ${ins.plan.nombre}` } };
  }
  if (ins.estado === 'VENCIDA' || fin < hoy) {
    const aviso: AvisoAsistencia = {
      tipo: 'VENCIDA', nivel: 'warning',
      mensaje: `Cuota/plan vencido desde el ${formatoFecha(fin)} (${ins.plan.nombre})`,
    };
    if (ins.plan.modalidadCobro === 'MES_CALENDARIO') {
      const e = await prisma.empresa.findUniqueOrThrow({ where: { id: empresaId }, select: SELECT_REGLA_EMPRESA });
      const periodo = periodoDe(hoy);
      const r = calcularCuota(ins.plan, configDeEmpresa(e), periodo, hoy);
      aviso.cuotaHoy = { periodo, tramo: r.tramo, monto: r.monto };
      aviso.mensaje = `Cuota de ${formatoMes(periodo)} impaga (${ins.plan.nombre}) — hoy paga $${r.monto.toLocaleString('es-AR')}`;
    }
    return { vigente: false, aviso };
  }

  const dias = diasEntre(hoy, fin);
  if (dias <= DIAS_AVISO_POR_VENCER) {
    return {
      vigente: true,
      aviso: { tipo: 'POR_VENCER', nivel: 'info', mensaje: dias === 0 ? 'La membresía vence hoy' : `La membresía vence en ${dias} día${dias === 1 ? '' : 's'}` },
    };
  }
  return { vigente: true, aviso: null };
}

const includeMembresia = {
  where:   { estado: { notIn: ESTADOS_HISTORICOS } },
  orderBy: [{ fechaFin: 'desc' as const }, { createdAt: 'desc' as const }],
  // Se traen las últimas y se elige con elegirMembresia() (la que cubre hoy),
  // no simplemente la primera: un mes siguiente cargado sin pagar no debe tapar al actual.
  take:    24,
  include: {
    plan: {
      select: {
        nombre: true, accesoTodasSucursales: true, modalidadCobro: true,
        precio: true, bonifTipo: true, bonifValor: true, recargoTipo: true, recargoValor: true,
      },
    },
  },
};

/** Persona con lo necesario para decidir el ingreso (roles activos + membresía actual). */
const includePersonaIngreso = {
  roles: {
    where:   { fechaBaja: null },
    include: { tipoRol: { select: { nombre: true } }, inscripciones: includeMembresia },
  },
};

type PersonaIngreso = Awaited<ReturnType<typeof buscarPersonaPorQR>>;

async function buscarPersonaPorQR(empresaId: string, qrCode: string) {
  return prisma.persona.findFirst({
    where:   { qrCode, empresaId, deletedAt: null },
    include: includePersonaIngreso,
  });
}

/**
 * Decide el ingreso de una persona (misma regla para QR del admin y kiosco):
 * staff entra sin membresía; socio entra siempre (con aviso si debe), salvo que
 * su plan vigente no habilite esta sucursal.
 */
async function resolverIngreso(empresaId: string, persona: NonNullable<PersonaIngreso>, sucursalId: string) {
  const hoy = hoyArgentina();
  const rolSocio = persona.roles.find(r => r.tipoRol.nombre === 'SOCIO');
  if (!rolSocio) {
    const rol = persona.roles[0];
    return { rol, tipoRol: rol.tipoRol.nombre, ins: null, vigente: false, aviso: null as AvisoAsistencia | null, sucursalNoHabilitada: false };
  }
  const ins = elegirMembresia(rolSocio.inscripciones, hoy);
  const { vigente, aviso } = await evaluarMembresia(empresaId, ins, hoy);
  const sucursalNoHabilitada = !!(ins && vigente && !ins.plan.accesoTodasSucursales && ins.sucursalId !== sucursalId);
  return { rol: rolSocio, tipoRol: 'SOCIO', ins, vigente, aviso, sucursalNoHabilitada };
}

const MINUTOS_ANTIREBOTE = 10;
const MSJ_NO_ENCONTRADO = 'No encontramos ese DNI. Pasá por recepción.';

export class AsistenciasService {

  /**
   * Kiosco de autoservicio (tablet / PC de recepción, futuro molinete).
   * `codigo`: DNI completo (búsqueda EXACTA, no parcial) o el QR del socio (empieza con "SG-",
   * así un lector QR USB que "tipea" el código funciona sin configurar nada).
   * Responde siempre con una decisión explícita `accesoPermitido`.
   */
  async registrarKiosco(empresaId: string, input: { codigo: string; sucursalId: string; dispositivo?: string }) {
    await verificarSucursal(empresaId, input.sucursalId);
    const codigo = input.codigo.trim();
    const esQR = /^SG-/i.test(codigo);

    let persona: PersonaIngreso;
    if (esQR) {
      persona = await buscarPersonaPorQR(empresaId, codigo) ?? await buscarPersonaPorQR(empresaId, codigo.toUpperCase());
    } else {
      const dni = codigo.replace(/\D/g, '');
      if (dni.length < 7 || dni.length > 9) throw new HttpError(400, 'Ingresá tu DNI completo, sin puntos.');
      const conPuntos = dni.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      const encontradas = await prisma.persona.findMany({
        where:   { empresaId, deletedAt: null, documentos: { some: { numero: { in: [dni, conPuntos] } } } },
        include: includePersonaIngreso,
        take:    2,
      });
      if (encontradas.length > 1) throw new HttpError(409, 'Hay más de una persona con ese DNI. Pasá por recepción.');
      persona = encontradas[0] ?? null;
    }
    // Mismo mensaje si no existe, está inactiva o no tiene roles: no revelar datos en un equipo público.
    if (!persona || !persona.activo || persona.roles.length === 0) throw new HttpError(404, MSJ_NO_ENCONTRADO);

    const r = await resolverIngreso(empresaId, persona, input.sucursalId);
    const base = {
      persona:     { nombres: persona.nombres, apellidos: persona.apellidos, fotoUrl: persona.fotoUrl },
      tipoRol:     r.tipoRol,
      plan:        r.ins?.plan.nombre ?? null,
      vencimiento: r.ins?.fechaFin ?? null,
      aviso:       r.aviso,
    };

    if (r.sucursalNoHabilitada) {
      return { ...base, accesoPermitido: false, motivo: 'Tu plan no habilita esta sucursal. Pasá por recepción.', yaRegistrado: false, horaIngreso: null };
    }

    // Anti-rebote: si ya marcó hace un rato (doble toque, QR leído dos veces), no se duplica.
    const roleIds = persona.roles.map(x => x.id);
    const reciente = await prisma.asistencia.findFirst({
      where: {
        fechaHoraIngreso: { gte: new Date(Date.now() - MINUTOS_ANTIREBOTE * 60_000) },
        OR: [{ personaRolId: { in: roleIds } }, { inscripcion: { personaRolId: { in: roleIds } } }],
      },
      orderBy: { fechaHoraIngreso: 'desc' },
    });
    if (reciente) {
      return { ...base, accesoPermitido: true, yaRegistrado: true, horaIngreso: reciente.fechaHoraIngreso };
    }

    const asistencia = await prisma.asistencia.create({
      data: {
        ...(r.ins && r.vigente ? { inscripcionId: r.ins.id } : { personaRolId: r.rol.id }),
        sucursalId:     input.sucursalId,
        metodoRegistro: esQR ? 'QR' : 'MANUAL',   // valores que ya usa el sistema
        dispositivoId:  (input.dispositivo || 'KIOSCO').slice(0, 60),
        fechaHoraIngreso: new Date(),
      },
    });
    return { ...base, accesoPermitido: true, yaRegistrado: false, horaIngreso: asistencia.fechaHoraIngreso };
  }

  /** Datos mínimos para configurar el equipo del kiosco (sin pedir permisos de socios). */
  async configKiosco(empresaId: string) {
    const sucursales = await prisma.sucursal.findMany({
      where:   { empresaId, activo: true, deletedAt: null },
      select:  { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });
    return { sucursales };
  }

  async registrarPorQR(empresaId: string, qrCode: string, sucursalId: string) {
    await verificarSucursal(empresaId, sucursalId);
    const persona = await buscarPersonaPorQR(empresaId, qrCode);
    if (!persona || !persona.activo || persona.roles.length === 0) {
      throw new HttpError(404, 'Socio no encontrado o inactivo');
    }

    const r = await resolverIngreso(empresaId, persona, sucursalId);
    if (r.sucursalNoHabilitada) throw new HttpError(403, 'Tu plan no habilita acceso a esta sucursal');

    const asistencia = await prisma.asistencia.create({
      data: {
        // Con membresía vigente se vincula a la inscripción; si no, a la persona.
        ...(r.ins && r.vigente ? { inscripcionId: r.ins.id } : { personaRolId: r.rol.id }),
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
        tipoRol:     r.tipoRol,
        plan:        r.ins?.plan.nombre ?? null,
        vencimiento: r.ins?.fechaFin ?? null,
      },
      aviso: r.aviso,
    };
  }

  async registrarManual(empresaId: string, opts: { inscripcionId?: string; personaRolId?: string; sucursalId: string }) {
    const { inscripcionId, personaRolId, sucursalId } = opts;
    await verificarSucursal(empresaId, sucursalId);

    if (inscripcionId) {
      const ins = await prisma.inscripcion.findFirst({
        where: { id: inscripcionId, plan: { empresaId }, estado: { notIn: ESTADOS_HISTORICOS } },
      });
      if (!ins) throw new HttpError(404, 'Inscripción no encontrada');
      return prisma.asistencia.create({
        data: { inscripcionId, sucursalId, metodoRegistro: 'MANUAL' },
      });
    }

    if (personaRolId) {
      const pr = await prisma.personaRol.findFirst({
        where: { id: personaRolId, fechaBaja: null, persona: { empresaId, deletedAt: null } },
      });
      if (!pr) throw new HttpError(404, 'Persona no encontrada');
      return prisma.asistencia.create({
        data: { personaRolId, sucursalId, metodoRegistro: 'MANUAL' },
      });
    }

    throw new HttpError(400, 'inscripcionId o personaRolId son requeridos');
  }

  async registrarEgreso(empresaId: string, asistenciaId: string) {
    const existe = await prisma.asistencia.findFirst({
      where: {
        id: asistenciaId,
        OR: [
          { inscripcion: { personaRol: { persona: { empresaId } } } },
          { personaRol:  { persona: { empresaId } } },
        ],
      },
    });
    if (!existe) throw new HttpError(404, 'Asistencia no encontrada');
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

// Exportado para la ruta /buscar-dni (y la futura ventana de asistencia).
export { evaluarMembresia, ESTADOS_HISTORICOS, includeMembresia };
