import { Router } from 'express';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { prisma } from '../lib/prisma';
import { ok, err } from '../types/api.types';

const router = Router();
router.use(auth);

// GET /api/v1/ejercicios?grupoMuscularId=xxx
// Devuelve los ejercicios globales (compartidos por todos los gyms) + los propios de esta empresa.
router.get('/', rbac('rutinas.ver'), async (req: any, res, next) => {
  try {
    const { grupoMuscularId } = req.query;
    const ejercicios = await prisma.ejercicio.findMany({
      where: {
        activo: true,
        OR: [{ empresaId: null }, { empresaId: req.empresaId }],
        ...(grupoMuscularId ? { grupoMuscularId: String(grupoMuscularId) } : {}),
      },
      include: { grupoMuscular: { select: { id: true, nombre: true } } },
      orderBy: { nombre: 'asc' },
    });
    res.json(ok(ejercicios));
  } catch (e) { next(e); }
});

// POST /api/v1/ejercicios — siempre se crea como propio de la empresa (nunca global)
router.post('/', rbac('rutinas.editar'), async (req: any, res, next) => {
  try {
    const { nombre, descripcion, grupoMuscularId, videoUrl } = req.body;
    if (!nombre) { res.status(400).json(err('nombre requerido')); return; }
    const ejercicio = await prisma.ejercicio.create({
      data: {
        empresaId: req.empresaId,
        nombre,
        descripcion: descripcion ?? null,
        grupoMuscularId: grupoMuscularId ?? null,
        videoUrl: videoUrl ?? null,
        activo: true,
      },
    });
    res.status(201).json(ok(ejercicio, 'Ejercicio creado'));
  } catch (e) { next(e); }
});

// PATCH /api/v1/ejercicios/:id — solo se puede editar un ejercicio PROPIO (no los globales)
router.patch('/:id', rbac('rutinas.editar'), async (req: any, res, next) => {
  try {
    const existente = await prisma.ejercicio.findFirst({
      where: { id: req.params.id, empresaId: req.empresaId },
    });
    if (!existente) {
      res.status(404).json(err('Ejercicio no encontrado, o es un ejercicio global que no se puede editar'));
      return;
    }
    const { nombre, descripcion, grupoMuscularId, videoUrl, activo } = req.body;
    const ejercicio = await prisma.ejercicio.update({
      where: { id: req.params.id },
      data: {
        ...(nombre !== undefined && { nombre }),
        ...(descripcion !== undefined && { descripcion }),
        ...(grupoMuscularId !== undefined && { grupoMuscularId }),
        ...(videoUrl !== undefined && { videoUrl }),
        ...(activo !== undefined && { activo }),
      },
    });
    res.json(ok(ejercicio, 'Ejercicio actualizado'));
  } catch (e) { next(e); }
});

// GET /api/v1/ejercicios/grupos-musculares/todos — catálogo global de grupos musculares
router.get('/grupos-musculares/todos', rbac('rutinas.ver'), async (_req: any, res, next) => {
  try {
    const grupos = await prisma.grupoMuscular.findMany({ orderBy: { nombre: 'asc' } });
    res.json(ok(grupos));
  } catch (e) { next(e); }
});

export default router;
