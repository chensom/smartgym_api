import { Router } from 'express';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { prisma } from '../lib/prisma';
import { ok, err } from '../types/api.types';
import bcrypt from 'bcryptjs';

const router = Router();
router.use(auth);

// GET /api/v1/usuarios — listar usuarios de la empresa
router.get('/', rbac('configuracion.ver'), async (req: any, res, next) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      where: { empresaId: req.empresaId, deletedAt: null },
      include: {
        persona: { select: { nombres: true, apellidos: true, fotoUrl: true } },
        roles: {
          where: { fechaHasta: null },
          include: { rol: { select: { id: true, nombre: true, descripcion: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(ok(usuarios));
  } catch (e) { next(e); }
});

// GET /api/v1/usuarios/roles — listar roles disponibles con sus permisos
router.get('/roles', rbac('configuracion.ver'), async (req: any, res, next) => {
  try {
    const roles = await prisma.rol.findMany({
      where: { empresaId: req.empresaId, activo: true },
      include: {
        permisos: { include: { permiso: true } },
        _count: { select: { usuarios: true } },
      },
      orderBy: { nombre: 'asc' },
    });
    res.json(ok(roles));
  } catch (e) { next(e); }
});

// GET /api/v1/usuarios/permisos — listar todos los permisos disponibles
router.get('/permisos', rbac('configuracion.ver'), async (req: any, res, next) => {
  try {
    const permisos = await prisma.permiso.findMany({ orderBy: [{ modulo: 'asc' }, { codigo: 'asc' }] });
    res.json(ok(permisos));
  } catch (e) { next(e); }
});

// POST /api/v1/usuarios — crear usuario
router.post('/', rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { email, password, rolId, nombres, apellidos } = req.body;
    if (!email || !password || !rolId) {
      res.status(400).json(err('email, password y rolId son requeridos')); return;
    }

    const existe = await prisma.usuario.findUnique({ where: { email } });
    if (existe) { res.status(409).json(err('Ya existe un usuario con ese email')); return; }

    const hash = await bcrypt.hash(password, 10);

    const usuario = await prisma.$transaction(async tx => {
      // Crear persona si se proveen datos
      let personaId: string | undefined;
      if (nombres && apellidos) {
        const persona = await tx.persona.create({
          data: { empresaId: req.empresaId, nombres, apellidos },
        });
        personaId = persona.id;
      }

      const u = await tx.usuario.create({
        data: {
          empresaId: req.empresaId,
          email,
          passwordHash: hash,
          activo: true,
          personaId: personaId ?? null,
        },
      });

      await tx.usuarioRol.create({
        data: {
          usuarioId:  u.id,
          rolId,
          fechaDesde: new Date(),
        },
      });

      return u;
    });

    res.status(201).json(ok({ id: usuario.id, email: usuario.email }, 'Usuario creado'));
  } catch (e) { next(e); }
});

// PATCH /api/v1/usuarios/:id — editar usuario
router.patch('/:id', rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { rolId, activo, password, nombres, apellidos, email } = req.body;

    if (rolId) {
      await prisma.usuarioRol.updateMany({
        where: { usuarioId: req.params.id, fechaHasta: null },
        data:  { fechaHasta: new Date() },
      });
      await prisma.usuarioRol.create({
        data: { usuarioId: req.params.id, rolId, fechaDesde: new Date() },
      });
    }

    const data: any = {};
    if (activo   !== undefined) data.activo = activo;
    if (password) data.passwordHash = await bcrypt.hash(password, 10);
    if (email)    data.email = email;

    const usuario = await prisma.usuario.update({ where: { id: req.params.id }, data });

    // Actualizar o crear persona si se proveen datos
    if (nombres || apellidos) {
      if (usuario.personaId) {
        const personaData: any = {};
        if (nombres)   personaData.nombres   = nombres;
        if (apellidos) personaData.apellidos = apellidos;
        await prisma.persona.update({ where: { id: usuario.personaId }, data: personaData });
      } else {
        // Crear persona y vincularla al usuario
        const persona = await prisma.persona.create({
          data: {
            empresaId: req.empresaId,
            nombres:   nombres   ?? 'Sin nombre',
            apellidos: apellidos ?? '',
          },
        });
        await prisma.usuario.update({
          where: { id: req.params.id },
          data:  { personaId: persona.id },
        });
      }
    }
    res.json(ok({ id: usuario.id, email: usuario.email, activo: usuario.activo }, 'Usuario actualizado'));
  } catch (e) { next(e); }
});

// POST /api/v1/usuarios/roles — crear rol personalizado
router.post('/roles', rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { nombre, descripcion, permisoIds } = req.body;
    if (!nombre || !permisoIds?.length) {
      res.status(400).json(err('nombre y permisoIds son requeridos')); return;
    }

    const rol = await prisma.$transaction(async tx => {
      const r = await tx.rol.create({
        data: { empresaId: req.empresaId, nombre, descripcion },
      });
      await tx.rolPermiso.createMany({
        data: permisoIds.map((pid: string) => ({ rolId: r.id, permisoId: pid })),
        skipDuplicates: true,
      });
      return r;
    });

    res.status(201).json(ok(rol, 'Rol creado'));
  } catch (e) { next(e); }
});

// PATCH /api/v1/usuarios/roles/:id — editar permisos de un rol
router.patch('/roles/:id', rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { nombre, descripcion, permisoIds } = req.body;
    const data: any = {};
    if (nombre      !== undefined) data.nombre = nombre;
    if (descripcion !== undefined) data.descripcion = descripcion;

    await prisma.$transaction(async tx => {
      if (Object.keys(data).length) {
        await tx.rol.update({ where: { id: req.params.id }, data });
      }
      if (permisoIds) {
        await tx.rolPermiso.deleteMany({ where: { rolId: req.params.id } });
        await tx.rolPermiso.createMany({
          data: permisoIds.map((pid: string) => ({ rolId: req.params.id, permisoId: pid })),
          skipDuplicates: true,
        });
      }
    });

    const rol = await prisma.rol.findUnique({
      where: { id: req.params.id },
      include: { permisos: { include: { permiso: true } } },
    });
    res.json(ok(rol, 'Rol actualizado'));
  } catch (e) { next(e); }
});

export default router;
