import { Router } from 'express';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { prisma } from '../lib/prisma';
import { ok, err } from '../types/api.types';
import { configDeEmpresa, parsearAjuste, preciosDelPlan, SELECT_REGLA_EMPRESA } from '../lib/calcularCuota';

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
    const existente = await prisma.sucursal.findFirst({ where: { id: req.params.id, empresaId: req.empresaId } });
    if (!existente) { res.status(404).json(err('Sucursal no encontrada')); return; }
    const { nombre, direccion, ciudad, provincia, telefono, email, activo } = req.body ?? {};
    const sucursal = await prisma.sucursal.update({
      where: { id: existente.id },
      data: {
        ...(nombre    !== undefined && { nombre }),
        ...(direccion !== undefined && { direccion }),
        ...(ciudad    !== undefined && { ciudad }),
        ...(provincia !== undefined && { provincia }),
        ...(telefono  !== undefined && { telefono }),
        ...(email     !== undefined && { email }),
        ...(activo    !== undefined && { activo: !!activo }),
      },
    });
    res.json(ok(sucursal));
  } catch (e) { next(e); }
});

// ── Planes ─────────────────────────────────────────────────────────────────
// Modalidad de cobro y excepción del plan a la regla de descuento/recargo del
// gimnasio (solo mes calendario). Devuelve el objeto `data` listo para Prisma
// o un string con el error de validación.
function datosPlan(body: any, tipoFinal: string | undefined, modalidadActual?: string): Record<string, any> | string {
  const data: Record<string, any> = {};
  if (body.modalidadCobro !== undefined) {
    if (!['DIAS', 'MES_CALENDARIO'].includes(body.modalidadCobro)) return 'modalidadCobro debe ser DIAS o MES_CALENDARIO';
    data.modalidadCobro = body.modalidadCobro;
  }
  const modalidad = data.modalidadCobro ?? modalidadActual ?? 'DIAS';
  if (modalidad === 'MES_CALENDARIO' && tipoFinal !== 'MENSUAL') {
    return 'El cobro por mes calendario solo está disponible para planes de tipo MENSUAL';
  }
  if (modalidad !== 'MES_CALENDARIO') {
    // por días no hay tramos: nunca queda una excepción colgada
    data.bonifTipo = null; data.bonifValor = null; data.recargoTipo = null; data.recargoValor = null;
    return data;
  }
  if (body.bonifTipo !== undefined) {
    const a = parsearAjuste(body.bonifTipo, body.bonifValor, 'Descuento del plan', true);
    if (typeof a === 'string') return a;
    data.bonifTipo = a.tipo; data.bonifValor = a.valor;
  }
  if (body.recargoTipo !== undefined) {
    const a = parsearAjuste(body.recargoTipo, body.recargoValor, 'Recargo del plan', true);
    if (typeof a === 'string') return a;
    data.recargoTipo = a.tipo; data.recargoValor = a.valor;
  }
  return data;
}

/** El plan con sus tres precios ya calculados (solo mes calendario), para mostrar. */
function conPreciosCuota<T extends { modalidadCobro: string }>(plan: T, regla: ReturnType<typeof configDeEmpresa>) {
  return { ...plan, preciosCuota: plan.modalidadCobro === 'MES_CALENDARIO' ? preciosDelPlan(plan as any, regla) : null };
}

async function reglaDeEmpresa(empresaId: string) {
  const e = await prisma.empresa.findUniqueOrThrow({ where: { id: empresaId }, select: SELECT_REGLA_EMPRESA });
  return configDeEmpresa(e);
}

router.get('/planes', auth, rbac('socios.ver'), async (req: any, res, next) => {
  try {
    const planes = await prisma.plan.findMany({
      where:   { empresaId: req.empresaId, deletedAt: null },
      orderBy: { nombre: 'asc' },
    });
    const regla = await reglaDeEmpresa(req.empresaId);
    res.json(ok(planes.map((p) => conPreciosCuota(p, regla))));
  } catch (e) { next(e); }
});

router.post('/planes', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { nombre, descripcion, precio, duracionDias, tipo, accesoTodasSucursales, cantidadClases } = req.body;
    if (!nombre || !precio) { res.status(400).json(err('nombre y precio son requeridos')); return; }
    const extra = datosPlan(req.body, tipo || 'MENSUAL', 'DIAS');
    if (typeof extra === 'string') { res.status(400).json(err(extra)); return; }
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
        ...extra,
      },
    });
    res.status(201).json(ok(conPreciosCuota(plan, await reglaDeEmpresa(req.empresaId)), 'Plan creado'));
  } catch (e) { next(e); }
});

