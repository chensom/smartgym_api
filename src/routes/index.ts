import { Router } from 'express';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { prisma } from '../lib/prisma';
import { ok, err } from '../types/api.types';

import authRoutes          from './auth.routes';
import sociosRoutes        from './socios.routes';
import inscripcionesRoutes from './inscripciones.routes';
import asistenciasRoutes   from './asistencias.routes';
import ventasRoutes        from './ventas.routes';
import inventarioRoutes    from './inventario.routes';
import facturacionRoutes   from './facturacion.routes';
import uploadsRoutes       from './uploads.routes';
import proveedoresRoutes   from './proveedores.routes';
import horariosRoutes      from './horarios.routes';
import superadminRoutes    from './superadmin.routes';
import usuariosRoutes     from './usuarios.routes';
import ejerciciosRoutes   from './ejercicios.routes';
import rutinasRoutes      from './rutinas.routes';
import certificadosRoutes from './certificados.routes';
import medicionesRoutes   from './mediciones.routes';
import registrosRoutes    from './registros.routes';
import gastosRoutes       from './gastos.routes';
import cajaRoutes         from './caja.routes';

const router = Router();

router.get('/health', (_, res) =>
  res.json({ ok: true, service: 'SMARTGYM API', version: '1.0.0' })
);

// ── Branding público (sin auth) — para pintar el login de cada subdominio ──
router.get('/public/empresas/:slug', async (req, res, next) => {
  try {
    const empresa = await prisma.empresa.findUnique({
      where: { slug: req.params.slug },
      select: {
        nombre: true, nombreComercial: true, slogan: true,
        logoUrl: true, fondoLoginUrl: true,
        colorPrimario: true, colorSecundario: true,
        activo: true,
      },
    });
    if (!empresa || !empresa.activo) { res.status(404).json(err('Gimnasio no encontrado')); return; }
    res.json(ok(empresa));
  } catch (e) { next(e); }
});

router.use('/auth',          authRoutes);
router.use('/socios',        sociosRoutes);
router.use('/inscripciones', inscripcionesRoutes);
router.use('/asistencias',   asistenciasRoutes);
router.use('/ventas',        ventasRoutes);
router.use('/inventario',    inventarioRoutes);
router.use('/facturas',      facturacionRoutes);
router.use('/uploads',       uploadsRoutes);
router.use('/proveedores',   proveedoresRoutes);
router.use('/horarios',      horariosRoutes);
router.use('/superadmin',    superadminRoutes);
router.use('/usuarios',      usuariosRoutes);
router.use('/ejercicios',    ejerciciosRoutes);
router.use('/rutinas',       rutinasRoutes);
router.use('/certificados',  certificadosRoutes);
router.use('/mediciones',    medicionesRoutes);
router.use('/registros',     registrosRoutes);
router.use('/gastos',        gastosRoutes);
router.use('/caja',          cajaRoutes);

// ── Sucursales ─────────────────────────────────────────────────────────────
router.get('/sucursales', auth, rbac('socios.ver'), async (req: any, res, next) => {
  try {
    const sucursales = await prisma.sucursal.findMany({
      where:   { empresaId: req.empresaId, activo: true },
      orderBy: { nombre: 'asc' },
    });
    res.json(ok(sucursales));
  } catch (e) { next(e); }
});

router.post('/sucursales', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { nombre, direccion, ciudad, provincia, telefono, email } = req.body;
    if (!nombre) { res.status(400).json(err('nombre requerido')); return; }
    const sucursal = await prisma.sucursal.create({
      data: { empresaId: req.empresaId, nombre, direccion, ciudad, provincia, telefono, email, activo: true },
    });
    res.status(201).json(ok(sucursal, 'Sucursal creada'));
  } catch (e) { next(e); }
});

router.patch('/sucursales/:id', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const sucursal = await prisma.sucursal.update({
      where: { id: req.params.id },
      data:  req.body,
    });
    res.json(ok(sucursal));
  } catch (e) { next(e); }
});

// ── Planes ─────────────────────────────────────────────────────────────────
router.get('/planes', auth, rbac('socios.ver'), async (req: any, res, next) => {
  try {
    const planes = await prisma.plan.findMany({
      where:   { empresaId: req.empresaId, deletedAt: null },
      orderBy: { nombre: 'asc' },
    });
    res.json(ok(planes));
  } catch (e) { next(e); }
});

