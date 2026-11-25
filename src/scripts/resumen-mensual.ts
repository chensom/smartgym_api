import 'dotenv/config';
import { writeFileSync } from 'fs';
import { prisma } from '../lib/prisma';
import { hoyArgentina, periodoDe, sumarMeses } from '../lib/fechas';
import { calcularResumen } from '../services/resumenMensual.service';
import { armarHtmlResumen, asuntoResumen } from '../services/resumenMail';
import { enviarEmail } from '../services/mailer.service';
import { datosGimnasio, destinatariosDe } from '../jobs/resumen.job';

// =============================================================================
// Vista previa / envío de prueba del resumen mensual. NO registra nada en
// resumenes_enviados (no afecta al envío automático del día 1).
//
//   node dist/scripts/resumen-mensual.js --empresa fenixgim --mes 2026-11
//       -> muestra los números y guarda el HTML en resumen-<slug>-<mes>.html
//   ... --a tu@mail.com
//       -> además lo manda SOLO a esa dirección
//
// --mes por defecto: el mes anterior a hoy.
// =============================================================================

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = arg('empresa');
  if (!slug) throw new Error('Falta --empresa <slug>');
  const mes     = arg('mes');
  const periodo = mes ? `${mes}-01` : sumarMeses(periodoDe(hoyArgentina()), -1);
  const para    = arg('a');

  const emp = await prisma.empresa.findUnique({ where: { slug }, select: { id: true } });
  if (!emp) throw new Error(`No existe el gimnasio con slug "${slug}"`);

  const resumen = await calcularResumen(emp.id, periodo);
  const marca   = await datosGimnasio(emp.id);
  const admins  = await destinatariosDe(emp.id, hoyArgentina());

  const { dejaronDeVenir, ...numeros } = resumen;
  console.log(JSON.stringify(numeros, null, 2));
  console.log(`Dejaron de venir: ${dejaronDeVenir.length}`);
  for (const d of dejaronDeVenir) console.log(`  - ${d.nombre} (última ${d.ultimaVisita}, ${d.estadoCuota})`);
  console.log(`Administradores que lo recibirían: ${admins.length}`);

  const archivo = `resumen-${slug}-${periodo.slice(0, 7)}.html`;
  writeFileSync(archivo, armarHtmlResumen(resumen, marca), 'utf8');
  console.log(`HTML guardado en ${archivo}`);
  console.log(`Asunto: ${asuntoResumen(resumen, marca)}`);

  if (para) {
    await enviarEmail({ para, asunto: '[PRUEBA] ' + asuntoResumen(resumen, marca), html: armarHtmlResumen(resumen, marca),
                        nombreRemitente: `SmartGym · ${marca.nombre}` });
    console.log(`Enviado de prueba a ${para}`);
  }
}

main()
  .catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
