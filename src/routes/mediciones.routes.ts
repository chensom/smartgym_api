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

// GET /api/v1/mediciones/:personaRolId — historial completo, más antigua primero (para graficar)
router.get('/:personaRolId', rbac('socios.ver'), async (req: any, res, next) => {
  try {
    const rolValido = await personaRolDeLaEmpresa(req.params.personaRolId, req.empresaId);
    if (!rolValido) { res.status(404).json(err('Socio no encontrado')); return; }

    const mediciones = await prisma.medicionCorporal.findMany({
      where: { personaRolId: req.params.personaRolId },
      orderBy: { fecha: 'asc' },
    });
    res.json(ok(mediciones));
  } catch (e) { next(e); }
});

// POST /api/v1/mediciones
router.post('/', rbac('socios.editar'), async (req: any, res, next) => {
  try {
    const { personaRolId, fecha, peso, altura, observaciones } = req.body;
    if (!personaRolId || !fecha || (!peso && !altura)) {
      res.status(400).json(err('personaRolId, fecha, y al menos peso o altura son requeridos'));
      return;
    }
    const rolValido = await personaRolDeLaEmpresa(personaRolId, req.empresaId);
    if (!rolValido) { res.status(404).json(err('Socio no encontrado')); return; }

    const medicion = await prisma.medicionCorporal.create({
      data: {
        personaRolId,
        fecha:         new Date(fecha),
        peso:          peso ? Number(peso) : null,
        altura:        altura ? Number(altura) : null,
        observaciones: observaciones ?? null,
      },
    });
    res.status(201).json(ok(medicion, 'Medición cargada'));
  } catch (e) { next(e); }
});

// DELETE /api/v1/mediciones/:id
router.delete('/:id', rbac('socios.editar'), async (req: any, res, next) => {
  try {
    const existente = await prisma.medicionCorporal.findFirst({
      where: { id: req.params.id, personaRol: { persona: { empresaId: req.empresaId } } },
    });
    if (!existente) { res.status(404).json(err('Medición no encontrada')); return; }
    await prisma.medicionCorporal.delete({ where: { id: req.params.id } });
    res.json(ok(null, 'Medición eliminada'));
  } catch (e) { next(e); }
});

export default router;