router.post('/planes', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { nombre, descripcion, precio, duracionDias, tipo, accesoTodasSucursales, cantidadClases } = req.body;
    if (!nombre || !precio) { res.status(400).json(err('nombre y precio son requeridos')); return; }
    const plan = await prisma.plan.create({
      data: {
        empresaId: req.empresaId,
        nombre,
        descripcion:           descripcion           ?? null,
        precio:                parseFloat(precio),
        duracionDias:          parseInt(duracionDias) || 30,
        tipo:                  tipo                  || 'MENSUAL',
        accesoTodasSucursales: accesoTodasSucursales ?? false,
        cantidadClases:        cantidadClases ? parseInt(cantidadClases) : null,
        activo:                true,
      },
    });
    res.status(201).json(ok(plan, 'Plan creado'));
  } catch (e) { next(e); }
});

router.patch('/planes/:id', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const plan = await prisma.plan.update({ where: { id: req.params.id }, data: req.body });
    res.json(ok(plan));
  } catch (e) { next(e); }
});

router.delete('/planes/:id', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const existente = await prisma.plan.findFirst({ where: { id: req.params.id, empresaId: req.empresaId } });
    if (!existente) { res.status(404).json(err('Plan no encontrado')); return; }
    await prisma.plan.delete({ where: { id: req.params.id } });
    res.json(ok(null, 'Plan eliminado'));
  } catch (e) { next(e); }
});

// ── Disciplinas ────────────────────────────────────────────────────────────
router.get('/disciplinas', auth, rbac('socios.ver'), async (req: any, res, next) => {
  try {
    const disciplinas = await prisma.disciplina.findMany({
      where:   { empresaId: req.empresaId, deletedAt: null },
      orderBy: { nombre: 'asc' },
    });
    res.json(ok(disciplinas));
  } catch (e) { next(e); }
});

router.patch('/disciplinas/:id', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { nombre, descripcion, colorHex, activo } = req.body;
    const disc = await prisma.disciplina.update({
      where: { id: req.params.id },
      data: {
        ...(nombre      !== undefined && { nombre }),
        ...(descripcion !== undefined && { descripcion }),
        ...(colorHex    !== undefined && { colorHex }),
        ...(activo      !== undefined && { activo }),
      },
    });
    res.json(ok(disc));
  } catch (e) { next(e); }
});

router.post('/disciplinas', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { nombre, descripcion, colorHex } = req.body;
    if (!nombre) { res.status(400).json(err('nombre requerido')); return; }
    const disc = await prisma.disciplina.create({
      data: { empresaId: req.empresaId, nombre, descripcion: descripcion ?? null, colorHex: colorHex ?? '#534AB7', activo: true },
    });
    res.status(201).json(ok(disc, 'Disciplina creada'));
  } catch (e) { next(e); }
});

router.delete('/disciplinas/:id', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const existente = await prisma.disciplina.findFirst({
      where: { id: req.params.id, empresaId: req.empresaId },
    });
    if (!existente) { res.status(404).json(err('Disciplina no encontrada')); return; }
    await prisma.disciplina.delete({ where: { id: req.params.id } });
    res.json(ok(null, 'Disciplina eliminada'));
  } catch (e) { next(e); }
});

// ── Medios de pago ─────────────────────────────────────────────────────────
router.get('/medios-pago', auth, rbac('socios.ver'), async (req: any, res, next) => {
  try {
    const medios = await prisma.medioPago.findMany({
      where:   { empresaId: req.empresaId },
      orderBy: { nombre: 'asc' },
    });
    res.json(ok(medios));
  } catch (e) { next(e); }
});

router.post('/medios-pago', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { nombre, tipo } = req.body;
    if (!nombre || !tipo) { res.status(400).json(err('nombre y tipo son requeridos')); return; }
    const medio = await prisma.medioPago.create({
      data: { empresaId: req.empresaId, nombre, tipo, activo: true },
    });
    res.status(201).json(ok(medio, 'Medio de pago creado'));
  } catch (e) { next(e); }
});

router.patch('/medios-pago/:id', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { nombre, tipo, activo } = req.body;
    const data: any = {};
    if (nombre !== undefined) data.nombre = nombre;
    if (tipo   !== undefined) data.tipo   = tipo;
    if (activo !== undefined) data.activo = activo;
    const medio = await prisma.medioPago.update({ where: { id: req.params.id }, data });
    res.json(ok(medio, 'Medio de pago actualizado'));
  } catch (e) { next(e); }
});

