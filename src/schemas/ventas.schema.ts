import { z } from 'zod';

const detalleSchema = z.object({
  productoId:     z.string().uuid().optional(),
  varianteId:     z.string().uuid().optional(),
  descripcion:    z.string().min(1).max(150),
  cantidad:       z.number().positive(),
  precioUnitario: z.number().min(0),
  descuento:      z.number().min(0).default(0),
});

export const crearVentaSchema = z.object({
  personaId:  z.string().uuid().optional(),
  sucursalId: z.string().uuid(),
  descuento:  z.number().min(0).default(0),
  detalles:   z.array(detalleSchema).min(1, 'Al menos un ítem'),
  // Pago inmediato opcional
  pago: z.object({
    medioPagoId:      z.string().uuid(),
    referenciaExterna: z.string().max(100).optional(),
  }).optional(),
}).strict();

export type CrearVentaInput = z.infer<typeof crearVentaSchema>;
