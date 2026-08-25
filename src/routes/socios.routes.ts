import { Router } from 'express';
import { sociosController } from '../controllers/socios.controller';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { crearPersonaSchema, actualizarPersonaSchema } from '../schemas/personas.schema';
import { idParamSchema } from '../schemas/common.schema';
import { prisma } from '../lib/prisma';
import { ok, err } from '../types/api.types';

const router = Router();
router.use(auth);

router.get('/',      rbac('socios.ver'),      sociosController.listar);
router.get('/:id',   rbac('socios.ver'),      validate(idParamSchema, 'params'), sociosController.obtener);
router.post('/',     rbac('socios.crear'),    validate(crearPersonaSchema),       sociosController.crear);
router.patch('/:id', rbac('socios.editar'),   validate(idParamSchema, 'params'),
                                              validate(actualizarPersonaSchema),  sociosController.actualizar);
router.delete('/:id',rbac('socios.eliminar'), validate(idParamSchema, 'params'), sociosController.darDeBaja);

// PATCH /api/v1/socios/:id/rol — cambiar tipo de rol
router.patch('/:id/rol', rbac('socios.editar'), async (req: any, res, next) => {
  try {
    const { tipoRolId } = req.body;
    if (!tipoRolId) { res.status(400).json(err('tipoRolId requerido')); return; }

    // Verificar que el tipo de rol existe
    const tipoRol = await prisma.tipoRolPersona.findFirst({
      where: { id: tipoRolId, empresaId: req.empresaId },
    });
    if (!tipoRol) { res.status(404).json(err('Tipo de rol no encontrado')); return; }

    // Actualizar el rol activo de la persona
    const rolActual = await prisma.personaRol.findFirst({
      where: { personaId: req.params.id, fechaBaja: null },
    });
    if (!rolActual) { res.status(404).json(err('La persona no tiene un rol activo')); return; }

    const actualizado = await prisma.personaRol.update({
      where: { id: rolActual.id },
      data:  { tipoRolId },
      include: { tipoRol: true },
    });

    res.json(ok(actualizado, `Perfil cambiado a ${tipoRol.nombre}`));
  } catch (e) { next(e); }
});

export default router;
