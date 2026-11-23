import { z } from 'zod';

export const loginSchema = z.object({
  email:       z.string().email('Email inválido'),
  password:    z.string().min(6, 'Mínimo 6 caracteres'),
  empresaSlug: z.string().min(1).max(60).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type LoginInput   = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
