import { Router } from 'express';
import { ventasController } from '../controllers/ventas.controller';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { crearVentaSchema } from '../schemas/ventas.schema';
import { idParamSchema } from '../schemas/common.schema';

const router = Router();
router.use(auth);

// GET  /api/v1/ventas?sucursalId=&estado=&desde=&hasta=&page=&limit=
router.get('/',                  rbac('ventas.ver'),    ventasController.listar);

// GET  /api/v1/ventas/resumen?sucursalId=
router.get('/resumen',           rbac('ventas.ver'),    ventasController.resumenDiario);

// GET  /api/v1/ventas/:id
router.get('/:id',               rbac('ventas.ver'),    validate(idParamSchema, 'params'), ventasController.obtener);

// POST /api/v1/ventas
router.post('/',                 rbac('ventas.crear'),  validate(crearVentaSchema),        ventasController.crear);

// PATCH /api/v1/ventas/:id/anular
router.patch('/:id/anular',      rbac('ventas.anular'), validate(idParamSchema, 'params'), ventasController.anular);

export default router;
