import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { logger } from '../lib/logger';
import { env } from '../config/env';

export const errorHandler = (
  error: Error,
  req:   Request,
  res:   Response,
  next:  NextFunction
): void => {
  logger.error(error.message, { stack: error.stack, url: req.url, method: req.method });

  // Errores de Prisma — traducir a mensajes útiles
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        const fields = (error.meta?.target as string[])?.join(', ') ?? 'campo';
        res.status(409).json({ ok: false, error: `Ya existe un registro con ese ${fields}` });
        return;
      }
      case 'P2025':
        res.status(404).json({ ok: false, error: 'Registro no encontrado' });
        return;
      case 'P2003':
        res.status(409).json({ ok: false, error: 'Referencia inválida: el registro relacionado no existe' });
        return;
      case 'P2014':
        res.status(409).json({ ok: false, error: 'No se puede eliminar: existen registros relacionados' });
        return;
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({ ok: false, error: 'Datos inválidos para la base de datos' });
    return;
  }

  // Error genérico — no exponer stack en producción
  res.status(500).json({
    ok:    false,
    error: 'Error interno del servidor',
    ...(env.NODE_ENV === 'development' ? { detail: error.message } : {}),
  });
};

// Rutas no encontradas
export const notFound = (req: Request, res: Response): void => {
  res.status(404).json({ ok: false, error: `Ruta no encontrada: ${req.method} ${req.url}` });
};
