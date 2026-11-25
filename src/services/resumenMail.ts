import type { ResumenMensual } from './resumenMensual.service';
import { MAX_DEJARON_EN_MAIL } from './resumenMensual.service';
import { formatoFecha, sumarMeses } from '../lib/fechas';

// =============================================================================
// HTML del resumen mensual. Tablas y estilos en línea (Gmail, Outlook y el
// celular no respetan <style> ni flex). Todo lo que carga el gimnasio se escapa.
// =============================================================================

export interface MarcaGimnasio {
  nombre:        string;
  slug:          string;
  logoUrl?:      string | null;
  colorPrimario?: string | null;
}

const esc = (t: string) => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const nombreMes = (periodo: string) => MESES[Number(periodo.slice(5, 7)) - 1];
const pesos = (n: number) => '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const entero = (n: number) => n.toLocaleString('es-AR');

/** "↑ 12 % vs. octubre" / "↓ 5 %" / "" si no hay con qué comparar */
function comparacion(actual: number, anterior: number, mesAnt: string): string {
  if (anterior <= 0) return actual > 0 ? `sin datos de ${mesAnt} para comparar` : '';
  const pct = Math.round(((actual - anterior) / anterior) * 100);
  if (pct === 0) return `igual que ${mesAnt}`;
  const color = pct > 0 ? '#15803d' : '#b91c1c';
  return `<span style="color:${color};font-weight:bold;">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)} %</span> vs. ${mesAnt}`;
}

const COLOR_POR_DEFECTO = '#534AB7';
const colorValido = (c?: string | null) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : COLOR_POR_DEFECTO);
const urlValida  = (u?: string | null) => (u && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);

export function urlGimnasio(slug: string, ruta = '/'): string {
  const base = process.env.APP_DOMINIO ?? 'smartgym.codandtics.com';
  return `https://${encodeURIComponent(slug)}.${base}${ruta}`;
}

const ESTADO_TXT: Record<string, string> = {
  AL_DIA: 'al día', POR_VENCER: 'vence pronto', VENCIDA: 'vencida', PENDIENTE: 'pago pendiente',
  SUSPENDIDA: 'suspendida', SIN_MEMBRESIA: 'sin membresía',
};

export function asuntoResumen(r: ResumenMensual, g: MarcaGimnasio): string {
  const mes = nombreMes(r.periodo);
  return `${g.nombre}: tu resumen de ${mes} — ${pesos(r.cobrado.total)} cobrados`;
}

