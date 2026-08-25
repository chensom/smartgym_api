import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { err } from '../types/api.types';

type Target = 'body' | 'query' | 'params';

export const validate =
  (schema: ZodSchema, target: Target = 'body') =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const issues = (result.error as ZodError).issues.map(i => ({
        campo: i.path.join('.'),
        error: i.message,
      }));
      res.status(422).json({ ok: false, error: 'Datos inválidos', issues });
      return;
    }
    req[target] = result.data;
    next();
  };
