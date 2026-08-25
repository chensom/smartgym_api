import 'dotenv/config'
const required = ['DATABASE_URL', 'JWT_SECRET'] as const;
for (const key of required) {
  if (!process.env[key]) throw new Error(`Variable de entorno requerida: ${key}`);
}

export const env = {
  DATABASE_URL:           process.env.DATABASE_URL!,
  JWT_SECRET:             process.env.JWT_SECRET!,
  JWT_EXPIRES_IN:         process.env.JWT_EXPIRES_IN           || '8h',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN   || '7d',
  PORT:                   parseInt(process.env.PORT             || '3000'),
  NODE_ENV:               process.env.NODE_ENV                  || 'development',
  CORS_ORIGINS:          (process.env.CORS_ORIGINS             || 'http://localhost:5173').split(','),
  RATE_LIMIT_WINDOW_MS:   parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  RATE_LIMIT_MAX:         parseInt(process.env.RATE_LIMIT_MAX       || '100'),
  SENTRY_DSN:             process.env.SENTRY_DSN || '',
};
