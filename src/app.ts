import express from 'express';
import * as Sentry from '@sentry/node';
import { Prisma } from '@prisma/client';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { logger } from './lib/logger';
import routes from './routes';
import { errorHandler, notFound } from './middlewares/error.middleware';


const app = express();
// ── Seguridad ─────────────────────────────────────────────────────────────────
app.use(helmet());
// Permite: (a) los orígenes exactos listados en CORS_ORIGINS (ej. localhost para
// desarrollo), y (b) cualquier subdominio de smartgym.codandtics.com (multi-tenant).
const SUBDOMINIO_REGEX = /^https:\/\/([a-z0-9-]+\.)?smartgym\.codandtics\.com$/;
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // requests sin Origin (ej. Postman, curl)
    if (env.CORS_ORIGINS.includes(origin) || SUBDOMINIO_REGEX.test(origin)) {
      return callback(null, true);
    }
    callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max:      env.RATE_LIMIT_MAX,
  message:  { ok: false, error: 'Demasiadas solicitudes, intentá más tarde' },
}));
// Rate limit más estricto para login
app.use('/api/v1/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max:      10,               // 10 intentos
  message:  { ok: false, error: 'Demasiados intentos de login' },
}));
// ── Parsing & compresión ──────────────────────────────────────────────────────
app.use(helmet()); 
app.use( rateLimit({ windowMs: 15 * 60 * 1000, limit: 1000, message: 
  { error: 'Demasiadas solicitudes, intentá más tarde' }, standardHeaders: true, legacyHeaders: false, }), ); 
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(compression());
// ── Logging HTTP ──────────────────────────────────────────────────────────────
app.use(morgan(
  env.NODE_ENV === 'production' ? 'combined' : 'dev',
  { stream: { write: (msg) => logger.http(msg.trim()) } }
));
// ── Trust proxy (para IP real detrás de Nginx) ────────────────────────────────
app.set('trust proxy', 1);
// ── Rutas ─────────────────────────────────────────────────────────────────────
app.use('/api/v1', routes);
// ── Sentry (debe ir después de las rutas y antes del error handler propio) ────
// Códigos de Prisma que error.middleware.ts ya traduce a una respuesta clara
// (409/404) — no son bugs, son casos de negocio esperados (nombre duplicado,
// registro no encontrado, referencia inválida). No tiene sentido alertar por
// estos: si algún día hace falta ver cuántos pasan, se puede armar una
// métrica aparte, pero no como "issue" de error.
const CODIGOS_PRISMA_MANEJADOS = new Set(['P2002', 'P2025', 'P2003', 'P2014']);

Sentry.setupExpressErrorHandler(app, {
  shouldHandleError(error: any) {
    if (error?.name === 'NotFoundError') return false;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      CODIGOS_PRISMA_MANEJADOS.has(error.code)
    ) {
      return false;
    }
    return true;
  },
});
// ── Errores ───────────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);
export default app;
