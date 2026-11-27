import { Request } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

// ── Límite de pedidos ─────────────────────────────────────────────────────────
// Antes había un solo límite por IP (100 pedidos cada 15 min). En un gimnasio
// la recepción, el kiosco y el dueño salen a internet por la misma IP, así que
// entre todos lo agotaban y la API empezaba a responder 429 en pleno uso.
//
// Ahora:
//   - Pedido con token de acceso VÁLIDO (firma verificada): se cuenta por
//     usuario, con un tope alto (RATE_LIMIT_MAX_AUTH). No consume el cupo de la IP.
//   - Pedido sin token, o con token inválido/vencido/refresh: se cuenta por IP
//     con el tope de siempre (RATE_LIMIT_MAX). Un token inventado no sirve para
//     esquivar el límite, porque se verifica la firma.

/** Devuelve el id del usuario si el pedido trae un token de acceso válido. */
export function usuarioDelPedido(req: Request): string | null {
  const cache = (req as any)._rlUsuario;
  if (cache !== undefined) return cache;

  let usuario: string | null = null;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as { sub?: string; typ?: string };
      if (payload?.sub && payload.typ !== 'refresh') usuario = payload.sub;
    } catch {
      usuario = null; // vencido o firma inválida -> se trata como anónimo
    }
  }
  (req as any)._rlUsuario = usuario;
  return usuario;
}

const mensaje = { ok: false, error: 'Demasiadas solicitudes, intentá más tarde' };

/** Pedidos anónimos: por IP. Los logueados no cuentan acá. */
export const limiteAnonimo = rateLimit({
  windowMs:        env.RATE_LIMIT_WINDOW_MS,
  max:             env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders:   false,
  skip:            (req) => usuarioDelPedido(req) !== null,
  message:         mensaje,
});

/** Pedidos de usuarios logueados: por usuario, con tope alto contra abusos. */
export const limiteLogueado = rateLimit({
  windowMs:        env.RATE_LIMIT_WINDOW_MS,
  max:             env.RATE_LIMIT_MAX_AUTH,
  standardHeaders: true,
  legacyHeaders:   false,
  skip:            (req) => usuarioDelPedido(req) === null,
  keyGenerator:    (req) => `u:${usuarioDelPedido(req)}`,
  message:         mensaje,
});

/** Login: 10 intentos FALLIDOS cada 15 min por IP. Los exitosos no cuentan. */
export const limiteLogin = rateLimit({
  windowMs:               15 * 60 * 1000,
  max:                    10,
  standardHeaders:        true,
  legacyHeaders:          false,
  skipSuccessfulRequests: true,
  message:                { ok: false, error: 'Demasiados intentos de login' },
});
