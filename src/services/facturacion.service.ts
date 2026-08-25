import { prisma } from '../lib/prisma';

type TipoComprobante = 'FA' | 'FB' | 'FC' | 'FX' | 'NCA' | 'NCB' | 'NCC';

interface ItemFactura {
  descripcion:    string;
  cantidad:       number;
  precioUnitario: number;
  alicuotaIva:    number;
}

interface EmitirFacturaInput {
  ventaId?:        string;
  inscripcionId?:  string;
  personaId?:      string;
  sucursalId:      string;
  tipoComprobante: TipoComprobante;
  items:           ItemFactura[];
  observaciones?:  string;
}

export class FacturacionService {

  private async getPuntoVenta(sucursalId: string) {
    let pv = await prisma.puntoVenta.findFirst({ where: { sucursalId, activo: true } });
    if (!pv) {
      pv = await prisma.puntoVenta.create({
        data: { sucursalId, numero: 1, tipo: 'ELECTRONICO', activo: true },
      });
    }
    return pv;
  }

  private async getProximoNumero(puntoVentaId: string, tipo: TipoComprobante): Promise<number> {
    const ultima = await prisma.factura.findFirst({
      where:   { puntoVentaId, tipoComprobante: tipo },
      orderBy: { numero: 'desc' },
      select:  { numero: true },
    });
    return (ultima?.numero ?? 0) + 1;
  }

  private calcularTotales(items: ItemFactura[], tipo: TipoComprobante) {
    let subtotal = 0;
    let iva      = 0;
    for (const item of items) {
      const base = item.cantidad * item.precioUnitario;
      subtotal  += base;
      if (tipo === 'FA' || tipo === 'NCA') {
        iva += base * (item.alicuotaIva / 100);
      }
    }
    return { subtotal, iva, total: subtotal + iva };
  }

  async emitir(empresaId: string, usuarioId: string, input: EmitirFacturaInput) {
    const { tipoComprobante, items, sucursalId, ventaId, personaId } = input;

    if (tipoComprobante === 'FX') {
      return this.emitirPresupuesto(empresaId, input);
    }

    const pv     = await this.getPuntoVenta(sucursalId);
    const numero = await this.getProximoNumero(pv.id, tipoComprobante);
    const { subtotal, iva, total } = this.calcularTotales(items, tipoComprobante);

    // Crear en PENDIENTE
    const facturaCreada = await prisma.factura.create({
      data: {
        empresaId,
        puntoVentaId:    pv.id,
        tipoComprobante,
        numero,
        fecha:           new Date(),
        personaId:       personaId ?? null,
        ventaId:         ventaId ?? null,
        subtotal,
        iva,
        total,
        estado:          'PENDIENTE',
        detalles: {
          create: items.map(i => ({
            descripcion:    i.descripcion,
            cantidad:       i.cantidad,
            precioUnitario: i.precioUnitario,
            alicuotaIva:    i.alicuotaIva,
            subtotal:       i.cantidad * i.precioUnitario,
          })),
        },
      },
      include: { detalles: true },
    });

    // Solicitar CAE — usar SQL raw para evitar RETURNING con campos del schema viejo
    try {
      const caeResponse = await this.solicitarCAE(facturaCreada, empresaId);
      const vencimiento = new Date(caeResponse.vencimiento);

      await prisma.$executeRaw`
        UPDATE facturas
        SET cae = ${caeResponse.cae},
            cae_vencimiento = ${vencimiento}::date,
            estado = 'EMITIDA'
        WHERE id = ${facturaCreada.id}::uuid
      `;

      return {
        ...facturaCreada,
        cae:            caeResponse.cae,
        caeVencimiento: vencimiento,
        estado:         'EMITIDA',
      };

    } catch (error: any) {
      await prisma.$executeRaw`
        UPDATE facturas SET estado = 'ERROR' WHERE id = ${facturaCreada.id}::uuid
      `;
      throw new Error(`Error ARCA: ${error.message}`);
    }
  }

  async emitirPresupuesto(empresaId: string, input: EmitirFacturaInput) {
    const { items, sucursalId, ventaId, personaId } = input;
    const pv     = await this.getPuntoVenta(sucursalId);
    const numero = await this.getProximoNumero(pv.id, 'FX');
    const { subtotal, total } = this.calcularTotales(items, 'FX');

    return prisma.factura.create({
      data: {
        empresaId,
        puntoVentaId:    pv.id,
        tipoComprobante: 'FX',
        numero,
        fecha:           new Date(),
        personaId:       personaId ?? null,
        ventaId:         ventaId ?? null,
        subtotal,
        iva:             0,
        total,
        estado:          'EMITIDA',
        cae:             null,
        caeVencimiento:  null,
        detalles: {
          create: items.map(i => ({
            descripcion:    i.descripcion,
            cantidad:       i.cantidad,
            precioUnitario: i.precioUnitario,
            alicuotaIva:    0,
            subtotal:       i.cantidad * i.precioUnitario,
          })),
        },
      },
      include: { detalles: true },
    });
  }

