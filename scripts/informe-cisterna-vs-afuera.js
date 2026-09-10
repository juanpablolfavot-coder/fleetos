#!/usr/bin/env node
/**
 * Informe: quién carga gasoil en la CISTERNA y quién carga EN RUTA (estación),
 * y qué porcentaje de los litros va por cada lado.
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO LECTURA. Pedido de gerencia (09/2026).
 *
 * De dónde sale cada cosa:
 *   · carga en cisterna → fuel_logs con tank_id (descontó litros de un tanque
 *                         propio; el nombre del tanque está en tanks.location)
 *   · carga afuera      → fuel_logs sin tank_id; el lugar es fuel_logs.location
 *                         (texto libre que escribe quien registra la carga)
 *   · chofer            → fuel_logs.driver_name (el de la carga), o el chofer
 *                         asignado a la unidad si la carga no lo trae
 *   · $                 → litros × price_per_l de esa carga (afuera es el precio
 *                         del ticket; en cisterna, el precio del tanque al momento)
 *
 * Sólo gasoil: la urea queda afuera, como en todos los informes de consumo.
 *
 * Muestra, por mes: resumen, por unidad, por chofer, lugares externos, y al
 * final un bloque CSV (separado por ";") para pegar directo en Excel.
 *
 * Uso (Shell de Render):
 *   node scripts/informe-cisterna-vs-afuera.js                  → mes anterior y mes actual
 *   node scripts/informe-cisterna-vs-afuera.js 2026-08          → un mes
 *   node scripts/informe-cisterna-vs-afuera.js 2026-06 2026-09  → desde … hasta (inclusive)
 *   node scripts/informe-cisterna-vs-afuera.js 2026-08 --csv    → SOLO el CSV (para redirigir a un archivo)
 */
const { pool } = require('../db/pool');

const SOLO_CSV = process.argv.includes('--csv');
const num = (n, d = 0) => Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (a, b) => (Number(b) > 0 ? num(100 * Number(a) / Number(b), 1) + ' %' : '—');
const NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const label = ym => { const [y, m] = ym.split('-').map(Number); return `${NOMBRE[m - 1]} ${y}`; };

