import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { err } from '../types/api.types';

const cache = new Map<string, { permisos: string[]; exp: number }>();

async function getPermisosUsuario(usuarioId: string): Promise<string[]> {
  const cached = cache.get(usuarioId);
  if (cached && cached.exp > Date.now()) return cached.permisos;

  const roles = await prisma.usuarioRol.findMany({
    where: { usuarioId, fechaHasta: null },
    include: {
      rol: {
        include: { permisos: { include: { permiso: true } } }
      }
    }
  });

  const permisos = roles
    .flatMap(ur => ur.rol.permisos.map(rp => rp.permiso.codigo));

  cache.set(usuarioId, { permisos, exp: Date.now() + 5 * 60 * 1000 });
  return permisos;
}

export const invalidarCacheUsuario = (usuarioId: string) => cache.delete(usuarioId);

export const rbac = (permiso: string) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json(err('No autenticado'));
      return;
    }

    try {
      const permisos = await getPermisosUsuario(req.user.sub);

      if (permisos.includes('sistema.super') || permisos.includes(permiso)) {
        next();
        return;
      }

      res.status(403).json(err(`Permiso requerido: ${permiso}`));
    } catch (e) {
      next(e);
    }
  };
