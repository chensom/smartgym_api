import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { LoginInput } from '../schemas/auth.schema';

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
    };

    const accessToken  = jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });
    const refreshToken = jwt.sign({ sub: usuario.id }, env.JWT_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN as any });

    return {
      accessToken,
      refreshToken,
      usuario: {
        id:        usuario.id,
        email:     usuario.email,
        empresaId: usuario.empresaId,
        persona:   usuario.persona ?? null,
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

    const usuario = await prisma.usuario.findUnique({ where: { id: payload.sub } });
    if (!usuario || !usuario.activo) throw new Error('Usuario no disponible');

    const newPayload  = { sub: usuario.id, empresaId: usuario.empresaId, email: usuario.email };
    const accessToken = jwt.sign(newPayload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });

    return { accessToken };
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }
}

export const authService = new AuthService();
