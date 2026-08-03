#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
//  Cuánto pesan los adjuntos guardados DENTRO de la base.
//
//  SOLO LEE. Es seguro correrlo contra producción.
//
//  Para qué: los tickets de carga, los presupuestos y los comprobantes se
//  guardan como texto base64 en columnas TEXT (fuel_logs.ticket_image,
//  purchase_orders.presupuesto_imagen, etc.). Cada uno pesa hasta 5 MB y el
//  ticket es OBLIGATORIO para todo chofer que carga gasoil.
//
//  El problema con fecha: el backup por email (scripts/backup-email.js) manda
//  el dump comprimido como adjunto y corta en BACKUP_MAX_MB (20 por defecto,
//  porque Gmail rechaza arriba de ~25). Un JPEG en base64 casi no comprime:
//  ya viene comprimido, y base64 le suma un 33%. Cuando el dump cruce ese
//  umbral, el backup EMPIEZA A LLEGAR SIN ADJUNTO — y el mail llega igual, así
//  que nadie se entera.
//
//  Este comando dice a qué distancia está ese día.
//
//  Uso:
//    npm run adjuntos:check                 (desde el Shell de Render)
//    DATABASE_URL=postgresql://... npm run adjuntos:check
// ════════════════════════════════════════════════════════════════════
require('dotenv').config();
const { Client } = require('pg');

const MAX_MB = parseInt(process.env.BACKUP_MAX_MB || '20', 10);

// Columnas TEXT donde el sistema guarda adjuntos. Se verifica que existan
// antes de consultarlas: no todas están en todas las bases.
const CANDIDATAS = [
  ['fuel_logs', 'ticket_image', 'foto del ticket de carga (obligatoria para choferes)'],
  ['purchase_orders', 'presupuesto_imagen', 'presupuesto adjunto de la OC'],
  ['purchase_order_invoices', 'file_url', 'factura del proveedor'],
  ['purchase_order_payments', 'file_url', 'comprobante de pago'],
  ['fuel_tank_entries', 'remito', 'remito de ingreso a cisterna'],
  ['fuel_internal_dispatches', 'remito', 'remito de despacho interno'],
  ['documents', 'file_url', 'documentación de unidades'],
];

const mb = (bytes) => (Number(bytes || 0) / 1024 / 1024);
const fmt = (n) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 });

