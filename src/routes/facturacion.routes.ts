import { Router } from 'express';
import { facturacionController } from '../controllers/facturacion.controller';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { idParamSchema } from '../schemas/common.schema';
import { validate } from '../middlewares/validate.middleware';

const router = Router();
router.use(auth);

// GET  /api/v1/facturas/resumen?desde=&hasta=&sucursalId=
router.get('/resumen',               rbac('facturas.ver'),    facturacionController.resumen);

// GET  /api/v1/facturas?tipo=&estado=&personaId=&desde=&hasta=
router.get('/',                      rbac('facturas.ver'),    facturacionController.listar);

// GET  /api/v1/facturas/:id
router.get('/:id',                   rbac('facturas.ver'),    validate(idParamSchema,'params'), facturacionController.obtener);

// POST /api/v1/facturas  (incluye FX = presupuesto)
router.post('/',                     rbac('facturas.emitir'), facturacionController.emitir);

// POST /api/v1/facturas/:id/nota-credito
router.post('/:id/nota-credito',     rbac('facturas.anular'), validate(idParamSchema,'params'), facturacionController.notaCredito);

// POST /api/v1/facturas/:id/reintentar  (solo facturas en ERROR)
router.post('/:id/reintentar',       rbac('facturas.emitir'), validate(idParamSchema,'params'), facturacionController.reintentar);

export default router;
