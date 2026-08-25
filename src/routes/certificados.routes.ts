import { Router, Request, Response, NextFunction } from 'express';
import { auth } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import { prisma } from '../lib/prisma';
import { ok, err } from '../types/api.types';
import { uploadCertificado } from '../lib/cloudinary';

const router = Router();
router.use(auth);

// Calcula el estado real según la fecha de vencimiento, en vez de confiar
// ciegamente en el valor guardado (que puede quedar desactualizado con el tiempo).
function calcularEstado(fechaVencimiento: Date): string {
  const hoy = new Date();
  const dias = Math.ceil((fechaVencimiento.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
  if (dias < 0)  return 'VENCIDO';
  if (dias <= 30) return 'POR_VENCER';
  return 'VIGENTE';
}

// Verifica que el personaRolId pertenezca a esta empresa antes de tocar nada
async function personaRolDeLaEmpresa(personaRolId: string, empresaId: string) {
  return prisma.personaRol.findFirst({
    where: { id: personaRolId, persona: { empresaId } },
  });
}

// GET /api/v1/certificados/:personaRolId — listado de certificados de un socio
router.get('/:personaRolId', rbac('socios.ver'), async (req: any, res, next) => {
  try {
    const rolValido = await personaRolDeLaEmpresa(req.params.personaRolId, req.empresaId);
    if (!rolValido) { res.status(404).json(err('Socio no encontrado')); return; }

    const certificados = await prisma.certificadoMedico.findMany({
      where: { personaRolId: req.params.personaRolId },
      orderBy: { fechaVencimiento: 'desc' },
    });

    const conEstadoActualizado = certificados.map(c => ({ ...c, estado: calcularEstado(c.fechaVencimiento) }));
    res.json(ok(conEstadoActualizado));
  } catch (e) { next(e); }
});

// POST /api/v1/certificados
router.post('/', rbac('socios.editar'), async (req: any, res, next) => {
  try {
    const { personaRolId, tipo, fechaEmision, fechaVencimiento, medicoNombre, matricula } = req.body;
    if (!personaRolId || !tipo || !fechaEmision || !fechaVencimiento) {
      res.status(400).json(err('personaRolId, tipo, fechaEmision y fechaVencimiento son requeridos'));
      return;
    }
    const rolValido = await personaRolDeLaEmpresa(personaRolId, req.empresaId);
    if (!rolValido) { res.status(404).json(err('Socio no encontrado')); return; }

    const certificado = await prisma.certificadoMedico.create({
      data: {
        personaRolId,
        tipo,
        fechaEmision:     new Date(fechaEmision),
        fechaVencimiento: new Date(fechaVencimiento),
        medicoNombre:     medicoNombre ?? null,
        matricula:        matricula ?? null,
        estado:           calcularEstado(new Date(fechaVencimiento)),
      },
    });
    res.status(201).json(ok(certificado, 'Certificado cargado'));
  } catch (e: any) {
    if (e.code === 'P2003') { res.status(400).json(err('Socio inválido')); return; }
    next(e);
  }
});

// POST /api/v1/certificados/:id/archivo — subir el PDF/foto del certificado
router.post('/:id/archivo', rbac('socios.editar'), uploadCertificado.single('archivo'),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      if (!req.file) { res.status(400).json(err('No se recibió ningún archivo')); return; }
      const certificado = await prisma.certificadoMedico.findFirst({
        where: { id: req.params.id, personaRol: { persona: { empresaId: req.empresaId } } },
      });
      if (!certificado) { res.status(404).json(err('Certificado no encontrado')); return; }

      const archivoUrl = req.file.path;
      await prisma.certificadoMedico.update({ where: { id: req.params.id }, data: { archivoUrl } });
      res.json(ok({ archivoUrl }, 'Archivo subido'));
    } catch (e) { next(e); }
  }
);

// PATCH /api/v1/certificados/:id
router.patch('/:id', rbac('socios.editar'), async (req: any, res, next) => {
  try {
    const existente = await prisma.certificadoMedico.findFirst({
      where: { id: req.params.id, personaRol: { persona: { empresaId: req.empresaId } } },
    });
    if (!existente) { res.status(404).json(err('Certificado no encontrado')); return; }

    const { tipo, fechaEmision, fechaVencimiento, medicoNombre, matricula } = req.body;
    const nuevaFechaVenc = fechaVencimiento ? new Date(fechaVencimiento) : existente.fechaVencimiento;

    const certificado = await prisma.certificadoMedico.update({
      where: { id: req.params.id },
      data: {
        ...(tipo !== undefined && { tipo }),
        ...(fechaEmision !== undefined && { fechaEmision: new Date(fechaEmision) }),
        ...(fechaVencimiento !== undefined && { fechaVencimiento: nuevaFechaVenc }),
        ...(medicoNombre !== undefined && { medicoNombre }),
        ...(matricula !== undefined && { matricula }),
        estado: calcularEstado(nuevaFechaVenc),
      },
    });
    res.json(ok(certificado, 'Certificado actualizado'));
  } catch (e) { next(e); }
});

// DELETE /api/v1/certificados/:id
router.delete('/:id', rbac('socios.editar'), async (req: any, res, next) => {
  try {
    const existente = await prisma.certificadoMedico.findFirst({
      where: { id: req.params.id, personaRol: { persona: { empresaId: req.empresaId } } },
    });
    if (!existente) { res.status(404).json(err('Certificado no encontrado')); return; }
    await prisma.certificadoMedico.delete({ where: { id: req.params.id } });
    res.json(ok(null, 'Certificado eliminado'));
  } catch (e) { next(e); }
});

export default router;
