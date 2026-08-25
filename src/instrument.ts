import 'dotenv/config';
import * as Sentry from '@sentry/node';

// Si no hay DSN configurado (ej. en desarrollo local), Sentry queda inactivo
// y no rompe nada — simplemente no se envían errores a ningún lado.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.2, // 20% de las requests, suficiente para ver rendimiento sin gastar cuota de más
  });
}
