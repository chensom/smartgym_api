import nodemailer from 'nodemailer';

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
  const { destinatario, nombreSocio, planNombre, fechaFin, diasRestantes, gimnasioNombre, gimnasioEmail } = opts;

  const vencida  = diasRestantes < 0;
  const fechaStr = new Date(fechaFin).toLocaleDateString('es-AR');
  const asunto   = vencida
    ? `⚠️ Tu membresía en ${gimnasioNombre} venció`
    : `⏰ Tu membresía en ${gimnasioNombre} vence en ${diasRestantes} día${diasRestantes !== 1 ? 's' : ''}`;

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
          : `<p>Tu membresía <strong>${planNombre}</strong> vence el <strong>${fechaStr}</strong> (en <strong>${diasRestantes} día${diasRestantes !== 1 ? 's' : ''}</strong>).</p>
             <p>¡Recordá renovarla para no perder el acceso!</p>`
        }
        <div style="text-align:center;margin:24px 0;">
          <span style="background:#534AB7;color:white;padding:12px 28px;border-radius:8px;font-weight:bold;font-size:15px;">
            ${vencida ? '🔄 Renovar membresía' : '✅ Renovar ahora'}
          </span>
        </div>
        <p style="font-size:12px;color:#888;text-align:center;">
          ${gimnasioNombre}${gimnasioEmail ? ` · ${gimnasioEmail}` : ''}
        </p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from:    `"${gimnasioNombre}" <${process.env.SMTP_USER}>`,
    to:      destinatario,
    subject: asunto,
    html,
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
