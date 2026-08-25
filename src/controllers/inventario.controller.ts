import { Request, Response, NextFunction } from 'express';
import { inventarioService } from '../services/inventario.service';
import { ok, err, paginate } from '../types/api.types';
import { z } from 'zod';

const movimientoSchema = z.object({
  proveedorId: z.string().uuid().optional(),
  sucursalId:  z.string().uuid(),
  productoId:  z.string().uuid(),
  varianteId:  z.string().uuid().optional(),
  tipo:        z.enum(['ENTRADA','SALIDA','AJUSTE','TRANSFERENCIA','DEVOLUCION']),
  cantidad:    z.number().refine(n => n !== 0, 'La cantidad no puede ser 0'),
  motivo:      z.string().max(200).optional(),
});

export const inventarioController = {

  async stock(req: Request, res: Response, next: NextFunction) {
    try {
      const { sucursalId } = req.query as any;
      const data = await inventarioService.stockPorSucursal(req.empresaId!, sucursalId);
      res.json(ok(data));
    } catch (e) { next(e); }
  },

  async bajosDeStock(req: Request, res: Response, next: NextFunction) {
    try {
      const { sucursalId } = req.query as any;
      const data = await inventarioService.bajosDeStock(req.empresaId!, sucursalId);
      res.json(ok(data));
    } catch (e) { next(e); }
  },

  async registrarMovimiento(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = movimientoSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({ ok: false, error: 'Datos inválidos', issues: parsed.error.issues });
        return;
      }
      const mov = await inventarioService.registrarMovimiento({
        ...parsed.data,
        usuarioId: req.user!.sub,
      });
      res.status(201).json(ok(mov, 'Movimiento registrado'));
    } catch (e) { next(e); }
  },

  async historial(req: Request, res: Response, next: NextFunction) {
    try {
      const { productoId, sucursalId, page = '1', limit = '50' } = req.query as any;
      const result = await inventarioService.historialMovimientos({
        productoId, sucursalId,
        empresaId: req.empresaId!,
        page:  parseInt(page),
        limit: parseInt(limit),
      });
      res.json(ok(result.movimientos, undefined, paginate(result.total, parseInt(page), parseInt(limit))));
    } catch (e) { next(e); }
  },

  async productos(req: Request, res: Response, next: NextFunction) {
    try {
      const { q, categoriaId, marcaId, page = '1', limit = '20' } = req.query as any;
      const result = await inventarioService.listarProductos(req.empresaId!, {
        q, categoriaId, marcaId,
        page:  parseInt(page),
        limit: parseInt(limit),
      });
      res.json(ok(result.productos, undefined, paginate(result.total, parseInt(page), parseInt(limit))));
    } catch (e) { next(e); }
  },

  async crearProducto(req: Request, res: Response, next: NextFunction) {
    try {
      const { nombre, codigo, categoriaId, marcaId, proveedorId, precioVenta, precioCosto, stockInicial } = req.body;
      if (!nombre || !categoriaId || !precioVenta) {
        res.status(422).json({ ok: false, error: 'nombre, categoriaId y precioVenta son requeridos' });
        return;
      }
      const producto = await inventarioService.crearProducto(req.empresaId!, {
        nombre, codigo, categoriaId, marcaId, proveedorId,
        precioVenta: parseFloat(precioVenta),
        precioCosto: precioCosto ? parseFloat(precioCosto) : undefined,
        stockInicial: stockInicial ? parseFloat(stockInicial) : undefined,
      });
      res.status(201).json(ok(producto, 'Producto creado correctamente'));
    } catch (e) { next(e); }
  },

  async actualizarProducto(req: Request, res: Response, next: NextFunction) {
    try {
      const { nombre, codigo, categoriaId, marcaId, precioVenta, precioCosto, activo } = req.body;
      const data: any = {};
      if (nombre      !== undefined) data.nombre = nombre;
      if (codigo      !== undefined) data.codigo = codigo;
      if (categoriaId !== undefined) data.categoriaId = categoriaId;
      if (marcaId     !== undefined) data.marcaId = marcaId;
      if (req.body.proveedorId !== undefined) data.proveedorId = req.body.proveedorId;
      if (precioVenta !== undefined) data.precioVenta = parseFloat(precioVenta);
      if (precioCosto !== undefined) data.precioCosto = precioCosto ? parseFloat(precioCosto) : null;
      if (activo      !== undefined) data.activo = activo;

      const producto = await inventarioService.actualizarProducto(req.params.id, data);
      res.json(ok(producto, 'Producto actualizado'));
    } catch (e) { next(e); }
  },

  async ajustarPrecios(req: Request, res: Response, next: NextFunction) {
    try {
      const { marcaId, categoriaId, porcentaje, tipo, campo } = req.body;
      if (!porcentaje || !tipo || !campo) {
        res.status(422).json({ ok: false, error: 'porcentaje, tipo y campo son requeridos' });
        return;
      }
      const result = await inventarioService.ajustarPrecios({
        empresaId:   req.empresaId!,
        marcaId:     marcaId     || undefined,
        categoriaId: categoriaId || undefined,
        porcentaje:  parseFloat(porcentaje),
        tipo,
        campo,
      });
      res.json({ ok: true, data: result, message: `Precios ajustados en ${result.cantidad} productos` });
    } catch (e) { next(e); }
  },
};
