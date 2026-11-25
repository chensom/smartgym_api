// Prueba de aislamiento entre gimnasios (multi-tenant) contra una base de PRUEBA.
// Un admin del gimnasio B intenta tocar datos del gimnasio A por id: tiene que
// recibir 404 y los datos de A tienen que quedar intactos. Además, el admin de A
// sobre sus propios datos sigue funcionando (control positivo).
// NUNCA correr contra producción: borra y recrea los datos.
// Corre en un schema aparte de la base local (no toca el schema public):
//   DATABASE_URL="postgresql://.../smartgym?schema=aislamiento_test" npx prisma db push --skip-generate
//   DATABASE_URL="postgresql://.../smartgym?schema=aislamiento_test" npx ts-node --transpile-only test-local/aislamiento-gimnasios.test.ts
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';

if (!/sg_aislamiento|sg_resumen|test|prueba/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Esta prueba solo corre contra una base de prueba (sg_aislamiento / sg_resumen)');
}
process.env.RATE_LIMIT_MAX = '10000';

const PERMISOS = ['configuracion.editar', 'socios.ver', 'socios.editar', 'inventario.ver', 'inventario.ajustar',
                  'rutinas.ver', 'rutinas.editar', 'ventas.crear'];

async function main() {
  const { prisma } = await import('../src/lib/prisma');
  const { env }    = await import('../src/config/env');
  const app        = (await import('../src/app')).default;

  // ── Datos ──────────────────────────────────────────────────────────────
  const tablas = ['socio_rutinas', 'rutina_ejercicios', 'rutinas', 'ejercicios', 'inscripciones_clase', 'horarios_clase',
    'disciplinas', 'movimientos_stock', 'inventario', 'venta_detalles', 'ventas', 'productos', 'proveedores', 'marcas',
    'categorias_producto', 'persona_documentos', 'persona_contactos', 'persona_roles', 'tipo_roles_persona', 'usuario_roles',
    'rol_permisos', 'permisos', 'usuarios', 'roles', 'personas', 'medios_pago', 'sucursales', 'empresas'];
  // Seguro extra: nunca truncar el schema public (puede ser la base de desarrollo)
  const [{ esquema }]: { esquema: string }[] = await prisma.$queryRawUnsafe(`SELECT current_schema() AS esquema`);
  if (esquema === 'public') throw new Error('La prueba no corre sobre el schema public: usá ?schema=aislamiento_test');
  const existentes: { tablename: string }[] = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`);
  const nombres = new Set(existentes.map(t => t.tablename));
  await prisma.$executeRawUnsafe(`TRUNCATE ${tablas.filter(t => nombres.has(t)).join(', ')} CASCADE`);

  const permisos = await Promise.all(PERMISOS.map(codigo =>
    prisma.permiso.create({ data: { codigo, modulo: codigo.split('.')[0] } })));

  async function gimnasio(nombre: string, i: number) {
    const emp  = await prisma.empresa.create({ data: { nombre, slug: `gym${i}`, cuit: `30-0000000${i}-0`, razonSocial: nombre } });
    const suc  = await prisma.sucursal.create({ data: { empresaId: emp.id, nombre: 'Central' } });
    const tipo = await prisma.tipoRolPersona.create({ data: { empresaId: emp.id, nombre: 'SOCIO' } });
    const tipo2 = await prisma.tipoRolPersona.create({ data: { empresaId: emp.id, nombre: 'PROFESOR' } });
    const medio = await prisma.medioPago.create({ data: { empresaId: emp.id, nombre: 'Efectivo', tipo: 'EFECTIVO' } });
    const marca = await prisma.marca.create({ data: { empresaId: emp.id, nombre: 'Marca' } });
    const cat   = await prisma.categoriaProducto.create({ data: { empresaId: emp.id, nombre: 'Bebidas' } });
    const prov  = await prisma.proveedor.create({ data: { empresaId: emp.id, nombre: 'Proveedor' } });
    const prod  = await prisma.producto.create({ data: { empresaId: emp.id, categoriaId: cat.id, nombre: 'Agua', precioVenta: 1000 } });
    const persona = await prisma.persona.create({ data: { empresaId: emp.id, nombres: 'Socio', apellidos: nombre } });
    const contacto = await prisma.personaContacto.create({ data: { personaId: persona.id, tipo: 'EMAIL', valor: `socio@${i}.test` } });
    const pr    = await prisma.personaRol.create({ data: { personaId: persona.id, tipoRolId: tipo.id, fechaAlta: new Date('2026-01-01') } });
    const disc  = await prisma.disciplina.create({ data: { empresaId: emp.id, nombre: 'Funcional' } });
    const hor   = await prisma.horarioClase.create({ data: { empresaId: emp.id, disciplinaId: disc.id, sucursalId: suc.id, diaSemana: 1,
      horaInicio: new Date('1970-01-01T08:00:00Z'), horaFin: new Date('1970-01-01T09:00:00Z') } });
    await prisma.inscripcionClase.create({ data: { horarioId: hor.id, personaRolId: pr.id, activo: true } });
    const ej    = await prisma.ejercicio.create({ data: { empresaId: emp.id, nombre: 'Sentadilla' } });
    const rut   = await prisma.rutina.create({ data: { empresaId: emp.id, nombre: 'Rutina', activo: true } });
    const item  = await prisma.rutinaEjercicio.create({ data: { rutinaId: rut.id, ejercicioId: ej.id, diaNumero: 1, orden: 1, series: 3, repeticiones: '10' } });
    const asig  = await prisma.socioRutina.create({ data: { personaRolId: pr.id, rutinaId: rut.id, fechaInicio: new Date('2026-01-01'), activo: true } });

    const rol = await prisma.rol.create({ data: { empresaId: emp.id, nombre: 'Administrador' } });
    await prisma.rolPermiso.createMany({ data: permisos.map(p => ({ rolId: rol.id, permisoId: p.id })) });
    const admin = await prisma.usuario.create({ data: { empresaId: emp.id, email: `admin@gym${i}.test`, passwordHash: 'x' } });
    await prisma.usuarioRol.create({ data: { usuarioId: admin.id, rolId: rol.id, fechaDesde: new Date('2026-01-01') } });
    const token = jwt.sign({ sub: admin.id, empresaId: emp.id, email: admin.email }, env.JWT_SECRET, { expiresIn: '10m' });

    return { emp, suc, tipo, tipo2, medio, marca, cat, prov, prod, persona, contacto, pr, disc, hor, ej, rut, item, asig, token };
  }

  const A = await gimnasio('Gimnasio A', 1);
  const B = await gimnasio('Gimnasio B', 2);

  // ── Servidor en un puerto libre ─────────────────────────────────────────
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const api = async (token: string, method: string, path: string, body?: any) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };

  let ok = 0;
  const fallas: string[] = [];
  const caso = async (nombre: string, fn: () => Promise<void>) => {
    try { await fn(); ok++; console.log('  OK ', nombre); }
    catch (e: any) { fallas.push(nombre); console.log('  MAL', nombre, '->', e.message); }
  };
  // B intenta X sobre datos de A: 404
  const ajeno = (nombre: string, method: string, path: string, body?: any) =>
    caso(`B -> A ${method} ${nombre}: 404`, async () => {
      const r = await api(B.token, method, path, body);
      assert.equal(r.status, 404, `esperaba 404, vino ${r.status} ${JSON.stringify(r.body)}`);
    });

  console.log('\nAdmin del gimnasio B contra datos del gimnasio A:');
  await ajeno('/medios-pago/:id',               'PATCH',  `/medios-pago/${A.medio.id}`, { nombre: 'HACKEADO' });
  await ajeno('/marcas/:id',                    'PATCH',  `/marcas/${A.marca.id}`, { nombre: 'HACKEADO' });
  await ajeno('/categorias/:id',                'PATCH',  `/categorias/${A.cat.id}`, { nombre: 'HACKEADO' });
  await ajeno('/uploads/persona/:id',           'POST',   `/uploads/persona/${A.persona.id}`);
  await ajeno('/uploads/persona/:id',           'DELETE', `/uploads/persona/${A.persona.id}`);
  await ajeno('/uploads/producto/:id',          'POST',   `/uploads/producto/${A.prod.id}`);
  await ajeno('/uploads/producto/:id',          'DELETE', `/uploads/producto/${A.prod.id}`);
  await ajeno('/uploads/ejercicio/:id',         'POST',   `/uploads/ejercicio/${A.ej.id}`);
  await ajeno('/uploads/ejercicio/:id',         'DELETE', `/uploads/ejercicio/${A.ej.id}`);
  await ajeno('/proveedores/:id',               'PATCH',  `/proveedores/${A.prov.id}`, { nombre: 'HACKEADO' });
  await ajeno('/proveedores/:id',               'DELETE', `/proveedores/${A.prov.id}`);
  await ajeno('/horarios/:id',                  'PATCH',  `/horarios/${A.hor.id}`, { cupoMax: 1 });
  await ajeno('/horarios/:id',                  'DELETE', `/horarios/${A.hor.id}`);
  await ajeno('/horarios/:id/inscribir (horario ajeno)', 'POST', `/horarios/${A.hor.id}/inscribir`, { personaRolId: B.pr.id });
  await ajeno('/horarios/:id/inscribir (socio ajeno)',   'POST', `/horarios/${B.hor.id}/inscribir`, { personaRolId: A.pr.id });
  await ajeno('/horarios/:id/inscribir/:pr',    'DELETE', `/horarios/${A.hor.id}/inscribir/${A.pr.id}`);
  await ajeno('/horarios (sucursal ajena)',     'POST',   `/horarios`, { disciplinaId: B.disc.id, sucursalId: A.suc.id, diaSemana: 2, horaInicio: '10:00', horaFin: '11:00' });
  await ajeno('/horarios/:id propio con disciplina ajena', 'PATCH', `/horarios/${B.hor.id}`, { disciplinaId: A.disc.id });
  await ajeno('/socios/:id',                    'PATCH',  `/socios/${A.persona.id}`, { nombres: 'HACKEADO' });
  await ajeno('/socios/:id/rol',                'PATCH',  `/socios/${A.persona.id}/rol`, { tipoRolId: B.tipo2.id });
  await ajeno('/inventario/productos/:id',      'PATCH',  `/inventario/productos/${A.prod.id}`, { precioVenta: 1 });
  await ajeno('/inventario/productos/:id propio con categoría ajena', 'PATCH', `/inventario/productos/${B.prod.id}`, { categoriaId: A.cat.id });
  await ajeno('/inventario/productos con marca ajena', 'POST', `/inventario/productos`, { nombre: 'X', categoriaId: B.cat.id, marcaId: A.marca.id, precioVenta: 10 });
  await ajeno('/inventario/movimientos',        'POST',   `/inventario/movimientos`, { sucursalId: A.suc.id, productoId: A.prod.id, tipo: 'AJUSTE', cantidad: -50 });
  await ajeno('/ventas (producto y sucursal ajenos)', 'POST', `/ventas`, {
    sucursalId: A.suc.id, detalles: [{ productoId: A.prod.id, descripcion: 'Agua', cantidad: 1, precioUnitario: 1000 }] });
  await ajeno('/ventas (medio de pago ajeno)',  'POST',   `/ventas`, {
    sucursalId: B.suc.id, detalles: [{ productoId: B.prod.id, descripcion: 'Agua', cantidad: 1, precioUnitario: 1000 }],
    pago: { medioPagoId: A.medio.id } });
  await ajeno('/rutinas/:id/ejercicios/:item (item ajeno)', 'PATCH',  `/rutinas/${B.rut.id}/ejercicios/${A.item.id}`, { series: 99 });
  await ajeno('/rutinas/:id/ejercicios/:item (item ajeno)', 'DELETE', `/rutinas/${B.rut.id}/ejercicios/${A.item.id}`);
  await ajeno('/rutinas/:id/ejercicios (ejercicio ajeno)',  'POST',   `/rutinas/${B.rut.id}/ejercicios`, { ejercicioId: A.ej.id, diaNumero: 2, series: 3, repeticiones: '10' });
  await ajeno('/rutinas/:id/asignar (socio ajeno)',         'POST',   `/rutinas/${B.rut.id}/asignar`, { personaRolId: A.pr.id, fechaInicio: '2026-11-01' });
  await ajeno('/rutinas/asignaciones/:id',      'DELETE', `/rutinas/asignaciones/${A.asig.id}`);

  await caso('B -> A GET /rutinas/socio/:pr no devuelve la rutina de A', async () => {
    const r = await api(B.token, 'GET', `/rutinas/socio/${A.pr.id}`);
    assert.equal(r.status, 200); assert.equal(r.body.data, null);
  });
  await caso('B -> A GET /horarios/socio/:pr no devuelve horarios de A', async () => {
    const r = await api(B.token, 'GET', `/horarios/socio/${A.pr.id}`);
    assert.equal(r.status, 200); assert.deepEqual(r.body.data, []);
  });

  console.log('\nLos datos de A quedaron intactos:');
  await caso('nombres de medio, marca, categoría, proveedor y socio sin cambios', async () => {
    assert.equal((await prisma.medioPago.findUniqueOrThrow({ where: { id: A.medio.id } })).nombre, 'Efectivo');
    assert.equal((await prisma.marca.findUniqueOrThrow({ where: { id: A.marca.id } })).nombre, 'Marca');
    assert.equal((await prisma.categoriaProducto.findUniqueOrThrow({ where: { id: A.cat.id } })).nombre, 'Bebidas');
    const prov = await prisma.proveedor.findUniqueOrThrow({ where: { id: A.prov.id } });
    assert.equal(prov.nombre, 'Proveedor'); assert.equal(prov.deletedAt, null);
    assert.equal((await prisma.persona.findUniqueOrThrow({ where: { id: A.persona.id } })).nombres, 'Socio');
    assert.equal((await prisma.personaRol.findUniqueOrThrow({ where: { id: A.pr.id } })).tipoRolId, A.tipo.id);
  });
  await caso('horario, inscripción, producto, stock, rutina y asignación de A sin cambios', async () => {
    const hor = await prisma.horarioClase.findUniqueOrThrow({ where: { id: A.hor.id } });
    assert.equal(hor.activo, true); assert.equal(hor.cupoMax, null);
    assert.equal(await prisma.inscripcionClase.count({ where: { horarioId: A.hor.id, activo: true } }), 1);
    assert.equal(Number((await prisma.producto.findUniqueOrThrow({ where: { id: A.prod.id } })).precioVenta), 1000);
    assert.equal(await prisma.movimientoStock.count({ where: { sucursalId: A.suc.id } }), 0);
    assert.equal(await prisma.venta.count({ where: { sucursalId: A.suc.id } }), 0);
    assert.equal((await prisma.rutinaEjercicio.findUniqueOrThrow({ where: { id: A.item.id } })).series, 3);
    assert.equal((await prisma.socioRutina.findUniqueOrThrow({ where: { id: A.asig.id } })).activo, true);
  });

  console.log('\nControl positivo: el admin de A sobre lo suyo sigue andando:');
  const propio = (nombre: string, esperado: number, method: string, path: string, body?: any) =>
    caso(`A -> A ${method} ${nombre}: ${esperado}`, async () => {
      const r = await api(A.token, method, path, body);
      assert.equal(r.status, esperado, `esperaba ${esperado}, vino ${r.status} ${JSON.stringify(r.body)}`);
    });
  await propio('/medios-pago/:id', 200, 'PATCH', `/medios-pago/${A.medio.id}`, { nombre: 'Efectivo caja' });
  await propio('/marcas/:id',      200, 'PATCH', `/marcas/${A.marca.id}`, { nombre: 'Marca 2' });
  await propio('/categorias/:id',  200, 'PATCH', `/categorias/${A.cat.id}`, { nombre: 'Bebidas 2' });
  await propio('/uploads/persona/:id sin archivo (pasa el chequeo, 400 por falta de archivo)', 400, 'POST', `/uploads/persona/${A.persona.id}`);
  await propio('/uploads/persona/:id', 200, 'DELETE', `/uploads/persona/${A.persona.id}`);
  await propio('/proveedores/:id', 200, 'PATCH', `/proveedores/${A.prov.id}`, { nombre: 'Proveedor 2' });
  await propio('/horarios/:id',    200, 'PATCH', `/horarios/${A.hor.id}`, { cupoMax: 20, disciplinaId: A.disc.id });
  await propio('/socios/:id',      200, 'PATCH', `/socios/${A.persona.id}`, { nombres: 'Socio 2', contactos: [{ id: A.contacto.id, tipo: 'EMAIL', valor: 'nuevo@1.test' }] });
  await propio('/socios/:id/rol',  200, 'PATCH', `/socios/${A.persona.id}/rol`, { tipoRolId: A.tipo2.id });
  await propio('/inventario/productos/:id', 200, 'PATCH', `/inventario/productos/${A.prod.id}`, { precioVenta: 1200, marcaId: A.marca.id });
  await propio('/inventario/movimientos', 201, 'POST', `/inventario/movimientos`, { sucursalId: A.suc.id, productoId: A.prod.id, tipo: 'ENTRADA', cantidad: 10 });
  await propio('/rutinas/:id/ejercicios/:item', 200, 'PATCH', `/rutinas/${A.rut.id}/ejercicios/${A.item.id}`, { series: 4 });
  await propio('/rutinas/:id/asignar', 201, 'POST', `/rutinas/${A.rut.id}/asignar`, { personaRolId: A.pr.id, fechaInicio: '2026-11-01' });
  await caso('A -> A el contacto propio se actualizó y el de B no se tocó', async () => {
    // (el schema de zod no deja pasar `id` en contactos: el PATCH reemplaza la lista entera)
    const deA = await prisma.personaContacto.findMany({ where: { personaId: A.persona.id } });
    assert.deepEqual(deA.map(c => c.valor), ['nuevo@1.test']);
    assert.equal((await prisma.personaContacto.findUniqueOrThrow({ where: { id: B.contacto.id } })).valor, 'socio@2.test');
  });
  await caso('A -> A PATCH /socios/:id con id de contacto de B no lo toca', async () => {
    const r = await api(A.token, 'PATCH', `/socios/${A.persona.id}`, { contactos: [{ id: B.contacto.id, tipo: 'EMAIL', valor: 'pisado@x.test' }] });
    assert.equal(r.status, 200);
    assert.equal((await prisma.personaContacto.findUniqueOrThrow({ where: { id: B.contacto.id } })).valor, 'socio@2.test');
  });

  server.close();
  await prisma.$disconnect();
  console.log(`\n${ok} casos OK, ${fallas.length} fallaron${fallas.length ? ': ' + fallas.join(' | ') : ''}`);
  if (fallas.length) process.exit(1);
}

main().catch(async e => { console.error(e); process.exit(1); });
