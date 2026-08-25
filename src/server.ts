import './instrument';
import 'dotenv/config';
import app from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { iniciarJobAvisos } from './jobs/avisos.job'

async function main() {
  // Verificar conexión a la base de datos
  await prisma.$connect();
  logger.info('✅ Conectado a PostgreSQL');

  const server = app.listen(env.PORT, () => {
    logger.info(`🚀 SMARTGYM API corriendo en puerto ${env.PORT} [${env.NODE_ENV}]`);
  });

  iniciarJobAvisos()

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} recibido, cerrando servidor...`);
    server.close(async () => {
      await prisma.$disconnect();
      logger.info('Servidor cerrado correctamente');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

main().catch((e) => {
  console.error('Error al iniciar el servidor:', e);
  process.exit(1);
});
