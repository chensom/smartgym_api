import { Router } from 'express';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { prisma } from '../lib/prisma';
import { ok, err } from '../types/api.types';

const router = Router();
router.use(auth);

async function personaRolDeLaEmpresa(personaRolId: string, empresaId: string) {
  return prisma.personaRol.findFirst({ where: { id: personaRolId, persona: { empresaId } } });
}

// GET /api/v1/registros/:personaRolId/ejercicios — qué ejercicios tiene registrados este socio
// (para armar el selector de "ver progresión de...")
router.get('/:personaRolId/ejercicios', rbac('socios.ver'), async (req: any, res, next) => {
  try {
    const rolValido = await personaRolDeLaEmpresa(req.params.personaRolId, req.empresaId);
    if (!rolValido) { res.status(404).json(err('Socio no encontrado')); return; }

    const registros = await prisma.registroEntrenamiento.findMany({
      where: { personaRolId: req.params.personaRolId },
      distinct: ['ejercicioId'],
      include: { ejercicio: { select: { id: true, nombre: true } } },
      orderBy: { fecha: 'desc' },
    });
    res.json(ok(registros.map(r => r.ejercicio)));
  } catch (e) { next(e); }
});

// GET /api/v1/registros/:personaRolId?ejercicioId=xxx — historial (de un ejercicio o de todos)
router.get('/:personaRolId', rbac('socios.ver'), async (req: any, res, next) => {
  try {
    const rolValido = await personaRolDeLaEmpresa(req.params.personaRolId, req.empresaId);
    if (!rolValido) { res.status(404).json(err('Socio no encontrado')); return; }

    const { ejercicioId } = req.query;
    const registros = await prisma.registroEntrenamiento.findMany({
      where: {
        personaRolId: req.params.personaRolId,
        ...(ejercicioId ? { ejercicioId: String(ejercicioId) } : {}),
      },
      include: { ejercicio: { select: { nombre: true } } },
      orderBy: { fecha: 'asc' },
    });
    res.json(ok(registros));
  } catch (e) { next(e); }
});

// POST /api/v1/registros
router.post('/', rbac('socios.editar'), async (req: any, res, next) => {
  try {
    const { personaRolId, ejercicioId, fecha, peso, series, repeticiones, observaciones } = req.body;
    if (!personaRolId || !ejercicioId || !fecha) {
      res.status(400).json(err('personaRolId, ejercicioId y fecha son requeridos'));
      return;
    }
    const rolValido = await personaRolDeLaEmpresa(personaRolId, req.empresaId);
    if (!rolValido) { res.status(404).json(err('Socio no encontrado')); return; }

    const registro = await prisma.registroEntrenamiento.create({
      data: {
        personaRolId,
        ejercicioId,
        fecha:         new Date(fecha),
        peso:          peso ? Number(peso) : null,
        series:        series ? Number(series) : null,
        repeticiones:  repeticiones ?? null,
        observaciones: observaciones ?? null,
      },
      include: { ejercicio: { select: { nombre: true } } },
    });
    res.status(201).json(ok(registro, 'Registro cargado'));
  } catch (e) { next(e); }
});

// DELETE /api/v1/registros/:id
router.delete('/:id', rbac('socios.editar'), async (req: any, res, next) => {
  try {
    const existente = await prisma.registroEntrenamiento.findFirst({
      where: { id: req.params.id, personaRol: { persona: { empresaId: req.empresaId } } },
    });
    if (!existente) { res.status(404).json(err('Registro no encontrado')); return; }
    await prisma.registroEntrenamiento.delete({ where: { id: req.params.id } });
    res.json(ok(null, 'Registro eliminado'));
  } catch (e) { next(e); }
});

export default router;
