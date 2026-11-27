import { prisma } from '../lib/prisma';
import { aFechaDB, deFechaDB, esFechaValida, hoyArgentina, formatoFecha, diasEntre } from '../lib/fechas';
import { enviarEmail } from './mailer.service';
import { CobroError } from '../lib/cobroError';

// =============================================================================
// Factura y mails de los pagos de suscripción (lo que Cod&Tics cobra a cada gimnasio).
//
// Tipo de factura (Argentina):
//   - Cod&Tics monotributista            -> C, siempre.
//   - Cod&Tics responsable inscripto     -> A si el gimnasio es responsable inscripto; B si no.
// Hoy la factura se hace en ARCA a mano y acá se carga el número y el PDF (origen MANUAL).
// El origen ARCA queda previsto para cuando se emita por web service (WSFE).
//
// Datos del emisor: se editan en el SuperAdmin (tabla config_cobro). Un campo vacío ahí usa el .env:
//   EMISOR_CONDICION_IVA=MONOTRIBUTO | RESPONSABLE_INSCRIPTO
//   EMISOR_PUNTO_VENTA=<número>   (el que se propone al cargar la factura)
//   COBROS_COPIA_A=<mail>          (copia oculta de cada mail de cobro, opcional)
//   COBROS_DATOS_PAGO=<texto>      (alias/CBU que va en los avisos de vencimiento, opcional)
// =============================================================================

export const CONDICIONES_IVA = ['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL'] as const;
export type CondicionIva = typeof CONDICIONES_IVA[number];
export type TipoFactura = 'A' | 'B' | 'C';

export const MAX_PDF_BYTES = 5 * 1024 * 1024;

const esc = (t: string) => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const pesos = (n: number) => '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const MAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CondicionEmisor = 'MONOTRIBUTO' | 'RESPONSABLE_INSCRIPTO';
export const CONDICIONES_EMISOR: readonly CondicionEmisor[] = ['MONOTRIBUTO', 'RESPONSABLE_INSCRIPTO'];
export const MAX_DATOS_PAGO = 500;

/** Lo que dice el .env (respaldo cuando el panel está vacío). */
export function emisorCondicionIva(): CondicionEmisor {
  return process.env.EMISOR_CONDICION_IVA === 'RESPONSABLE_INSCRIPTO' ? 'RESPONSABLE_INSCRIPTO' : 'MONOTRIBUTO';
}

export function tipoFacturaPara(emisor: 'MONOTRIBUTO' | 'RESPONSABLE_INSCRIPTO', receptor: string | null): TipoFactura {
  if (emisor === 'MONOTRIBUTO') return 'C';
  return receptor === 'RESPONSABLE_INSCRIPTO' ? 'A' : 'B';
}

/** "C 0003-00000125" */
export function numeroFactura(tipo: string, pv: number, numero: number): string {
  return `${tipo} ${String(pv).padStart(4, '0')}-${String(numero).padStart(8, '0')}`;
}

export function puntoVentaSugerido(): number | null {
  const n = Number(process.env.EMISOR_PUNTO_VENTA);
  return Number.isInteger(n) && n > 0 && n <= 99999 ? n : null;
}

// ----------------------------------------------------------------------------- datos de cobro (panel)

export interface ConfigCobro {
  condicionIva: CondicionEmisor;
  puntoVenta:   number | null;
  copiaA:       string | null;
  datosPago:    string | null;
  /** De dónde sale cada dato: 'panel' (guardado en el SuperAdmin), 'env' (.env) o null (vacío). */
  fuente: { condicionIva: 'panel' | 'env'; puntoVenta: 'panel' | 'env' | null; copiaA: 'panel' | 'env' | null; datosPago: 'panel' | 'env' | null };
  actualizado: string | null;
}

const copiaEnv = () => { const c = process.env.COBROS_COPIA_A?.trim(); return c && MAIL_OK.test(c) ? c : null; };
const datosEnv = () => process.env.COBROS_DATOS_PAGO?.trim() || null;

