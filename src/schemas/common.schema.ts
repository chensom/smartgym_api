import { z } from 'zod';

export const uuidSchema = z.string().uuid('UUID inválido');

export const paginationSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q:     z.string().optional(),
});

export const idParamSchema = z.object({
  id: uuidSchema,
});
