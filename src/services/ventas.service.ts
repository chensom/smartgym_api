import { prisma } from '../lib/prisma';
import { CrearVentaInput } from '../schemas/ventas.schema';

export class VentasService {

  async crear(empresaId: string, usuarioId: string, input: CrearVentaInput) {
    return prisma.$transaction(async (tx) => {

      // 1. Calcular totales
      let subtotal = 0;
      const itemsCalculados = input.detalles.map(d => {
        const itemSubtotal = (d.cantidad * d.precioUnitario) - (d.descuento ?? 0);
        subtotal += itemSubtotal;
        return { ...d, subtotal: itemSubtotal };
      });

      const descuentoTotal = input.descuento ?? 0;
      const total = subtotal - descuentoTotal;

      // 2. Verificar stock ANTES de crear la venta
      for (const d of itemsCalculados) {
        if (!d.productoId) continue;

        const inv = await tx.inventario.findFirst({
          where: {
            sucursalId: input.sucursalId,
            productoId: d.productoId,
            varianteId: d.varianteId ?? null,
            stockMinimo: { gt: 0 },  // tomar la fila "real" con stock_minimo definido
          },
        });

        // Si no encuentra con stockMinimo > 0, tomar cualquiera con stock
        const invFinal = inv ?? await tx.inventario.findFirst({
          where: {
            sucursalId: input.sucursalId,
            productoId: d.productoId,
            varianteId: d.varianteId ?? null,
          },
          orderBy: { stockActual: 'desc' },
        });

        if (!invFinal || Number(invFinal.stockActual) < d.cantidad) {
          throw new Error(`Stock insuficiente para: ${d.descripcion}`);
        }
      }

      // 3. Crear cabecera de venta
      const venta = await tx.venta.create({
        data: {
          empresaId,
          sucursalId: input.sucursalId,
          personaId:  input.personaId ?? null,
          usuarioId,
          subtotal,
          descuento:  descuentoTotal,
          total,
          estado:     'PENDIENTE',
          detalles: {
            create: itemsCalculados.map(d => ({
              productoId:     d.productoId ?? null,
              varianteId:     d.varianteId ?? null,
              descripcion:    d.descripcion,
              cantidad:       d.cantidad,
              precioUnitario: d.precioUnitario,
              descuento:      d.descuento ?? 0,
              subtotal:       d.subtotal,
            })),
          },
        },
        include: {
          detalles: true,
          persona:  { select: { nombres: true, apellidos: true } },
        },
      });

      // 4. Registrar movimientos de salida — el TRIGGER actualiza inventario
      for (const d of itemsCalculados) {
        if (!d.productoId) continue;

        await tx.movimientoStock.create({
          data: {
            sucursalId:   input.sucursalId,
            productoId:   d.productoId,
            varianteId:   d.varianteId ?? null,
            tipo:         'SALIDA',
            cantidad:     -d.cantidad,
            motivo:       `Venta ${venta.id}`,
            referenciaId: venta.id,
            usuarioId,
          },
        });
      }

      // 5. Registrar pago si viene en el body
      if (input.pago) {
        await tx.pago.create({
          data: {
            ventaId:           venta.id,
            medioPagoId:       input.pago.medioPagoId,
            monto:             total,
            estado:            'APROBADO',
            referenciaExterna: input.pago.referenciaExterna ?? null,
            usuarioId,
          },
        });

        await tx.venta.update({
          where: { id: venta.id },
          data:  { estado: 'COMPLETADA' },
        });
      }

      return { ...venta, estado: input.pago ? 'COMPLETADA' : 'PENDIENTE' };
    });
  }

  async listar(empresaId: string, opts: {
    sucursalId?: string;
    personaId?:  string;
    estado?:     string;
    desde?:      Date;
    hasta?:      Date;
    page:        number;
    limit:       number;
  }) {
    const { sucursalId, personaId, estado, desde, hasta, page, limit } = opts;
    const skip = (page - 1) * limit;

    const where: any = { empresaId };
    if (sucursalId) where.sucursalId = sucursalId;
    if (personaId)  where.personaId  = personaId;
    if (estado)     where.estado     = estado;
    if (desde || hasta) {
      where.fecha = {};
      if (desde) where.fecha.gte = desde;
      if (hasta) where.fecha.lte = hasta;
    }

    const [total, ventas] = await prisma.$transaction([
      prisma.venta.count({ where }),
      prisma.venta.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fecha: 'desc' },
        include: {
          sucursal: { select: { nombre: true } },
          persona:  { select: { nombres: true, apellidos: true } },
          detalles: true,
          pagos:    { select: { monto: true, estado: true, medioPagoId: true } },
        },
      }),
    ]);

    return { total, ventas };
  }

  async obtener(empresaId: string, ventaId: string) {
    return prisma.venta.findFirstOrThrow({
      where:   { id: ventaId, empresaId },
      include: {
        sucursal: { select: { nombre: true } },
        persona:  { select: { nombres: true, apellidos: true } },
        usuario:  { select: { email: true } },
        detalles: {
          include: {
            producto: { select: { nombre: true, codigo: true } },
            variante: { select: { nombre: true, valor: true } },
          },
        },
        pagos: {
          include: { medioPago: { select: { nombre: true, tipo: true } } },
        },
        factura: { select: { id: true, tipoComprobante: true, numero: true, cae: true, estado: true } },
      },
    });
  }

  async anular(empresaId: string, ventaId: string, usuarioId: string) {
    return prisma.$transaction(async (tx) => {
      const venta = await tx.venta.findFirstOrThrow({
        where:   { id: ventaId, empresaId },
        include: { detalles: true },
      });

      if (venta.estado === 'CANCELADA') {
        throw new Error('La venta ya está cancelada');
      }

      // Devolver stock via movimiento — el trigger actualiza inventario
      for (const d of venta.detalles) {
        if (!d.productoId) continue;

        await tx.movimientoStock.create({
          data: {
            sucursalId:   venta.sucursalId,
            productoId:   d.productoId,
            varianteId:   d.varianteId ?? null,
            tipo:         'DEVOLUCION',
            cantidad:     Number(d.cantidad),  // positivo = devuelve al stock
            motivo:       `Anulación venta ${ventaId}`,
            referenciaId: ventaId,
            usuarioId,
          },
        });
      }

      return tx.venta.update({
        where: { id: ventaId },
        data:  { estado: 'CANCELADA' },
      });
    });
  }

  async resumenDiario(empresaId: string, sucursalId?: string) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const where: any = {
      empresaId,
      fecha:  { gte: hoy },
      estado: 'COMPLETADA',
    };
    if (sucursalId) where.sucursalId = sucursalId;

    const ventas = await prisma.venta.findMany({
      where,
      include: { pagos: { include: { medioPago: true } } },
    });

    const totalVentas  = ventas.length;
    const totalMonto   = ventas.reduce((sum, v) => sum + Number(v.total), 0);
    const porMedioPago = ventas
      .flatMap(v => v.pagos)
      .reduce((acc: any, p) => {
        const nombre = p.medioPago?.nombre ?? 'Sin medio';
        acc[nombre] = (acc[nombre] ?? 0) + Number(p.monto);
        return acc;
      }, {});

    return { fecha: hoy, totalVentas, totalMonto, porMedioPago };
  }
}

export const ventasService = new VentasService();