/** Datos de cobro vigentes: lo guardado en el panel y, para lo vacío, el .env. */
export async function obtenerConfigCobro(): Promise<ConfigCobro> {
  const c = await prisma.configCobro.findUnique({ where: { id: 1 } });
  const civa = c?.emisorCondicionIva && (CONDICIONES_EMISOR as readonly string[]).includes(c.emisorCondicionIva)
    ? c.emisorCondicionIva as CondicionEmisor : null;
  const pvEnv = puntoVentaSugerido(), cpEnv = copiaEnv(), dpEnv = datosEnv();
  const de = <T>(panel: T | null | undefined, env: T | null) =>
    panel != null && panel !== '' ? { v: panel, f: 'panel' as const } : env != null ? { v: env, f: 'env' as const } : { v: null, f: null };
  const pv = de(c?.emisorPuntoVenta, pvEnv), cp = de(c?.copiaA, cpEnv), dp = de(c?.datosPago, dpEnv);
  return {
    condicionIva: civa ?? emisorCondicionIva(),
    puntoVenta:   pv.v, copiaA: cp.v, datosPago: dp.v,
    fuente: { condicionIva: civa ? 'panel' : 'env', puntoVenta: pv.f, copiaA: cp.f, datosPago: dp.f },
    actualizado: c ? c.updatedAt.toISOString() : null,
  };
}

export interface ConfigCobroInput { condicionIva?: unknown; puntoVenta?: unknown; copiaA?: unknown; datosPago?: unknown }

/** Guarda los datos de cobro. Vacío o null = volver a usar el .env para ese dato. */
export async function guardarConfigCobro(b: ConfigCobroInput): Promise<ConfigCobro> {
  const txt = (v: unknown) => (v == null ? '' : typeof v === 'string' ? v.trim() : null);

  const civa = txt(b.condicionIva);
  if (civa === null || (civa !== '' && !(CONDICIONES_EMISOR as readonly string[]).includes(civa)))
    throw new CobroError('Condición frente al IVA inválida (Monotributo o Responsable inscripto)');

  let pv: number | null = null;
  if (b.puntoVenta != null && b.puntoVenta !== '') {
    const n = Number(b.puntoVenta);
    if (!Number.isInteger(n) || n < 1 || n > 99999) throw new CobroError('Punto de venta inválido (de 1 a 99999)');
    pv = n;
  }

  const cp = txt(b.copiaA);
  if (cp === null || (cp !== '' && (!MAIL_OK.test(cp) || cp.length > 150))) throw new CobroError('Mail de copia inválido');

  const dp = txt(b.datosPago);
  if (dp === null) throw new CobroError('Datos para pagar inválidos');
  if (dp.length > MAX_DATOS_PAGO) throw new CobroError(`Los datos para pagar no pueden pasar de ${MAX_DATOS_PAGO} caracteres`);

  const data = {
    emisorCondicionIva: civa || null, emisorPuntoVenta: pv,
    copiaA: cp ? cp.toLowerCase() : null, datosPago: dp || null,
  };
  await prisma.configCobro.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
  return obtenerConfigCobro();
}

// ----------------------------------------------------------------------------- cargar factura

export interface FacturaInput {
  tipo?: unknown; puntoVenta?: unknown; numero?: unknown; fecha?: unknown; cae?: unknown; caeVto?: unknown;
}