// ── Usuarios ───────────────────────────────────────────────────────────────
router.get('/usuarios', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      where:   { empresaId: req.empresaId, deletedAt: null },
      select:  { id: true, email: true, activo: true, ultimoLogin: true, persona: { select: { nombres: true, apellidos: true } } },
      orderBy: { email: 'asc' },
    });
    res.json(ok(usuarios));
  } catch (e) { next(e); }
});

// ── Marcas y categorías (para inventario) ──────────────────────────────────
router.get('/marcas', auth, rbac('inventario.ver'), async (req: any, res, next) => {
  try {
    const marcas = await prisma.marca.findMany({ where: { empresaId: req.empresaId }, orderBy: { nombre: 'asc' } });
    res.json(ok(marcas));
  } catch (e) { next(e); }
});

router.get('/categorias', auth, rbac('inventario.ver'), async (req: any, res, next) => {
  try {
    const cats = await prisma.categoriaProducto.findMany({ where: { empresaId: req.empresaId }, orderBy: { nombre: 'asc' } });
    res.json(ok(cats));
  } catch (e) { next(e); }
});

router.post('/marcas', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { nombre } = req.body;
    if (!nombre) { res.status(400).json(err('nombre requerido')); return; }
    const marca = await prisma.marca.create({ data: { empresaId: req.empresaId, nombre } });
    res.status(201).json(ok(marca, 'Marca creada'));
  } catch (e) { next(e); }
});

router.patch('/marcas/:id', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const marca = await prisma.marca.update({ where: { id: req.params.id }, data: { nombre: req.body.nombre } });
    res.json(ok(marca));
  } catch (e) { next(e); }
});

router.delete('/marcas/:id', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const existente = await prisma.marca.findFirst({ where: { id: req.params.id, empresaId: req.empresaId } });
    if (!existente) { res.status(404).json(err('Marca no encontrada')); return; }
    await prisma.marca.delete({ where: { id: req.params.id } });
    res.json(ok(null, 'Marca eliminada'));
  } catch (e) { next(e); }
});

router.post('/categorias', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { nombre } = req.body;
    if (!nombre) { res.status(400).json(err('nombre requerido')); return; }
    const cat = await prisma.categoriaProducto.create({ data: { empresaId: req.empresaId, nombre } });
    res.status(201).json(ok(cat, 'Categoría creada'));
  } catch (e) { next(e); }
});

router.patch('/categorias/:id', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const cat = await prisma.categoriaProducto.update({ where: { id: req.params.id }, data: { nombre: req.body.nombre } });
    res.json(ok(cat, 'Categoría actualizada'));
  } catch (e) { next(e); }
});

router.delete('/categorias/:id', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const existente = await prisma.categoriaProducto.findFirst({ where: { id: req.params.id, empresaId: req.empresaId } });
    if (!existente) { res.status(404).json(err('Categoría no encontrada')); return; }
    await prisma.categoriaProducto.delete({ where: { id: req.params.id } });
    res.json(ok(null, 'Categoría eliminada'));
  } catch (e) { next(e); }
});

// ── Tipos de rol (para alta de socios) ────────────────────────────────────
router.get('/tipos-rol', auth, rbac('socios.ver'), async (req: any, res, next) => {
  try {
    const tipos = await prisma.tipoRolPersona.findMany({
      where:   { empresaId: req.empresaId, activo: true },
      orderBy: { nombre: 'asc' },
    });
    res.json(ok(tipos));
  } catch (e) { next(e); }
});

router.post('/tipos-rol', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { nombre, descripcion } = req.body;
    if (!nombre) { res.status(400).json(err('nombre requerido')); return; }
    const tipo = await prisma.tipoRolPersona.create({
      data: {
        empresaId:   req.empresaId,
        nombre:      String(nombre).toUpperCase().trim(),
        descripcion: descripcion ?? null,
        activo:      true,
      },
    });
    res.status(201).json(ok(tipo, 'Tipo de perfil creado'));
  } catch (e: any) {
    if (e.code === 'P2002') { res.status(409).json(err('Ya existe un tipo de perfil con ese nombre')); return; }
    next(e);
  }
});

