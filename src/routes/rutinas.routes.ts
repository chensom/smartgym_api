import { Router } from 'express';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { prisma } from '../lib/prisma';
import { ok, err } from '../types/api.types';

const router = Router();

// GET /api/v1/rutinas/publica/:token — sin login, para que el socio la vea desde su celular
// (va ANTES de router.use(auth), a propósito, porque esta ruta es pública)
router.get('/publica/:token', async (req, res, next) => {
  try {
    const rutina = await prisma.rutina.findUnique({
      where: { tokenPublico: req.params.token },
      include: {
        ejercicios: {
          include: {
            ejercicio: { select: { nombre: true, imagenUrl: true, descripcion: true, grupoMuscular: { select: { nombre: true } } } },
          },
          orderBy: [{ diaNumero: 'asc' }, { orden: 'asc' }],
        },
        Empresa: { select: { nombreComercial: true, nombre: true, logoUrl: true, colorPrimario: true } },
      },
    });
    if (!rutina || !rutina.activo) { res.status(404).json(err('Rutina no encontrada')); return; }
    res.json(ok(rutina));
  } catch (e) { next(e); }
});

router.use(auth);

// ── Rutinas (plantillas) ──────────────────────────────────────────────────

// GET /api/v1/rutinas — listado con cantidad de ejercicios y socios asignados
router.get('/', rbac('rutinas.ver'), async (req: any, res, next) => {
  try {
    const rutinas = await prisma.rutina.findMany({
      where: { empresaId: req.empresaId, activo: true },
      include: {
        _count: { select: { ejercicios: true, socios: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(ok(rutinas));
  } catch (e) { next(e); }
});

// GET /api/v1/rutinas/socio/:personaRolId — rutina activa asignada a un socio
// (va ANTES que /:id a propósito, si no Express interpreta "socio" como un id de rutina)
router.get('/socio/:personaRolId', rbac('rutinas.ver'), async (req: any, res, next) => {
  try {
    const asignacion = await prisma.socioRutina.findFirst({
      where: { personaRolId: req.params.personaRolId, activo: true },
      include: {
        rutina: {
          include: {
            ejercicios: {
              include: { ejercicio: { select: { id: true, nombre: true, imagenUrl: true, grupoMuscular: { select: { nombre: true } } } } },
              orderBy: [{ diaNumero: 'asc' }, { orden: 'asc' }],
            },
          },
        },
        profesorRol: { include: { persona: { select: { nombres: true, apellidos: true } } } },
      },
    });
    res.json(ok(asignacion));
  } catch (e) { next(e); }
});

// GET /api/v1/rutinas/:id — detalle completo, ejercicios agrupados por día
router.get('/:id', rbac('rutinas.ver'), async (req: any, res, next) => {
  try {
    const rutina = await prisma.rutina.findFirst({
      where: { id: req.params.id, empresaId: req.empresaId },
      include: {
        ejercicios: {
          include: {
            ejercicio: { select: { id: true, nombre: true, imagenUrl: true, grupoMuscular: { select: { nombre: true } } } },
          },
          orderBy: [{ diaNumero: 'asc' }, { orden: 'asc' }],
        },
      },
    });
    if (!rutina) { res.status(404).json(err('Rutina no encontrada')); return; }
    res.json(ok(rutina));
  } catch (e) { next(e); }
});

// POST /api/v1/rutinas
router.post('/', rbac('rutinas.editar'), async (req: any, res, next) => {
  try {
    const { nombre, descripcion, duracionSemanas, nivel } = req.body;
    if (!nombre) { res.status(400).json(err('nombre requerido')); return; }
    const rutina = await prisma.rutina.create({
      data: {
        empresaId:       req.empresaId,
        nombre,
        descripcion:     descripcion ?? null,
        duracionSemanas: duracionSemanas ? Number(duracionSemanas) : null,
        nivel:           nivel ?? null,
        activo:          true,
      },
    });
    res.status(201).json(ok(rutina, 'Rutina creada'));
  } catch (e) { next(e); }
});

// PATCH /api/v1/rutinas/:id
router.patch('/:id', rbac('rutinas.editar'), async (req: any, res, next) => {
  try {
    const existente = await prisma.rutina.findFirst({ where: { id: req.params.id, empresaId: req.empresaId } });
    if (!existente) { res.status(404).json(err('Rutina no encontrada')); return; }
    const { nombre, descripcion, duracionSemanas, nivel, activo } = req.body;
    const rutina = await prisma.rutina.update({
      where: { id: req.params.id },
      data: {
        ...(nombre !== undefined && { nombre }),
        ...(descripcion !== undefined && { descripcion }),
        ...(duracionSemanas !== undefined && { duracionSemanas: duracionSemanas ? Number(duracionSemanas) : null }),
        ...(nivel !== undefined && { nivel }),
        ...(activo !== undefined && { activo }),
      },
    });
    res.json(ok(rutina, 'Rutina actualizada'));
  } catch (e) { next(e); }
});

// ── Ejercicios dentro de una rutina (por día) ─────────────────────────────

// POST /api/v1/rutinas/:id/ejercicios
router.post('/:id/ejercicios', rbac('rutinas.editar'), async (req: any, res, next) => {
  try {
    const rutina = await prisma.rutina.findFirst({ where: { id: req.params.id, empresaId: req.empresaId } });
    if (!rutina) { res.status(404).json(err('Rutina no encontrada')); return; }

    const { ejercicioId, diaNumero, series, repeticiones, descansoSeg, observaciones } = req.body;
    if (!ejercicioId || !diaNumero || !series || !repeticiones) {
      res.status(400).json(err('ejercicioId, diaNumero, series y repeticiones son requeridos'));
      return;
    }

    // El orden dentro del día se calcula solo (siguiente lugar disponible)
    const ultimo = await prisma.rutinaEjercicio.findFirst({
      where: { rutinaId: rutina.id, diaNumero: Number(diaNumero) },
      orderBy: { orden: 'desc' },
    });
    const orden = (ultimo?.orden ?? 0) + 1;

    const item = await prisma.rutinaEjercicio.create({
      data: {
        rutinaId:      rutina.id,
        ejercicioId,
        diaNumero:     Number(diaNumero),
        orden,
        series:        Number(series),
        repeticiones:  String(repeticiones),
        descanseSeg:   descansoSeg ? Number(descansoSeg) : null,
        observaciones: observaciones ?? null,
      },
      include: {
        ejercicio: { select: { id: true, nombre: true, imagenUrl: true, grupoMuscular: { select: { nombre: true } } } },
      },
    });
    res.status(201).json(ok(item, 'Ejercicio agregado'));
  } catch (e) { next(e); }
});

// PATCH /api/v1/rutinas/:id/ejercicios/:itemId
router.patch('/:id/ejercicios/:itemId', rbac('rutinas.editar'), async (req: any, res, next) => {
  try {
    const rutina = await prisma.rutina.findFirst({ where: { id: req.params.id, empresaId: req.empresaId } });
    if (!rutina) { res.status(404).json(err('Rutina no encontrada')); return; }

    const { series, repeticiones, descansoSeg, observaciones } = req.body;
    const item = await prisma.rutinaEjercicio.update({
      where: { id: req.params.itemId },
      data: {
        ...(series !== undefined && { series: Number(series) }),
        ...(repeticiones !== undefined && { repeticiones: String(repeticiones) }),
        ...(descansoSeg !== undefined && { descanseSeg: descansoSeg ? Number(descansoSeg) : null }),
        ...(observaciones !== undefined && { observaciones }),
      },
    });
    res.json(ok(item, 'Ejercicio actualizado'));
  } catch (e) { next(e); }
});

// DELETE /api/v1/rutinas/:id/ejercicios/:itemId
router.delete('/:id/ejercicios/:itemId', rbac('rutinas.editar'), async (req: any, res, next) => {
  try {
    const rutina = await prisma.rutina.findFirst({ where: { id: req.params.id, empresaId: req.empresaId } });
    if (!rutina) { res.status(404).json(err('Rutina no encontrada')); return; }
    await prisma.rutinaEjercicio.delete({ where: { id: req.params.itemId } });
    res.json(ok(null, 'Ejercicio quitado de la rutina'));
  } catch (e) { next(e); }
});

// ── Asignación a socios ────────────────────────────────────────────────────

// POST /api/v1/rutinas/:id/asignar
router.post('/:id/asignar', rbac('rutinas.editar'), async (req: any, res, next) => {
  try {
    const rutina = await prisma.rutina.findFirst({ where: { id: req.params.id, empresaId: req.empresaId } });
    if (!rutina) { res.status(404).json(err('Rutina no encontrada')); return; }

    const { personaRolId, profesorRolId, fechaInicio, fechaFin } = req.body;
    if (!personaRolId || !fechaInicio) { res.status(400).json(err('personaRolId y fechaInicio son requeridos')); return; }

    // Desactiva cualquier rutina previa activa de este socio (solo una activa a la vez)
    await prisma.socioRutina.updateMany({
      where: { personaRolId, activo: true },
      data:  { activo: false },
    });

    const asignacion = await prisma.socioRutina.create({
      data: {
        personaRolId,
        rutinaId:      rutina.id,
        profesorRolId: profesorRolId ?? null,
        fechaInicio:   new Date(fechaInicio),
        fechaFin:      fechaFin ? new Date(fechaFin) : null,
        activo:        true,
      },
    });
    res.status(201).json(ok(asignacion, 'Rutina asignada'));
  } catch (e) { next(e); }
});

// DELETE /api/v1/rutinas/asignaciones/:socioRutinaId — desasignar
router.delete('/asignaciones/:socioRutinaId', rbac('rutinas.editar'), async (req: any, res, next) => {
  try {
    await prisma.socioRutina.update({
      where: { id: req.params.socioRutinaId },
      data:  { activo: false, fechaFin: new Date() },
    });
    res.json(ok(null, 'Rutina desasignada'));
  } catch (e) { next(e); }
});

export default router;