/** Carga (o corrige) la factura de un pago. El PDF es opcional: si no viene, se deja el que había. */
export async function cargarFactura(pagoId: string, b: FacturaInput, pdf?: { buffer: Buffer; nombre: string }, hoy = hoyArgentina()) {
  const tipo = typeof b.tipo === 'string' ? b.tipo.toUpperCase() : '';
  if (!['A', 'B', 'C'].includes(tipo)) throw new CobroError('Tipo de factura inválido (A, B o C)');
  const pv = Number(b.puntoVenta);
  if (!Number.isInteger(pv) || pv < 1 || pv > 99999) throw new CobroError('Punto de venta inválido');
  const numero = Number(b.numero);
  if (!Number.isInteger(numero) || numero < 1 || numero > 99999999) throw new CobroError('Número de factura inválido');
  const fecha = b.fecha === undefined || b.fecha === '' ? hoy : b.fecha;
  if (typeof fecha !== 'string' || !esFechaValida(fecha)) throw new CobroError('Fecha de factura inválida');
  if (fecha > hoy) throw new CobroError('La fecha de la factura no puede ser futura');
  let cae: string | null = null;
  if (b.cae !== undefined && b.cae !== null && b.cae !== '') {
    cae = String(b.cae).replace(/\D/g, '');
    if (cae.length !== 14) throw new CobroError('El CAE tiene 14 números');
  }
  let caeVto: string | null = null;
  if (b.caeVto !== undefined && b.caeVto !== null && b.caeVto !== '') {
    if (typeof b.caeVto !== 'string' || !esFechaValida(b.caeVto)) throw new CobroError('Vencimiento del CAE inválido');
    caeVto = b.caeVto;
  }
  if (pdf) {
    if (pdf.buffer.length > MAX_PDF_BYTES) throw new CobroError('El PDF pesa más de 5 MB');
    if (pdf.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new CobroError('El archivo no es un PDF');
  }

  const pago = await prisma.pagoSuscripcion.findUnique({ where: { id: pagoId }, select: { id: true, anuladoAt: true } }).catch(() => null);
  if (!pago) throw new CobroError('Pago no encontrado', 404);
  if (pago.anuladoAt) throw new CobroError('El pago está anulado: no se le carga factura', 409);

  const nombrePdf = pdf ? `Factura-${tipo}-${String(pv).padStart(4, '0')}-${String(numero).padStart(8, '0')}.pdf` : undefined;
  try {
    await prisma.pagoSuscripcion.update({
      where: { id: pagoId },
      data: {
        facturaTipo: tipo, facturaPuntoVenta: pv, facturaNumero: numero, facturaFecha: aFechaDB(fecha),
        facturaCae: cae, facturaCaeVto: caeVto ? aFechaDB(caeVto) : null, facturaOrigen: 'MANUAL',
        ...(pdf ? { facturaPdf: pdf.buffer, facturaPdfNombre: nombrePdf } : {}),
      },
    });
  } catch (e: any) {
    if (e.code === 'P2002') throw new CobroError(`La factura ${numeroFactura(tipo, pv, numero)} ya está cargada en otro pago`, 409);
    throw e;
  }
  return { numero: numeroFactura(tipo, pv, numero), pdfNuevo: !!pdf };
}

export async function obtenerPdfFactura(pagoId: string) {
  const p = await prisma.pagoSuscripcion.findUnique({
    where: { id: pagoId }, select: { facturaPdf: true, facturaPdfNombre: true },
  }).catch(() => null);
  if (!p || !p.facturaPdf) throw new CobroError('Este pago no tiene PDF de factura', 404);
  return { buffer: Buffer.from(p.facturaPdf), nombre: p.facturaPdfNombre ?? 'factura.pdf' };
}

// ----------------------------------------------------------------------------- destinatarios

/** A quién se le manda lo de cobro: el mail de cobro del gimnasio, o sus administradores activos. */
export async function destinatariosCobro(empresaId: string, hoy: string): Promise<string[]> {
  const e = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { emailCobro: true } });
  const propio = e?.emailCobro?.trim().toLowerCase();
  if (propio && MAIL_OK.test(propio)) return [propio];
  const usuarios = await prisma.usuario.findMany({
    where: {
      empresaId, activo: true, deletedAt: null,
      roles: { some: {
        rol: { nombre: 'Administrador', activo: true, empresaId },
        OR:  [{ fechaHasta: null }, { fechaHasta: { gte: aFechaDB(hoy) } }],
      } },
    },
    select: { email: true },
  });
  return [...new Set(usuarios.map(u => u.email.trim().toLowerCase()).filter(m => MAIL_OK.test(m)))];
}


