import { prisma } from './prisma';

// Aislamiento entre gimnasios (multi-tenant).
// Cuando un endpoint recibe ids de otras tablas en el body (sucursal, producto,
// proveedor, etc.), hay que confirmar que son del MISMO gimnasio que el usuario.
// Si no, un admin de un gimnasio podría tocar stock, ventas o datos de otro.
//
// Devuelve el mensaje de error del primer id ajeno, o null si todo es propio.
// Los ids vacíos/undefined se ignoran (los campos opcionales no se validan).
export interface RefsGimnasio {
  sucursalId?:   string | null;
  productoIds?:  (string | null | undefined)[];
  proveedorId?:  string | null;
  categoriaId?:  string | null;
  marcaId?:      string | null;
  medioPagoId?:  string | null;
  personaId?:    string | null;
}

export async function refsAjenas(empresaId: string, r: RefsGimnasio): Promise<string | null> {
  if (r.sucursalId && !(await prisma.sucursal.findFirst({ where: { id: r.sucursalId, empresaId }, select: { id: true } })))
    return 'Sucursal no encontrada';

  const productos = [...new Set((r.productoIds ?? []).filter((x): x is string => !!x))];
  if (productos.length) {
    const propios = await prisma.producto.count({ where: { id: { in: productos }, empresaId } });
    if (propios !== productos.length) return 'Producto no encontrado';
  }

  if (r.proveedorId && !(await prisma.proveedor.findFirst({ where: { id: r.proveedorId, empresaId }, select: { id: true } })))
    return 'Proveedor no encontrado';
  if (r.categoriaId && !(await prisma.categoriaProducto.findFirst({ where: { id: r.categoriaId, empresaId }, select: { id: true } })))
    return 'Categoría no encontrada';
  if (r.marcaId && !(await prisma.marca.findFirst({ where: { id: r.marcaId, empresaId }, select: { id: true } })))
    return 'Marca no encontrada';
  if (r.medioPagoId && !(await prisma.medioPago.findFirst({ where: { id: r.medioPagoId, empresaId }, select: { id: true } })))
    return 'Medio de pago no encontrado';
  if (r.personaId && !(await prisma.persona.findFirst({ where: { id: r.personaId, empresaId }, select: { id: true } })))
    return 'Persona no encontrada';

  return null;
}
