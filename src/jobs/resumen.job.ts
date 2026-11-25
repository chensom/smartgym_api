import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { aFechaDB, hoyArgentina, periodoDe, sumarMeses } from '../lib/fechas';
import { calcularResumen } from '../services/resumenMensual.service';
import { armarHtmlResumen, asuntoResumen, MarcaGimnasio } from '../services/resumenMail';
import { enviarEmail } from '../services/mailer.service';

// =============================================================================
// Resumen mensual al dueño: el día 1 a las 9:00 (hora argentina) se manda el
// resumen del mes que cerró a los administradores de cada gimnasio activo.
//
// Para no mandarlo dos veces ni perderlo:
//   - Antes de mandar se "reserva" la fila (gimnasio, mes) en resumenes_enviados
//     (UNIQUE). Si ya existe ENVIADO / ENVIANDO, no se manda de nuevo.
//   - Si falló el SMTP queda en ERROR y se reintenta en la próxima vuelta
//     (cada hora de 9 a 20, del día 1 al 3), hasta MAX_INTENTOS.
//   - Si la API se cae justo mientras manda, queda ENVIANDO y NO se reintenta
//     sola (puede que el mail haya salido): se revisa a mano.
//
// Solo corre si RESUMEN_MENSUAL_ACTIVO=true en el .env (así staging no manda).
// =============================================================================

const ZONA = 'America/Argentina/Buenos_Aires';
export const MAX_INTENTOS = 3;

export function iniciarJobResumen() {
  if (process.env.RESUMEN_MENSUAL_ACTIVO !== 'true') {
    console.log('[RESUMEN] Desactivado (RESUMEN_MENSUAL_ACTIVO != true)');
    return;
  }
  cron.schedule('0 9-20 1-3 * *', async () => {
    await procesarResumenes();
  }, { timezone: ZONA });
  console.log('[RESUMEN] Job programado: días 1 a 3, cada hora de 9 a 20 (hora argentina)');
}

/** Administradores activos del gimnasio (rol "Administrador" vigente). */
export async function destinatariosDe(empresaId: string, hoy: string): Promise<string[]> {
  const usuarios = await prisma.usuario.findMany({
    where: {
      empresaId, activo: true, deletedAt: null,
      roles: { some: {
        rol: { nombre: 'Administrador', activo: true, empresaId },
        OR:  [{ fechaHasta: null }, { fechaHasta: { gte: aFechaDB(hoy) } }],
      } },
    },
    select: { email: true },
  });
  const validos = usuarios.map(u => u.email.trim().toLowerCase()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  return [...new Set(validos)];
}

export async function datosGimnasio(empresaId: string): Promise<MarcaGimnasio> {
  const e = await prisma.empresa.findUniqueOrThrow({
    where:  { id: empresaId },
    select: { nombre: true, nombreComercial: true, slug: true, logoUrl: true, colorPrimario: true },
  });
  return { nombre: e.nombreComercial ?? e.nombre, slug: e.slug, logoUrl: e.logoUrl, colorPrimario: e.colorPrimario };
}

type Enviar = typeof enviarEmail;

/** Manda el resumen de `periodo` (por defecto, el mes anterior a hoy) a todos los
 *  gimnasios que todavía no lo recibieron. */
export async function procesarResumenes(opts: { periodo?: string; enviar?: Enviar; hoy?: string } = {}) {
  const hoy     = opts.hoy ?? hoyArgentina();
  const periodo = opts.periodo ?? sumarMeses(periodoDe(hoy), -1);
  const enviar  = opts.enviar ?? enviarEmail;
  const fechaPeriodo = aFechaDB(periodo);
  const res = { enviados: 0, errores: 0, sinDestinatarios: 0, yaEnviados: 0 };

  const empresas = await prisma.empresa.findMany({
    where:  { activo: true, deletedAt: null },
    select: { id: true, nombre: true },
  });

  for (const emp of empresas) {
    // Reservar (gimnasio, mes). Si ya existe, ver si corresponde reintentar.
    const previa = await prisma.resumenEnviado.findUnique({
      where: { empresaId_periodo: { empresaId: emp.id, periodo: fechaPeriodo } },
    });
    if (previa && (previa.estado !== 'ERROR' || previa.intentos >= MAX_INTENTOS)) { res.yaEnviados++; continue; }

    let reserva;
    try {
      reserva = previa
        ? await prisma.resumenEnviado.update({
            where: { id: previa.id, estado: 'ERROR', intentos: previa.intentos },   // si otro proceso la tomó, falla
            data:  { estado: 'ENVIANDO', intentos: { increment: 1 }, error: null },
          })
        : await prisma.resumenEnviado.create({
            data: { empresaId: emp.id, periodo: fechaPeriodo, estado: 'ENVIANDO' },
          });
    } catch {
      res.yaEnviados++; continue;   // la tomó otra instancia
    }

    try {
      const para = await destinatariosDe(emp.id, hoy);
      if (!para.length) {
        await prisma.resumenEnviado.update({ where: { id: reserva.id }, data: { estado: 'SIN_DESTINATARIOS' } });
        res.sinDestinatarios++;
        console.log(`[RESUMEN] ${emp.nombre}: sin administradores con mail`);
        continue;
      }
      const resumen = await calcularResumen(emp.id, periodo);
      const marca   = await datosGimnasio(emp.id);
      await enviar({
        para, asunto: asuntoResumen(resumen, marca), html: armarHtmlResumen(resumen, marca),
        nombreRemitente: `SmartGym · ${marca.nombre}`,
      });
      await prisma.resumenEnviado.update({
        where: { id: reserva.id },
        data:  { estado: 'ENVIADO', enviadoAt: new Date(), destinatarios: para.join(', ') },
      });
      res.enviados++;
      console.log(`[RESUMEN] ${emp.nombre} (${periodo}): enviado a ${para.length} administrador(es)`);
    } catch (e) {
      res.errores++;
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.resumenEnviado.update({ where: { id: reserva.id }, data: { estado: 'ERROR', error: msg.slice(0, 500) } })
        .catch(() => undefined);
      console.error(`[RESUMEN] Error con ${emp.nombre} (${periodo}):`, msg);
    }
  }

  console.log(`[RESUMEN] Finalizado (${periodo}): ${res.enviados} enviados, ${res.errores} errores, ${res.sinDestinatarios} sin destinatarios, ${res.yaEnviados} ya enviados`);
  return res;
}
