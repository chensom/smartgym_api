import { Router } from 'express';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { prisma } from '../lib/prisma';
import { ok, err } from '../types/api.types';

const router = Router();
router.use(auth);

function rangoDelDia(fecha: string) {
  return {
    inicio: new Date(`${fecha}T00:00:00`),
    fin:    new Date(`${fecha}T23:59:59.999`),
  };
}

// Calcula lo esperado en caja para una sucursal en una fecha determinada:
// fondo inicial + ventas/inscripciones cobradas en efectivo - gastos pagados en efectivo.
// Las ventas por tarjeta/transferencia/MP no mueven el cajón físico, así que no entran
// en "montoEsperado" (pero sí se informan en el desglose, para tener el panorama completo).
async function calcularResumenDia(empresaId: string, sucursalId: string, fecha: string) {
  const { inicio, fin } = rangoDelDia(fecha);

  const [pagosVenta, pagosInscripcion, gastosEfectivo, gastosTotales, cierre, medios] = await Promise.all([
    prisma.pago.findMany({
      where: { fecha: { gte: inicio, lte: fin }, venta: { sucursalId } },
      select: { monto: true, medioPago: { select: { nombre: true, tipo: true } } },
    }),
    prisma.pago.findMany({
      where: { fecha: { gte: inicio, lte: fin }, inscripcion: { sucursalId } },
      select: { monto: true, medioPago: { select: { nombre: true, tipo: true } } },
    }),
    prisma.gasto.aggregate({
      where: { sucursalId, fecha: { gte: inicio, lte: fin }, medioPago: { tipo: 'EFECTIVO' } },
      _sum: { monto: true },
    }),
    prisma.gasto.aggregate({
      where: { sucursalId, fecha: { gte: inicio, lte: fin } },
      _sum: { monto: true },
    }),
    prisma.cierreCaja.findUnique({ where: { sucursalId_fecha: { sucursalId, fecha: new Date(fecha) } } }),
    prisma.medioPago.findMany({ where: { empresaId }, select: { nombre: true, tipo: true } }),
  ]);

  const todosLosPagos = [...pagosVenta, ...pagosInscripcion];
  const ventasEfectivo = todosLosPagos
    .filter(p => p.medioPago.tipo === 'EFECTIVO')
    .reduce((acc, p) => acc + Number(p.monto), 0);
  const ventasTotales = todosLosPagos.reduce((acc, p) => acc + Number(p.monto), 0);

  // Desglose por medio de pago (para mostrar "tarjeta: $X, transferencia: $Y", etc.)
  const desglose: Record<string, number> = {};
  for (const m of medios) desglose[m.nombre] = 0;
  for (const p of todosLosPagos) desglose[p.medioPago.nombre] = (desglose[p.medioPago.nombre] ?? 0) + Number(p.monto);

  const montoInicial     = cierre ? Number(cierre.montoInicial) : 0;
  const gastosEfectivoNum = Number(gastosEfectivo._sum.monto ?? 0);
  const montoEsperado    = montoInicial + ventasEfectivo - gastosEfectivoNum;
  const montoContado     = cierre?.montoContado != null ? Number(cierre.montoContado) : null;

  return {
    fecha, sucursalId,
    montoInicial,
    ventasEfectivo,
    ventasTotales,
    desglosePorMedio: desglose,
    gastosEfectivo:  gastosEfectivoNum,
    gastosTotales:   Number(gastosTotales._sum.monto ?? 0),
    montoEsperado,
    montoContado,
    diferencia:      montoContado != null ? montoContado - montoEsperado : null,
    observaciones:   cierre?.observaciones ?? null,
    cerrado:         montoContado != null,
  };
}

// GET /api/v1/caja/resumen-dia?fecha=&sucursalId=
router.get('/resumen-dia', rbac('caja.ver'), async (req: any, res, next) => {
  try {
    const { fecha, sucursalId } = req.query;
    if (!fecha || !sucursalId) { res.status(400).json(err('fecha y sucursalId son requeridos')); return; }
    const resumen = await calcularResumenDia(req.empresaId, String(sucursalId), String(fecha));
    res.json(ok(resumen));
  } catch (e) { next(e); }
});

// POST /api/v1/caja/cierre — guarda (crea o actualiza) el cierre del día
router.post('/cierre', rbac('caja.editar'), async (req: any, res, next) => {
  try {
    const { fecha, sucursalId, montoInicial, montoContado, observaciones } = req.body;
    if (!fecha || !sucursalId) { res.status(400).json(err('fecha y sucursalId son requeridos')); return; }

    const cierre = await prisma.cierreCaja.upsert({
      where: { sucursalId_fecha: { sucursalId, fecha: new Date(fecha) } },
      create: {
        empresaId: req.empresaId,
        sucursalId,
        fecha: new Date(fecha),
        montoInicial: montoInicial ?? 0,
        montoContado: montoContado ?? null,
        observaciones: observaciones ?? null,
      },
      update: {
        ...(montoInicial   !== undefined && { montoInicial }),
        ...(montoContado   !== undefined && { montoContado }),
        ...(observaciones  !== undefined && { observaciones }),
      },
    });
    res.json(ok(cierre, 'Cierre guardado'));
  } catch (e) { next(e); }
});

// GET /api/v1/caja/historial?sucursalId=&limite=
router.get('/historial', rbac('caja.ver'), async (req: any, res, next) => {
  try {
    const { sucursalId } = req.query;
    if (!sucursalId) { res.status(400).json(err('sucursalId es requerido')); return; }
    const limite = req.query.limite ? Number(req.query.limite) : 30;

    const cierres = await prisma.cierreCaja.findMany({
      where: { sucursalId: String(sucursalId) },
      orderBy: { fecha: 'desc' },
      take: limite,
    });

    const conResumen = await Promise.all(
      cierres.map(c => calcularResumenDia(req.empresaId, String(sucursalId), c.fecha.toISOString().slice(0, 10)))
    );
    res.json(ok(conResumen));
  } catch (e) { next(e); }
});

export default router;
