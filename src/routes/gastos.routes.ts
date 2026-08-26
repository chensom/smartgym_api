import { Router } from 'express';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { prisma } from '../lib/prisma';
import { ok, err } from '../types/api.types';

const router = Router();
router.use(auth);

// GET /api/v1/gastos/resumen?mes=&anio= — total por tipo (fijo/variable), para
// el dashboard y como base del futuro cierre de caja.
// Va ANTES de /:id a propósito, si no Express interpreta "resumen" como un id.
router.get('/resumen', rbac('gastos.ver'), async (req: any, res, next) => {
  try {
    const ahora  = new Date();
    const mes    = req.query.mes  ? Number(req.query.mes)  : ahora.getMonth() + 1;
    const anio   = req.query.anio ? Number(req.query.anio) : ahora.getFullYear();
    const inicio = new Date(anio, mes - 1, 1);
    const fin    = new Date(anio, mes, 0, 23, 59, 59);

    const gastos = await prisma.gasto.findMany({
      where: { empresaId: req.empresaId, fecha: { gte: inicio, lte: fin } },
      select: { tipo: true, monto: true },
    });

    const totalFijo     = gastos.filter(g => g.tipo === 'FIJO').reduce((a, g) => a + Number(g.monto), 0);
    const totalVariable = gastos.filter(g => g.tipo === 'VARIABLE').reduce((a, g) => a + Number(g.monto), 0);

    res.json(ok({
      mes, anio,
      totalFijo,
      totalVariable,
      total: totalFijo + totalVariable,
      cantidadGastos: gastos.length,
    }));
  } catch (e) { next(e); }
});

// GET /api/v1/gastos?desde=&hasta=&tipo=
router.get('/', rbac('gastos.ver'), async (req: any, res, next) => {
  try {
    const { desde, hasta, tipo } = req.query;
    const where: any = { empresaId: req.empresaId };
    if (tipo) where.tipo = String(tipo);
    if (desde || hasta) {
      where.fecha = {};
      if (desde) where.fecha.gte = new Date(String(desde));
      if (hasta) where.fecha.lte = new Date(String(hasta));
    }

    const gastos = await prisma.gasto.findMany({
      where,
      include: {
        sucursal:  { select: { nombre: true } },
        medioPago: { select: { nombre: true } },
      },
      orderBy: { fecha: 'desc' },
    });
    res.json(ok(gastos));
  } catch (e) { next(e); }
});

// POST /api/v1/gastos
router.post('/', rbac('gastos.editar'), async (req: any, res, next) => {
  try {
    const { tipo, categoria, descripcion, monto, fecha, sucursalId, medioPagoId } = req.body;
    if (!tipo || !categoria || !monto || !fecha) {
      res.status(400).json(err('tipo, categoria, monto y fecha son requeridos'));
      return;
    }
    const gasto = await prisma.gasto.create({
      data: {
        empresaId:   req.empresaId,
        tipo:        String(tipo).toUpperCase(),
        categoria,
        descripcion: descripcion ?? null,
        monto:       Number(monto),
        fecha:       new Date(fecha),
        sucursalId:  sucursalId ?? null,
        medioPagoId: medioPagoId ?? null,
      },
    });
    res.status(201).json(ok(gasto, 'Gasto cargado'));
  } catch (e) { next(e); }
});

// PATCH /api/v1/gastos/:id
router.patch('/:id', rbac('gastos.editar'), async (req: any, res, next) => {
  try {
    const existente = await prisma.gasto.findFirst({ where: { id: req.params.id, empresaId: req.empresaId } });
    if (!existente) { res.status(404).json(err('Gasto no encontrado')); return; }

    const { tipo, categoria, descripcion, monto, fecha, sucursalId, medioPagoId } = req.body;
    const gasto = await prisma.gasto.update({
      where: { id: req.params.id },
      data: {
        ...(tipo        !== undefined && { tipo: String(tipo).toUpperCase() }),
        ...(categoria    !== undefined && { categoria }),
        ...(descripcion !== undefined && { descripcion }),
        ...(monto        !== undefined && { monto: Number(monto) }),
        ...(fecha        !== undefined && { fecha: new Date(fecha) }),
        ...(sucursalId  !== undefined && { sucursalId }),
        ...(medioPagoId !== undefined && { medioPagoId }),
      },
    });
    res.json(ok(gasto, 'Gasto actualizado'));
  } catch (e) { next(e); }
});

// DELETE /api/v1/gastos/:id
router.delete('/:id', rbac('gastos.editar'), async (req: any, res, next) => {
  try {
    const existente = await prisma.gasto.findFirst({ where: { id: req.params.id, empresaId: req.empresaId } });
    if (!existente) { res.status(404).json(err('Gasto no encontrado')); return; }
    await prisma.gasto.delete({ where: { id: req.params.id } });
    res.json(ok(null, 'Gasto eliminado'));
  } catch (e) { next(e); }
});

export default router;
