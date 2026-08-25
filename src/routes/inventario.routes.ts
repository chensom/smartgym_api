import { Router } from 'express';
import { inventarioController } from '../controllers/inventario.controller';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(auth);

router.get('/stock',         rbac('inventario.ver'),     inventarioController.stock);
router.get('/bajos',         rbac('inventario.ver'),     inventarioController.bajosDeStock);
router.get('/productos',     rbac('inventario.ver'),     inventarioController.productos);
router.get('/movimientos',   rbac('inventario.ver'),     inventarioController.historial);
router.post('/movimientos',  rbac('inventario.ajustar'), inventarioController.registrarMovimiento);
router.post('/productos',    rbac('inventario.ajustar'), inventarioController.crearProducto);
router.patch('/productos/:id', rbac('inventario.ajustar'), inventarioController.actualizarProducto);
router.post('/ajuste-precios', rbac('inventario.ajustar'), inventarioController.ajustarPrecios);

// Marcas y categorías para filtros
router.get('/marcas', rbac('inventario.ver'), async (req: any, res, next) => {
  try {
    const marcas = await prisma.marca.findMany({
      where:   { empresaId: req.empresaId },
      orderBy: { nombre: 'asc' },
    });
    res.json({ ok: true, data: marcas });
  } catch (e) { next(e); }
});

router.get('/categorias', rbac('inventario.ver'), async (req: any, res, next) => {
  try {
    const cats = await prisma.categoriaProducto.findMany({
      where:   { empresaId: req.empresaId },
      orderBy: { nombre: 'asc' },
    });
    res.json({ ok: true, data: cats });
  } catch (e) { next(e); }
});

export default router;
