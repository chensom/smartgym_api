import { Request, Response, NextFunction } from 'express';
import { sociosService } from '../services/socios.service';
import { registrarAuditoria } from '../middlewares/auditoria.middleware';
import { ok, err, paginate } from '../types/api.types';
import { prisma } from '../lib/prisma';

export const sociosController = {

  async listar(req: Request, res: Response, next: NextFunction) {
    try {
      const { q, tipoRolId, page = '1', limit = '20' } = req.query as any;
      const { total, socios } = await sociosService.listarSocios(req.empresaId!, {
        q, tipoRolId, page: parseInt(page), limit: parseInt(limit),
      });
      res.json(ok(socios, undefined, paginate(total, parseInt(page), parseInt(limit))));
    } catch (e) { next(e); }
  },

  async obtener(req: Request, res: Response, next: NextFunction) {
    try {
      const socio = await sociosService.obtenerSocio(req.empresaId!, req.params.id);
      res.json(ok(socio));
    } catch (e) { next(e); }
  },

  async crear(req: Request, res: Response, next: NextFunction) {
    try {
      const sucursalId = req.sucursalId || req.body.sucursalId;
      if (!sucursalId) { res.status(400).json(err('sucursal_id requerido')); return; }
      const resultado = await sociosService.crearSocio(req.empresaId!, sucursalId, req.body);
      await registrarAuditoria({
        empresaId: req.empresaId!, usuarioId: req.user!.sub,
        tabla: 'personas', operacion: 'INSERT',
        registroId: resultado.persona.id, datosDespues: resultado.persona, req,
      });
      res.status(201).json(ok(resultado, 'Socio registrado correctamente'));
    } catch (e) { next(e); }
  },

  async actualizar(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const empresaId = req.empresaId!;
      const { nombres, apellidos, fechaNacimiento, genero, fotoUrl, documentos, contactos } = req.body;

      await prisma.$transaction(async (tx) => {
        const anterior = await tx.persona.findFirst({ where: { id, empresaId } });

        const actualizado = await tx.persona.update({
          where: { id },
          data: {
            ...(nombres         !== undefined && { nombres }),
            ...(apellidos       !== undefined && { apellidos }),
            ...(genero          !== undefined && { genero: genero || null }),
            ...(fotoUrl         !== undefined && { fotoUrl }),
            ...(fechaNacimiento !== undefined && {
              fechaNacimiento: fechaNacimiento ? new Date(fechaNacimiento) : null,
            }),
          },
        });

        if (documentos && Array.isArray(documentos)) {
          const idsExistentes = documentos.filter((d: any) => d.id).map((d: any) => d.id);
          await tx.personaDocumento.deleteMany({
            where: { personaId: id, ...(idsExistentes.length ? { id: { notIn: idsExistentes } } : {}) },
          });
          for (const doc of documentos) {
            if (doc.id) {
              await tx.personaDocumento.update({ where: { id: doc.id }, data: { tipo: doc.tipo, numero: doc.numero } });
            } else {
              await tx.personaDocumento.create({ data: { personaId: id, tipo: doc.tipo, numero: doc.numero } });
            }
          }
        }

        if (contactos && Array.isArray(contactos)) {
          const idsExistentes = contactos.filter((c: any) => c.id).map((c: any) => c.id);
          await tx.personaContacto.deleteMany({
            where: { personaId: id, ...(idsExistentes.length ? { id: { notIn: idsExistentes } } : {}) },
          });
          for (const cont of contactos) {
            if (cont.id) {
              await tx.personaContacto.update({ where: { id: cont.id }, data: { tipo: cont.tipo, valor: cont.valor, principal: cont.principal } });
            } else {
              await tx.personaContacto.create({ data: { personaId: id, tipo: cont.tipo, valor: cont.valor, principal: cont.principal ?? false } });
            }
          }
        }

        await registrarAuditoria({
          empresaId, usuarioId: req.user!.sub,
          tabla: 'personas', operacion: 'UPDATE',
          registroId: id, datosAntes: anterior ?? undefined, datosDespues: actualizado, req,
        });

        res.json(ok(actualizado, 'Datos actualizados correctamente'));
      });
    } catch (e) { next(e); }
  },

  async darDeBaja(req: Request, res: Response, next: NextFunction) {
    try {
      await sociosService.darDeBaja(req.empresaId!, req.params.id);
      await registrarAuditoria({
        empresaId: req.empresaId!, usuarioId: req.user!.sub,
        tabla: 'personas', operacion: 'DELETE', registroId: req.params.id, req,
      });
      res.json(ok(null, 'Socio dado de baja'));
    } catch (e) { next(e); }
  },
};
