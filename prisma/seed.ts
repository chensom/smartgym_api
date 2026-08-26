// =============================================================================
// SMARTGYM · Seed de datos iniciales
// Crea: empresa, sucursales, roles, permisos, usuarios, disciplinas,
//       planes, socios de prueba, productos e inventario inicial
// =============================================================================

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient({ log: ['warn', 'error'] });

async function main() {
  console.log('\n🌱 Iniciando seed SMARTGYM...\n');

  // ── 1. EMPRESA ─────────────────────────────────────────────────────────────
  const empresa = await prisma.empresa.upsert({
    where:  { cuit: '30-71234567-0' },
    update: {},
    create: {
      nombre:      'Gym Demo S.R.L.',
      slug:        'gym-demo',
      cuit:        '30-71234567-0',
      razonSocial: 'Gym Demo S.R.L.',
      activo:      true,
    },
  });
  console.log(`✅ Empresa: ${empresa.nombre} (${empresa.id})`);

  // ── 2. SUCURSALES ──────────────────────────────────────────────────────────
  const sucursalCentral = await prisma.sucursal.upsert({
    where:  { id: empresa.id },   // truco: usamos create/update por nombre
    update: {},
    create: {
      empresaId: empresa.id,
      nombre:    'Sede Central',
      direccion: 'Av. 25 de Mayo 1234',
      ciudad:    'Formosa',
      provincia: 'Formosa',
      telefono:  '3704-123456',
      email:     'central@gymdemo.com',
      activo:    true,
    },
  }).catch(() => prisma.sucursal.findFirst({ where: { empresaId: empresa.id, nombre: 'Sede Central' } })) as any;

  const sucursalNorte = await prisma.sucursal.findFirst({
    where: { empresaId: empresa.id, nombre: 'Sede Norte' }
  }) ?? await prisma.sucursal.create({
    data: {
      empresaId: empresa.id,
      nombre:    'Sede Norte',
      direccion: 'Av. Circunvalación 567',
      ciudad:    'Formosa',
      provincia: 'Formosa',
      telefono:  '3704-654321',
      email:     'norte@gymdemo.com',
      activo:    true,
    },
  });
  console.log(`✅ Sucursales: ${sucursalCentral.nombre}, ${sucursalNorte.nombre}`);

  // ── 3. PERMISOS (ya existen del seed SQL, pero por si acaso) ───────────────
  const permisosExistentes = await prisma.permiso.count();
  if (permisosExistentes === 0) {
    await prisma.permiso.createMany({
      data: [
        { codigo: 'socios.ver',          modulo: 'socios',       descripcion: 'Ver socios' },
        { codigo: 'socios.crear',        modulo: 'socios',       descripcion: 'Crear socios' },
        { codigo: 'socios.editar',       modulo: 'socios',       descripcion: 'Editar socios' },
        { codigo: 'socios.eliminar',     modulo: 'socios',       descripcion: 'Eliminar socios' },
        { codigo: 'inscripciones.ver',   modulo: 'inscripciones',descripcion: 'Ver inscripciones' },
        { codigo: 'inscripciones.crear', modulo: 'inscripciones',descripcion: 'Crear inscripciones' },
        { codigo: 'inscripciones.editar',modulo: 'inscripciones',descripcion: 'Editar inscripciones' },
        { codigo: 'inscripciones.anular',modulo: 'inscripciones',descripcion: 'Anular inscripciones' },
        { codigo: 'asistencias.ver',     modulo: 'asistencias',  descripcion: 'Ver asistencias' },
        { codigo: 'asistencias.registrar',modulo:'asistencias',  descripcion: 'Registrar asistencias' },
        { codigo: 'clases.ver',          modulo: 'clases',       descripcion: 'Ver clases' },
        { codigo: 'clases.crear',        modulo: 'clases',       descripcion: 'Crear clases' },
        { codigo: 'inventario.ver',      modulo: 'inventario',   descripcion: 'Ver inventario' },
        { codigo: 'inventario.ajustar',  modulo: 'inventario',   descripcion: 'Ajustar stock' },
        { codigo: 'productos.crear',     modulo: 'inventario',   descripcion: 'Crear productos' },
        { codigo: 'productos.editar',    modulo: 'inventario',   descripcion: 'Editar productos' },
        { codigo: 'ventas.ver',          modulo: 'ventas',       descripcion: 'Ver ventas' },
        { codigo: 'ventas.crear',        modulo: 'ventas',       descripcion: 'Crear ventas' },
        { codigo: 'ventas.anular',       modulo: 'ventas',       descripcion: 'Anular ventas' },
        { codigo: 'pagos.ver',           modulo: 'pagos',        descripcion: 'Ver pagos' },
        { codigo: 'pagos.registrar',     modulo: 'pagos',        descripcion: 'Registrar pagos' },
        { codigo: 'facturas.ver',        modulo: 'facturacion',  descripcion: 'Ver facturas' },
        { codigo: 'facturas.emitir',     modulo: 'facturacion',  descripcion: 'Emitir facturas' },
        { codigo: 'reportes.ver',        modulo: 'reportes',     descripcion: 'Ver reportes' },
        { codigo: 'reportes.exportar',   modulo: 'reportes',     descripcion: 'Exportar reportes' },
        { codigo: 'config.ver',          modulo: 'config',       descripcion: 'Ver configuración' },
        { codigo: 'config.editar',       modulo: 'config',       descripcion: 'Editar configuración' },
        { codigo: 'empresa.admin',       modulo: 'admin',        descripcion: 'Admin empresa' },
        { codigo: 'sistema.super',       modulo: 'admin',        descripcion: 'Superadmin' },
      ],
      skipDuplicates: true,
    });
  }

  // ── 4. ROLES ───────────────────────────────────────────────────────────────
  const rolAdmin = await prisma.rol.upsert({
    where:  { empresaId_nombre: { empresaId: empresa.id, nombre: 'ADMIN' } },
    update: {},
    create: { empresaId: empresa.id, nombre: 'ADMIN', descripcion: 'Administrador total', activo: true },
  });

  const rolRecepcion = await prisma.rol.upsert({
    where:  { empresaId_nombre: { empresaId: empresa.id, nombre: 'RECEPCION' } },
    update: {},
    create: { empresaId: empresa.id, nombre: 'RECEPCION', descripcion: 'Recepcionista', activo: true },
  });

  const rolProfesor = await prisma.rol.upsert({
    where:  { empresaId_nombre: { empresaId: empresa.id, nombre: 'PROFESOR' } },
    update: {},
    create: { empresaId: empresa.id, nombre: 'PROFESOR', descripcion: 'Profesor / Instructor', activo: true },
  });
  console.log(`✅ Roles: ADMIN, RECEPCION, PROFESOR`);

  // ── 5. ASIGNAR PERMISOS A ROLES ────────────────────────────────────────────
  const todosLosPermisos = await prisma.permiso.findMany();
  const permisosAdmin    = todosLosPermisos.map(p => ({ rolId: rolAdmin.id, permisoId: p.id }));
  const permisosRecep    = todosLosPermisos
    .filter(p => ['socios','inscripciones','asistencias','pagos'].includes(p.modulo))
    .map(p => ({ rolId: rolRecepcion.id, permisoId: p.id }));
  const permisosProfe    = todosLosPermisos
    .filter(p => ['socios','asistencias','clases'].includes(p.modulo))
    .map(p => ({ rolId: rolProfesor.id, permisoId: p.id }));

  await prisma.rolPermiso.createMany({ data: [...permisosAdmin, ...permisosRecep, ...permisosProfe], skipDuplicates: true });
  console.log(`✅ Permisos asignados a roles`);

  // ── 6. USUARIOS ────────────────────────────────────────────────────────────
  const hashAdmin    = await bcrypt.hash('Admin2025*',   12);
  const hashRecep    = await bcrypt.hash('Recep2025*',   12);
  const hashProfesor = await bcrypt.hash('Profe2025*',   12);

  const usuarioAdmin = await prisma.usuario.upsert({
    where:  { email: 'admin@gymdemo.com' },
    update: {},
    create: {
      empresaId:    empresa.id,
      email:        'admin@gymdemo.com',
      passwordHash: hashAdmin,
      activo:       true,
    },
  });

  const usuarioRecep = await prisma.usuario.upsert({
    where:  { email: 'recepcion@gymdemo.com' },
    update: {},
    create: {
      empresaId:    empresa.id,
      email:        'recepcion@gymdemo.com',
      passwordHash: hashRecep,
      activo:       true,
    },
  });

  const usuarioProfe = await prisma.usuario.upsert({
    where:  { email: 'profesor@gymdemo.com' },
    update: {},
    create: {
      empresaId:    empresa.id,
      email:        'profesor@gymdemo.com',
      passwordHash: hashProfesor,
      activo:       true,
    },
  });
  console.log(`✅ Usuarios creados:`);
  console.log(`   👤 admin@gymdemo.com       / Admin2025*`);
  console.log(`   👤 recepcion@gymdemo.com   / Recep2025*`);
  console.log(`   👤 profesor@gymdemo.com    / Profe2025*`);

  // ── 7. ASIGNAR ROLES A USUARIOS ────────────────────────────────────────────
  const hoy = new Date();
  await prisma.usuarioRol.createMany({
    data: [
      { usuarioId: usuarioAdmin.id, rolId: rolAdmin.id,     fechaDesde: hoy },
      { usuarioId: usuarioRecep.id, rolId: rolRecepcion.id, fechaDesde: hoy, sucursalId: sucursalCentral.id },
      { usuarioId: usuarioProfe.id, rolId: rolProfesor.id,  fechaDesde: hoy, sucursalId: sucursalCentral.id },
    ],
    skipDuplicates: true,
  });
  console.log(`✅ Roles asignados a usuarios`);

  // ── 8. TIPOS DE ROLES DE PERSONA ───────────────────────────────────────────
  const tiposRol: Record<string, any> = {};
  for (const nombre of ['SOCIO', 'PROFESOR', 'EMPLEADO', 'CLIENTE', 'PROVEEDOR']) {
    tiposRol[nombre] = await prisma.tipoRolPersona.upsert({
      where:  { empresaId_nombre: { empresaId: empresa.id, nombre } },
      update: {},
      create: { empresaId: empresa.id, nombre, activo: true },
    });
  }
  console.log(`✅ Tipos de rol de persona: SOCIO, PROFESOR, EMPLEADO, CLIENTE, PROVEEDOR`);

  // ── 9. DISCIPLINAS ─────────────────────────────────────────────────────────
  const disciplinasData = [
    { nombre: 'Musculación',  colorHex: '#2E5BA8', icono: 'dumbbell'   },
    { nombre: 'Crossfit',     colorHex: '#D85A30', icono: 'flame'      },
    { nombre: 'Yoga',         colorHex: '#1D9E75', icono: 'leaf'       },
    { nombre: 'Pilates',      colorHex: '#7F77DD', icono: 'circle'     },
    { nombre: 'Funcional',    colorHex: '#BA7517', icono: 'zap'        },
    { nombre: 'Kick Boxing',  colorHex: '#E24B4A', icono: 'shield'     },
    { nombre: 'Zumba',        colorHex: '#E91E8C', icono: 'music'      },
    { nombre: 'Natación',     colorHex: '#0288D1', icono: 'droplets'   },
  ];

  const disciplinas: Record<string, any> = {};
  for (const d of disciplinasData) {
    disciplinas[d.nombre] = await prisma.disciplina.upsert({
      where:  { empresaId_nombre: { empresaId: empresa.id, nombre: d.nombre } },
      update: {},
      create: { empresaId: empresa.id, ...d, activo: true },
    });
  }
  console.log(`✅ Disciplinas: ${Object.keys(disciplinas).join(', ')}`);

  // ── 10. PLANES ─────────────────────────────────────────────────────────────
  const planMensualBasico = await prisma.plan.findFirst({ where: { empresaId: empresa.id, nombre: 'Mensual Básico' } })
    ?? await prisma.plan.create({ data: {
      empresaId:             empresa.id,
      nombre:                'Mensual Básico',
      descripcion:           'Acceso a musculación y funcional — 1 sucursal',
      precio:                15000,
      duracionDias:          30,
      tipo:                  'MENSUAL',
      accesoTodasSucursales: false,
      activo:                true,
    }});

  const planMensualFull = await prisma.plan.findFirst({ where: { empresaId: empresa.id, nombre: 'Mensual Full' } })
    ?? await prisma.plan.create({ data: {
      empresaId:             empresa.id,
      nombre:                'Mensual Full',
      descripcion:           'Acceso a todas las disciplinas y sucursales',
      precio:                25000,
      duracionDias:          30,
      tipo:                  'MENSUAL',
      accesoTodasSucursales: true,
      activo:                true,
    }});

  const planTrimestral = await prisma.plan.findFirst({ where: { empresaId: empresa.id, nombre: 'Trimestral Full' } })
    ?? await prisma.plan.create({ data: {
      empresaId:             empresa.id,
      nombre:                'Trimestral Full',
      descripcion:           'Acceso total por 3 meses — ahorro 15%',
      precio:                63750,
      duracionDias:          90,
      tipo:                  'TRIMESTRAL',
      accesoTodasSucursales: true,
      activo:                true,
    }});

  // Asignar disciplinas a planes
  await prisma.planDisciplina.createMany({
    data: [
      { planId: planMensualBasico.id, disciplinaId: disciplinas['Musculación'].id },
      { planId: planMensualBasico.id, disciplinaId: disciplinas['Funcional'].id   },
      ...Object.values(disciplinas).map((d: any) => ({ planId: planMensualFull.id, disciplinaId: d.id })),
      ...Object.values(disciplinas).map((d: any) => ({ planId: planTrimestral.id,  disciplinaId: d.id })),
    ],
    skipDuplicates: true,
  });
  console.log(`✅ Planes: Mensual Básico ($15.000), Mensual Full ($25.000), Trimestral Full ($63.750)`);

  // ── 11. MEDIOS DE PAGO ─────────────────────────────────────────────────────
  const mediosPagoData = [
    { nombre: 'Efectivo',      tipo: 'EFECTIVO'      },
    { nombre: 'Transferencia', tipo: 'TRANSFERENCIA' },
    { nombre: 'Mercado Pago',  tipo: 'MERCADOPAGO'   },
    { nombre: 'Débito',        tipo: 'DEBITO'        },
    { nombre: 'Crédito',       tipo: 'CREDITO'       },
  ];
  const mediosPago: Record<string, any> = {};
  for (const mp of mediosPagoData) {
    mediosPago[mp.nombre] = await prisma.medioPago.upsert({
      where:  { empresaId_nombre: { empresaId: empresa.id, nombre: mp.nombre } },
      update: {},
      create: { empresaId: empresa.id, ...mp, activo: true },
    });
  }
  console.log(`✅ Medios de pago: ${Object.keys(mediosPago).join(', ')}`);

  // ── 12. PERSONAS Y SOCIOS DE PRUEBA ────────────────────────────────────────
  const sociosData = [
    { nombres: 'Juan',    apellidos: 'González',  genero: 'M', tel: '3704-111111', dni: '35123456' },
    { nombres: 'María',   apellidos: 'Rodríguez', genero: 'F', tel: '3704-222222', dni: '36234567' },
    { nombres: 'Carlos',  apellidos: 'López',     genero: 'M', tel: '3704-333333', dni: '37345678' },
    { nombres: 'Sofía',   apellidos: 'Martínez',  genero: 'F', tel: '3704-444444', dni: '38456789' },
    { nombres: 'Diego',   apellidos: 'Pérez',     genero: 'M', tel: '3704-555555', dni: '39567890' },
  ];

  let socioNum = 1;
  for (const s of sociosData) {
    // Verificar si ya existe
    const existe = await prisma.persona.findFirst({
      where: { empresaId: empresa.id, apellidos: s.apellidos, nombres: s.nombres },
    });
    if (existe) { socioNum++; continue; }

    const numStr = String(socioNum).padStart(5, '0');

    const persona = await prisma.persona.create({ data: {
      empresaId: empresa.id,
      nombres:   s.nombres,
      apellidos: s.apellidos,
      genero:    s.genero as any,
      qrCode:    `SG-${empresa.id.slice(0,8)}-${numStr}`,
      activo:    true,
      documentos: { create: { tipo: 'DNI', numero: s.dni } },
      contactos:  { create: { tipo: 'CEL', valor: s.tel, principal: true } },
    }});

    const personaRol = await prisma.personaRol.create({ data: {
      personaId:   persona.id,
      tipoRolId:   tiposRol['SOCIO'].id,
      sucursalId:  sucursalCentral.id,
      numeroSocio: numStr,
      fechaAlta:   new Date(),
    }});

    // Inscripción activa con plan mensual full
    const fechaInicio = new Date();
    const fechaFin    = new Date(); fechaFin.setDate(fechaFin.getDate() + 30);

    const inscripcion = await prisma.inscripcion.create({ data: {
      personaRolId: personaRol.id,
      planId:       planMensualFull.id,
      sucursalId:   sucursalCentral.id,
      fechaInicio:  fechaInicio,
      fechaFin:     fechaFin,
      precioPagado: planMensualFull.precio,
      estado:       'ACTIVA',
    }});

    // Pago registrado
    await prisma.pago.create({ data: {
      inscripcionId: inscripcion.id,
      medioPagoId:   mediosPago['Efectivo'].id,
      monto:         planMensualFull.precio,
      estado:        'APROBADO',
      usuarioId:     usuarioAdmin.id,
    }});

    socioNum++;
  }
  console.log(`✅ Socios de prueba: ${sociosData.map(s => s.nombres + ' ' + s.apellidos).join(', ')}`);

  // ── 13. PERSONA + ROL PROFESOR ─────────────────────────────────────────────
  const profExiste = await prisma.persona.findFirst({
    where: { empresaId: empresa.id, apellidos: 'Suárez', nombres: 'Andrés' },
  });

  if (!profExiste) {
    const profesor = await prisma.persona.create({ data: {
      empresaId: empresa.id,
      nombres:   'Andrés',
      apellidos: 'Suárez',
      genero:    'M',
      qrCode:    `SG-${empresa.id.slice(0,8)}-PROF01`,
      activo:    true,
      contactos: { create: { tipo: 'CEL', valor: '3704-999999', principal: true } },
    }});

    // Vincular con el usuario profesor
    await prisma.usuario.update({
      where: { id: usuarioProfe.id },
      data:  { personaId: profesor.id },
    });

    const profRol = await prisma.personaRol.create({ data: {
      personaId:  profesor.id,
      tipoRolId:  tiposRol['PROFESOR'].id,
      sucursalId: sucursalCentral.id,
      fechaAlta:  new Date(),
    }});

    // Disciplinas que dicta
    await prisma.profesorDisciplina.createMany({
      data: [
        { personaRolId: profRol.id, disciplinaId: disciplinas['Musculación'].id, nivel: 'AVANZADO' },
        { personaRolId: profRol.id, disciplinaId: disciplinas['Funcional'].id,   nivel: 'AVANZADO' },
        { personaRolId: profRol.id, disciplinaId: disciplinas['Crossfit'].id,    nivel: 'INTERMEDIO' },
      ],
      skipDuplicates: true,
    });
    console.log(`✅ Profesor: Andrés Suárez (Musculación, Funcional, Crossfit)`);
  }

  // ── 14. CATEGORÍAS Y PRODUCTOS ─────────────────────────────────────────────
  const catSuplem = await prisma.categoriaProducto.upsert({
    where:  { empresaId_nombre: { empresaId: empresa.id, nombre: 'Suplementos' } },
    update: {},
    create: { empresaId: empresa.id, nombre: 'Suplementos', activo: true },
  });

  const catIndum = await prisma.categoriaProducto.upsert({
    where:  { empresaId_nombre: { empresaId: empresa.id, nombre: 'Indumentaria' } },
    update: {},
    create: { empresaId: empresa.id, nombre: 'Indumentaria', activo: true },
  });

  const marcaON = await prisma.marca.upsert({
    where:  { empresaId_nombre: { empresaId: empresa.id, nombre: 'Optimum Nutrition' } },
    update: {},
    create: { empresaId: empresa.id, nombre: 'Optimum Nutrition', activo: true },
  });

  const marcaGeneric = await prisma.marca.upsert({
    where:  { empresaId_nombre: { empresaId: empresa.id, nombre: 'Gym Demo Brand' } },
    update: {},
    create: { empresaId: empresa.id, nombre: 'Gym Demo Brand', activo: true },
  });

  const productosData = [
    { nombre: 'Whey Protein 2kg', cat: catSuplem.id, marca: marcaON.id,      codigo: 'WP-2KG',   precioVenta: 45000, precioCosto: 28000 },
    { nombre: 'Creatina 300g',    cat: catSuplem.id, marca: marcaON.id,      codigo: 'CR-300G',  precioVenta: 18000, precioCosto: 10000 },
    { nombre: 'Remera Dry Fit',   cat: catIndum.id,  marca: marcaGeneric.id, codigo: 'REM-DF',   precioVenta: 8500,  precioCosto: 4000  },
    { nombre: 'Short Training',   cat: catIndum.id,  marca: marcaGeneric.id, codigo: 'SHO-TR',   precioVenta: 9500,  precioCosto: 4500  },
    { nombre: 'Botella 750ml',    cat: catIndum.id,  marca: marcaGeneric.id, codigo: 'BOT-750',  precioVenta: 3500,  precioCosto: 1500  },
  ];

  const productos: any[] = [];
  for (const prod of productosData) {
    const p = await prisma.producto.findFirst({ where: { empresaId: empresa.id, codigo: prod.codigo } })
      ?? await prisma.producto.create({ data: {
        empresaId:   empresa.id,
        categoriaId: prod.cat,
        marcaId:     prod.marca,
        nombre:      prod.nombre,
        codigo:      prod.codigo,
        precioVenta: prod.precioVenta,
        precioCosto: prod.precioCosto,
        activo:      true,
      }});
    productos.push(p);

    // Stock inicial en sucursal central
    const invExiste = await prisma.inventario.findFirst({
      where: { sucursalId: sucursalCentral.id, productoId: p.id, varianteId: null },
    });
    if (!invExiste) {
      await prisma.inventario.create({ data: {
        sucursalId:  sucursalCentral.id,
        productoId:  p.id,
        stockActual: 20,
        stockMinimo: 5,
      }});
      await prisma.movimientoStock.create({ data: {
        sucursalId: sucursalCentral.id,
        productoId: p.id,
        tipo:       'ENTRADA',
        cantidad:   20,
        motivo:     'Stock inicial seed',
        usuarioId:  usuarioAdmin.id,
      }});
    }
  }
  console.log(`✅ Productos: ${productosData.map(p => p.nombre).join(', ')}`);
  console.log(`✅ Stock inicial cargado en Sede Central`);

  // ── RESUMEN FINAL ──────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('🎉 SEED COMPLETADO EXITOSAMENTE');
  console.log('═'.repeat(60));
  console.log('\n📋 CREDENCIALES DE ACCESO:');
  console.log('┌─────────────────────────────────────────────────────┐');
  console.log('│  ADMIN      admin@gymdemo.com      / Admin2025*     │');
  console.log('│  RECEPCIÓN  recepcion@gymdemo.com  / Recep2025*     │');
  console.log('│  PROFESOR   profesor@gymdemo.com   / Profe2025*     │');
  console.log('└─────────────────────────────────────────────────────┘');
  console.log('\n📋 DATOS DISPONIBLES:');
  console.log('  • 1 empresa   → Gym Demo S.R.L.');
  console.log('  • 2 sucursales → Sede Central, Sede Norte');
  console.log('  • 8 disciplinas');
  console.log('  • 3 planes de membresía');
  console.log('  • 5 socios activos con inscripción Mensual Full');
  console.log('  • 1 profesor con 3 disciplinas asignadas');
  console.log('  • 5 productos con stock inicial');
  console.log('  • 5 medios de pago');
  console.log('\n🚀 Podés probar el login en: POST /api/v1/auth/login');
  console.log('═'.repeat(60) + '\n');
}

main()
  .catch((e) => { console.error('\n❌ Error en seed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
