import cron from 'node-cron';
import { procesarAvisosCobro } from '../services/facturasSuscripcion.service';

// =============================================================================
// Avisos de vencimiento de la suscripción a los gimnasios (lo que cobra Cod&Tics):
// 5 a 1 días antes, el día que vence y hasta 3 días después. Todos los días a las
// 9 y reintento a las 13 (hora argentina). No repite avisos (ver procesarAvisosCobro).
// Solo corre si AVISOS_COBRO_ACTIVO=true en el .env (así staging no manda).
// =============================================================================

export function iniciarJobAvisosCobro() {
  if (process.env.AVISOS_COBRO_ACTIVO !== 'true') {
    console.log('[AVISOS COBRO] Desactivado (AVISOS_COBRO_ACTIVO != true)');
    return;
  }
  cron.schedule('0 9,13 * * *', async () => {
    try { await procesarAvisosCobro(); }
    catch (e) { console.error('[AVISOS COBRO] Falló la vuelta:', e instanceof Error ? e.message : e); }
  }, { timezone: 'America/Argentina/Buenos_Aires' });
  console.log('[AVISOS COBRO] Job programado: todos los días 9:00 y 13:00 (hora argentina)');
}