export function armarHtmlResumen(r: ResumenMensual, g: MarcaGimnasio): string {
  const color  = colorValido(g.colorPrimario);
  const logo   = urlValida(g.logoUrl);
  const nombre = esc(g.nombre);
  const mes    = nombreMes(r.periodo);
  const mesAnt = nombreMes(sumarMeses(r.periodo, -1));
  const anio   = r.periodo.slice(0, 4);

  const tarjeta = (titulo: string, cuerpo: string) => `
    <tr><td style="padding:0 24px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;">
        <tr><td style="padding:16px 18px;">
          <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;font-weight:bold;margin-bottom:8px;">${titulo}</div>
          ${cuerpo}
        </td></tr>
      </table>
    </td></tr>`;

  const numeroGrande = (n: string, sub: string) =>
    `<div style="font-size:30px;font-weight:bold;color:#111827;line-height:1.2;">${n}</div>
     <div style="font-size:13px;color:#4b5563;margin-top:4px;">${sub}</div>`;

  // 1. Cobrado
  const c = r.cobrado;
  const medios = c.porMedio.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;font-size:14px;color:#374151;">
        ${c.porMedio.map(m => `<tr>
          <td style="padding:4px 0;">${esc(m.medio)} <span style="color:#9ca3af;">(${entero(m.cantidad)})</span></td>
          <td style="padding:4px 0;text-align:right;">${pesos(m.total)}</td></tr>`).join('')}
       </table>`
    : '';
  const detalleVentas = c.ventas.cantidad > 0
    ? ` · cuotas ${pesos(c.cuotas.total)} · ventas ${pesos(c.ventas.total)}` : '';
  const bloqueCobrado = tarjeta('Cobrado en ' + mes,
    numeroGrande(pesos(c.total), `${entero(c.cantidad)} ${c.cantidad === 1 ? "pago" : "pagos"}${detalleVentas}`) +
    `<div style="font-size:13px;color:#4b5563;margin-top:6px;">${comparacion(c.total, c.mesAnterior.total, mesAnt)}</div>` +
    medios);

  // 2. Cuotas (foto al último día del mes)
  const q = r.cuotas;
  const fila = (etiqueta: string, n: number, colorN: string, estado: string) => `
    <tr>
      <td style="padding:6px 0;font-size:14px;color:#374151;">${etiqueta}</td>
      <td style="padding:6px 0;text-align:right;">
        <a href="${urlGimnasio(g.slug, `/socios?estado=${estado}`)}" style="font-size:18px;font-weight:bold;color:${colorN};text-decoration:none;">${entero(n)}</a>
      </td>
    </tr>`;
  const bloqueCuotas = tarjeta(`Cuotas al ${formatoFecha(r.fotoCuotas)}`, `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${fila('Al día', q.AL_DIA, '#15803d', 'AL_DIA')}
      ${fila('Vencen pronto (7 días)', q.POR_VENCER, '#b45309', 'POR_VENCER')}
      ${fila('Vencidas', q.VENCIDA, '#b91c1c', 'VENCIDA')}
      ${q.PENDIENTE ? fila('Pago pendiente', q.PENDIENTE, '#6d28d9', 'PENDIENTE') : ''}
    </table>
    <div style="font-size:12px;color:#6b7280;margin-top:8px;">${entero(q.totalSocios)} socios en total. Tocá un número para ver la lista.</div>`);

  // 3. Ingresos
  const i = r.ingresos;
  const bloqueIngresos = tarjeta('Ingresos en ' + mes,
    numeroGrande(entero(i.total), `${entero(i.sociosDistintos)} socios distintos vinieron al menos una vez`) +
    `<div style="font-size:13px;color:#4b5563;margin-top:6px;">${comparacion(i.total, i.mesAnterior.total, mesAnt)}</div>`);

  // 4. Dejaron de venir
  let cuerpoDejaron: string;
  if (!i.suficientes) {
    cuerpoDejaron = `
      <div style="font-size:14px;color:#374151;line-height:1.5;">
        Este mes se registraron ingresos de <strong>${entero(i.sociosDistintos)}</strong> de
        <strong>${entero(q.AL_DIA + q.POR_VENCER)}</strong> socios con la cuota al día, así que no podemos saber quién dejó de venir.
      </div>
      <div style="font-size:14px;color:#374151;line-height:1.5;margin-top:8px;">
        Si cada socio marca su ingreso en la <strong>Pantalla de ingreso</strong> (una tablet o PC en la entrada, con DNI o QR),
        el mes que viene te decimos con nombre y apellido quién dejó de venir, para que lo puedas llamar antes de que se dé de baja.
      </div>`;
  } else if (!r.dejaronDeVenir.length) {
    cuerpoDejaron = `<div style="font-size:14px;color:#15803d;">Todos los que vinieron en ${mesAnt} también vinieron en ${mes}. 👏</div>`;
  } else {
    const lista = r.dejaronDeVenir.slice(0, MAX_DEJARON_EN_MAIL);
    const resto = r.dejaronDeVenir.length - lista.length;
    cuerpoDejaron = `
      <div style="font-size:14px;color:#374151;margin-bottom:8px;">
        <strong>${entero(r.dejaronDeVenir.length)}</strong> socios vinieron en ${mesAnt} y en ${mes} no. Vale la pena un mensaje:
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#374151;">
        ${lista.map(d => `<tr>
          <td style="padding:6px 0;border-top:1px solid #f3f4f6;">
            <a href="${urlGimnasio(g.slug, `/socios/${encodeURIComponent(d.personaId)}`)}" style="color:#111827;font-weight:bold;text-decoration:none;">${esc(d.nombre)}</a>
            <div style="font-size:12px;color:#6b7280;">Última visita ${formatoFecha(d.ultimaVisita)} · cuota ${ESTADO_TXT[d.estadoCuota] ?? d.estadoCuota}${d.telefono ? ` · ${esc(d.telefono)}` : ''}</div>
          </td></tr>`).join('')}
      </table>
      ${resto > 0 ? `<div style="font-size:13px;color:#6b7280;margin-top:8px;">Y ${entero(resto)} más.</div>` : ''}`;
  }
  const bloqueDejaron = tarjeta('Dejaron de venir', cuerpoDejaron);

  const altas = r.altas > 0
    ? `<tr><td style="padding:0 24px 16px;font-size:14px;color:#374151;">🆕 ${r.altas === 1 ? 'Se sumó <strong>1 socio nuevo</strong>' : `Se sumaron <strong>${entero(r.altas)} socios nuevos</strong>`} en ${mes}.</td></tr>`
    : '';

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Resumen de ${mes}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#f9fafb;border-radius:12px;overflow:hidden;">
        <tr><td style="background:${color};padding:24px;text-align:center;">
          ${logo ? `<img src="${esc(logo)}" alt="${nombre}" height="56" style="height:56px;max-width:200px;display:block;margin:0 auto 10px;border:0;">` : ''}
          <div style="color:#ffffff;font-size:20px;font-weight:bold;">${nombre}</div>
          <div style="color:#ffffff;opacity:.9;font-size:14px;margin-top:4px;">Resumen de ${mes} ${anio}</div>
        </td></tr>
        <tr><td style="height:16px;"></td></tr>
        ${bloqueCobrado}
        ${bloqueCuotas}
        ${bloqueIngresos}
        ${bloqueDejaron}
        ${altas}
        <tr><td align="center" style="padding:8px 24px 24px;">
          <a href="${urlGimnasio(g.slug)}" style="display:inline-block;background:${color};color:#ffffff;font-weight:bold;font-size:15px;padding:12px 28px;border-radius:8px;text-decoration:none;">Ver en SmartGym</a>
        </td></tr>
        <tr><td style="padding:0 24px 24px;font-size:11px;color:#9ca3af;text-align:center;line-height:1.5;">
          Te llega porque sos administrador de ${nombre} en SmartGym. Se manda el día 1 de cada mes.<br>SmartGym · Cod&amp;Tics
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
