import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { ok, err } from '../types/api.types';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  CobroError, listarPlanes, crearPlan, editarPlan, cuadroCobros, editarCobroEmpresa,
  listarPagos, registrarPago, anularPago,
} from '../services/cobros.service';
import { cargarFactura, obtenerPdfFactura, enviarComprobantePago, MAX_PDF_BYTES, obtenerConfigCobro, guardarConfigCobro } from '../services/facturasSuscripcion.service';
import multer from 'multer';

// PDF de factura: en memoria (se guarda en la base), solo PDF y hasta 5 MB
const subirPdf = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_PDF_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
}).single('pdf');

const router = Router();

// Genera un slug URL-friendly a partir de un texto (sin tildes, minúsculas, guiones)
function slugify(texto: string): string {
  return texto
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // saca tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

// Genera un slug único agregando -2, -3, etc. si ya existe
async function generarSlugUnico(base: string): Promise<string> {
  const baseSlug = slugify(base) || 'gimnasio';
  let slug = baseSlug;
  let intento = 1;
  while (await prisma.empresa.findUnique({ where: { slug } })) {
    intento += 1;
    slug = `${baseSlug}-${intento}`;
  }
  return slug;
}

// Middleware superadmin — verifica token y rol SUPERADMIN
const superauth = async (req: any, res: any, next: any) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) { res.status(401).json(err('Token requerido')); return; }
  try {
    const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET!) as any;
    // Solo el token del login de superadmin: sub fijo y sin gimnasio. (Un token de
    // "Entrar como admin" lleva el nombre del rol del gym, que el gym puede elegir.)
    if (payload.rol !== 'SUPERADMIN' || payload.sub !== 'superadmin' || payload.empresaId) {
      res.status(403).json(err('Acceso denegado')); return;
    }
    req.superadminId = payload.sub;
    next();
  } catch { res.status(401).json(err('Token inválido')); return; }
};

// POST /api/v1/superadmin/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (email !== process.env.SUPERADMIN_EMAIL) {
      res.status(401).json(err('Credenciales inválidas')); return;
    }
    const ok2 = await bcrypt.compare(password, process.env.SUPERADMIN_HASH!);
    if (!ok2) { res.status(401).json(err('Credenciales inválidas')); return; }

    const token = jwt.sign(
      { sub: 'superadmin', rol: 'SUPERADMIN', email },
      process.env.JWT_SECRET!,
      { expiresIn: '8h' }
    );
    res.json(ok({ token, email, rol: 'SUPERADMIN' }));
  } catch (e) { next(e); }
});

