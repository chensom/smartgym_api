import { v2 as cloudinary } from 'cloudinary'
import { CloudinaryStorage } from 'multer-storage-cloudinary'
import multer from 'multer'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

export { cloudinary }

// Storage para fotos de personas
const storagePersonas = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:         'smartgym/personas',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
  } as any,
})

// Storage para imágenes de productos
const storageProductos = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:         'smartgym/productos',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 800, height: 800, crop: 'limit' }],
  } as any,
})

// Storage para imágenes/GIF de ejercicios
const storageEjercicios = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:         'smartgym/ejercicios',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    transformation: [{ width: 600, height: 600, crop: 'limit' }],
  } as any,
})

// Storage para certificados médicos — acepta PDF o foto del certificado
const storageCertificados = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          'smartgym/certificados',
    resource_type:   'auto', // necesario para que Cloudinary acepte PDF, no solo imágenes
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
  } as any,
})

export const uploadPersona      = multer({ storage: storagePersonas,     limits: { fileSize: 5 * 1024 * 1024 } })
export const uploadProducto     = multer({ storage: storageProductos,    limits: { fileSize: 5 * 1024 * 1024 } })
export const uploadEjercicio    = multer({ storage: storageEjercicios,   limits: { fileSize: 8 * 1024 * 1024 } }) // los GIF pesan más
export const uploadCertificado  = multer({ storage: storageCertificados, limits: { fileSize: 10 * 1024 * 1024 } })