function marco(titulo: string, cuerpo: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
  <div style="background:#534AB7;padding:20px 24px;border-radius:12px 12px 0 0;">
    <p style="color:#fff;margin:0;font-size:13px;opacity:.85;">SmartGym · Cod&amp;Tics</p>
    <h1 style="color:#fff;margin:4px 0 0;font-size:20px;">${titulo}</h1>
  </div>
  <div style="background:#fafafa;padding:24px;border-radius:0 0 12px 12px;border:1px solid #eee;">${cuerpo}
    <p style="font-size:12px;color:#888;margin-top:24px;">Este mail lo manda SmartGym. Si tenés dudas, respondé a este correo.</p>
  </div>
</div>`;
}

const fila = (k: string, v: string) =>
  `<tr><td style="padding:6px 0;color:#666;font-size:14px;">${k}</td><td style="padding:6px 0;font-size:14px;text-align:right;"><b>${v}</b></td></tr>`;

// ----------------------------------------------------------------------------- recibo / factura por mail

type Enviar = typeof enviarEmail;

/** Manda al gimnasio el recibo del pago, con la factura en PDF si está cargada. */
export async function enviarComprobantePago(pagoId: string, opts: { enviar?: Enviar; hoy?: string } = {}) {
  const enviar = opts.enviar ?? enviarEmail;
  const hoy = opts.hoy ?? hoyArgentina();
  const p = await prisma.pagoSuscripcion.findUnique({
    where: { id: pagoId },
    include: { empresa: { select: { id: true, nombre: true, nombreComercial: true } } },
  }).catch(() => null);
  if (!p) throw new CobroError('Pago no encontrado', 404);
  if (p.anuladoAt) throw new CobroError('El pago está anulado', 409);

  const para = await destinatariosCobro(p.empresaId, hoy);
  if (!para.length) throw new CobroError('El gimnasio no tiene mail de cobro ni administradores con mail', 409);

  const gimnasio = p.empresa.nombreComercial ?? p.empresa.nombre;
  const fact = p.facturaNumero && p.facturaTipo && p.facturaPuntoVenta
    ? numeroFactura(p.facturaTipo, p.facturaPuntoVenta, p.facturaNumero) : null;
  const html = marco(fact ? `Factura ${esc(fact)}` : 'Recibimos tu pago', `
    <p style="font-size:15px;">Hola, equipo de <b>${esc(gimnasio)}</b>. Gracias por tu pago de SmartGym.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:12px;">
      ${fila('Monto', pesos(Number(p.monto)))}
      ${fila('Período', `${formatoFecha(deFechaDB(p.periodoDesde))} al ${formatoFecha(deFechaDB(p.periodoHasta))}`)}
      ${p.planNombre ? fila('Plan', esc(p.planNombre)) : ''}
      ${fila('Fecha de pago', formatoFecha(deFechaDB(p.fechaPago)))}
      ${fact ? fila('Factura', esc(fact)) : ''}
      ${p.facturaCae ? fila('CAE', esc(p.facturaCae)) : ''}
    </table>
    ${p.facturaPdf ? '<p style="font-size:14px;">Te adjuntamos la factura en PDF.</p>' : ''}`);
  const asunto = fact
    ? `SmartGym: factura ${fact} de ${gimnasio}`
    : `SmartGym: recibimos el pago de ${gimnasio}`;

  try {
    await enviar({
      para, asunto, html, nombreRemitente: 'SmartGym', cco: (await obtenerConfigCobro()).copiaA ?? undefined,
      adjuntos: p.facturaPdf
        ? [{ filename: p.facturaPdfNombre ?? 'factura.pdf', content: Buffer.from(p.facturaPdf), contentType: 'application/pdf' }]
        : undefined,
    });
  } catch (e: any) {
    // Falla del servidor de mail (SMTP caído o mal configurado): se avisa en el panel, no es un 500.
    console.error(`[COBROS] No se pudo mandar el mail del pago ${pagoId}:`, e?.code ?? '', e?.message ?? e);
    throw new CobroError('No se pudo enviar el mail: el servidor de correo no respondió. Revisá la configuración SMTP.', 502);
  }
  const enviadoAt = new Date();
  await prisma.pagoSuscripcion.update({ where: { id: pagoId }, data: { enviadoAt, enviadoA: para.join(', ') } });
  return { enviadoA: para, enviadoAt: enviadoAt.toISOString(), conFactura: !!p.facturaPdf };
}

// ----------------------------------------------------------------------------- avisos de vencimiento

export type TipoAviso = 'POR_VENCER' | 'VENCE_HOY' | 'VENCIDO';
export const DIAS_ANTES_AVISO = 5;
export const DIAS_DESPUES_AVISO = 3;
export const MAX_INTENTOS_AVISO = 3;

/** Qué aviso corresponde hoy según "pagado hasta": 5 a 1 días antes, el día, o 1 a 3 días después. */
export function avisoQueCorresponde(pagadoHasta: string, hoy: string): TipoAviso | null {
  const d = diasEntre(hoy, pagadoHasta);
  if (d >= 1 && d <= DIAS_ANTES_AVISO) return 'POR_VENCER';
  if (d === 0) return 'VENCE_HOY';
  if (d < 0 && d >= -DIAS_DESPUES_AVISO) return 'VENCIDO';
  return null;
}

function htmlAviso(tipo: TipoAviso, gimnasio: string, pagadoHasta: string, hoy: string, monto: number | null, datos: string | null) {
  const fecha = formatoFecha(pagadoHasta);
  const d = diasEntre(hoy, pagadoHasta);
  const titulo = tipo === 'VENCIDO' ? 'Tu suscripción está vencida'
              : tipo === 'VENCE_HOY' ? 'Tu suscripción vence hoy'
              : `Tu suscripción vence en ${d} ${d === 1 ? 'día' : 'días'}`;
  const cuerpo = `
    <p style="font-size:15px;">Hola, equipo de <b>${esc(gimnasio)}</b>.</p>
    <p style="font-size:14px;">${tipo === 'VENCIDO'
      ? `Tu suscripción a SmartGym venció el <b>${fecha}</b>. Para seguir usando el sistema sin cortes, regularizá el pago.`
      : `Tu suscripción a SmartGym está paga hasta el <b>${fecha}</b>. Para que no se corte, renovala antes de esa fecha.`}</p>
    ${monto !== null ? `<table style="width:100%;border-collapse:collapse;">${fila('Monto mensual', pesos(monto))}</table>` : ''}
    ${datos ? `<p style="font-size:14px;margin-top:16px;"><b>Datos para pagar:</b><br>${esc(datos).replace(/\n/g, '<br>')}</p>` : ''}
    <p style="font-size:13px;color:#666;">Si ya pagaste, ignorá este mensaje.</p>`;
  return { asunto: `SmartGym: ${titulo.toLowerCase()} (${gimnasio})`, html: marco(titulo, cuerpo) };
}

/**
 * Manda los avisos que correspondan hoy. No repite: cada (gimnasio, tipo, pagado hasta) se
 * reserva en avisos_cobro antes de mandar. Si el SMTP falla queda en ERROR y se reintenta
 * en la próxima vuelta, hasta MAX_INTENTOS_AVISO.
 */
export async function procesarAvisosCobro(opts: { hoy?: string; enviar?: Enviar } = {}) {
  const hoy = opts.hoy ?? hoyArgentina();
  const enviar = opts.enviar ?? enviarEmail;
  const res = { enviados: 0, errores: 0, sinDestinatarios: 0, yaEnviados: 0 };
  const config = await obtenerConfigCobro();

  const empresas = await prisma.empresa.findMany({
    where: { activo: true, deletedAt: null, pagadoHasta: { not: null } },
    select: {
      id: true, nombre: true, nombreComercial: true, pagadoHasta: true, precioAcordado: true,
      planComercial: { select: { precioMensual: true } },
    },
  });

  for (const e of empresas) {
    const pagadoHasta = deFechaDB(e.pagadoHasta!);
    const tipo = avisoQueCorresponde(pagadoHasta, hoy);
    if (!tipo) continue;
    const clave = { empresaId: e.id, tipo, pagadoHasta: aFechaDB(pagadoHasta) };

    const previa = await prisma.avisoCobro.findUnique({ where: { empresaId_tipo_pagadoHasta: clave } });
    if (previa && (previa.estado !== 'ERROR' || previa.intentos >= MAX_INTENTOS_AVISO)) { res.yaEnviados++; continue; }
    let reserva;
    try {
      reserva = previa
        ? await prisma.avisoCobro.update({
            where: { id: previa.id, estado: 'ERROR', intentos: previa.intentos },
            data:  { estado: 'ENVIANDO', intentos: { increment: 1 }, error: null },
          })
        : await prisma.avisoCobro.create({ data: { ...clave, estado: 'ENVIANDO' } });
    } catch { res.yaEnviados++; continue; }

    const gimnasio = e.nombreComercial ?? e.nombre;
    try {
      const para = await destinatariosCobro(e.id, hoy);
      if (!para.length) {
        await prisma.avisoCobro.update({ where: { id: reserva.id }, data: { estado: 'SIN_DESTINATARIOS' } });
        res.sinDestinatarios++; continue;
      }
      const monto = e.precioAcordado !== null ? Number(e.precioAcordado)
                  : e.planComercial?.precioMensual != null ? Number(e.planComercial.precioMensual) : null;
      const { asunto, html } = htmlAviso(tipo, gimnasio, pagadoHasta, hoy, monto, config.datosPago);
      await enviar({ para, asunto, html, nombreRemitente: 'SmartGym', cco: config.copiaA ?? undefined });
      await prisma.avisoCobro.update({ where: { id: reserva.id }, data: { estado: 'ENVIADO', destinatarios: para.join(', ') } });
      res.enviados++;
      console.log(`[AVISOS COBRO] ${gimnasio}: ${tipo} (pagado hasta ${pagadoHasta}) a ${para.length} destinatario(s)`);
    } catch (err) {
      res.errores++;
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.avisoCobro.update({ where: { id: reserva.id }, data: { estado: 'ERROR', error: msg.slice(0, 500) } }).catch(() => undefined);
      console.error(`[AVISOS COBRO] Error con ${gimnasio}:`, msg);
    }
  }
  console.log(`[AVISOS COBRO] ${hoy}: ${res.enviados} enviados, ${res.errores} errores, ${res.sinDestinatarios} sin destinatarios, ${res.yaEnviados} ya enviados`);
  return res;
}

