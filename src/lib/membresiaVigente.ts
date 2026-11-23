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
