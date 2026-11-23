import { Request, Response, NextFunction } from 'express';
import { inscripcionesService } from '../services/inscripciones.service';
import { ok, paginate } from '../types/api.types';

// Los errores de negocio (HttpError 4xx) los responde el errorHandler global
// con su código y mensaje; acá solo se delega con next(e).
export const inscripcionesController = {

  async listar(req: Request, res: Response, next: NextFunction) {
    try {
      const { personaRolId, estado, page = '1', limit = '20' } = req.query as any;
      const result = await inscripcionesService.listar(req.empresaId!, {
        personaRolId, estado,
        page:  parseInt(page),
        limit: parseInt(limit),
      });
      res.json(ok(result.inscripciones, undefined, paginate(result.total, parseInt(page), parseInt(limit))));
    } catch (e) { next(e); }
  },

  async crear(req: Request, res: Response, next: NextFunction) {
    try {
      const inscripcion = await inscripcionesService.crear(req.empresaId!, req.user!.sub, req.body);
      res.status(201).json(ok(inscripcion, 'Inscripción registrada'));
    } catch (e) { next(e); }
  },

  async renovar(req: Request, res: Response, next: NextFunction) {
    try {
      const { medioPagoId } = req.body ?? {};
      const nueva = await inscripcionesService.renovar(req.empresaId!, req.user!.sub, req.params.id, medioPagoId);
      res.json(ok(nueva, 'Inscripción renovada'));
    } catch (e) { next(e); }
  },

  async cobrar(req: Request, res: Response, next: NextFunction) {
    try {
      const ins = await inscripcionesService.cobrar(req.empresaId!, req.user!.sub, req.params.id, req.body.medioPagoId);
      res.json(ok(ins, 'Cobro registrado'));
    } catch (e) { next(e); }
  },

  async cambiarPlan(req: Request, res: Response, next: NextFunction) {
    try {
      const nueva = await inscripcionesService.cambiarPlan(req.empresaId!, req.user!.sub, req.params.id, req.body);
      res.status(201).json(ok(nueva, 'Plan cambiado'));
    } catch (e) { next(e); }
  },

  async corregirMedioPago(req: Request, res: Response, next: NextFunction) {
    try {
      const pago = await inscripcionesService.corregirMedioPago(req.empresaId!, req.params.id, req.body.medioPagoId);
      res.json(ok(pago, 'Medio de pago corregido'));
    } catch (e) { next(e); }
  },

  async previewAlta(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(ok(await inscripcionesService.previewAlta(req.empresaId!, req.query as any)));
    } catch (e) { next(e); }
  },

  async previewRenovacion(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(ok(await inscripcionesService.previewRenovacion(req.empresaId!, req.params.id)));
    } catch (e) { next(e); }
  },

  async previewCobro(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(ok(await inscripcionesService.previewCobro(req.empresaId!, req.params.id)));
    } catch (e) { next(e); }
  },

  async previewCambioPlan(req: Request, res: Response, next: NextFunction) {
    try {
      const { planId } = req.query as any;
      res.json(ok(await inscripcionesService.previewCambioPlan(req.empresaId!, req.params.id, planId)));
    } catch (e) { next(e); }
  },

  async cambiarEstado(req: Request, res: Response, next: NextFunction) {
    try {
      const inscripcion = await inscripcionesService.cambiarEstado(req.empresaId!, req.params.id, req.body);
      res.json(ok(inscripcion, `Estado cambiado a ${req.body.estado}`));
    } catch (e) { next(e); }
  },
};
