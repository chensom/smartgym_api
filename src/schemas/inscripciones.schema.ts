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

export type CrearInscripcionInput  = z.infer<typeof crearInscripcionSchema>;
export type CambiarEstadoInput     = z.infer<typeof cambiarEstadoSchema>;
