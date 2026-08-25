import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { err } from '../types/api.types';

export interface JwtPayload {
  sub:        string;   // usuario_id
  empresaId:  string;
  email:      string;
  iat?:       number;
  exp?:       number;
}

export const auth = (req: Request, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json(err('Token requerido'));
    return;
  }

  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.user      = payload;
    req.empresaId = payload.empresaId;

    // Sucursal activa opcional — viene en header X-Sucursal-Id
    const sucursalHeader = req.headers['x-sucursal-id'];
    if (sucursalHeader && typeof sucursalHeader === 'string') {
      req.sucursalId = sucursalHeader;
    }

    next();
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) {
      res.status(401).json(err('Token expirado'));
    } else {
      res.status(401).json(err('Token inválido'));
    }
  }
};
