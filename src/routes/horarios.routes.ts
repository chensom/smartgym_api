import { Router } from 'express';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { prisma } from '../lib/prisma';
import { ok, err } from '../types/api.types';

const router = Router();
router.use(auth);

const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

// Convierte Date a "HH:MM" en UTC (evita problemas de timezone)
const fh = (d: Date): string =>
  `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;

const formatHorario = (h: any) => ({
  ...h,
  diaNombre:  DIAS[h.diaSemana],
  horaInicio: fh(h.horaInicio),
  horaFin:    fh(h.horaFin),
});

// GET /api/v1/horarios
router.get('/', rbac('socios.ver'), async (req: any, res, next) => {
  try {
    const { disciplinaId, profesorRolId, sucursalId } = req.query;
    const where: any = { empresaId: req.empresaId, activo: true };
    if (disciplinaId)  where.disciplinaId  = disciplinaId;
    if (profesorRolId) where.profesorRolId = profesorRolId;
    if (sucursalId)    where.sucursalId    = sucursalId;

    const horarios = await prisma.horarioClase.findMany({
      where,
      orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }],
      include: {
        disciplina:  { select: { id: true, nombre: true, colorHex: true } },
        sucursal:    { select: { id: true, nombre: true } },
        profesorRol: { select: { id: true, persona: { select: { nombres: true, apellidos: true } } } },
        _count:      { select: { inscripciones: { where: { activo: true } } } },
      },
    });

    res.json(ok(horarios.map(formatHorario)));
  } catch (e) { next(e); }
});

// GET /api/v1/horarios/socio/:personaRolId
router.get('/socio/:personaRolId', rbac('socios.ver'), async (req: any, res, next) => {
  try {
    const inscripciones = await prisma.inscripcionClase.findMany({
      where: { personaRolId: req.params.personaRolId, activo: true },
      include: {
        horario: {
          include: {
            disciplina: { select: { nombre: true, colorHex: true } },
            sucursal:   { select: { nombre: true } },
          },
        },
      },
    });
    res.json(ok(inscripciones.map(i => ({
      ...i,
      horario: formatHorario(i.horario),
    }))));
  } catch (e) { next(e); }
});

// GET /api/v1/horarios/:id
router.get('/:id', rbac('socios.ver'), async (req: any, res, next) => {
  try {
    const horario = await prisma.horarioClase.findFirst({
      where: { id: req.params.id, empresaId: req.empresaId },
      include: {
        disciplina:  { select: { id: true, nombre: true, colorHex: true } },
        sucursal:    { select: { id: true, nombre: true } },
        profesorRol: { select: { id: true, persona: { select: { nombres: true, apellidos: true } } } },
        inscripciones: {
          where: { activo: true },
          include: {
            personaRol: {
              select: {
                id: true, numeroSocio: true,
                persona: { select: { nombres: true, apellidos: true, fotoUrl: true } },
              },
            },
          },
        },
      },
    });
    if (!horario) { res.status(404).json(err('Horario no encontrado')); return; }
    res.json(ok(formatHorario(horario)));
  } catch (e) { next(e); }
});

// POST /api/v1/horarios
router.post('/', rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { disciplinaId, sucursalId, profesorRolId, diaSemana, horaInicio, horaFin, cupoMax, nombre } = req.body;
    if (!disciplinaId || !sucursalId || diaSemana === undefined || !horaInicio || !horaFin) {
      res.status(400).json(err('disciplinaId, sucursalId, diaSemana, horaInicio y horaFin son requeridos'));
      return;
    }
    const horario = await prisma.horarioClase.create({
      data: {
        empresaId:     req.empresaId,
        disciplinaId,
        sucursalId,
        profesorRolId: (profesorRolId && profesorRolId !== '') ? profesorRolId : null,
        diaSemana:     parseInt(diaSemana),
        horaInicio:    new Date(`1970-01-01T${horaInicio}:00Z`),
        horaFin:       new Date(`1970-01-01T${horaFin}:00Z`),
        cupoMax:       cupoMax ? parseInt(cupoMax) : null,
        nombre:        nombre || null,
        activo:        true,
      },
    });
    res.status(201).json(ok({ ...horario, horaInicio: fh(horario.horaInicio), horaFin: fh(horario.horaFin) }, 'Horario creado'));
  } catch (e) { next(e); }
});

// PATCH /api/v1/horarios/:id
router.patch('/:id', rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    const { disciplinaId, sucursalId, profesorRolId, diaSemana, horaInicio, horaFin, cupoMax, nombre, activo } = req.body;
    const data: any = {};
    if (disciplinaId  !== undefined) data.disciplinaId  = disciplinaId || undefined;
    if (sucursalId    !== undefined) data.sucursalId    = sucursalId   || undefined;
    if (profesorRolId !== undefined) data.profesorRolId = (profesorRolId && profesorRolId !== '') ? profesorRolId : null;
    if (diaSemana     !== undefined) data.diaSemana     = parseInt(diaSemana);
    if (horaInicio    !== undefined) data.horaInicio    = new Date(`1970-01-01T${horaInicio}:00Z`);
    if (horaFin       !== undefined) data.horaFin       = new Date(`1970-01-01T${horaFin}:00Z`);
    if (cupoMax       !== undefined) data.cupoMax       = cupoMax ? parseInt(cupoMax) : null;
    if (nombre        !== undefined) data.nombre        = nombre || null;
    if (activo        !== undefined) data.activo        = activo;

    const horario = await prisma.horarioClase.update({ where: { id: req.params.id }, data });
    res.json(ok({ ...horario, horaInicio: fh(horario.horaInicio), horaFin: fh(horario.horaFin) }, 'Horario actualizado'));
  } catch (e) { next(e); }
});

// DELETE /api/v1/horarios/:id
router.delete('/:id', rbac('configuracion.editar'), async (req: any, res, next) => {
  try {
    await prisma.horarioClase.update({ where: { id: req.params.id }, data: { activo: false } });
    res.json(ok(null, 'Horario eliminado'));
  } catch (e) { next(e); }
});

// POST /api/v1/horarios/:id/inscribir
router.post('/:id/inscribir', rbac('socios.editar'), async (req: any, res, next) => {
  try {
    const { personaRolId } = req.body;
    if (!personaRolId) { res.status(400).json(err('personaRolId requerido')); return; }

    const existente = await prisma.inscripcionClase.findUnique({
      where: { horarioId_personaRolId: { horarioId: req.params.id, personaRolId } },
    });

    if (existente) {
      if (existente.activo) { res.status(409).json(err('El socio ya está anotado a este horario')); return; }
      const reactivado = await prisma.inscripcionClase.update({
        where: { id: existente.id },
        data:  { activo: true, fechaBaja: null, fechaAlta: new Date() },
      });
      res.json(ok(reactivado, 'Socio anotado al horario'));
      return;
    }

    const inscripcion = await prisma.inscripcionClase.create({
      data: { horarioId: req.params.id, personaRolId, activo: true },
    });
    res.status(201).json(ok(inscripcion, 'Socio anotado al horario'));
  } catch (e) { next(e); }
});

// DELETE /api/v1/horarios/:id/inscribir/:personaRolId
router.delete('/:id/inscribir/:personaRolId', rbac('socios.editar'), async (req: any, res, next) => {
  try {
    await prisma.inscripcionClase.updateMany({
      where: { horarioId: req.params.id, personaRolId: req.params.personaRolId },
      data:  { activo: false, fechaBaja: new Date() },
    });
    res.json(ok(null, 'Socio desanotado del horario'));
  } catch (e) { next(e); }
});

export default router;
