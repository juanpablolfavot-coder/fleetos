#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
//  Por qué tardan las consultas de speeding_events / idle_events.
//
//  SOLO LEE. Los EXPLAIN ANALYZE se corren sobre SELECT, no modifican nada.
//
//  El problema: en el log de producción, estas dos consultas aparecen como
//  SLOW QUERY (~1 segundo) una y otra vez, en syncs distintos separados por
//  minutos. No es arranque en frío.
//
//    SELECT id, limit_kmh FROM speeding_events
//     WHERE vehicle_code=$1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1
//
//  Corren 42 veces cada 2 minutos (una por unidad, en cada sync del GPS) y
//  tienen índice parcial:
//
//    CREATE INDEX idx_speeding_open ON speeding_events(vehicle_code)
//      WHERE ended_at IS NULL
//
//  Un índice parcial así sirve mientras los eventos ABIERTOS sean pocos. Si por
//  algún motivo dejan de cerrarse, el conjunto "abierto" crece sin techo, el
//  índice deja de ser selectivo y encima el ORDER BY tiene que ordenar. Ahí la
//  consulta pasa de instantánea a lenta, y empeora sola con el tiempo.
//
//  Este comando distingue las dos causas posibles:
//    - Si hay MUCHOS eventos abiertos y alguno viejo → hay una fuga: no se están
//      cerrando. Es un bug, y se arregla en el código.
//    - Si hay pocos abiertos y el EXPLAIN igual tarda → el cuello es la base
//      (plan chico / CPU compartida). No se arregla con código.
//
//  Uso:  npm run diag:eventos
// ════════════════════════════════════════════════════════════════════
require('dotenv').config();
const { Client } = require('pg');

const TABLAS = [
  { tabla: 'speeding_events', campos: 'id, limit_kmh', indice: 'idx_speeding_open' },
  { tabla: 'idle_events', campos: 'id, started_at', indice: 'idx_idle_open' },
];

const fmt = (n) => Number(n || 0).toLocaleString('es-AR');

async function existe(client, tabla) {
  const r = await client.query('SELECT to_regclass($1) AS t', [`public.${tabla}`]);
  return !!r.rows[0].t;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('✗ Falta DATABASE_URL. Desde el Shell de Render: npm run diag:eventos');
    process.exit(2);
  }
  const client = new Client({
    connectionString: url,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  console.log('═'.repeat(72));
  console.log('  Eventos de GPS: por qué tardan las consultas del sync');
  console.log('═'.repeat(72));

  let sospechaFuga = false;
  let lentoConPocos = false;

  for (const { tabla, campos, indice } of TABLAS) {
    if (!(await existe(client, tabla))) {
      console.log(`\n${tabla}: la tabla no existe todavía.`);
      continue;
    }

    const c = await client.query(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE ended_at IS NULL) AS abiertos,
             MIN(started_at) FILTER (WHERE ended_at IS NULL) AS mas_viejo_abierto,
             COUNT(DISTINCT vehicle_code) FILTER (WHERE ended_at IS NULL) AS unidades_abiertas
        FROM ${tabla}`);
    const f = c.rows[0];
    const abiertos = Number(f.abiertos);

    console.log(`\n── ${tabla} ──`);
    console.log(`  filas totales:        ${fmt(f.total)}`);
    console.log(`  ABIERTOS (ended_at NULL): ${fmt(abiertos)}  en ${fmt(f.unidades_abiertas)} unidad(es)`);
    if (f.mas_viejo_abierto) {
      const dias = Math.floor((Date.now() - new Date(f.mas_viejo_abierto).getTime()) / 86400000);
      console.log(`  el más viejo sin cerrar:  ${String(f.mas_viejo_abierto).slice(0, 19)}  (hace ${dias} día(s))`);
      // Un evento abierto de días es la señal clara de que no se cierra solo.
      if (dias >= 2) sospechaFuga = true;
    }
    // Con una flota de ~42 unidades, más de 100 abiertos ya no se explica por
    // "está pasando ahora": son eventos que quedaron colgados.
    if (abiertos > 100) sospechaFuga = true;

    // La consulta real del sync, tal cual la hace services/speeding.js e idle.js.
    const unidad = await client.query(`SELECT vehicle_code FROM ${tabla} WHERE vehicle_code IS NOT NULL LIMIT 1`);
    if (!unidad.rows[0]) { console.log('  (sin datos para explicar la consulta)'); continue; }

    const plan = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT ${campos} FROM ${tabla}
        WHERE vehicle_code=$1 AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1`, [unidad.rows[0].vehicle_code]);
    const texto = plan.rows.map((r) => r['QUERY PLAN']).join('\n');
    const ms = Number((texto.match(/Execution Time: ([\d.]+) ms/) || [])[1] || 0);
    const usaIndice = texto.includes(indice);

    console.log(`  la consulta del sync tarda: ${ms.toFixed(1)} ms`);
    console.log(`  ¿usa ${indice}?  ${usaIndice ? 'sí' : 'NO — va a scan secuencial'}`);
    if (!usaIndice) sospechaFuga = true;
    if (ms > 200 && abiertos <= 100) lentoConPocos = true;

    console.log('\n' + texto.split('\n').map((l) => '    ' + l).join('\n'));
  }

  await client.end();

  console.log('\n' + '─'.repeat(72));
  console.log('REFERENCIA: con 3.000 filas y 60 eventos abiertos, sobre un Postgres 16');
  console.log('local, esta misma consulta tarda 0,03 ms. En el log de producción');
  console.log('aparece a ~1.000 ms. Ese contraste es el que hay que explicar.');
  console.log('─'.repeat(72));
  if (sospechaFuga) {
    console.log('VEREDICTO: hay eventos que NO se están cerrando.');
    console.log('  El índice parcial solo cubre los abiertos: si se acumulan, deja de');
    console.log('  ser selectivo y la consulta se degrada sola con el tiempo.');
    console.log('  Es un bug del código que abre/cierra eventos, no del plan de la base.');
  } else if (lentoConPocos) {
    console.log('VEREDICTO: pocos eventos abiertos y la consulta igual tarda.');
    console.log('  El cuello es la base (plan chico / CPU compartida), no el índice.');
    console.log('  No se arregla con código: es cuestión de plan en Render.');
  } else {
    console.log('VEREDICTO: la consulta anda bien acá y hay pocos eventos abiertos.');
    console.log('  Si en el log de producción igual aparece lenta, es carga puntual del');
    console.log('  momento (el sync toca 42 unidades seguidas), no un problema estructural.');
  }
  console.log('─'.repeat(72));
  console.log('\nEste comando no modificó nada: solo leyó y explicó consultas.\n');
}

main().catch((e) => {
  console.error('✗ diagnóstico falló:', e.message);
  process.exit(2);
});
