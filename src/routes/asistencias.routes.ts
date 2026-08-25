import { Router } from 'express';
import { asistenciasController } from '../controllers/asistencias.controller';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { prisma } from '../lib/prisma';
import { ok, err } from '../types/api.types';

const router = Router();
router.use(auth);

router.post('/qr',          rbac('asistencias.registrar'), asistenciasController.registrarQR);
router.post('/manual',      rbac('asistencias.registrar'), asistenciasController.registrarManual);
router.patch('/:id/egreso', rbac('asistencias.registrar'), asistenciasController.registrarEgreso);
router.get('/',             rbac('asistencias.ver'),       asistenciasController.listar);

// GET /api/v1/asistencias/buscar-dni/:dni
router.get('/buscar-dni/:dni', rbac('asistencias.ver'), async (req: any, res, next) => {
  try {
    const { dni } = req.params;
    if (!dni || dni.length < 6) {
      res.status(400).json(err('DNI inválido — mínimo 6 dígitos'));
      return;
    }

    const persona = await prisma.persona.findFirst({
      where: {
        empresaId: req.empresaId,
        deletedAt: null,
        documentos: { some: { numero: { contains: dni } } },
      },
      include: {
        documentos: true,
        roles: {
          where: { fechaBaja: null },
          include: {
            tipoRol: { select: { nombre: true } },
            inscripciones: {
              orderBy: { fechaFin: 'desc' },
              take: 1,
              include: { plan: { select: { nombre: true } } },
            },
          },
        },
      },
    });

    if (!persona) {
      res.status(404).json(err('No se encontró ningún socio con ese DNI'));
      return;
    }

    const inscripcion    = persona.roles?.[0]?.inscripciones?.[0];
    const tipoRolNombre   = persona.roles?.[0]?.tipoRol?.nombre ?? null;
    // Solo los SOCIOS necesitan una membresía activa para ingresar; profesores,
    // empleados, etc. pueden marcar asistencia libremente.
    const requiereMembresia = tipoRolNombre === 'SOCIO';
    const hoy           = new Date();
    const vencimiento   = inscripcion ? new Date(inscripcion.fechaFin) : null;
    const activo        = vencimiento ? vencimiento >= hoy : false;
    const diasRestantes = vencimiento
      ? Math.ceil((vencimiento.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    res.json(ok({
      persona: {
        id:        persona.id,
        nombres:   persona.nombres,
        apellidos: persona.apellidos,
        fotoUrl:   persona.fotoUrl,
        qrCode:    persona.qrCode,
      },
      rol: {
        id:           persona.roles?.[0]?.id,
        numeroSocio:  persona.roles?.[0]?.numeroSocio,
        personaRolId: persona.roles?.[0]?.id,
        tipoRol:      tipoRolNombre,
        requiereMembresia,
      },
      membresia: inscripcion ? {
        id:            inscripcion.id,
        estado:        inscripcion.estado,
        plan:          inscripcion.plan?.nombre,
        fechaFin:      inscripcion.fechaFin,
        activo,
        diasRestantes,
      } : null,
    }));
  } catch (e) { next(e); }
});

export default router;
