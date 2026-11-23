// =============================================================================
// SmartGym · Monto de la cuota mensual (mes calendario) según la fecha de pago
// Fechas siempre como 'YYYY-MM-DD' (ver lib/fechas.ts).
//
// Descuento y recargo (20/11/2026): ya no son precios cargados a mano por
// plan, sino un AJUSTE sobre el precio normal:
//   - NINGUNO     -> sin descuento / sin recargo
//   - PORCENTAJE  -> % del precio normal
//   - MONTO       -> pesos que se restan (descuento) o se suman (recargo)
// Cada gimnasio tiene su regla general; un plan puede tener su propia
// excepción, por separado para el descuento y para el recargo (null en el
// plan = usa la del gimnasio). Sin redondeo: el monto queda con centavos.
// =============================================================================
import { esFechaValida, periodoDe } from './fechas';

export type TramoPrecio = 'BONIFICADO' | 'NORMAL' | 'RECARGO';
export type TipoAjuste = 'NINGUNO' | 'PORCENTAJE' | 'MONTO';
export const TIPOS_AJUSTE: readonly TipoAjuste[] = ['NINGUNO', 'PORCENTAJE', 'MONTO'];
export type OrigenAjuste = 'GIMNASIO' | 'PLAN';

type Decimalish = number | string | { toString(): string };

export interface Ajuste {
  tipo: TipoAjuste;
  valor: number;
}

/** Lo que el cálculo necesita del plan. Tipo null/undefined = usa la regla del gimnasio. */
export interface PlanPrecios {
  precio: Decimalish; // precio NORMAL
  bonifTipo?: string | null;
  bonifValor?: Decimalish | null;
  recargoTipo?: string | null;
  recargoValor?: Decimalish | null;
}

/** Lo que el cálculo necesita del gimnasio. */
export interface ConfigTramos {
  diaFinBonificado: number; // ej. 5
  diaFinNormal: number;     // ej. 10
  bonificacion: Ajuste;     // regla general del gimnasio
  recargo: Ajuste;
}

export interface PreciosCuota {
  bonificado: number;
  normal: number;
  recargo: number;
  ajusteBonificacion: Ajuste & { origen: OrigenAjuste };
  ajusteRecargo: Ajuste & { origen: OrigenAjuste };
}

export interface ResultadoCuota {
  tramo: TramoPrecio;
  monto: number;
}

function aNumero(v: Decimalish | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'number' ? v : Number(v.toString());
  if (!Number.isFinite(s)) throw new Error(`Monto inválido: ${v}`);
  return s;
}

/** Pesos -> centavos enteros (evita errores de coma flotante). */
const aCentavos = (n: number) => Math.round(n * 100);
const aPesos = (c: number) => c / 100;

function ajusteDelPlan(tipo: string | null | undefined, valor: Decimalish | null | undefined): Ajuste | null {
  if (tipo === null || tipo === undefined) return null;
  if (!TIPOS_AJUSTE.includes(tipo as TipoAjuste)) throw new Error(`Tipo de ajuste inválido: ${tipo}`);
  return { tipo: tipo as TipoAjuste, valor: tipo === 'NINGUNO' ? 0 : aNumero(valor) ?? 0 };
}

/** Cuántos centavos mueve un ajuste sobre un precio normal (siempre >= 0). */
function centavosDeAjuste(normalCent: number, ajuste: Ajuste): number {
  if (ajuste.tipo === 'NINGUNO' || ajuste.valor <= 0) return 0;
  if (ajuste.tipo === 'PORCENTAJE') return Math.round((normalCent * ajuste.valor) / 100);
  return aCentavos(ajuste.valor);
}

/** Los tres precios de un plan de mes calendario, ya con la regla que corresponde. */
export function preciosDelPlan(plan: PlanPrecios, config: Pick<ConfigTramos, 'bonificacion' | 'recargo'>): PreciosCuota {
  const normal = aNumero(plan.precio);
  if (normal === null) throw new Error('El plan no tiene precio');
  const normalCent = aCentavos(normal);

  const propioBonif = ajusteDelPlan(plan.bonifTipo, plan.bonifValor);
  const propioRecargo = ajusteDelPlan(plan.recargoTipo, plan.recargoValor);
  const bonif = propioBonif ?? config.bonificacion;
  const recargo = propioRecargo ?? config.recargo;

  // un descuento nunca deja la cuota en negativo
  const bonificadoCent = Math.max(0, normalCent - centavosDeAjuste(normalCent, bonif));
  const recargoCent = normalCent + centavosDeAjuste(normalCent, recargo);

  return {
    bonificado: aPesos(bonificadoCent),
    normal: aPesos(normalCent),
    recargo: aPesos(recargoCent),
    ajusteBonificacion: { ...bonif, origen: propioBonif ? 'PLAN' : 'GIMNASIO' },
    ajusteRecargo: { ...recargo, origen: propioRecargo ? 'PLAN' : 'GIMNASIO' },
  };
}

