import { Router } from 'express';
import { sociosController } from '../controllers/socios.controller';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate.middleware';
import { crearPersonaSchema, actualizarPersonaSchema } from '../schemas/personas.schema';
import { idParamSchema } from '../schemas/common.schema';
import { prisma } from '../lib/prisma';
import { ok, err, paginate } from '../types/api.types';
import { z } from 'zod';
import { listarPorEstadoCuota, ESTADOS_CUOTA } from '../services/estadoCuota.service';
import { cuotasDelSocio, asistenciasDelSocio, NoEncontrado } from '../services/socioFicha.service';

const estadoCuotaQuerySchema = z.object({
  estado: z.enum(ESTADOS_CUOTA).optional(),
  q:      z.string().trim().max(100).optional(),
  page:   z.coerce.number().int().min(1).max(10_000).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});

const router = Router();
router.use(auth);

router.get('/',      rbac('socios.ver'),      sociosController.listar);

// Lista de socios con el estado de la cuota y la cantidad por estado (etapa 2 del rediseño).
// Va ANTES de '/:id' para que 'estado-cuota' no se tome como un id.
router.get('/estado-cuota', rbac('socios.ver'), validate(estadoCuotaQuerySchema, 'query'), async (req: any, res, next) => {
  try {
    const { estado, q, page, limit } = req.query;
    const r = await listarPorEstadoCuota(req.empresaId!, { estado, q, page, limit });
    res.json(ok({ socios: r.socios, conteos: r.conteos, totalSocios: r.totalSocios, hoy: r.hoy },
                undefined, paginate(r.total, page, limit)));
  } catch (e) { next(e); }
});
// Ficha del socio: historial completo de cuotas con sus pagos, y sus asistencias.
const paginaSchema = z.object({
  page:  z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
function fichaHandler(fn: (empresaId: string, id: string, page: number, limit: number) => Promise<any>) {
  return async (req: any, res: any, next: any) => {
    try {
      const { page, limit } = req.query;
      const r = await fn(req.empresaId!, req.params.id, page, limit);
      res.json(ok(r, undefined, paginate(r.total, page, limit)));
    } catch (e) {
      if (e instanceof NoEncontrado) { res.status(404).json(err('Socio no encontrado')); return; }
      next(e);
    }
  };
}
router.get('/:id/cuotas',      rbac('inscripciones.ver'), validate(idParamSchema, 'params'), validate(paginaSchema, 'query'), fichaHandler(cuotasDelSocio));
router.get('/:id/asistencias', rbac('asistencias.ver'),   validate(idParamSchema, 'params'), validate(paginaSchema, 'query'), fichaHandler(asistenciasDelSocio));

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
      where: { personaId: req.params.id, fechaBaja: null, persona: { empresaId: req.empresaId } },
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
