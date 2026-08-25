import { Request, Response, NextFunction } from 'express';
import { facturacionService } from '../services/facturacion.service';
import { ok, err, paginate } from '../types/api.types';
import { z } from 'zod';

const itemSchema = z.object({
  descripcion:    z.string().min(1).max(150),
  cantidad:       z.number().positive(),
  precioUnitario: z.number().min(0),
  alicuotaIva:    z.number().refine(v => [0, 10.5, 21, 27].includes(v), {
    message: 'Alícuota IVA debe ser 0, 10.5, 21 o 27'
  }).default(21),
});

const emitirSchema = z.object({
  ventaId:         z.string().uuid().optional(),
  inscripcionId:   z.string().uuid().optional(),
  personaId:       z.string().uuid().optional(),
  sucursalId:      z.string().uuid(),
  tipoComprobante: z.enum(['FA', 'FB', 'FC', 'FX', 'NCA', 'NCB', 'NCC']),
  items:           z.array(itemSchema).min(1),
  observaciones:   z.string().max(500).optional(),
});

export const facturacionController = {

  // POST /api/v1/facturas
  async emitir(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = emitirSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({ ok: false, error: 'Datos inválidos', issues: parsed.error.issues });
        return;
      }
      const factura = await facturacionService.emitir(req.empresaId!, req.user!.sub, parsed.data);
      const esFX = parsed.data.tipoComprobante === 'FX';
      res.status(201).json(ok(factura, esFX ? 'Presupuesto generado' : 'Comprobante emitido y autorizado por ARCA'));
    } catch (e: any) {
      if (e.message?.includes('ARCA')) {
        res.status(502).json(err(e.message));
        return;
      }
      next(e);
    }
  },

  // POST /api/v1/facturas/:id/nota-credito
  async notaCredito(req: Request, res: Response, next: NextFunction) {
    try {
      const nc = await facturacionService.emitirNotaCredito(req.empresaId!, req.params.id);
      res.status(201).json(ok(nc, 'Nota de crédito emitida'));
    } catch (e: any) {
      if (e.message?.includes('ARCA') || e.message?.includes('Solo se pueden')) {
        res.status(409).json(err(e.message));
        return;
      }
      next(e);
    }
  },

  // POST /api/v1/facturas/:id/reintentar
  async reintentar(req: Request, res: Response, next: NextFunction) {
    try {
      const factura = await facturacionService.reintentar(req.empresaId!, req.params.id);
      res.json(ok(factura, 'Comprobante reautorizado por ARCA'));
    } catch (e: any) {
      res.status(502).json(err(e.message));
    }
  },

  // GET /api/v1/facturas
  async listar(req: Request, res: Response, next: NextFunction) {
    try {
      const { tipo, estado, personaId, desde, hasta, page = '1', limit = '20' } = req.query as any;
      const result = await facturacionService.listar(req.empresaId!, {
        tipo, estado, personaId,
        desde: desde ? new Date(desde) : undefined,
        hasta: hasta ? new Date(hasta) : undefined,
        page:  parseInt(page),
        limit: parseInt(limit),
      });
      res.json(ok(result.facturas, undefined, paginate(result.total, parseInt(page), parseInt(limit))));
    } catch (e) { next(e); }
  },

  // GET /api/v1/facturas/:id
  async obtener(req: Request, res: Response, next: NextFunction) {
    try {
      const factura = await facturacionService.obtener(req.empresaId!, req.params.id);
      res.json(ok(factura));
    } catch (e) { next(e); }
  },

  // GET /api/v1/facturas/resumen?desde=&hasta=
  async resumen(req: Request, res: Response, next: NextFunction) {
    try {
      const { desde, hasta, sucursalId } = req.query as any;
      if (!desde || !hasta) {
        res.status(400).json(err('Se requieren parámetros desde y hasta'));
        return;
      }
      const result = await facturacionService.resumen(req.empresaId!, {
        desde:      new Date(desde),
        hasta:      new Date(hasta),
        sucursalId,
      });
      res.json(ok(result));
    } catch (e) { next(e); }
  },
};
