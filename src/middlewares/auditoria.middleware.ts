import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

type Operacion = 'INSERT' | 'UPDATE' | 'DELETE' | 'SELECT';

export async function registrarAuditoria(opts: {
  empresaId:    string;
  usuarioId?:   string;
  tabla:        string;
  operacion:    Operacion;
  registroId:   string;
  datosAntes?:  object;
  datosDespues?: object;
  req?:         Request;
}): Promise<void> {
  try {
    await prisma.auditoria.create({
      data: {
        empresaId:    opts.empresaId,
        usuarioId:    opts.usuarioId ?? null,
        tabla:        opts.tabla,
        operacion:    opts.operacion,
        registroId:   opts.registroId,
        datosAntes:   opts.datosAntes   ?? undefined,
        datosDespues: opts.datosDespues ?? undefined,
        ip:           opts.req?.ip      ?? null,
        userAgent:    opts.req?.headers['user-agent'] ?? null,
      },
    });
  } catch (e) {
    // La auditoría nunca debe romper el flujo principal
    logger.error('Error al registrar auditoría', { error: e, opts });
  }
}
