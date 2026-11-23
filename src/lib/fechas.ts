// =============================================================================
// Fechas "de calendario" (sin hora) — siempre como string 'YYYY-MM-DD'.
//
// Los campos @db.Date de Prisma llegan como Date a medianoche UTC. Si se
// comparan contra `new Date()` o se formatean con la zona local, quedan
// corridos un día en Argentina (UTC-3). Por eso acá todo se maneja como
// string y la fecha de "hoy" se calcula explícitamente en hora argentina.
// =============================================================================

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ZONA = 'America/Argentina/Buenos_Aires';

export function esFechaValida(s: string): boolean {
  if (!RE_FECHA.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Fecha de HOY en Argentina, sin importar la zona del servidor. */
export function hoyArgentina(ahora: Date = new Date()): string {
  return fechaArgentina(ahora);
}

/** Día calendario argentino de un instante (timestamptz). */
export function fechaArgentina(instante: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instante); // en-CA => YYYY-MM-DD
}

/** Date que devuelve Prisma para un campo @db.Date  ->  'YYYY-MM-DD' */
export function deFechaDB(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD'  ->  Date para guardar en un campo @db.Date */
export function aFechaDB(s: string): Date {
  if (!esFechaValida(s)) throw new Error(`Fecha inválida: ${s}`);
  return new Date(`${s}T00:00:00Z`);
}

export function sumarDias(s: string, dias: number): string {
  const d = aFechaDB(s);
  d.setUTCDate(d.getUTCDate() + dias);
  return deFechaDB(d);
}

/** Días entre dos fechas (b - a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((aFechaDB(b).getTime() - aFechaDB(a).getTime()) / 86_400_000);
}

/** '2026-12-17' -> '2026-12-01' */
export function periodoDe(s: string): string {
  if (!esFechaValida(s)) throw new Error(`Fecha inválida: ${s}`);
  return `${s.slice(0, 7)}-01`;
}

/** Último día del mes: '2026-02-01' -> '2026-02-28' */
export function finDePeriodo(periodo: string): string {
  const [a, m] = periodo.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${periodo.slice(0, 7)}-${String(ultimo).padStart(2, '0')}`;
}

/** '2026-12-01' + 1 -> '2027-01-01' */
export function sumarMeses(periodo: string, meses: number): string {
  const [a, m] = periodo.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + meses, 1));
  return deFechaDB(d);
}

export const maxFecha = (a: string, b: string) => (a > b ? a : b);
export const minFecha = (a: string, b: string) => (a < b ? a : b);

/** '2026-12-01' -> '12/2026' ; '2026-12-17' -> '17/12/2026' */
export const formatoMes = (periodo: string) => `${periodo.slice(5, 7)}/${periodo.slice(0, 4)}`;
export const formatoFecha = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
