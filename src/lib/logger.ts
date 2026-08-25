import { createLogger, format, transports } from 'winston';
import { env } from '../config/env';

export const logger = createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    env.NODE_ENV === 'production'
      ? format.json()
      : format.printf(({ timestamp, level, message, ...meta }) =>
          `${timestamp} [${level.toUpperCase()}] ${message}${
            Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''
          }`
        )
  ),
  transports: [
    new transports.Console(),
    ...(env.NODE_ENV === 'production'
      ? [
          new transports.File({ filename: 'logs/error.log',    level: 'error' }),
          new transports.File({ filename: 'logs/combined.log'               }),
        ]
      : []),
  ],
});
