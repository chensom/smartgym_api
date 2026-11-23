import { Router } from 'express';
import { inscripcionesController } from '../controllers/inscripciones.controller';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  crearInscripcionSchema, cambiarEstadoSchema, renovarSchema, cobrarSchema,
  cambiarPlanSchema, corregirMedioPagoSchema, previewAltaSchema, previewCambioSchema,
} from '../schemas/inscripciones.schema';
import { idParamSchema } from '../schemas/common.schema';

const router = Router();
router.use(auth);

const idParam = validate(idParamSchema, 'params');

// GET  /api/v1/inscripciones?personaRolId=&estado=&page=&limit=
router.get('/',    rbac('inscripciones.ver'),    inscripcionesController.listar);

// GET  /api/v1/inscripciones/preview?planId=&personaRolId=&fechaInicio=
// (ruta literal: va ANTES de cualquier /:id)
router.get('/preview', rbac('inscripciones.ver'), validate(previewAltaSchema, 'query'), inscripcionesController.previewAlta);

// POST /api/v1/inscripciones
router.post('/',   rbac('inscripciones.crear'),  validate(crearInscripcionSchema), inscripcionesController.crear);

// GET  /api/v1/inscripciones/:id/preview-renovacion
router.get('/:id/preview-renovacion', rbac('inscripciones.ver'), idParam, inscripcionesController.previewRenovacion);

// GET  /api/v1/inscripciones/:id/preview-cobro   (monto de una PENDIENTE si se cobra hoy)
router.get('/:id/preview-cobro', rbac('inscripciones.ver'), idParam, inscripcionesController.previewCobro);

// GET  /api/v1/inscripciones/:id/preview-cambio-plan?planId=
router.get('/:id/preview-cambio-plan', rbac('inscripciones.ver'), idParam,
                                       validate(previewCambioSchema, 'query'), inscripcionesController.previewCambioPlan);

// POST /api/v1/inscripciones/:id/renovar   { medioPagoId? }
router.post('/:id/renovar',  rbac('inscripciones.crear'),  idParam, validate(renovarSchema), inscripcionesController.renovar);

// POST /api/v1/inscripciones/:id/cobrar    { medioPagoId }   (inscripción PENDIENTE)
router.post('/:id/cobrar',   rbac('inscripciones.crear'),  idParam, validate(cobrarSchema), inscripcionesController.cobrar);

// POST /api/v1/inscripciones/:id/cambiar-plan   { planId, medioPagoId?, observaciones? }
router.post('/:id/cambiar-plan', rbac('inscripciones.editar'), idParam, validate(cambiarPlanSchema), inscripcionesController.cambiarPlan);

// PATCH /api/v1/inscripciones/:id/medio-pago   { medioPagoId }   (solo el mismo día, sin caja cerrada)
router.patch('/:id/medio-pago', rbac('inscripciones.editar'), idParam, validate(corregirMedioPagoSchema), inscripcionesController.corregirMedioPago);

// PATCH /api/v1/inscripciones/:id/estado
router.patch('/:id/estado',  rbac('inscripciones.editar'),  idParam,
                                                             validate(cambiarEstadoSchema),    inscripcionesController.cambiarEstado);

export default router;
