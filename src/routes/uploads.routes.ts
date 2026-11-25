import { Router, Request, Response, NextFunction } from 'express'
import { auth } from '../middlewares/auth.middleware'
import { rbac } from '../middlewares/rbac.middleware'
import { uploadPersona, uploadProducto, uploadEjercicio, cloudinary } from '../lib/cloudinary'
import { prisma } from '../lib/prisma'
import { ok, err } from '../types/api.types'
import multer from 'multer'
import { CloudinaryStorage } from 'multer-storage-cloudinary'
import { v2 as cloudinaryV2 } from 'cloudinary'

const router = Router()
router.use(auth)

// Storage para logos y fondos de empresa
const storageEmpresa = new CloudinaryStorage({
  cloudinary: cloudinaryV2,
  params: {
    folder: 'smartgym/empresa',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'svg'],
    transformation: [{ quality: 'auto' }],
  } as any,
})
const uploadEmpresa = multer({ storage: storageEmpresa, limits: { fileSize: 5 * 1024 * 1024 } })

// ── Aislamiento entre gimnasios ────────────────────────────────────────────
// Antes de subir o borrar, confirmamos que el registro (:id) es del gimnasio
// del usuario. Va ANTES de multer para no subir nada a Cloudinary si no es suyo.
// Los ejercicios globales (empresaId null) no se pueden tocar desde un gimnasio.
type Modelo = 'persona' | 'producto' | 'ejercicio'
const NO_ENCONTRADO: Record<Modelo, string> = {
  persona: 'Persona no encontrada', producto: 'Producto no encontrado', ejercicio: 'Ejercicio no encontrado',
}
function delGimnasio(modelo: Modelo) {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      const where = { id: req.params.id, empresaId: req.empresaId }
      const existe = modelo === 'persona'  ? await prisma.persona.findFirst({ where, select: { id: true } })
                   : modelo === 'producto' ? await prisma.producto.findFirst({ where, select: { id: true } })
                   :                         await prisma.ejercicio.findFirst({ where, select: { id: true } })
      if (!existe) { res.status(404).json(err(NO_ENCONTRADO[modelo])); return }
      next()
    } catch (e) { next(e) }
  }
}

// ── Personas ───────────────────────────────────────────────────────────────
router.post('/persona/:id', rbac('socios.editar'), delGimnasio('persona'), uploadPersona.single('foto'),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      if (!req.file) { res.status(400).json(err('No se recibió ningún archivo')); return }
      const fotoUrl = req.file.path
      await prisma.persona.update({ where: { id: req.params.id }, data: { fotoUrl } })
      res.json(ok({ fotoUrl }, 'Foto actualizada'))
    } catch (e) { next(e) }
  }
)

router.delete('/persona/:id', rbac('socios.editar'), delGimnasio('persona'), async (req: any, res, next) => {
  try {
    const persona = await prisma.persona.findUnique({ where: { id: req.params.id }, select: { fotoUrl: true } })
    if (persona?.fotoUrl) {
      const parts = persona.fotoUrl.split('/'); const file = parts[parts.length-1].split('.')[0]; const folder = parts[parts.length-2]
      await cloudinaryV2.uploader.destroy(`${folder}/${file}`)
    }
    await prisma.persona.update({ where: { id: req.params.id }, data: { fotoUrl: null } })
    res.json(ok(null, 'Foto eliminada'))
  } catch (e) { next(e) }
})

// ── Productos ──────────────────────────────────────────────────────────────
router.post('/producto/:id', rbac('inventario.ajustar'), delGimnasio('producto'), uploadProducto.single('imagen'),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      if (!req.file) { res.status(400).json(err('No se recibió ningún archivo')); return }
      const imagenUrl = req.file.path
      await prisma.producto.update({ where: { id: req.params.id }, data: { imagenUrl } })
      res.json(ok({ imagenUrl }, 'Imagen actualizada'))
    } catch (e) { next(e) }
  }
)

router.delete('/producto/:id', rbac('inventario.ajustar'), delGimnasio('producto'), async (req: any, res, next) => {
  try {
    const producto = await prisma.producto.findUnique({ where: { id: req.params.id }, select: { imagenUrl: true } })
    if (producto?.imagenUrl) {
      const parts = producto.imagenUrl.split('/'); const file = parts[parts.length-1].split('.')[0]; const folder = parts[parts.length-2]
      await cloudinaryV2.uploader.destroy(`${folder}/${file}`)
    }
    await prisma.producto.update({ where: { id: req.params.id }, data: { imagenUrl: null } })
    res.json(ok(null, 'Imagen eliminada'))
  } catch (e) { next(e) }
})

// ── Ejercicios (biblioteca de rutinas) ────────────────────────────────────
router.post('/ejercicio/:id', rbac('rutinas.editar'), delGimnasio('ejercicio'), uploadEjercicio.single('imagen'),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      if (!req.file) { res.status(400).json(err('No se recibió ningún archivo')); return }
      const imagenUrl = req.file.path
      await prisma.ejercicio.update({ where: { id: req.params.id }, data: { imagenUrl } })
      res.json(ok({ imagenUrl }, 'Imagen actualizada'))
    } catch (e) { next(e) }
  }
)

router.delete('/ejercicio/:id', rbac('rutinas.editar'), delGimnasio('ejercicio'), async (req: any, res, next) => {
  try {
    const ejercicio = await prisma.ejercicio.findUnique({ where: { id: req.params.id }, select: { imagenUrl: true } })
    if (ejercicio?.imagenUrl) {
      const parts = ejercicio.imagenUrl.split('/'); const file = parts[parts.length-1].split('.')[0]; const folder = parts[parts.length-2]
      await cloudinaryV2.uploader.destroy(`${folder}/${file}`)
    }
    await prisma.ejercicio.update({ where: { id: req.params.id }, data: { imagenUrl: null } })
    res.json(ok(null, 'Imagen eliminada'))
  } catch (e) { next(e) }
})

// ── Empresa (logo, fondo login, marca de agua) ─────────────────────────────
router.post('/empresa/logo', rbac('configuracion.editar'), uploadEmpresa.single('logo'),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      if (!req.file) { res.status(400).json(err('No se recibió archivo')); return }
      const logoUrl = req.file.path
      await prisma.empresa.update({ where: { id: req.empresaId }, data: { logoUrl } })
      res.json(ok({ logoUrl }, 'Logo actualizado'))
    } catch (e) { next(e) }
  }
)

router.post('/empresa/fondo', rbac('configuracion.editar'), uploadEmpresa.single('fondo'),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      if (!req.file) { res.status(400).json(err('No se recibió archivo')); return }
      const fondoLoginUrl = req.file.path
      await prisma.empresa.update({ where: { id: req.empresaId }, data: { fondoLoginUrl } })
      res.json(ok({ fondoLoginUrl }, 'Fondo actualizado'))
    } catch (e) { next(e) }
  }
)

router.post('/empresa/marca-agua', rbac('configuracion.editar'), uploadEmpresa.single('marcaAgua'),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      if (!req.file) { res.status(400).json(err('No se recibió archivo')); return }
      const marcaAguaUrl = req.file.path
      await prisma.empresa.update({ where: { id: req.empresaId }, data: { marcaAguaUrl } })
      res.json(ok({ marcaAguaUrl }, 'Marca de agua actualizada'))
    } catch (e) { next(e) }
  }
)

export default router
