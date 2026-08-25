import { Request, Response, NextFunction } from 'express';
import { asistenciasService } from '../services/asistencias.service';
import { ok, err, paginate } from '../types/api.types';

export const asistenciasController = {

  // POST /asistencias/qr  { qrCode, sucursalId }
  async registrarQR(req: Request, res: Response, next: NextFunction) {
    try {
      const { qrCode, sucursalId } = req.body;
      if (!qrCode || !sucursalId) {
        res.status(400).json(err('qrCode y sucursalId son requeridos'));
        return;
      }
      const result = await asistenciasService.registrarPorQR(qrCode, sucursalId);
      res.status(201).json(ok(result, `Bienvenido ${result.socio.nombres}!`));
    } catch (e: any) {
      res.status(e.status || 500).json(err(e.message));
    }
  },

  // POST /asistencias/manual  { inscripcionId?, personaRolId?, sucursalId }
  async registrarManual(req: Request, res: Response, next: NextFunction) {
    try {
      const { inscripcionId, personaRolId, sucursalId } = req.body;
      if (!sucursalId) { res.status(400).json(err('sucursalId es requerido')); return; }
      const result = await asistenciasService.registrarManual({ inscripcionId, personaRolId, sucursalId });
      res.status(201).json(ok(result, 'Asistencia registrada'));
    } catch (e) { next(e); }
  },

  // PATCH /asistencias/:id/egreso
  async registrarEgreso(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await asistenciasService.registrarEgreso(req.params.id);
      res.json(ok(result, 'Egreso registrado'));
    } catch (e) { next(e); }
  },

  // GET /asistencias?sucursalId=&desde=&hasta=&page=&limit=
  async listar(req: Request, res: Response, next: NextFunction) {
    try {
      const { sucursalId, desde, hasta, page = '1', limit = '50' } = req.query as any;
      const result = await asistenciasService.listar({
        empresaId: req.empresaId!,
        sucursalId,
        desde: desde ? new Date(desde) : undefined,
        hasta: hasta ? new Date(hasta) : undefined,
        page:  parseInt(page),
        limit: parseInt(limit),
      });
      res.json(ok(result.asistencias, undefined, paginate(result.total, parseInt(page), parseInt(limit))));
    } catch (e) { next(e); }
  },
};