async function existe(client, tabla, columna) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [tabla, columna]);
  return r.rows.length > 0;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('✗ Falta DATABASE_URL.');
    console.error('  Desde el Shell de Render ya está en el entorno: corré "npm run adjuntos:check" sin prefijo.');
    process.exit(2);
  }
  if (!/^postgres(ql)?:\/\//i.test(url.trim())) {
    console.error(`✗ DATABASE_URL no parece una URL de conexión: "${url.slice(0, 40)}"`);
    process.exit(2);
  }

  const client = new Client({
    connectionString: url,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  // OJO con estos dos tamaños: NO son comparables entre sí.
  //   - pg_database_size = lo que ocupa en DISCO, ya comprimido por Postgres
  //     (TOAST comprime los valores grandes de columnas TEXT).
  //   - octet_length     = el largo LÓGICO del texto guardado.
  // Para el backup manda el lógico: pg_dump escribe el base64 tal cual, sin la
  // compresión interna. Mezclarlos da porcentajes imposibles (>100%).
  const total = await client.query('SELECT pg_database_size(current_database()) AS bytes');
  const discoBytes = Number(total.rows[0].bytes);

  // Dónde viven físicamente los adjuntos: Postgres saca los valores grandes de
  // una columna TEXT a una tabla TOAST aparte. Su tamaño es la porción de disco
  // que ocupan los adjuntos, y restándola queda el peso real del RESTO de la
  // base. Sin esto no hay forma de estimar el resto: restarle bytes lógicos al
  // tamaño en disco da negativo siempre.
  const toast = await client.query(`
    SELECT COALESCE(SUM(pg_relation_size(c.reltoastrelid)), 0) AS bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.reltoastrelid <> 0
       AND c.relname = ANY($1)`, [[...new Set(CANDIDATAS.map((c) => c[0]))]]);
  const toastBytes = Number(toast.rows[0].bytes);

  const filas = [];
  let bytesAdjuntos = 0;
  for (const [tabla, columna, desc] of CANDIDATAS) {
    if (!(await existe(client, tabla, columna))) continue;
    // octet_length sobre TEXT da los bytes reales del contenido guardado.
    const r = await client.query(`
      SELECT COUNT(*)                                              AS filas,
             COUNT(${columna})                                     AS con_dato,
             COUNT(*) FILTER (WHERE ${columna} LIKE 'data:%')      AS base64,
             COALESCE(SUM(octet_length(${columna})), 0)            AS bytes,
             COALESCE(MAX(octet_length(${columna})), 0)            AS max_bytes
        FROM ${tabla}`);
    const f = r.rows[0];
    const bytes = Number(f.bytes);
    if (Number(f.con_dato) === 0) continue;
    bytesAdjuntos += bytes;
    filas.push({
      objeto: `${tabla}.${columna}`, desc,
      con_dato: Number(f.con_dato), base64: Number(f.base64),
      mb: mb(bytes), maxMb: mb(f.max_bytes),
      promedioKb: Number(f.con_dato) ? bytes / Number(f.con_dato) / 1024 : 0,
    });
  }
  await client.end();

  filas.sort((a, b) => b.mb - a.mb);

  console.log('═'.repeat(74));
  console.log('  Adjuntos guardados dentro de la base');
  console.log('═'.repeat(74));
  console.log(`\nTamaño en disco de la base: ${fmt(mb(discoBytes))} MB`);
  console.log('  (comprimido por Postgres; el dump del backup es más grande porque va en texto plano)');

  if (!filas.length) {
    console.log('\n✓ No hay adjuntos guardados en columnas de texto.\n');
    return;
  }

  console.log('\n' + 'COLUMNA'.padEnd(40) + 'CON DATO'.padStart(9) + 'BASE64'.padStart(8) + 'TOTAL MB'.padStart(10) + 'PROM KB'.padStart(9) + 'MAX MB'.padStart(8));
  console.log('─'.repeat(74));
  for (const f of filas) {
    console.log(
      f.objeto.padEnd(40) +
      String(f.con_dato).padStart(9) +
      String(f.base64).padStart(8) +
      fmt(f.mb).padStart(10) +
      fmt(f.promedioKb).padStart(9) +
      fmt(f.maxMb).padStart(8));
  }
  console.log('─'.repeat(74));
  console.log(`${'TOTAL EN ADJUNTOS (texto)'.padEnd(40)}${''.padStart(17)}${fmt(mb(bytesAdjuntos)).padStart(10)}`);

  // ── Qué significa para el backup ──
  // pg_dump escribe el base64 tal cual, así que los adjuntos entran al dump con
  // su tamaño LÓGICO. Después gzip recupera más o menos lo que el base64 agregó
  // (~25%): un JPEG o un PDF ya vienen comprimidos, no hay mucho más que sacar.
  // El resto de la base (texto, números, fechas) sí comprime fuerte, pero su
  // peso en el dump no se puede sacar del tamaño en disco —que ya está
  // comprimido—, así que se estima por lo alto y se aclara. Es una estimación
  // del orden de magnitud, no una medición del dump.
  const adjuntosEnDumpGz = mb(bytesAdjuntos) * 0.75;
  const restoEnDumpGz = Math.max(0, mb(discoBytes) - mb(toastBytes)) * 0.30;
  const estimado = adjuntosEnDumpGz + restoEnDumpGz;

  console.log('\n' + '─'.repeat(74));
  console.log('BACKUP POR EMAIL');
  console.log(`  Límite configurado (BACKUP_MAX_MB): ${MAX_MB} MB`);
  console.log(`  Dump comprimido estimado:           ~${fmt(estimado)} MB`);
  console.log(`    adjuntos:  ~${fmt(adjuntosEnDumpGz)} MB  (el ${fmt(estimado ? adjuntosEnDumpGz / estimado * 100 : 0)}% del backup)`);
  console.log(`    resto:     ~${fmt(restoEnDumpGz)} MB`);

  if (estimado >= MAX_MB) {
    console.log('\n  ⚠ YA ESTARÍA POR ENCIMA DEL LÍMITE.');
    console.log('    El backup llega como mail SIN el archivo adjunto — y el mail llega igual,');
    console.log('    así que no se nota. Revisá el último que recibiste.');
  } else {
    const margen = MAX_MB - estimado;
    console.log(`\n  Margen: ~${fmt(margen)} MB`);
    // Se proyecta con el ticket de carga, que es el único que crece solo: es
    // obligatorio para cada carga de gasoil de un chofer. Los demás adjuntos
    // dependen de que alguien cargue una OC o una factura.
    const tickets = filas.find((f) => f.objeto === 'fuel_logs.ticket_image');
    if (tickets && tickets.promedioKb > 0) {
      const porTicketMb = (tickets.promedioKb / 1024) * 0.75;
      console.log(`  A ${fmt(tickets.promedioKb)} KB por ticket, entran ~${Math.floor(margen / porTicketMb).toLocaleString('es-AR')} cargas más antes de cruzarlo.`);
    }
  }
  console.log('─'.repeat(74));
  console.log('\nEste comando no modificó nada: solo leyó.\n');
}

main().catch((e) => {
  console.error('✗ diagnóstico de adjuntos falló:', e.message);
  process.exit(2);
});
