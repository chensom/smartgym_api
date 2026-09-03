import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { ok, err } from '../types/api.types';
import { verificarTurnstile } from '../services/turnstile.service';

export const authController = {

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const turnstileOk = await verificarTurnstile(req.body?.turnstileToken, req.ip); 
        if (!turnstileOk) { res.status(400).json(err('No pudimos verificar que sos una persona real — recargá la página e intentá de nuevo')); 
          return; } 
      const result = await authService.login(req.body);
      res.json(ok(result, 'Login exitoso'));
    } catch (e: any) {
      res.status(401).json(err(e.message));
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.refresh(req.body.refreshToken);
      res.json(ok(result));
    } catch (e: any) {
      res.status(401).json(err(e.message));
    }
  },

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(ok({ user: req.user }));
    } catch (e) {
      next(e);
    }
  },
};
