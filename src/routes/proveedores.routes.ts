import { Router } from 'express';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { prisma } from '../lib/prisma';
import { ok, err, paginate } from '../types/api.types';

const router = Router();
router.use(auth);

// GET /api/v1/proveedores
router.get('/', rbac('inventario.ver'), async (req: any, res, next) => {
  try {
    const { q, page = '1', limit = '50' } = req.query;
    const p = parseInt(page); const l = parseInt(limit);
    const where: any = { empresaId: req.empresaId, deletedAt: null };
    if (q) {
      where.OR = [
        { nombre:      { contains: q, mode: 'insensitive' } },
        { razonSocial: { contains: q, mode: 'insensitive' } },
        { cuit:        { contains: q } },
      ];
    }
    const [total, proveedores] = await prisma.$transaction([
      prisma.proveedor.count({ where }),
      prisma.proveedor.findMany({
        where, skip: (p - 1) * l, take: l,
        orderBy: { nombre: 'asc' },
        include: { _count: { select: { productos: true } } },
      }),
    ]);
    res.json(ok(proveedores, undefined, paginate(total, p, l)));
  } catch (e) { next(e); }
});

// GET /api/v1/proveedores/:id
router.get('/:id', rbac('inventario.ver'), async (req: any, res, next) => {
  try {
    const proveedor = await prisma.proveedor.findFirst({
      where: { id: req.params.id, empresaId: req.empresaId, deletedAt: null },
      include: {
        productos: { where: { deletedAt: null }, select: { id: true, nombre: true, codigo: true, precioVenta: true, imagenUrl: true } },
      },
    });
    if (!proveedor) { res.status(404).json(err('Proveedor no encontrado')); return; }
    res.json(ok(proveedor));
  } catch (e) { next(e); }
});

// POST /api/v1/proveedores
router.post('/', rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { nombre, razonSocial, cuit, telefono, email, direccion, notas } = req.body;
    if (!nombre) { res.status(400).json(err('nombre requerido')); return; }
    const proveedor = await prisma.proveedor.create({
      data: { empresaId: req.empresaId, nombre, razonSocial, cuit, telefono, email, direccion, notas, activo: true },
    });
    res.status(201).json(ok(proveedor, 'Proveedor creado'));
  } catch (e) { next(e); }
});

// PATCH /api/v1/proveedores/:id
router.patch('/:id', rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { nombre, razonSocial, cuit, telefono, email, direccion, notas, activo } = req.body;
    const data: any = {};
    if (nombre      !== undefined) data.nombre = nombre;
    if (razonSocial !== undefined) data.razonSocial = razonSocial;
    if (cuit        !== undefined) data.cuit = cuit;
    if (telefono    !== undefined) data.telefono = telefono;
    if (email       !== undefined) data.email = email;
    if (direccion   !== undefined) data.direccion = direccion;
    if (notas       !== undefined) data.notas = notas;
    if (activo      !== undefined) data.activo = activo;
    const proveedor = await prisma.proveedor.update({ where: { id: req.params.id }, data });
    res.json(ok(proveedor, 'Proveedor actualizado'));
  } catch (e) { next(e); }
});

// DELETE /api/v1/proveedores/:id (soft delete)
router.delete('/:id', rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    await prisma.proveedor.update({
      where: { id: req.params.id },
      data:  { deletedAt: new Date(), activo: false },
    });
    res.json(ok(null, 'Proveedor eliminado'));
  } catch (e) { next(e); }
});

export default router;