  async emitirNotaCredito(empresaId: string, facturaOriginalId: string) {
    const original = await prisma.factura.findFirstOrThrow({
      where:   { id: facturaOriginalId, empresaId },
      include: { detalles: true, puntoVenta: true },
    });

    if (original.estado !== 'EMITIDA') throw new Error('Solo se pueden anular facturas en estado EMITIDA');
    if (original.tipoComprobante === 'FX') throw new Error('Los presupuestos no generan notas de crédito');

    const mapNC: Record<string, TipoComprobante> = { FA: 'NCA', FB: 'NCB', FC: 'NCC' };
    const tipoNC = mapNC[original.tipoComprobante];
    if (!tipoNC) throw new Error('Tipo de comprobante no admite nota de crédito');

    const pv     = await this.getPuntoVenta(original.puntoVenta.sucursalId);
    const numero = await this.getProximoNumero(pv.id, tipoNC);

    const nc = await prisma.factura.create({
      data: {
        empresaId,
        puntoVentaId:    pv.id,
        tipoComprobante: tipoNC,
        numero,
        fecha:           new Date(),
        personaId:       original.personaId,
        subtotal:        original.subtotal,
        iva:             original.iva,
        total:           original.total,
        estado:          'PENDIENTE',
        detalles: {
          create: original.detalles.map(d => ({
            descripcion:    `NC: ${d.descripcion}`,
            cantidad:       Number(d.cantidad),
            precioUnitario: Number(d.precioUnitario),
            alicuotaIva:    Number(d.alicuotaIva),
            subtotal:       Number(d.subtotal),
          })),
        },
      },
      include: { detalles: true },
    });

    try {
      const caeResponse = await this.solicitarCAE(nc, empresaId);
      const vencimiento = new Date(caeResponse.vencimiento);

      await prisma.$executeRaw`
        UPDATE facturas
        SET cae = ${caeResponse.cae}, cae_vencimiento = ${vencimiento}::date, estado = 'EMITIDA'
        WHERE id = ${nc.id}::uuid
      `;

      await prisma.$executeRaw`
        UPDATE facturas SET estado = 'ANULADA' WHERE id = ${facturaOriginalId}::uuid
      `;

      return { ...nc, cae: caeResponse.cae, caeVencimiento: vencimiento, estado: 'EMITIDA' };

    } catch (error: any) {
      await prisma.$executeRaw`UPDATE facturas SET estado = 'ERROR' WHERE id = ${nc.id}::uuid`;
      throw new Error(`Error ARCA al emitir NC: ${error.message}`);
    }
  }

  private async solicitarCAE(factura: any, empresaId: string): Promise<{ cae: string; vencimiento: string }> {
    if (process.env.NODE_ENV === 'development' || process.env.ARCA_MODO === 'simulacion') {
      const caeSimulado = `${Date.now()}`.slice(0, 14).padEnd(14, '0');
      const vencimiento = new Date();
      vencimiento.setDate(vencimiento.getDate() + 10);
      return { cae: caeSimulado, vencimiento: vencimiento.toISOString().split('T')[0] };
    }
    throw new Error('ARCA en producción no configurado. Definir ARCA_CERT y ARCA_KEY en .env');
  }

  async reintentar(empresaId: string, facturaId: string) {
    const factura = await prisma.factura.findFirstOrThrow({
      where:   { id: facturaId, empresaId, estado: 'ERROR' },
      include: { detalles: true },
    });
    if (factura.tipoComprobante === 'FX') throw new Error('Los presupuestos no requieren reintento ARCA');

    const caeResponse = await this.solicitarCAE(factura, empresaId);
    const vencimiento = new Date(caeResponse.vencimiento);

    await prisma.$executeRaw`
      UPDATE facturas
      SET cae = ${caeResponse.cae}, cae_vencimiento = ${vencimiento}::date, estado = 'EMITIDA'
      WHERE id = ${facturaId}::uuid
    `;

    return { ...factura, cae: caeResponse.cae, caeVencimiento: vencimiento, estado: 'EMITIDA' };
  }

  async listar(empresaId: string, opts: {
    tipo?: string; estado?: string; personaId?: string;
    desde?: Date; hasta?: Date; page: number; limit: number;
  }) {
    const { tipo, estado, personaId, desde, hasta, page, limit } = opts;
    const skip  = (page - 1) * limit;
    const where: any = { empresaId };
    if (tipo)      where.tipoComprobante = tipo;
    if (estado)    where.estado          = estado;
    if (personaId) where.personaId       = personaId;
    if (desde || hasta) {
      where.fecha = {};
      if (desde) where.fecha.gte = desde;
      if (hasta) where.fecha.lte = hasta;
    }

    const [total, facturas] = await prisma.$transaction([
      prisma.factura.count({ where }),
      prisma.factura.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fecha: 'desc' },
        include: {
          persona:    { select: { nombres: true, apellidos: true } },
          puntoVenta: { select: { numero: true } },
        },
      }),
    ]);

    return { total, facturas };
  }

  async obtener(empresaId: string, facturaId: string) {
    return prisma.factura.findFirstOrThrow({
      where:   { id: facturaId, empresaId },
      include: {
        detalles:   true,
        persona:    { select: { nombres: true, apellidos: true } },
        puntoVenta: { select: { numero: true, tipo: true } },
        venta:      { select: { id: true, total: true, estado: true } },
      },
    });
  }

  async resumen(empresaId: string, opts: { desde: Date; hasta: Date; sucursalId?: string }) {
    const { desde, hasta } = opts;
    const facturas = await prisma.factura.findMany({
      where: { empresaId, estado: 'EMITIDA', fecha: { gte: desde, lte: hasta } },
    });
    const porTipo = facturas.reduce((acc: any, f) => {
      const t = f.tipoComprobante;
      if (!acc[t]) acc[t] = { cantidad: 0, total: 0 };
      acc[t].cantidad++;
      acc[t].total += Number(f.total);
      return acc;
    }, {});
    return {
      desde, hasta,
      totalFacturas: facturas.length,
      totalMonto:    facturas.reduce((s, f) => s + Number(f.total), 0),
      porTipo,
    };
  }
}

export const facturacionService = new FacturacionService();
