import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { getPermisosUsuario } from '../middlewares/rbac.middleware';
import { env } from '../config/env';
import { LoginInput } from '../schemas/auth.schema';

const firmarRefresh = (usuarioId: string) =>
  jwt.sign({ sub: usuarioId, typ: 'refresh' }, env.JWT_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN as any });

export class AuthService {
  async login(input: LoginInput) {
    const usuario = await prisma.usuario.findUnique({
      where: { email: input.email },
      include: {
        persona: { select: { nombres: true, apellidos: true, fotoUrl: true } },
        empresa: { select: { slug: true, activo: true } },
      },
    });

    if (!usuario || !usuario.activo || usuario.deletedAt) {
      throw new Error('Credenciales inválidas');
    }

    const valid = await bcrypt.compare(input.password, usuario.passwordHash);
    if (!valid) throw new Error('Credenciales inválidas');

    // El email es único a nivel global, así que sin esta validación un usuario
    // de otro gym podría loguearse en el subdominio de este (mismo backend).
    // Por eso el frontend manda el slug del subdominio actual y lo comparamos acá.
    if (input.empresaSlug && usuario.empresa.slug !== input.empresaSlug) {
      throw new Error('Credenciales inválidas');
    }

    if (!usuario.empresa.activo) {
      throw new Error('Este gimnasio está suspendido. Contactá a soporte.');
    }

    await prisma.usuario.update({
      where: { id: usuario.id },
      data:  { ultimoLogin: new Date() },
    });

    const payload = {
      sub:       usuario.id,
      empresaId: usuario.empresaId,
      email:     usuario.email,
      typ:       'access',
    };

    const accessToken  = jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });
    const refreshToken = firmarRefresh(usuario.id);
    // El frontend los usa para decidir a dónde va después del login (ej. el usuario
    // de la Pantalla de ingreso va directo al kiosco). Los permisos se siguen
    // chequeando en cada endpoint: esto es solo para la navegación.
    const permisos = await getPermisosUsuario(usuario.id);

    return {
      accessToken,
      refreshToken,
      usuario: {
        id:        usuario.id,
        email:     usuario.email,
        empresaId: usuario.empresaId,
        persona:   usuario.persona ?? null,
        permisos,
      },
    };
  }

  async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = jwt.verify(refreshToken, env.JWT_SECRET);
    } catch {
      throw new Error('Refresh token inválido o expirado');
    }
    // Solo refresh tokens: los de acceso o de superadmin no sirven para renovar.
    // (Los refresh viejos, emitidos antes de agregar `typ`, no tienen empresaId ni rol.)
    if (payload.empresaId || payload.rol || (payload.typ && payload.typ !== 'refresh')) {
      throw new Error('Refresh token inválido o expirado');
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: payload.sub },
      include: { empresa: { select: { activo: true } } },
    });
    if (!usuario || !usuario.activo || usuario.deletedAt || !usuario.empresa.activo) {
      throw new Error('Usuario no disponible');
    }

    const newPayload  = { sub: usuario.id, empresaId: usuario.empresaId, email: usuario.email, typ: 'access' };
    const accessToken = jwt.sign(newPayload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });

    // Se entrega un refresh nuevo (ventana deslizante de 7 días): un equipo en uso
    // todos los días -como el kiosco de recepción- no queda deslogueado nunca.
    return { accessToken, refreshToken: firmarRefresh(usuario.id) };
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }
}

export const authService = new AuthService();
