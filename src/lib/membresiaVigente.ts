import { deFechaDB } from './fechas';

// =============================================================================
// Qué membresía "cuenta" para un socio en un día dado. Misma regla en el
// ingreso (kiosco / QR / DNI) y en la lista de Socios (ahí está escrita en SQL,
// en estadoCuota.service.ts: si cambia una, cambiar la otra).
//
//   1. La que cubre hoy (inicio <= hoy <= fin) y no está marcada VENCIDA.
//      Entre dos que cubren hoy, gana la ACTIVA.
//   2. Si ninguna cubre hoy: la de fecha de fin más reciente (como antes).
//
// Así, un socio con noviembre pago y diciembre cargado sin pagar figura como
// "vence pronto" (lo que cubre hoy) y no como "pago pendiente".
// Las CANCELADA / BAJA_CAMBIO_PLAN se excluyen antes, en la consulta.
// =============================================================================

interface InsMin { estado: string; fechaInicio: Date; fechaFin: Date; createdAt: Date }

function prioridad(i: InsMin, hoy: string): number {
  const cubreHoy = i.estado !== 'VENCIDA' && deFechaDB(i.fechaInicio) <= hoy && hoy <= deFechaDB(i.fechaFin);
  if (!cubreHoy) return 0;
  return i.estado === 'ACTIVA' ? 2 : 1;
}

export function elegirMembresia<T extends InsMin>(lista: T[] | undefined | null, hoy: string): T | null {
  if (!lista?.length) return null;
  return [...lista].sort((a, b) =>
    prioridad(b, hoy) - prioridad(a, hoy)
    || b.fechaFin.getTime() - a.fechaFin.getTime()
    || b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
}

/** ¿Tiene un período siguiente ya cargado y sin pagar (aparte del que cuenta hoy)? */
export function pendienteSiguiente<T extends InsMin & { id: string }>(lista: T[] | undefined | null, elegida: T | null, hoy: string): T | null {
  if (!lista?.length || elegida?.estado === 'PENDIENTE') return null;
  return lista.find(i => i.id !== elegida?.id && i.estado === 'PENDIENTE' && deFechaDB(i.fechaInicio) > hoy) ?? null;
}

// Estado de la cuota para mostrar (mismo criterio que el CASE de estadoCuota.service.ts).
export const DIAS_POR_VENCER_LISTA = 7;
export type EstadoCuotaCodigo = 'AL_DIA' | 'POR_VENCER' | 'VENCIDA' | 'SIN_MEMBRESIA' | 'PENDIENTE' | 'SUSPENDIDA';

export function clasificarCuota(elegida: InsMin | null, hoy: string): EstadoCuotaCodigo {
  if (!elegida) return 'SIN_MEMBRESIA';
  if (elegida.estado === 'SUSPENDIDA') return 'SUSPENDIDA';
  if (elegida.estado === 'PENDIENTE')  return 'PENDIENTE';
  const fin = deFechaDB(elegida.fechaFin);
  if (elegida.estado === 'VENCIDA' || fin < hoy) return 'VENCIDA';
  return diasEntreISO(hoy, fin) <= DIAS_POR_VENCER_LISTA ? 'POR_VENCER' : 'AL_DIA';
}

function diasEntreISO(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
}
