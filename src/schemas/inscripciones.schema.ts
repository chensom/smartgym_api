import { z } from 'zod';

export const crearInscripcionSchema = z.object({
  personaRolId:  z.string().uuid(),
  planId:        z.string().uuid(),
  sucursalId:    z.string().uuid(),
  fechaInicio:   z.string().date(),
  medioPagoId:   z.string().uuid().optional(),  // si se cobra en el mismo acto
  observaciones: z.string().max(500).optional(),
}).strict();

export const cambiarEstadoSchema = z.object({
  estado:        z.enum(['ACTIVA','VENCIDA','CANCELADA','SUSPENDIDA']),
  observaciones: z.string().max(500).optional(),
}).strict();

// Sin .strict(): el frontend actual puede mandar campos de más en el body de renovar.
export const renovarSchema = z.object({
  medioPagoId: z.string().uuid().optional(),
});

export const cobrarSchema = z.object({
  medioPagoId: z.string().uuid(),
}).strict();

export const cambiarPlanSchema = z.object({
  planId:        z.string().uuid(),
  medioPagoId:   z.string().uuid().optional(),  // solo si el período actual no estaba pagado
  observaciones: z.string().max(500).optional(),
}).strict();

export const corregirMedioPagoSchema = z.object({
  medioPagoId: z.string().uuid(),
}).strict();

export const previewAltaSchema = z.object({
  planId:       z.string().uuid(),
  personaRolId: z.string().uuid().optional(),
  fechaInicio:  z.string().date().optional(),
});

export const previewCambioSchema = z.object({
  planId: z.string().uuid(),
});

export type CrearInscripcionInput   = z.infer<typeof crearInscripcionSchema>;
export type CambiarEstadoInput      = z.infer<typeof cambiarEstadoSchema>;
export type CambiarPlanInput        = z.infer<typeof cambiarPlanSchema>;
export type PreviewAltaInput        = z.infer<typeof previewAltaSchema>;
