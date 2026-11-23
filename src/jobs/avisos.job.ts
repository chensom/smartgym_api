import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { enviarEmailVencimiento } from '../services/mailer.service';
import { hoyArgentina, sumarDias, aFechaDB, deFechaDB, diasEntre } from '../lib/fechas';

// =============================================================================
// Aviso por mail de membresías por vencer.
//
// Cada socio recibe como máximo TRES avisos por membresía: a los 7 días, el día
// anterior y el día que vence. Antes se mandaba TODOS los días desde 7 días
// antes (y seguía después de vencer si la membresía quedaba ACTIVA).
//
// "Hoy" se calcula en hora argentina y el job corre a las 8:00 de Argentina,
// sin importar la zona horaria del servidor (que está en UTC).
// =============================================================================

export const DIAS_DE_AVISO = [7, 1, 0] as const;
const ZONA = 'America/Argentina/Buenos_Aires';

// Estados de una membresía posterior que indican que el socio ya renovó
const ESTADOS_RENOVADA = ['ACTIVA', 'PENDIENTE'];

export function iniciarJobAvisos() {
  cron.schedule('0 8 * * *', async () => {
    console.log('[AVISOS] Iniciando job de vencimientos...');
    await procesarAvisos();
  }, { timezone: ZONA });
  console.log('[AVISOS] Job de vencimientos programado para las 8:00 (hora argentina) diariamente');
}

type Enviar = typeof enviarEmailVencimiento;

export async function procesarAvisos(opts: { hoy?: string; enviar?: Enviar } = {}) {
  const hoy    = opts.hoy ?? hoyArgentina();
  const enviar = opts.enviar ?? enviarEmailVencimiento;
  const fechasObjetivo = DIAS_DE_AVISO.map(d => aFechaDB(sumarDias(hoy, d)));

  try {
    const inscripciones = await prisma.inscripcion.findMany({
      where: {
        estado:   'ACTIVA',
        fechaFin: { in: fechasObjetivo },
        personaRol: { fechaBaja: null, persona: { deletedAt: null, activo: true } },
        sucursal:   { empresa: { activo: true, deletedAt: null } },
      },
      include: {
        personaRol: {
          include: {
            persona: {
              select: {
                nombres:   true,
                apellidos: true,
                contactos: { where: { tipo: 'EMAIL' }, orderBy: { principal: 'desc' }, take: 1 },
              },
            },
          },
        },
        plan:     { select: { nombre: true } },
        sucursal: {
          include: {
            empresa: { select: { nombreComercial: true, nombre: true, email: true } },
          },
        },
      },
    });

    // Socios que ya tienen la membresía siguiente cargada (pagaron por adelantado):
    // no tiene sentido avisarles que se les vence.
    const yaRenovaron = new Set<string>();
    if (inscripciones.length) {
      const siguientes = await prisma.inscripcion.findMany({
        where: {
          personaRolId: { in: inscripciones.map(i => i.personaRolId) },
          estado:       { in: ESTADOS_RENOVADA },
        },
        select: { personaRolId: true, fechaFin: true },
      });
      for (const ins of inscripciones) {
        if (siguientes.some(s => s.personaRolId === ins.personaRolId && s.fechaFin > ins.fechaFin)) {
          yaRenovaron.add(ins.id);
        }
      }
    }

    let enviados = 0; let errores = 0; let sinEmail = 0; let renovadas = 0;

    for (const ins of inscripciones) {
      if (yaRenovaron.has(ins.id)) { renovadas++; continue; }

      const emailContacto = (ins.personaRol.persona as any).contactos?.[0]?.valor;
      if (!emailContacto) { sinEmail++; continue; }

      const persona        = ins.personaRol.persona;
      const nombreSocio    = `${persona.nombres} ${persona.apellidos}`;
      const empresa        = (ins.sucursal as any).empresa;
      const gimnasioNombre = empresa?.nombreComercial ?? empresa?.nombre ?? 'SMARTGYM';
      const diasRestantes  = diasEntre(hoy, deFechaDB(ins.fechaFin));

      try {
        await enviar({
          destinatario:   emailContacto,
          nombreSocio,
          planNombre:     (ins as any).plan?.nombre ?? '',
          fechaFin:       ins.fechaFin,
          diasRestantes,
          gimnasioNombre,
          gimnasioEmail:  empresa?.email ?? undefined,
        });
        enviados++;
        console.log(`[AVISOS] Email enviado a ${emailContacto} (${nombreSocio}) - ${diasRestantes}d`);
      } catch (e) {
        errores++;
        console.error(`[AVISOS] Error al enviar a ${emailContacto}:`, e);
      }
    }

    console.log(`[AVISOS] Finalizado (${hoy}): ${enviados} enviados, ${errores} errores, ${sinEmail} sin email, ${renovadas} ya renovadas`);
    return { enviados, errores, sinEmail, renovadas, total: inscripciones.length };
  } catch (e) {
    console.error('[AVISOS] Error en job:', e);
    return { enviados: 0, errores: 1, sinEmail: 0, renovadas: 0, total: 0 };
  }
}
