import { Router } from 'express';
import { inscripcionesController } from '../controllers/inscripciones.controller';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { crearInscripcionSchema, cambiarEstadoSchema } from '../schemas/inscripciones.schema';
import { idParamSchema } from '../schemas/common.schema';

const router = Router();
router.use(auth);

// GET  /api/v1/inscripciones?personaRolId=&estado=&page=&limit=
router.get('/',    rbac('inscripciones.ver'),    inscripcionesController.listar);

// POST /api/v1/inscripciones
router.post('/',   rbac('inscripciones.crear'),  validate(crearInscripcionSchema), inscripcionesController.crear);

// POST /api/v1/inscripciones/:id/renovar
router.post('/:id/renovar',  rbac('inscripciones.crear'),   validate(idParamSchema,'params'), inscripcionesController.renovar);

// PATCH /api/v1/inscripciones/:id/estado
router.patch('/:id/estado',  rbac('inscripciones.editar'),  validate(idParamSchema,'params'),
                                                             validate(cambiarEstadoSchema),    inscripcionesController.cambiarEstado);

export default router;
