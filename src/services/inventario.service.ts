import { prisma } from '../lib/prisma';

export class InventarioService {

  async stockPorSucursal(empresaId: string, sucursalId?: string) {
    const where: any = { sucursal: { empresaId } };
    if (sucursalId) where.sucursalId = sucursalId;
    return prisma.inventario.findMany({
      where,
      include: {
        sucursal: { select: { nombre: true } },
        producto: { select: { nombre: true, codigo: true, precioVenta: true } },
        variante: { select: { nombre: true, valor: true } },
      },
      orderBy: [{ sucursalId: 'asc' }, { producto: { nombre: 'asc' } }],
    });
  }

  async bajosDeStock(empresaId: string, sucursalId?: string) {
    const where: any = { sucursal: { empresaId } };
    if (sucursalId) where.sucursalId = sucursalId;
    const inventario = await prisma.inventario.findMany({
      where,
      include: {
        sucursal: { select: { nombre: true } },
        producto: { select: { nombre: true, codigo: true } },
        variante: { select: { nombre: true, valor: true } },
      },
    });
    return inventario.filter(i => Number(i.stockActual) <= Number(i.stockMinimo));
  }

  async registrarMovimiento(opts: {
    sucursalId:  string;
    productoId:  string;
    varianteId?: string;
    tipo:        string;
    cantidad:    number;
    motivo?:     string;
    usuarioId:   string;
    proveedorId?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const movimiento = await tx.movimientoStock.create({
        data: {
          sucursalId:  opts.sucursalId,
          productoId:  opts.productoId,
          varianteId:  opts.varianteId ?? null,
          tipo:        opts.tipo,
          cantidad:    opts.cantidad,
          motivo:      opts.motivo ?? null,
          usuarioId:   opts.usuarioId,
          proveedorId: opts.proveedorId ?? null,
        },
        include: {
          producto: { select: { nombre: true, codigo: true } },
          sucursal: { select: { nombre: true } },
          proveedor: { select: { nombre: true } },
          usuario:  { select: { email: true } },
        },
      });

      const invExiste = await tx.inventario.findFirst({
        where: {
          sucursalId: opts.sucursalId,
          productoId: opts.productoId,
          varianteId: opts.varianteId ?? null,
        },
      });
      if (!invExiste) {
        await tx.inventario.create({
          data: {
            sucursalId:  opts.sucursalId,
            productoId:  opts.productoId,
            varianteId:  opts.varianteId ?? null,
            stockActual: opts.cantidad,
            stockMinimo: 0,
          },
        });
      }
      return movimiento;
    });
  }

  async historialMovimientos(opts: {
    productoId?: string;
    sucursalId?: string;
    empresaId:   string;
    page:        number;
    limit:       number;
  }) {
    const { productoId, sucursalId, page, limit } = opts;
    const skip = (page - 1) * limit;
    const where: any = { sucursal: { empresaId: opts.empresaId } };
    if (productoId) where.productoId = productoId;
    if (sucursalId) where.sucursalId = sucursalId;

    const [total, movimientos] = await prisma.$transaction([
      prisma.movimientoStock.count({ where }),
      prisma.movimientoStock.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          sucursal: { select: { nombre: true } },
          producto: { select: { nombre: true, codigo: true } },
          variante: { select: { nombre: true, valor: true } },
        },
      }),
    ]);
    return { total, movimientos };
  }

  async listarProductos(empresaId: string, opts: {
    q?:          string;
    categoriaId?: string;
    marcaId?:    string;
    page:        number;
    limit:       number;
  }) {
    const { q, categoriaId, marcaId, page, limit } = opts;
    const skip = (page - 1) * limit;
    const where: any = { empresaId, deletedAt: null, activo: true };
    if (categoriaId) where.categoriaId = categoriaId;
    if (marcaId)     where.marcaId     = marcaId;
    if (q) where.OR = [
      { nombre: { contains: q, mode: 'insensitive' } },
      { codigo: { contains: q, mode: 'insensitive' } },
    ];

    const [total, productos] = await prisma.$transaction([
      prisma.producto.count({ where }),
      prisma.producto.findMany({
        where, skip, take: limit,
        orderBy: { nombre: 'asc' },
        include: {
          categoria: { select: { nombre: true } },
          marca:     { select: { nombre: true } },
          variantes: { where: { activo: true } },
          inventario: { include: { sucursal: { select: { nombre: true } } } },
        },
      }),
    ]);
    return { total, productos };
  }

  async ajustarPrecios(opts: {
    empresaId:    string;
    marcaId?:     string;
    categoriaId?: string;
    porcentaje:   number;
    tipo:         'aumento' | 'descuento';
    campo:        'venta' | 'costo' | 'ambos';
  }) {
    const { empresaId, marcaId, categoriaId, porcentaje, tipo, campo } = opts;
    const factor = tipo === 'aumento' ? 1 + porcentaje / 100 : 1 - porcentaje / 100;

    const where: any = { empresaId, activo: true, deletedAt: null };
    if (marcaId)     where.marcaId     = marcaId;
    if (categoriaId) where.categoriaId = categoriaId;

    const productos = await prisma.producto.findMany({
      where,
      select: { id: true, precioVenta: true, precioCosto: true },
    });

    let cantidad = 0;
    for (const p of productos) {
      const data: any = {};
      if (campo === 'venta' || campo === 'ambos') {
        data.precioVenta = Math.round(Number(p.precioVenta) * factor);
      }
      if ((campo === 'costo' || campo === 'ambos') && p.precioCosto) {
        data.precioCosto = Math.round(Number(p.precioCosto) * factor);
      }
      if (Object.keys(data).length > 0) {
        await prisma.producto.update({ where: { id: p.id }, data });
        cantidad++;
      }
    }
    return { cantidad, factor, campo };
  }

  async actualizarProducto(id: string, data: any) {
    return prisma.producto.update({ where: { id }, data });
  }

  async crearProducto(empresaId: string, data: {
    nombre:       string;
    codigo?:      string;
    categoriaId:  string;
    marcaId?:     string;
    proveedorId?: string;
    precioVenta:  number;
    precioCosto?: number;
    stockInicial?: number;
  }) {
    const producto = await prisma.producto.create({
      data: {
        empresaId,
        nombre:      data.nombre,
        codigo:      data.codigo ?? null,
        categoriaId: data.categoriaId,
        marcaId:     data.marcaId ?? null,
        proveedorId: data.proveedorId ?? null,
        precioVenta: data.precioVenta,
        precioCosto: data.precioCosto ?? null,
        activo:      true,
      },
    });

    if (data.stockInicial && data.stockInicial > 0) {
      const sucursales = await prisma.sucursal.findMany({
        where: { empresaId, activo: true },
        select: { id: true },
      });
      if (sucursales.length > 0) {
        await prisma.inventario.create({
          data: {
            sucursalId:  sucursales[0].id,
            productoId:  producto.id,
            stockActual: data.stockInicial,
            stockMinimo: 0,
          },
        });
      }
    }

    return producto;
  }
}

export const inventarioService = new InventarioService();