/**
 * - Pago adelantado (antes de que empiece el mes)  -> BONIFICADO
 * - Día 1 .. diaFinBonificado                       -> BONIFICADO
 * - .. diaFinNormal                                 -> NORMAL
 * - Después (incluye pagar un mes ya pasado)        -> RECARGO
 * - esAlta: un socio nuevo nunca paga RECARGO (como mucho NORMAL)
 */
export function calcularCuota(
  plan: PlanPrecios,
  config: ConfigTramos,
  periodo: string,
  fechaPago: string,
  opciones: { esAlta?: boolean } = {},
): ResultadoCuota {
  if (!esFechaValida(periodo) || !periodo.endsWith('-01')) {
    throw new Error(`Período inválido (debe ser día 1): ${periodo}`);
  }
  if (!esFechaValida(fechaPago)) throw new Error(`Fecha de pago inválida: ${fechaPago}`);

  const precios = preciosDelPlan(plan, config);

  let tramo: TramoPrecio;
  if (fechaPago < periodo) {
    tramo = 'BONIFICADO';
  } else if (periodoDe(fechaPago) > periodo) {
    tramo = 'RECARGO';
  } else {
    const dia = Number(fechaPago.slice(8, 10));
    if (dia <= config.diaFinBonificado) tramo = 'BONIFICADO';
    else if (dia <= config.diaFinNormal) tramo = 'NORMAL';
    else tramo = 'RECARGO';
  }

  if (opciones.esAlta && tramo === 'RECARGO') tramo = 'NORMAL';

  const monto = tramo === 'BONIFICADO' ? precios.bonificado : tramo === 'NORMAL' ? precios.normal : precios.recargo;
  return { tramo, monto };
}

/** Los campos de la empresa que arman la regla general. */
export const SELECT_REGLA_EMPRESA = {
  cuotaDiaFinBonificado: true,
  cuotaDiaFinNormal: true,
  cuotaBonifTipo: true,
  cuotaBonifValor: true,
  cuotaRecargoTipo: true,
  cuotaRecargoValor: true,
} as const;

export function configDeEmpresa(e: {
  cuotaDiaFinBonificado: number;
  cuotaDiaFinNormal: number;
  cuotaBonifTipo: string;
  cuotaBonifValor: Decimalish;
  cuotaRecargoTipo: string;
  cuotaRecargoValor: Decimalish;
}): ConfigTramos {
  return {
    diaFinBonificado: e.cuotaDiaFinBonificado,
    diaFinNormal: e.cuotaDiaFinNormal,
    bonificacion: ajusteDelPlan(e.cuotaBonifTipo, e.cuotaBonifValor) ?? { tipo: 'NINGUNO', valor: 0 },
    recargo: ajusteDelPlan(e.cuotaRecargoTipo, e.cuotaRecargoValor) ?? { tipo: 'NINGUNO', valor: 0 },
  };
}

/**
 * Valida un ajuste que llega de la API. Devuelve { tipo, valor } listo para la
 * base, o un string con el error. `permitirHeredar`: en un plan, tipo null =
 * usa la regla del gimnasio.
 */
export function parsearAjuste(
  tipo: unknown,
  valor: unknown,
  campo: string,
  permitirHeredar: boolean,
): { tipo: TipoAjuste | null; valor: number | null } | string {
  if (tipo === null || tipo === '' || tipo === undefined) {
    return permitirHeredar ? { tipo: null, valor: null } : `${campo}: elegí un tipo`;
  }
  if (typeof tipo !== 'string' || !TIPOS_AJUSTE.includes(tipo as TipoAjuste)) {
    return `${campo}: el tipo debe ser NINGUNO, PORCENTAJE o MONTO`;
  }
  if (tipo === 'NINGUNO') return { tipo, valor: 0 };
  const n = typeof valor === 'number' ? valor : typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : NaN;
  if (!Number.isFinite(n) || n <= 0) return `${campo}: el valor tiene que ser mayor a 0`;
  if (Math.round(n * 100) / 100 !== n) return `${campo}: como mucho 2 decimales`;
  if (tipo === 'PORCENTAJE' && n > 100) return `${campo}: el porcentaje no puede pasar de 100`;
  if (n > 9_999_999_999.99) return `${campo}: valor demasiado grande`;
  return { tipo: tipo as TipoAjuste, valor: n };
}
