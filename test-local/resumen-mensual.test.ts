// Prueba del resumen mensual contra una base de PRUEBA con datos simulados.
// NUNCA correr contra producción: borra y recrea los datos de los gimnasios de prueba.
//   DATABASE_URL=postgresql://.../sg_resumen npx ts-node --transpile-only test-local/resumen-mensual.test.ts
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma';
import { calcularResumen } from '../src/services/resumenMensual.service';
import { armarHtmlResumen } from '../src/services/resumenMail';
import { procesarResumenes, destinatariosDe, datosGimnasio, MAX_INTENTOS } from '../src/jobs/resumen.job';

if (!/sg_resumen|test|prueba/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Esta prueba solo corre contra una base de prueba (sg_resumen)');
}

const d   = (s: string) => new Date(`${s}T00:00:00Z`);          // campo @db.Date
const ar  = (s: string) => new Date(`${s}-03:00`);              // instante en hora argentina
let ok = 0;
const caso = async (nombre: string, fn: () => Promise<void> | void) => { await fn(); ok++; console.log('  ✓', nombre); };

async function limpiar() {
  const t = ['resumenes_enviados', 'pagos', 'asistencias', 'inscripciones', 'persona_contactos', 'persona_roles',
             'usuario_roles', 'usuarios', 'roles', 'personas', 'tipo_roles_persona', 'planes', 'medios_pago',
             'sucursales', 'empresas'];
  await prisma.$executeRawUnsafe(`TRUNCATE ${t.join(', ')} CASCADE`);
}

async function gimnasio(nombre: string, slug: string, i: number) {
  const emp = await prisma.empresa.create({ data: {
    nombre, slug, cuit: `30-0000000${i}-0`, razonSocial: nombre, nombreComercial: nombre,
    colorPrimario: '#0F766E', logoUrl: 'https://res.cloudinary.com/demo/logo.png',
  } });
  const suc   = await prisma.sucursal.create({ data: { empresaId: emp.id, nombre: 'Central' } });
  const tipo  = await prisma.tipoRolPersona.create({ data: { empresaId: emp.id, nombre: 'SOCIO' } });
  const plan  = await prisma.plan.create({ data: { empresaId: emp.id, nombre: 'Mensual', precio: 30000, duracionDias: 30, tipo: 'MENSUAL' } });
  const efec  = await prisma.medioPago.create({ data: { empresaId: emp.id, nombre: 'Efectivo', tipo: 'EFECTIVO' } });
  const trans = await prisma.medioPago.create({ data: { empresaId: emp.id, nombre: 'Transferencia', tipo: 'TRANSFERENCIA' } });
  const rolAdmin = await prisma.rol.create({ data: { empresaId: emp.id, nombre: 'Administrador' } });
  const rolRecep = await prisma.rol.create({ data: { empresaId: emp.id, nombre: 'Recepción' } });
  return { emp, suc, tipo, plan, efec, trans, rolAdmin, rolRecep };
}