// Hoy en hora argentina (el server corre en UTC).
function mesAR(offset = 0) {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
}
function listaMeses() {
  const args = process.argv.slice(2).filter(a => /^\d{4}-\d{2}$/.test(a)).sort();
  if (!args.length) return [mesAR(-1), mesAR(0)];
  if (args.length === 1) return args;
  const out = [];
  let [y, m] = args[0].split('-').map(Number);
  const [y2, m2] = args[args.length - 1].split('-').map(Number);
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// Una fila por carga, ya clasificada. Todo lo demás se agrupa en JS.
const SQL = `
  SELECT fl.id, fl.logged_at, fl.liters, fl.price_per_l,
         (fl.tank_id IS NOT NULL)                                   AS en_cisterna,
         CASE WHEN fl.tank_id IS NOT NULL
              THEN COALESCE(NULLIF(BTRIM(t.location),''), 'Cisterna')
              ELSE COALESCE(NULLIF(BTRIM(fl.location),''), '(sin lugar)') END AS lugar,
         COALESCE(NULLIF(BTRIM(fl.driver_name),''), NULLIF(BTRIM(v.driver_name),''), u.name, '(sin chofer)') AS chofer,
         COALESCE(v.plate, v.code, '(sin unidad)')                  AS unidad,
         COALESCE(v.base, '')                                       AS base
    FROM fuel_logs fl
    LEFT JOIN vehicles v ON v.id = fl.vehicle_id
    LEFT JOIN tanks    t ON t.id = fl.tank_id
    LEFT JOIN users    u ON u.id = v.driver_id
   WHERE COALESCE(LOWER(fl.fuel_type),'') <> 'urea'
     AND TO_CHAR(fl.logged_at AT TIME ZONE 'America/Argentina/Buenos_Aires','YYYY-MM') = $1
   ORDER BY fl.logged_at`;

function vacio() { return { cargas: 0, litros: 0, pesos: 0, cCargas: 0, cLitros: 0, cPesos: 0, aCargas: 0, aLitros: 0, aPesos: 0, lugares: new Map() }; }
function sumar(acc, r) {
  const l = Number(r.liters) || 0, p = l * (Number(r.price_per_l) || 0);
  acc.cargas++; acc.litros += l; acc.pesos += p;
  if (r.en_cisterna) { acc.cCargas++; acc.cLitros += l; acc.cPesos += p; }
  else {
    acc.aCargas++; acc.aLitros += l; acc.aPesos += p;
    const lg = acc.lugares.get(r.lugar) || { cargas: 0, litros: 0 };
    lg.cargas++; lg.litros += l; acc.lugares.set(r.lugar, lg);
  }
}
function agrupar(filas, clave) {
  const m = new Map();
  for (const r of filas) {
    const k = clave(r);
    if (!m.has(k)) m.set(k, { ...vacio(), lugares: new Map(), extra: r });
    sumar(m.get(k), r);
  }
  // Primero las que más cargan afuera: es lo que gerencia quiere ver.
  return [...m.entries()].sort((a, b) => b[1].aLitros - a[1].aLitros || b[1].litros - a[1].litros);
}
const lugaresTxt = acc => [...acc.lugares.entries()].sort((a, b) => b[1].litros - a[1].litros)
  .map(([n, x]) => `${n} (${x.cargas})`).join(', ');

function imprimirMes(ym, filas) {
  const tot = vacio(); filas.forEach(r => sumar(tot, r));
  console.log(`\n${'═'.repeat(100)}\n  ${label(ym).toUpperCase()} — cargas de gasoil\n${'═'.repeat(100)}`);
  if (!filas.length) { console.log('  (sin cargas registradas)'); return; }

  console.log(`\n  RESUMEN`);
  console.log(`    Cisterna:  ${String(tot.cCargas).padStart(4)} cargas  ${num(tot.cLitros).padStart(10)} L  $ ${num(tot.cPesos).padStart(13)}   (${pct(tot.cLitros, tot.litros)} de los litros)`);
  console.log(`    En ruta:   ${String(tot.aCargas).padStart(4)} cargas  ${num(tot.aLitros).padStart(10)} L  $ ${num(tot.aPesos).padStart(13)}   (${pct(tot.aLitros, tot.litros)} de los litros)`);
  console.log(`    Total:     ${String(tot.cargas).padStart(4)} cargas  ${num(tot.litros).padStart(10)} L  $ ${num(tot.pesos).padStart(13)}`);

  const cab = `    ${'UNIDAD'.padEnd(10)} ${'BASE'.padEnd(12)} ${'CIST. n'.padStart(8)} ${'CIST. L'.padStart(10)} ${'EN RUTA n'.padStart(9)} ${'EN RUTA L'.padStart(10)} ${'EN RUTA $'.padStart(13)} ${'% EN RUTA'.padStart(9)}  DÓNDE CARGA EN RUTA`;
  console.log(`\n  POR UNIDAD (ordenado por litros cargados en ruta)\n${cab}\n    ${'─'.repeat(110)}`);
  for (const [unidad, a] of agrupar(filas, r => r.unidad)) {
    console.log(`    ${unidad.padEnd(10)} ${a.extra.base.slice(0, 12).padEnd(12)} ${String(a.cCargas).padStart(8)} ${num(a.cLitros).padStart(10)} ${String(a.aCargas).padStart(9)} ${num(a.aLitros).padStart(10)} ${num(a.aPesos).padStart(13)} ${pct(a.aLitros, a.litros).padStart(9)}  ${lugaresTxt(a)}`);
  }

  console.log(`\n  POR CHOFER (ordenado por litros cargados en ruta)`);
  console.log(`    ${'CHOFER'.padEnd(28)} ${'CIST. n'.padStart(8)} ${'CIST. L'.padStart(10)} ${'EN RUTA n'.padStart(9)} ${'EN RUTA L'.padStart(10)} ${'EN RUTA $'.padStart(13)} ${'% EN RUTA'.padStart(9)}  DÓNDE CARGA EN RUTA\n    ${'─'.repeat(110)}`);
  for (const [chofer, a] of agrupar(filas, r => r.chofer)) {
    console.log(`    ${chofer.slice(0, 28).padEnd(28)} ${String(a.cCargas).padStart(8)} ${num(a.cLitros).padStart(10)} ${String(a.aCargas).padStart(9)} ${num(a.aLitros).padStart(10)} ${num(a.aPesos).padStart(13)} ${pct(a.aLitros, a.litros).padStart(9)}  ${lugaresTxt(a)}`);
  }

  const afuera = filas.filter(r => !r.en_cisterna);
  if (afuera.length) {
    console.log(`\n  LUGARES DONDE SE CARGA EN RUTA`);
    console.log(`    ${'LUGAR'.padEnd(32)} ${'CARGAS'.padStart(7)} ${'LITROS'.padStart(10)} ${'$'.padStart(13)} ${'$/L prom'.padStart(9)}  UNIDADES\n    ${'─'.repeat(110)}`);
    for (const [lugar, a] of agrupar(afuera, r => r.lugar)) {
      const unidades = [...new Set(afuera.filter(r => r.lugar === lugar).map(r => r.unidad))].join(', ');
      console.log(`    ${lugar.slice(0, 32).padEnd(32)} ${String(a.cargas).padStart(7)} ${num(a.litros).padStart(10)} ${num(a.pesos).padStart(13)} ${(a.litros ? num(a.pesos / a.litros, 2) : '—').padStart(9)}  ${unidades}`);
    }
  }
}

// CSV con ";" — es el separador que Excel en castellano abre directo.
function csvMes(ym, filas, out) {
  for (const [unidad, a] of agrupar(filas, r => r.unidad)) {
    out.push([label(ym), unidad, a.extra.base, a.cCargas, num(a.cLitros, 2), num(a.cPesos, 2),
      a.aCargas, num(a.aLitros, 2), num(a.aPesos, 2), pct(a.aLitros, a.litros).replace(' %', ''),
      lugaresTxt(a)].map(x => String(x).replace(/;/g, ',')).join(';'));
  }
}
function csvChofer(ym, filas, out) {
  for (const [chofer, a] of agrupar(filas, r => r.chofer)) {
    out.push([label(ym), chofer, a.cCargas, num(a.cLitros, 2), num(a.cPesos, 2),
      a.aCargas, num(a.aLitros, 2), num(a.aPesos, 2), pct(a.aLitros, a.litros).replace(' %', ''),
      lugaresTxt(a)].map(x => String(x).replace(/;/g, ',')).join(';'));
  }
}

(async () => {
  const client = await pool.connect();
  try {
    const meses = listaMeses();
    const csvU = ['Mes;Unidad;Base;Cisterna cargas;Cisterna litros;Cisterna $;En ruta cargas;En ruta litros;En ruta $;% en ruta;Dónde carga en ruta'];
    const csvC = ['Mes;Chofer;Cisterna cargas;Cisterna litros;Cisterna $;En ruta cargas;En ruta litros;En ruta $;% en ruta;Dónde carga en ruta'];

    if (!SOLO_CSV) console.log(`\n⛽ CISTERNA vs EN RUTA — ${meses.map(label).join(', ')}   (sólo lectura, sólo gasoil)`);
    const evolucion = [];
    for (const ym of meses) {
      const { rows } = await client.query(SQL, [ym]);
      if (!SOLO_CSV) imprimirMes(ym, rows);
      const tot = vacio(); rows.forEach(r => sumar(tot, r));
      evolucion.push({ ym, tot });
      csvMes(ym, rows, csvU);
      csvChofer(ym, rows, csvC);
    }

    // El número que pide gerencia: qué parte del gasoil se carga en cisterna y
    // qué parte en ruta, mes a mes. Por LITROS, no por cantidad de cargas: una
    // carga en ruta suele ser un tanque lleno, y contar cargas la subestima.
    if (!SOLO_CSV) {
      console.log(`\n${'═'.repeat(100)}\n  EVOLUCIÓN — % del gasoil cargado en cisterna y en ruta (por litros)\n${'═'.repeat(100)}`);
      console.log(`    ${'MES'.padEnd(18)} ${'CISTERNA L'.padStart(11)} ${'EN RUTA L'.padStart(11)} ${'TOTAL L'.padStart(11)} ${'% CISTERNA'.padStart(11)} ${'% EN RUTA'.padStart(10)}   (por cargas: % en ruta)\n    ${'─'.repeat(96)}`);
      for (const { ym, tot } of evolucion) {
        console.log(`    ${label(ym).padEnd(18)} ${num(tot.cLitros).padStart(11)} ${num(tot.aLitros).padStart(11)} ${num(tot.litros).padStart(11)} ${pct(tot.cLitros, tot.litros).padStart(11)} ${pct(tot.aLitros, tot.litros).padStart(10)}   (${pct(tot.aCargas, tot.cargas)})`);
      }
      const T = vacio(); evolucion.forEach(e => { for (const k of ['cargas','litros','pesos','cCargas','cLitros','cPesos','aCargas','aLitros','aPesos']) T[k] += e.tot[k]; });
      if (evolucion.length > 1)
        console.log(`    ${'─'.repeat(96)}\n    ${'Período completo'.padEnd(18)} ${num(T.cLitros).padStart(11)} ${num(T.aLitros).padStart(11)} ${num(T.litros).padStart(11)} ${pct(T.cLitros, T.litros).padStart(11)} ${pct(T.aLitros, T.litros).padStart(10)}   (${pct(T.aCargas, T.cargas)})`);
    }

    if (!SOLO_CSV) console.log(`\n${'═'.repeat(100)}\n  CSV PARA EXCEL — copiá desde la línea de encabezado, pegá en una hoja y usá "Texto en columnas" con ";"\n${'═'.repeat(100)}`);
    console.log(`\n--- POR UNIDAD ---`);
    console.log(csvU.join('\n'));
    console.log(`\n--- POR CHOFER ---`);
    console.log(csvC.join('\n'));
    console.log('');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
