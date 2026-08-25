import { Request, Response, NextFunction } from 'express';
import { ventasService } from '../services/ventas.service';
import { ok, err, paginate } from '../types/api.types';

export const ventasController = {

  async listar(req: Request, res: Response, next: NextFunction) {
    try {
      const { sucursalId, personaId, estado, desde, hasta, page = '1', limit = '20' } = req.query as any;
      const result = await ventasService.listar(req.empresaId!, {
        sucursalId, personaId, estado,
        desde: desde ? new Date(desde) : undefined,
        hasta: hasta ? new Date(hasta) : undefined,
        page:  parseInt(page),
        limit: parseInt(limit),
      });
      res.json(ok(result.ventas, undefined, paginate(result.total, parseInt(page), parseInt(limit))));
    } catch (e) { next(e); }
  },

  async obtener(req: Request, res: Response, next: NextFunction) {
    try {
      const venta = await ventasService.obtener(req.empresaId!, req.params.id);
      res.json(ok(venta));
    } catch (e) { next(e); }
  },

  async crear(req: Request, res: Response, next: NextFunction) {
    try {
      const venta = await ventasService.crear(req.empresaId!, req.user!.sub, req.body);
      res.status(201).json(ok(venta, 'Venta registrada'));
    } catch (e: any) {
      if (e.message?.includes('Stock insuficiente')) {
        res.status(409).json(err(e.message));
        return;
      }
      next(e);
    }
  },

  async anular(req: Request, res: Response, next: NextFunction) {
    try {
      const venta = await ventasService.anular(req.empresaId!, req.params.id, req.user!.sub);
      res.json(ok(venta, 'Venta anulada'));
    } catch (e: any) {
      if (e.message?.includes('ya está cancelada')) {
        res.status(409).json(err(e.message));
        return;
      }
      next(e);
    }
  },

  async resumenDiario(req: Request, res: Response, next: NextFunction) {
    try {
      const { sucursalId } = req.query as any;
      const resumen = await ventasService.resumenDiario(req.empresaId!, sucursalId);
      res.json(ok(resumen));
    } catch (e) { next(e); }
  },
};
