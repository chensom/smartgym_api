import { Router } from 'express';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { prisma } from '../lib/prisma';
import { ok, err } from '../types/api.types';
import bcrypt from 'bcryptjs';
import { invalidarCacheUsuario } from '../middlewares/rbac.middleware';
import { HttpError } from '../lib/httpError';

const router = Router();
router.use(auth);

// ── Verificaciones por empresa ─────────────────────────────────────────────
// Antes estas rutas buscaban usuarios y roles solo por id: el admin de un
// gimnasio podía editar (contraseña, email, rol) usuarios de OTRO gimnasio y
// cambiar los permisos de roles ajenos.
const PERMISO_RESERVADO = 'sistema.super';   // solo lo asigna Cod&Tics, nunca un gimnasio

async function rolDeEmpresa(tx: any, empresaId: string, rolId: string) {
  return tx.rol.findFirst({ where: { id: rolId, empresaId, activo: true } });
}

/**
 * Valida que los permisos existan y que no se AGREGUE el reservado. Devuelve un error o null.
 * `yaTeniaReservado`: los roles Administrador de Fenix e Instinto ya tienen sistema.super
 * (19/11/2026); se les permite conservarlo, pero ningún gimnasio lo puede agregar.
 */
async function validarPermisos(tx: any, permisoIds: unknown, yaTeniaReservado = false): Promise<string | null> {
  if (!Array.isArray(permisoIds) || permisoIds.some(x => typeof x !== 'string')) return 'permisoIds inválido';
  const ids = [...new Set(permisoIds as string[])];
  const encontrados = await tx.permiso.findMany({ where: { id: { in: ids } }, select: { codigo: true } });
  if (encontrados.length !== ids.length) return 'Hay permisos que no existen';
  if (!yaTeniaReservado && encontrados.some((p: any) => p.codigo === PERMISO_RESERVADO)) return 'Ese permiso no se puede asignar';
  return null;
}

/** Que la empresa no se quede sin ningún usuario activo capaz de editar la configuración. */
async function quedaAdministrador(tx: any, empresaId: string) {
  const n = await tx.usuarioRol.count({
    where: {
      fechaHasta: null,
      usuario: { empresaId, activo: true, deletedAt: null },
      rol: { empresaId, activo: true, permisos: { some: { permiso: { codigo: { in: ['configuracion.editar', PERMISO_RESERVADO] } } } } },
    },
  });
  return n > 0;
}

const SIN_ADMIN = 'El gimnasio se quedaría sin ningún usuario que pueda editar la configuración.';

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
    if (!(await rolDeEmpresa(prisma, req.empresaId, rolId))) { res.status(404).json(err('Rol no encontrado')); return; }

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

    const usuario = await prisma.$transaction(async tx => {
      const actual = await tx.usuario.findFirst({ where: { id: req.params.id, empresaId: req.empresaId, deletedAt: null } });
      if (!actual) throw new HttpError(404, 'Usuario no encontrado');

      if (rolId) {
        if (!(await rolDeEmpresa(tx, req.empresaId, rolId))) throw new HttpError(404, 'Rol no encontrado');
        await tx.usuarioRol.updateMany({
          where: { usuarioId: actual.id, fechaHasta: null },
          data:  { fechaHasta: new Date() },
        });
        await tx.usuarioRol.create({
          data: { usuarioId: actual.id, rolId, fechaDesde: new Date() },
        });
      }

      const data: any = {};
      if (activo   !== undefined) data.activo = !!activo;
      if (password) data.passwordHash = await bcrypt.hash(password, 10);
      if (email)    data.email = email;

      const u = await tx.usuario.update({ where: { id: actual.id }, data });

      // Actualizar o crear persona si se proveen datos
      if (nombres || apellidos) {
        if (u.personaId) {
          const personaData: any = {};
          if (nombres)   personaData.nombres   = nombres;
          if (apellidos) personaData.apellidos = apellidos;
          await tx.persona.update({ where: { id: u.personaId }, data: personaData });
        } else {
          const persona = await tx.persona.create({
            data: { empresaId: req.empresaId, nombres: nombres ?? 'Sin nombre', apellidos: apellidos ?? '' },
          });
          await tx.usuario.update({ where: { id: u.id }, data: { personaId: persona.id } });
        }
      }

      if ((rolId || activo === false) && !(await quedaAdministrador(tx, req.empresaId))) throw new HttpError(409, SIN_ADMIN);
      return u;
    });

    invalidarCacheUsuario(usuario.id);   // que el cambio de rol rija ya, no en 5 minutos
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
      const error = await validarPermisos(tx, permisoIds);
      if (error) throw new HttpError(400, error);
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
      const existente = await tx.rol.findFirst({ where: { id: req.params.id, empresaId: req.empresaId } });
      if (!existente) throw new HttpError(404, 'Rol no encontrado');
      if (Object.keys(data).length) {
        await tx.rol.update({ where: { id: existente.id }, data });
      }
      if (permisoIds) {
        const teniaReservado = (await tx.rolPermiso.count({
          where: { rolId: existente.id, permiso: { codigo: PERMISO_RESERVADO } },
        })) > 0;
        const error = await validarPermisos(tx, permisoIds, teniaReservado);
        if (error) throw new HttpError(400, error);
        await tx.rolPermiso.deleteMany({ where: { rolId: existente.id } });
        await tx.rolPermiso.createMany({
          data: permisoIds.map((pid: string) => ({ rolId: existente.id, permisoId: pid })),
          skipDuplicates: true,
        });
        if (!(await quedaAdministrador(tx, req.empresaId))) throw new HttpError(409, SIN_ADMIN);
      }
    });
    // Los permisos se cachean 5 min por usuario: invalidar a los que tienen este rol
    const afectados = await prisma.usuarioRol.findMany({ where: { rolId: req.params.id }, select: { usuarioId: true } });
    afectados.forEach(a => invalidarCacheUsuario(a.usuarioId));

    const rol = await prisma.rol.findUnique({
      where: { id: req.params.id },
      include: { permisos: { include: { permiso: true } } },
    });
    res.json(ok(rol, 'Rol actualizado'));
  } catch (e) { next(e); }
});

export default router;
