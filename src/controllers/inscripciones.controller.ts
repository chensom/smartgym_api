import { Request, Response, NextFunction } from 'express';
import { inscripcionesService } from '../services/inscripciones.service';
import { ok, paginate } from '../types/api.types';

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
    } catch (e: any) {
      if (e.message?.includes('ya tiene una inscripción activa')) {
        res.status(409).json({ ok: false, error: e.message });
        return;
      }
      next(e);
    }
  },

  async renovar(req: Request, res: Response, next: NextFunction) {
    try {
      const { medioPagoId } = req.body;
      const nueva = await inscripcionesService.renovar(req.empresaId!, req.user!.sub, req.params.id, medioPagoId);
      res.json(ok(nueva, 'Inscripción renovada'));
    } catch (e) { next(e); }
  },

  async cambiarEstado(req: Request, res: Response, next: NextFunction) {
    try {
      const { prisma } = await import('../lib/prisma');
      const inscripcion = await prisma.inscripcion.update({
        where: { id: req.params.id },
        data:  { estado: req.body.estado, observaciones: req.body.observaciones },
      });
      res.json(ok(inscripcion, `Estado cambiado a ${req.body.estado}`));
    } catch (e) { next(e); }
  },
};