async function main() {
  await limpiar();
  const A = await gimnasio('Atlas Prueba', 'atlas', 1);
  const B = await gimnasio('Otro Gym', 'otro', 2);
  const C = await gimnasio('Sin Admins', 'sinadmins', 3);

  // Un usuario cajero para los pagos
  const cajero = await prisma.usuario.create({ data: { empresaId: A.emp.id, email: 'cajero@atlas.test', passwordHash: 'x' } });

  async function usuario(g: typeof A, email: string, rol: string, extra: { activo?: boolean; hasta?: string } = {}) {
    const u = await prisma.usuario.create({ data: { empresaId: g.emp.id, email, passwordHash: 'x', activo: extra.activo ?? true } });
    await prisma.usuarioRol.create({ data: {
      usuarioId: u.id, rolId: rol === 'admin' ? g.rolAdmin.id : g.rolRecep.id, fechaDesde: d('2026-01-01'),
      fechaHasta: extra.hasta ? d(extra.hasta) : null,
    } });
  }
  await usuario(A, 'Duenio@Atlas.test', 'admin');
  await usuario(A, 'inactivo@atlas.test', 'admin', { activo: false });
  await usuario(A, 'exadmin@atlas.test', 'admin', { hasta: '2026-10-01' });
  await usuario(A, 'recepcion@atlas.test', 'recep');
  await usuario(B, 'duenio@otro.test', 'admin');

  async function socio(g: typeof A, nombre: string, ins: { ini: string; fin: string; estado?: string } | null,
                       extra: { alta?: string; borrado?: boolean; tel?: string } = {}) {
    const p = await prisma.persona.create({ data: {
      empresaId: g.emp.id, nombres: nombre, apellidos: 'Prueba', deletedAt: extra.borrado ? new Date() : null,
    } });
    if (extra.tel) await prisma.personaContacto.create({ data: { personaId: p.id, tipo: 'CEL', valor: extra.tel, principal: true } });
    const pr = await prisma.personaRol.create({ data: { personaId: p.id, tipoRolId: g.tipo.id, sucursalId: g.suc.id, fechaAlta: d(extra.alta ?? '2026-01-01') } });
    const i = ins ? await prisma.inscripcion.create({ data: {
      personaRolId: pr.id, planId: g.plan.id, sucursalId: g.suc.id, fechaInicio: d(ins.ini), fechaFin: d(ins.fin),
      precioPagado: 30000, estado: ins.estado ?? 'ACTIVA',
    } }) : null;
    return { p, pr, i };
  }
  const ingreso = (g: typeof A, s: { pr: { id: string }; i: { id: string } | null }, cuando: string, soloInscripcion = false) =>
    prisma.asistencia.create({ data: {
      sucursalId: g.suc.id, fechaHoraIngreso: ar(cuando),
      personaRolId: soloInscripcion ? null : s.pr.id, inscripcionId: s.i?.id ?? null,
    } });
  const pago = (medio: { id: string }, monto: number, cuando: string, insId: string | null, estado = 'APROBADO') =>
    prisma.pago.create({ data: { medioPagoId: medio.id, monto, fecha: ar(cuando), inscripcionId: insId, estado, usuarioId: cajero.id } });

  // ── Gimnasio A ──────────────────────────────────────────────────────────────
  const ana   = await socio(A, 'Ana',   { ini: '2026-11-21', fin: '2026-12-20' });
  const beto  = await socio(A, 'Beto',  { ini: '2026-11-16', fin: '2026-12-15' }, { tel: '351-555-0101' });
  const carla = await socio(A, 'Carla', { ini: '2026-10-11', fin: '2026-11-10' });
  const dario = await socio(A, 'Dario', { ini: '2026-09-06', fin: '2026-10-05' });
  const eva   = await socio(A, 'Eva',   { ini: '2026-12-01', fin: '2026-12-31' });
  const fede  = await socio(A, 'Fede',  { ini: '2026-11-15', fin: '2026-12-14' });
  const gabi  = await socio(A, 'Gabi',  { ini: '2026-11-11', fin: '2026-12-10' });
  const hugo  = await socio(A, 'Hugo',  { ini: '2026-11-05', fin: '2026-12-04' }, { alta: '2026-11-05' });
  const julia = await socio(A, 'Julia', { ini: '2026-11-06', fin: '2026-12-05' });
  const ivan  = await socio(A, 'Ivan',  { ini: '2026-11-01', fin: '2026-12-25' }, { borrado: true });
  // Eva: membresía que arranca en diciembre -> el 30/11 no cubre hoy; la elegida es la de fin más reciente (31/12) -> AL_DIA
  void julia;

  await ingreso(A, ana,   '2026-10-10T10:00');
  await ingreso(A, ana,   '2026-11-05T10:00');
  await ingreso(A, ana,   '2026-11-12T10:00');
  await ingreso(A, beto,  '2026-10-20T19:00');
  await ingreso(A, carla, '2026-10-15T18:00');
  await ingreso(A, dario, '2026-10-02T09:00');
  await ingreso(A, eva,   '2026-09-10T09:00');
  await ingreso(A, fede,  '2026-10-31T23:30');           // octubre en AR (1/11 02:30 UTC)
  await ingreso(A, gabi,  '2026-10-05T08:00', true);     // solo con la membresía
  await ingreso(A, gabi,  '2026-11-30T23:30', true);     // noviembre en AR (1/12 02:30 UTC)
  await ingreso(A, hugo,  '2026-11-06T07:00');
  await ingreso(A, ivan,  '2026-10-01T07:00');           // borrado: no cuenta en la lista

  await pago(A.efec,  30000, '2026-11-03T10:00', ana.i!.id);
  await pago(A.trans, 30000, '2026-11-30T23:00', beto.i!.id);   // noviembre en AR
  await pago(A.efec,  25000, '2026-11-05T10:00', hugo.i!.id);
  await pago(A.efec,   5000, '2026-11-20T10:00', null);          // venta de producto
  await pago(A.efec,   9999, '2026-11-21T10:00', null, 'PENDIENTE');
  await pago(A.efec,  20000, '2026-10-31T22:00', carla.i!.id);   // octubre en AR
  await pago(A.efec,  11111, '2026-12-01T00:30', ana.i!.id);     // diciembre en AR (1/12 03:30 UTC)

  // ── Gimnasio B: casi no registra ingresos ───────────────────────────────────
  for (const n of ['B1', 'B2', 'B3', 'B4']) await socio(B, n, { ini: '2026-11-20', fin: '2026-12-19' });
  const b5 = await socio(B, 'B5', { ini: '2026-11-20', fin: '2026-12-19' });
  await ingreso(B, b5, '2026-10-10T10:00');
  await pago(B.efec, 77777, '2026-11-10T10:00', b5.i!.id);

  console.log('Resumen de noviembre — Atlas');
  const r = await calcularResumen(A.emp.id, '2026-11-01');

  await caso('cobrado: total, cantidad, cuotas y ventas (sin PENDIENTE, sin otro gimnasio, cortes en hora AR)', () => {
    assert.equal(r.cobrado.total, 90000);
    assert.equal(r.cobrado.cantidad, 4);
    assert.deepEqual(r.cobrado.cuotas, { total: 85000, cantidad: 3 });
    assert.deepEqual(r.cobrado.ventas, { total: 5000, cantidad: 1 });
    assert.deepEqual(r.cobrado.porMedio, [
      { medio: 'Efectivo', total: 60000, cantidad: 3 },
      { medio: 'Transferencia', total: 30000, cantidad: 1 },
    ]);
    assert.deepEqual(r.cobrado.mesAnterior, { total: 20000, cantidad: 1 });
  });
  await caso('cuotas al 30/11 con la regla de la lista (sin el socio borrado)', () => {
    assert.equal(r.fotoCuotas, '2026-11-30');
    assert.equal(r.cuotas.AL_DIA, 5);       // Ana, Beto, Eva, Fede, Gabi
    assert.equal(r.cuotas.POR_VENCER, 2);   // Hugo (4/12) y Julia (5/12)
    assert.equal(r.cuotas.VENCIDA, 2);
    assert.equal(r.cuotas.totalSocios, 9);
  });
  await caso('ingresos del mes y del anterior (con asistencias solo por membresía y corte AR)', () => {
    assert.equal(r.ingresos.total, 4);
    assert.equal(r.ingresos.sociosDistintos, 3);
    assert.deepEqual(r.ingresos.mesAnterior, { total: 7, sociosDistintos: 7 });
    assert.equal(r.ingresos.suficientes, true);
  });
  await caso('dejaron de venir: Carla (vencida en noviembre), Beto, Fede; sin Dario (vencido antes), Eva ni Ivan', () => {
    assert.deepEqual(r.dejaronDeVenir.map(x => x.nombre), ['Carla Prueba', 'Beto Prueba', 'Fede Prueba']);
    assert.deepEqual(r.dejaronDeVenir.map(x => x.ultimaVisita), ['2026-10-15', '2026-10-20', '2026-10-31']);
    assert.equal(r.dejaronDeVenir[0].estadoCuota, 'VENCIDA');
    assert.equal(r.dejaronDeVenir[1].telefono, '351-555-0101');
  });
  await caso('altas del mes', () => assert.equal(r.altas, 1));

  console.log('Resumen de noviembre — Otro Gym (pocos ingresos)');
  const rb = await calcularResumen(B.emp.id, '2026-11-01');
  await caso('sin ingresos suficientes no lista nombres y avisa', () => {
    assert.equal(rb.ingresos.suficientes, false);
    assert.deepEqual(rb.dejaronDeVenir, []);
    assert.equal(rb.cobrado.total, 77777);
    const html = armarHtmlResumen(rb, { nombre: 'Otro Gym', slug: 'otro' });
    assert.match(html, /Pantalla de ingreso/);
  });

  console.log('HTML');
  await caso('escapa lo que carga el gimnasio y usa links al subdominio', async () => {
    const html = armarHtmlResumen(r, { nombre: '<script>x</script>', slug: 'atlas', colorPrimario: 'red;background:url(x)', logoUrl: 'javascript:alert(1)' });
    assert.doesNotMatch(html, /<script>x/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /javascript:/);
    assert.match(html, /#534AB7/);                                         // color inválido -> por defecto
    assert.match(html, /https:\/\/atlas\.smartgym\.codandtics\.com\/socios\?estado=VENCIDA/);
    assert.match(html, /Carla Prueba/);
    const real = armarHtmlResumen(r, await datosGimnasio(A.emp.id));
    assert.match(real, /#0F766E/);
    assert.match(real, /\$ 90\.000/);
  });

  console.log('Destinatarios');
  await caso('solo administradores activos y vigentes del gimnasio', async () => {
    assert.deepEqual(await destinatariosDe(A.emp.id, '2026-12-01'), ['duenio@atlas.test']);
    assert.deepEqual(await destinatariosDe(C.emp.id, '2026-12-01'), []);
  });

  console.log('Job del día 1');
  const enviados: { para: string | string[]; asunto: string }[] = [];
  const enviarOk = async (o: { para: string | string[]; asunto: string }) => { enviados.push(o); };
  await caso('primera vuelta: manda a A y B, C queda sin destinatarios', async () => {
    const res = await procesarResumenes({ hoy: '2026-12-01', enviar: enviarOk });
    assert.deepEqual(res, { enviados: 2, errores: 0, sinDestinatarios: 1, yaEnviados: 0 });
    assert.deepEqual(enviados.map(e => e.para).sort(), [['duenio@atlas.test'], ['duenio@otro.test']]);
  });
  await caso('segunda vuelta (reinicio de pm2): no manda nada de nuevo', async () => {
    const res = await procesarResumenes({ hoy: '2026-12-01', enviar: enviarOk });
    assert.deepEqual(res, { enviados: 0, errores: 0, sinDestinatarios: 0, yaEnviados: 3 });
    assert.equal(enviados.length, 2);
  });
  await caso('dos instancias a la vez: un solo mail por gimnasio', async () => {
    await prisma.resumenEnviado.deleteMany();
    enviados.length = 0;
    const lento = async (o: { para: string | string[]; asunto: string }) => { await new Promise(r => setTimeout(r, 50)); enviados.push(o); };
    await Promise.all([
      procesarResumenes({ hoy: '2026-12-01', enviar: lento }),
      procesarResumenes({ hoy: '2026-12-01', enviar: lento }),
    ]);
    assert.equal(enviados.length, 2);
  });
  await caso(`si falla el SMTP queda ERROR, reintenta y para a los ${MAX_INTENTOS} intentos`, async () => {
    await prisma.resumenEnviado.deleteMany();
    const falla = async () => { throw new Error('SMTP caído'); };
    await procesarResumenes({ hoy: '2026-12-01', enviar: falla });
    let fila = await prisma.resumenEnviado.findFirstOrThrow({ where: { empresaId: A.emp.id } });
    assert.equal(fila.estado, 'ERROR'); assert.equal(fila.intentos, 1); assert.equal(fila.error, 'SMTP caído');
    await procesarResumenes({ hoy: '2026-12-01', enviar: falla });
    await procesarResumenes({ hoy: '2026-12-01', enviar: falla });
    fila = await prisma.resumenEnviado.findFirstOrThrow({ where: { empresaId: A.emp.id } });
    assert.equal(fila.intentos, MAX_INTENTOS);
    enviados.length = 0;
    await procesarResumenes({ hoy: '2026-12-01', enviar: enviarOk });
    assert.equal(enviados.length, 0);                                       // no insiste más
  });
  await caso('reintento exitoso después de un error', async () => {
    await prisma.resumenEnviado.deleteMany();
    await procesarResumenes({ hoy: '2026-12-01', enviar: async () => { throw new Error('x'); } });
    enviados.length = 0;
    await procesarResumenes({ hoy: '2026-12-01', enviar: enviarOk });
    const fila = await prisma.resumenEnviado.findFirstOrThrow({ where: { empresaId: A.emp.id } });
    assert.equal(fila.estado, 'ENVIADO'); assert.equal(fila.intentos, 2);
    assert.equal(fila.destinatarios, 'duenio@atlas.test');
    assert.equal(enviados.length, 2);
  });
  await caso('el período por defecto es el mes anterior (1/1 -> diciembre del año anterior)', async () => {
    await prisma.resumenEnviado.deleteMany();
    await procesarResumenes({ hoy: '2027-01-01', enviar: enviarOk });
    const fila = await prisma.resumenEnviado.findFirstOrThrow({ where: { empresaId: A.emp.id } });
    assert.equal(fila.periodo.toISOString().slice(0, 10), '2026-12-01');
  });

  console.log(`\n${ok} pruebas OK`);
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
