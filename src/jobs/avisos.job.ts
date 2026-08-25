import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { enviarEmailVencimiento } from '../services/mailer.service';

export function iniciarJobAvisos() {
  cron.schedule('0 8 * * *', async () => {
    console.log('[AVISOS] Iniciando job de vencimientos...');
    await procesarAvisos();
  });
  console.log('[AVISOS] Job de vencimientos programado para las 8:00 AM diariamente');
}

export async function procesarAvisos() {
  const hoy  = new Date(); hoy.setHours(0,0,0,0);
  const en7  = new Date(hoy); en7.setDate(en7.getDate() + 7);
  const en1  = new Date(hoy); en1.setDate(en1.getDate() + 1);
  const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);

  try {
    const inscripciones = await prisma.inscripcion.findMany({
      where: {
        estado: 'ACTIVA',
        fechaFin: { lte: en7 },
      },
      include: {
        personaRol: {
          include: {
            persona: {
              select: {
                nombres:  true,
                apellidos: true,
                contactos: { where: { tipo: 'EMAIL' }, take: 1 },
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

    let enviados = 0; let errores = 0;

    for (const ins of inscripciones) {
      const emailContacto = (ins.personaRol.persona as any).contactos?.[0]?.valor;
      if (!emailContacto) continue;

      const persona        = ins.personaRol.persona;
      const nombreSocio    = `${persona.nombres} ${persona.apellidos}`;
      const empresa        = (ins.sucursal as any).empresa;
      const gimnasioNombre = empresa?.nombreComercial ?? empresa?.nombre ?? 'SMARTGYM';
      const diasRestantes  = Math.ceil((new Date(ins.fechaFin).getTime() - hoy.getTime()) / (1000*60*60*24));

      try {
        await enviarEmailVencimiento({
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

    console.log(`[AVISOS] Finalizado: ${enviados} enviados, ${errores} errores`);
    return { enviados, errores, total: inscripciones.length };
  } catch (e) {
    console.error('[AVISOS] Error en job:', e);
    return { enviados: 0, errores: 1, total: 0 };
  }
}