router.patch('/tipos-rol/:id', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const existente = await prisma.tipoRolPersona.findFirst({
      where: { id: req.params.id, empresaId: req.empresaId },
    });
    if (!existente) { res.status(404).json(err('Tipo de perfil no encontrado')); return; }

    const { nombre, descripcion, activo } = req.body;
    const tipo = await prisma.tipoRolPersona.update({
      where: { id: req.params.id },
      data: {
        ...(nombre !== undefined && { nombre: String(nombre).toUpperCase().trim() }),
        ...(descripcion !== undefined && { descripcion }),
        ...(activo !== undefined && { activo }),
      },
    });
    res.json(ok(tipo, 'Tipo de perfil actualizado'));
  } catch (e: any) {
    if (e.code === 'P2002') { res.status(409).json(err('Ya existe un tipo de perfil con ese nombre')); return; }
    next(e);
  }
});

router.delete('/tipos-rol/:id', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const existente = await prisma.tipoRolPersona.findFirst({ where: { id: req.params.id, empresaId: req.empresaId } });
    if (!existente) { res.status(404).json(err('Tipo de perfil no encontrado')); return; }
    await prisma.tipoRolPersona.delete({ where: { id: req.params.id } });
    res.json(ok(null, 'Tipo de perfil eliminado'));
  } catch (e) { next(e); }
});

// ── Búsqueda por documento ──────────────────────────────────────────────────
router.get('/personas/buscar-documento', auth, async (req: any, res, next) => {
  try {
    const { numero } = req.query;
    if (!numero) { res.status(400).json(err('numero requerido')); return; }
    const doc = await prisma.personaDocumento.findFirst({
      where: {
        numero: String(numero),
        persona: { empresaId: req.empresaId, deletedAt: null },
      },
      include: {
        persona: {
          select: {
            id: true, nombres: true, apellidos: true,
          },
        },
      },
    });
    res.json(ok(doc?.persona ?? null));
  } catch (e) { next(e); }
});

// ── Vencimientos ─────────────────────────────────────────────────────────────
router.get('/vencimientos', auth, rbac('socios.ver'), async (req: any, res, next) => {
  try {
    const { dias = '7', sucursalId } = req.query;
    const diasNum = parseInt(String(dias));
    const hoy     = new Date(); hoy.setHours(0,0,0,0);
    const limite  = new Date(hoy); limite.setDate(limite.getDate() + diasNum);

    const where: any = {
      personaRol: { persona: { empresaId: req.empresaId, deletedAt: null } },
      estado: 'ACTIVA',
      fechaFin: { lte: limite },
    };
    if (sucursalId) where.sucursalId = sucursalId;

    const inscripciones = await prisma.inscripcion.findMany({
      where,
      include: {
        personaRol: {
          include: {
            persona: { select: { id: true, nombres: true, apellidos: true, fotoUrl: true } },
          },
        },
        plan: { select: { nombre: true } },
      },
      orderBy: { fechaFin: 'asc' },
    });

    const resultado = (inscripciones as any[]).map(i => ({
      inscripcionId: i.id,
      personaId:     i.personaRol?.personaId,
      persona:       i.personaRol?.persona,
      plan:          i.plan?.nombre,
      fechaFin:      i.fechaFin,
      diasRestantes: Math.ceil((new Date(i.fechaFin).getTime() - hoy.getTime()) / (1000*60*60*24)),
      vencida:       new Date(i.fechaFin) < hoy,
    }));

    res.json(ok(resultado));
  } catch (e) { next(e); }
});

// ── Empresa / Branding ─────────────────────────────────────────────────────
router.get('/empresa', auth, async (req: any, res, next) => {
  try {
    const empresa = await prisma.empresa.findUnique({ where: { id: req.empresaId } });
    res.json(ok(empresa));
  } catch (e) { next(e); }
});

router.patch('/empresa', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const {
      nombreComercial, slogan, colorPrimario, colorSecundario,
      direccion, telefono, email, sitioWeb, instagram, facebook,
      marcaAguaTexto,
    } = req.body;
    const empresa = await prisma.empresa.update({
      where: { id: req.empresaId },
      data: {
        ...(nombreComercial !== undefined && { nombreComercial }),
        ...(slogan          !== undefined && { slogan }),
        ...(colorPrimario   !== undefined && { colorPrimario }),
        ...(colorSecundario !== undefined && { colorSecundario }),
        ...(direccion       !== undefined && { direccion }),
        ...(telefono        !== undefined && { telefono }),
        ...(email           !== undefined && { email }),
        ...(sitioWeb        !== undefined && { sitioWeb }),
        ...(instagram       !== undefined && { instagram }),
        ...(facebook        !== undefined && { facebook }),
        ...(marcaAguaTexto  !== undefined && { marcaAguaTexto }),
      },
    });
    res.json(ok(empresa, 'Configuración actualizada'));
  } catch (e) { next(e); }
});

export default router;
