/**
 * Verificación de Cloudflare Turnstile (anti-bot) — mismo criterio que
 * en AULARIS y que los webhooks de pago: nunca confiar en que el
 * frontend "dice" que el usuario pasó el desafío, siempre volver a
 * preguntarle a Cloudflare con el token real antes de procesar el login.
 */
interface RespuestaTurnstile {
  success: boolean;
  'error-codes'?: string[];
}

export async function verificarTurnstile(token: string | undefined, ipCliente?: string): Promise<boolean> {
  if (!token) return false;

  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    console.warn('TURNSTILE_SECRET_KEY no configurada — verificación anti-bot desactivada');
    return true;
  }

  const params = new URLSearchParams();
  params.append('secret', secretKey);
  params.append('response', token);
  if (ipCliente) params.append('remoteip', ipCliente);

  const respuesta = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  const resultado = (await respuesta.json()) as RespuestaTurnstile;
  return resultado.success === true;
}
