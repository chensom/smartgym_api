import nodemailer from 'nodemailer';
import { deFechaDB, formatoFecha } from '../lib/fechas';

// Los nombres los carga cada gimnasio: se escapan antes de meterlos en el HTML del mail.
const esc = (t: string) => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST  ?? 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT ?? '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
  },
});

export async function enviarEmailVencimiento(opts: {
  destinatario: string
  nombreSocio:  string
  planNombre:   string
  fechaFin:     Date
  diasRestantes: number
  gimnasioNombre: string
  gimnasioEmail?: string
}) {
  const { destinatario, diasRestantes, gimnasioEmail } = opts;
  const nombreSocio    = esc(opts.nombreSocio);
  const planNombre     = esc(opts.planNombre);
  const gimnasioNombre = esc(opts.gimnasioNombre);

  const vencida  = diasRestantes < 0;
  // fechaFin es un campo de fecha (medianoche UTC): se formatea sin pasar por la zona del servidor
  const fechaStr = formatoFecha(deFechaDB(opts.fechaFin));
  const cuando   = diasRestantes === 0 ? 'hoy'
                 : diasRestantes === 1 ? 'mañana'
                 : `en ${diasRestantes} días`;
  const asunto   = vencida
    ? `⚠️ Tu membresía en ${opts.gimnasioNombre} venció`
    : `⏰ Tu membresía en ${opts.gimnasioNombre} vence ${cuando}`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;color:#1a1a1a;">
      <div style="background:#534AB7;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:white;margin:0;font-size:22px;">${gimnasioNombre}</h1>
      </div>
      <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px;border:1px solid #eee;">
        <p style="font-size:16px;">Hola, <strong>${nombreSocio}</strong> 👋</p>
        ${vencida
          ? `<p>Tu membresía <strong>${planNombre}</strong> venció el <strong>${fechaStr}</strong>.</p>
             <p>¡Te esperamos para renovar y seguir entrenando!</p>`
          : `<p>Tu membresía <strong>${planNombre}</strong> vence el <strong>${fechaStr}</strong> (<strong>${cuando}</strong>).</p>
             <p>¡Recordá renovarla para no perder el acceso!</p>`
        }
        <div style="text-align:center;margin:24px 0;">
          <span style="background:#534AB7;color:white;padding:12px 28px;border-radius:8px;font-weight:bold;font-size:15px;">
            ${vencida ? '🔄 Renovar membresía' : '✅ Renovar ahora'}
          </span>
        </div>
        <p style="font-size:12px;color:#888;text-align:center;">
          ${gimnasioNombre}${gimnasioEmail ? ` · ${esc(gimnasioEmail)}` : ''}
        </p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from:    { name: opts.gimnasioNombre, address: process.env.SMTP_USER ?? '' },
    to:      destinatario,
    subject: asunto,
    html,
  });
}

/** Mail genérico (resumen mensual, etc.). El remitente es siempre la cuenta SMTP;
 *  `nombreRemitente` es solo el nombre que se muestra. */
export interface AdjuntoEmail { filename: string; content: Buffer; contentType?: string }

export async function enviarEmail(opts: {
  para: string | string[]; asunto: string; html: string; nombreRemitente?: string;
  cco?: string | string[]; adjuntos?: AdjuntoEmail[];
}) {
  await transporter.sendMail({
    from:    { name: opts.nombreRemitente ?? 'SmartGym', address: process.env.SMTP_USER ?? '' },
    to:      opts.para,
    bcc:     opts.cco,
    subject: opts.asunto,
    html:    opts.html,
    attachments: opts.adjuntos,
  });
}

export async function verificarConexionSMTP() {
  try {
    await transporter.verify();
    return true;
  } catch {
    return false;
  }
}
