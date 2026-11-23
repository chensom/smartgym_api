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
      const result = await asistenciasService.registrarPorQR(req.empresaId!, qrCode, sucursalId);
      // Política: el socio ingresa igual con la cuota vencida; el aviso viaja en
      // data.aviso y también en el mensaje (para el frontend que solo muestra el toast).
      const mensaje = result.aviso
        ? `Bienvenido ${result.socio.nombres} — ${result.aviso.mensaje}`
        : `Bienvenido ${result.socio.nombres}!`;
      res.status(201).json(ok(result, mensaje));
    } catch (e) { next(e); }
  },

  // POST /asistencias/kiosco  { codigo, sucursalId, dispositivo? }
  async registrarKiosco(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await asistenciasService.registrarKiosco(req.empresaId!, req.body);
      res.status(result.yaRegistrado || !result.accesoPermitido ? 200 : 201).json(ok(result));
    } catch (e) { next(e); }
  },

  // GET /asistencias/kiosco/config
  async configKiosco(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(ok(await asistenciasService.configKiosco(req.empresaId!)));
    } catch (e) { next(e); }
  },

  // POST /asistencias/manual  { inscripcionId?, personaRolId?, sucursalId }
  async registrarManual(req: Request, res: Response, next: NextFunction) {
    try {
      const { inscripcionId, personaRolId, sucursalId } = req.body;
      if (!sucursalId) { res.status(400).json(err('sucursalId es requerido')); return; }
      const result = await asistenciasService.registrarManual(req.empresaId!, { inscripcionId, personaRolId, sucursalId });
      res.status(201).json(ok(result, 'Asistencia registrada'));
    } catch (e) { next(e); }
  },

  // PATCH /asistencias/:id/egreso
  async registrarEgreso(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await asistenciasService.registrarEgreso(req.empresaId!, req.params.id);
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
