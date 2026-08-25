import { z } from 'zod';

export const crearPersonaSchema = z.object({
  nombres:         z.string().min(1).max(100),
  apellidos:       z.string().min(1).max(100),
  fechaNacimiento: z.string().date().optional(),
  genero:          z.enum(['M','F','X','NB']).optional(),
  fotoUrl:         z.string().url().optional(),
  sucursalId:      z.string().uuid().optional(),
  tipoRolId:       z.string().uuid().optional(),
  documentos: z.array(z.object({
    tipo:        z.enum(['DNI','PASAPORTE','CUIL','CUIT','OTRO']),
    numero:      z.string().min(1).max(30),
    vencimiento: z.string().date().optional(),
  })).optional(),
  contactos: z.array(z.object({
    tipo:      z.enum(['TEL','CEL','EMAIL','WA','IG','OTRO']),
    valor:     z.string().min(1).max(150),
    principal: z.boolean().default(false),
  })).optional(),
});

export const actualizarPersonaSchema = crearPersonaSchema.partial();
export type CrearPersonaInput      = z.infer<typeof crearPersonaSchema>;
export type ActualizarPersonaInput = z.infer<typeof actualizarPersonaSchema>;
