import { JwtPayload } from '../middlewares/auth.middleware';

declare global {
  namespace Express {
    interface Request {
      user?:       JwtPayload;  // usuario autenticado del JWT
      empresaId?:  string;      // empresa_id extraído del JWT
      sucursalId?: string;      // sucursal activa del header X-Sucursal-Id
    }
  }
}