// GET /api/v1/superadmin/dashboard
router.get('/dashboard', superauth, async (req, res, next) => {
  try {
    const [
      totalEmpresas,
      totalSocios,
      totalVentasMes,
      empresas,
    ] = await prisma.$transaction([
      prisma.empresa.count({ where: { activo: true } }),
      prisma.persona.count({ where: { deletedAt: null } }),
      prisma.venta.aggregate({
        where: {
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
          estado: 'COMPLETADA',
        },
        _sum: { total: true },
      }),
      prisma.empresa.findMany({
        where: { activo: true },
        select: {
          id: true, nombre: true, nombreComercial: true, logoUrl: true,
          createdAt: true, activo: true,
          _count: {
            select: {
              personas: { where: { deletedAt: null } },
              ventas:   { where: { estado: 'COMPLETADA' } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json(ok({
      totalEmpresas,
      totalSocios,
      ventasMes: Number(totalVentasMes._sum.total ?? 0),
      empresas,
    }));
  } catch (e) { next(e); }
});

// GET /api/v1/superadmin/empresas
router.get('/empresas', superauth, async (req, res, next) => {
  try {
    const empresas = await prisma.empresa.findMany({
      include: {
        _count: {
          select: {
            personas:  { where: { deletedAt: null } },
            usuarios:  { where: { activo: true } },
            sucursales: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(ok(empresas));
  } catch (e) { next(e); }
});

// POST /api/v1/superadmin/empresas — crear nuevo gimnasio
router.post('/empresas', superauth, async (req, res, next) => {
  try {
    const { nombre, cuit, razonSocial, nombreComercial, adminEmail, adminPassword } = req.body;
    if (!nombre || !cuit || !adminEmail || !adminPassword) {
      res.status(400).json(err('nombre, cuit, adminEmail y adminPassword son requeridos')); return;
    }

    const slug = await generarSlugUnico(nombreComercial || nombre);

    const resultado = await prisma.$transaction(async tx => {
      const empresa = await tx.empresa.create({
        data: { nombre, cuit, razonSocial: razonSocial || nombre, nombreComercial, slug, activo: true },
      });

      const hash = await bcrypt.hash(adminPassword, 10);
      const usuario = await tx.usuario.create({
        data: { empresaId: empresa.id, email: adminEmail, passwordHash: hash, activo: true },
      });

      // Rol "Administrador" con todos los permisos del gym (menos sistema.super,
      // reservado para nosotros como plataforma) y se lo asignamos al admin recién creado.
      const permisosDisponibles = await tx.permiso.findMany({
        where: { codigo: { not: 'sistema.super' } },
        select: { id: true },
      });
      const rolAdmin = await tx.rol.create({
        data: {
          empresaId:   empresa.id,
          nombre:      'Administrador',
          descripcion: 'Rol con acceso completo al gimnasio',
          activo:      true,
        },
      });
      await tx.rolPermiso.createMany({
        data: permisosDisponibles.map(p => ({ rolId: rolAdmin.id, permisoId: p.id })),
      });
      await tx.usuarioRol.create({
        data: { usuarioId: usuario.id, rolId: rolAdmin.id, fechaDesde: new Date() },
      });

      // Crear sucursal central por defecto
      await tx.sucursal.create({
        data: {
          empresaId: empresa.id,
          nombre: nombreComercial || nombre,
          activo: true,
        },
      });

      // Tipos de perfil por defecto (necesarios para poder dar de alta socios)
      await tx.tipoRolPersona.createMany({
        data: [
          { empresaId: empresa.id, nombre: 'SOCIO',    activo: true },
          { empresaId: empresa.id, nombre: 'PROFESOR', activo: true },
          { empresaId: empresa.id, nombre: 'EMPLEADO', activo: true },
        ],
      });

      return { empresa, usuario };
    });

    res.status(201).json(ok(resultado, 'Gimnasio creado correctamente'));
  } catch (e) { next(e); }
});

// PATCH /api/v1/superadmin/empresas/:id — activar/suspender/editar datos
router.patch('/empresas/:id', superauth, async (req, res, next) => {
  try {
    const { activo, nombreComercial, nombre, cuit, razonSocial, slug } = req.body;
    const data: any = {};
    if (activo          !== undefined) data.activo = activo;
    if (nombreComercial !== undefined) data.nombreComercial = nombreComercial;
    if (nombre          !== undefined) data.nombre = nombre;
    if (cuit            !== undefined) data.cuit = cuit;
    if (razonSocial     !== undefined) data.razonSocial = razonSocial;
    if (slug            !== undefined) {
      const slugNormalizado = slugify(slug);
      if (!slugNormalizado) { res.status(400).json(err('Slug inválido')); return; }
      data.slug = slugNormalizado;
    }
    const empresa = await prisma.empresa.update({ where: { id: req.params.id }, data });
    res.json(ok(empresa, activo !== undefined ? (activo ? 'Gimnasio activado' : 'Gimnasio suspendido') : 'Datos actualizados'));
  } catch (e: any) {
    if (e.code === 'P2002') { res.status(409).json(err('Ya existe otro gimnasio con ese CUIT, nombre o slug')); return; }
    next(e);
  }
});

// POST /api/v1/superadmin/impersonate/:empresaId — token temporal como admin del gimnasio
router.post('/impersonate/:empresaId', superauth, async (req, res, next) => {
  try {
    const empresa = await prisma.empresa.findUnique({ where: { id: req.params.empresaId } });
    if (!empresa) { res.status(404).json(err('Empresa no encontrada')); return; }

    const adminUsuario = await prisma.usuario.findFirst({
      where: { empresaId: req.params.empresaId, activo: true },
      include: { roles: { where: { fechaHasta: null }, include: { rol: true }, take: 1 } },
    });
    if (!adminUsuario) { res.status(404).json(err('Sin usuarios en esta empresa')); return; }

    const token = jwt.sign(
      {
        sub:       adminUsuario.id,
        empresaId: req.params.empresaId,
        email:     adminUsuario.email,
        rol:       adminUsuario.roles[0]?.rol?.nombre ?? 'Admin',
        impersonated: true,
      },
      process.env.JWT_SECRET!,
      { expiresIn: '2h' }
    );

    res.json(ok({ token, empresa: empresa.nombreComercial ?? empresa.nombre, email: adminUsuario.email }));
  } catch (e) { next(e); }
});

// ============================================================================
// Cobro de SmartGym a los gimnasios: planes, cuadro de cobros y pagos
// ============================================================================

// Traduce los errores de negocio del servicio de cobros a status HTTP
const conCobro = (fn: (req: any, res: any) => Promise<void>) => async (req: any, res: any, next: any) => {
  try { await fn(req, res); }
  catch (e: any) {
    if (e instanceof CobroError) { res.status(e.status).json(err(e.message)); return; }
    next(e);
  }
};

// GET /api/v1/superadmin/planes-comerciales
router.get('/planes-comerciales', superauth, conCobro(async (_req, res) => {
  res.json(ok(await listarPlanes()));
}));

// POST /api/v1/superadmin/planes-comerciales
router.post('/planes-comerciales', superauth, conCobro(async (req, res) => {
  res.status(201).json(ok(await crearPlan(req.body ?? {}), 'Plan creado'));
}));

// PATCH /api/v1/superadmin/planes-comerciales/:id  (no se borran: se desactivan con activo=false)
router.patch('/planes-comerciales/:id', superauth, conCobro(async (req, res) => {
  res.json(ok(await editarPlan(req.params.id, req.body ?? {}), 'Plan actualizado'));
}));

// GET /api/v1/superadmin/cobros — plan, estado de pago, socios activos y uso de la semana por gimnasio
router.get('/cobros', superauth, conCobro(async (_req, res) => {
  res.json(ok(await cuadroCobros()));
}));

// PATCH /api/v1/superadmin/empresas/:id/cobro — plan, precio acordado, fin de prueba, notas
router.patch('/empresas/:id/cobro', superauth, conCobro(async (req, res) => {
  res.json(ok(await editarCobroEmpresa(req.params.id, req.body ?? {}), 'Plan del gimnasio actualizado'));
}));

// GET /api/v1/superadmin/empresas/:id/pagos — historial (incluye anulados)
router.get('/empresas/:id/pagos', superauth, conCobro(async (req, res) => {
  res.json(ok(await listarPagos(req.params.id)));
}));

// POST /api/v1/superadmin/empresas/:id/pagos — registrar un pago y correr "pagado hasta"
router.post('/empresas/:id/pagos', superauth, conCobro(async (req, res) => {
  res.status(201).json(ok(await registrarPago(req.params.id, req.body ?? {}), 'Pago registrado'));
}));

// PUT /api/v1/superadmin/pagos-suscripcion/:id/factura — multipart: tipo, puntoVenta, numero, fecha, cae?, caeVto?, pdf?
router.put('/pagos-suscripcion/:id/factura', superauth, (req: any, res: any, next: any) => {
  subirPdf(req, res, (e: any) => {
    if (e?.code === 'LIMIT_FILE_SIZE') { res.status(400).json(err('El PDF pesa más de 5 MB')); return; }
    if (e) { res.status(400).json(err('No se pudo leer el archivo')); return; }
    next();
  });
}, conCobro(async (req, res) => {
  const pdf = req.file ? { buffer: req.file.buffer as Buffer, nombre: String(req.file.originalname ?? '') } : undefined;
  res.json(ok(await cargarFactura(req.params.id, req.body ?? {}, pdf), 'Factura cargada'));
}));

// GET /api/v1/superadmin/pagos-suscripcion/:id/factura.pdf
router.get('/pagos-suscripcion/:id/factura.pdf', superauth, conCobro(async (req, res) => {
  const { buffer, nombre } = await obtenerPdfFactura(req.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre.replace(/[^\w.-]/g, '_')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(buffer);
}));

// GET /api/v1/superadmin/config-cobro — datos de cobro de Cod&Tics (panel; lo vacío sale del .env)
router.get('/config-cobro', superauth, conCobro(async (_req, res) => {
  res.json(ok(await obtenerConfigCobro()));
}));

// PUT /api/v1/superadmin/config-cobro — guarda los datos de cobro (vacío = volver al .env)
router.put('/config-cobro', superauth, conCobro(async (req, res) => {
  res.json(ok(await guardarConfigCobro(req.body ?? {}), 'Datos de cobro guardados'));
}));

// POST /api/v1/superadmin/pagos-suscripcion/:id/enviar — recibo (y factura si está) por mail al gimnasio
router.post('/pagos-suscripcion/:id/enviar', superauth, conCobro(async (req, res) => {
  res.json(ok(await enviarComprobantePago(req.params.id), 'Mail enviado'));
}));

// POST /api/v1/superadmin/pagos-suscripcion/:id/anular — { motivo }
router.post('/pagos-suscripcion/:id/anular', superauth, conCobro(async (req, res) => {
  res.json(ok(await anularPago(req.params.id, req.body?.motivo), 'Pago anulado'));
}));

export default router;
