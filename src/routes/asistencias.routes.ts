import { Router } from 'express';
import { asistenciasController } from '../controllers/asistencias.controller';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { prisma } from '../lib/prisma';
import { ok, err } from '../types/api.types';
import { validate } from '../middlewares/validate.middleware';
import { z } from 'zod';
import { evaluarMembresia, includeMembresia } from '../services/asistencias.service';
import { hoyArgentina, deFechaDB, diasEntre } from '../lib/fechas';

const router = Router();
router.use(auth);

router.post('/qr',          rbac('asistencias.registrar'), asistenciasController.registrarQR);

// Kiosco de autoservicio. El usuario del kiosco solo necesita asistencias.registrar.
const kioscoSchema = z.object({
  codigo:      z.string().trim().min(1).max(100),
  sucursalId:  z.string().uuid(),
  dispositivo: z.string().trim().max(60).optional(),
}).strict();
router.get('/kiosco/config', rbac('asistencias.registrar'), asistenciasController.configKiosco);
router.post('/kiosco',       rbac('asistencias.registrar'), validate(kioscoSchema), asistenciasController.registrarKiosco);
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
            // Membresía actual: excluye las cerradas por cambio de plan / canceladas
            inscripciones: includeMembresia,
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
    // Fechas como día calendario argentino (antes: new Date() en UTC dejaba
    // al socio "vencido" todo su último día).
    const hoy           = hoyArgentina();
    const vencimiento   = inscripcion ? deFechaDB(inscripcion.fechaFin) : null;
    const activo        = vencimiento ? vencimiento >= hoy : false;
    const diasRestantes = vencimiento ? diasEntre(hoy, vencimiento) : null;
    const { aviso }     = requiereMembresia
      ? await evaluarMembresia(req.empresaId, inscripcion ?? null, hoy)
      : { aviso: null };

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
      aviso, // { tipo, nivel, mensaje, cuotaHoy? } o null — el ingreso se permite igual
    }));
  } catch (e) { next(e); }
});

export default router;