router.patch('/planes/:id', auth, rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const existente = await prisma.plan.findFirst({ where: { id: req.params.id, empresaId: req.empresaId, deletedAt: null } });
    if (!existente) { res.status(404).json(err('Plan no encontrado')); return; }

    const b = req.body ?? {};
    const tipoFinal = b.tipo ?? existente.tipo;
    const extra = datosPlan({ modalidadCobro: b.modalidadCobro,
                              bonifTipo: b.bonifTipo, bonifValor: b.bonifValor,
                              recargoTipo: b.recargoTipo, recargoValor: b.recargoValor },
                            tipoFinal, existente.modalidadCobro);
    if (typeof extra === 'string') { res.status(400).json(err(extra)); return; }

    // Solo campos editables (antes se pasaba req.body entero a Prisma).
    const data: Record<string, any> = { ...extra };
    if (b.nombre                !== undefined) data.nombre                = b.nombre;
    if (b.descripcion           !== undefined) data.descripcion           = b.descripcion;
    if (b.precio                !== undefined) data.precio                = parseFloat(b.precio);
    if (b.duracionDias          !== undefined) data.duracionDias          = parseInt(b.duracionDias);
    if (b.tipo                  !== undefined) data.tipo                  = b.tipo;
    if (b.accesoTodasSucursales !== undefined) data.accesoTodasSucursales = !!b.accesoTodasSucursales;
    if (b.cantidadClases        !== undefined) data.cantidadClases        = b.cantidadClases ? parseInt(b.cantidadClases) : null;
    if (b.activo                !== undefined) data.activo                = !!b.activo;

    const plan = await prisma.plan.update({ where: { id: existente.id }, data });
    res.json(ok(conPreciosCuota(plan, await reglaDeEmpresa(req.empresaId))));
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
    const existente = await prisma.disciplina.findFirst({ where: { id: req.params.id, empresaId: req.empresaId } });
    if (!existente) { res.status(404).json(err('Disciplina no encontrada')); return; }
    const { nombre, descripcion, colorHex, activo } = req.body;
    const disc = await prisma.disciplina.update({
      where: { id: existente.id },
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
      marcaAguaTexto, cuotaDiaFinBonificado, cuotaDiaFinNormal,
      cuotaBonifTipo, cuotaBonifValor, cuotaRecargoTipo, cuotaRecargoValor,
    } = req.body;

    // Regla general de descuento / recargo (cada lado se manda con su tipo)
    const regla: Record<string, any> = {};
    if (cuotaBonifTipo !== undefined) {
      const a = parsearAjuste(cuotaBonifTipo, cuotaBonifValor, 'Descuento', false);
      if (typeof a === 'string') { res.status(400).json(err(a)); return; }
      regla.cuotaBonifTipo = a.tipo; regla.cuotaBonifValor = a.valor;
    }
    if (cuotaRecargoTipo !== undefined) {
      const a = parsearAjuste(cuotaRecargoTipo, cuotaRecargoValor, 'Recargo', false);
      if (typeof a === 'string') { res.status(400).json(err(a)); return; }
      regla.cuotaRecargoTipo = a.tipo; regla.cuotaRecargoValor = a.valor;
    }

    // Días de corte de la cuota mensual: 1 <= bonificado < normal <= 28
    if (cuotaDiaFinBonificado !== undefined || cuotaDiaFinNormal !== undefined) {
      const actual = await prisma.empresa.findUniqueOrThrow({
        where: { id: req.empresaId }, select: { cuotaDiaFinBonificado: true, cuotaDiaFinNormal: true },
      });
      const bon = cuotaDiaFinBonificado !== undefined ? Number(cuotaDiaFinBonificado) : actual.cuotaDiaFinBonificado;
      const nor = cuotaDiaFinNormal     !== undefined ? Number(cuotaDiaFinNormal)     : actual.cuotaDiaFinNormal;
      if (!Number.isInteger(bon) || !Number.isInteger(nor) || bon < 1 || bon >= nor || nor > 28) {
        res.status(400).json(err('Días de cuota inválidos: el bonificado va del 1 al día de corte, y el normal hasta el 28 como máximo'));
        return;
      }
    }

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
        ...(cuotaDiaFinBonificado !== undefined && { cuotaDiaFinBonificado: Number(cuotaDiaFinBonificado) }),
        ...(cuotaDiaFinNormal     !== undefined && { cuotaDiaFinNormal:     Number(cuotaDiaFinNormal) }),
        ...regla,
      },
    });
    res.json(ok(empresa, 'Configuración actualizada'));
  } catch (e) { next(e); }
});

export default router;
