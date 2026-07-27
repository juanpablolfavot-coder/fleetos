#!/usr/bin/env node
/**
 * Diagnóstico de km recorridos por mes — detecta odómetros mal tipeados y
 * comparaciones injustas por mes incompleto.
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO LECTURA: no modifica nada.
 *
 * Los "km recorridos" del reporte mensual se calculan, por unidad, como
 * MAX(odómetro) − MIN(odómetro) entre las cargas del mes. Por eso:
 *   - UNA lectura mal tipeada infla/desinfla el km del mes entero, y
 *   - un mes INCOMPLETO (p. ej. julio a mitad de mes) da menos km que uno completo,
 *     porque se pierde lo recorrido después de la última carga de cada unidad.
 *
 * Qué muestra:
 *   1) Km total por mes (misma fórmula que el reporte) — mes COMPLETO.
 *   2) Comparación PAREJA: mismos días de cada mes (1..D), para comparar manzanas
 *      con manzanas cuando el último mes está incompleto.
 *   3) POR UNIDAD: mes A vs mes B lado a lado (km_veh y Δ), ordenado por la mayor
 *      diferencia → sirve para ver si UNA unidad infló un mes.
 *   4) Cargas SOSPECHOSAS: odómetro que retrocede o pega un pico anómalo (ventana
 *      ampliada un mes hacia atrás para atrapar typos al inicio del período).
 *
 * Uso (Shell de Render):
 *   node scripts/diagnostico-km-mensual.js                 → junio vs julio 2026
 *   node scripts/diagnostico-km-mensual.js 2026-05 2026-06 → los meses que le pases
 *   node scripts/diagnostico-km-mensual.js 2026-06 2026-07 20 → fuerza D=20 en la pareja
 */
const { pool } = require('../db/pool');

const num = n => Math.round(Number(n || 0)).toLocaleString('es-AR');
const args = process.argv.slice(2);
const argMeses = args.filter(a => /^\d{4}-\d{2}$/.test(a));
const argDia = args.map(Number).find(n => Number.isInteger(n) && n >= 1 && n <= 31) || null;
const MESES = argMeses.length >= 2 ? argMeses.slice(0, 2) : ['2026-06', '2026-07'];
const NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const label = ym => { const [y, m] = ym.split('-').map(Number); return `${NOMBRE[m - 1]} ${y}`; };
const lastDay = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const desdeYm = ym => `${ym}-01`;
const hastaYmDia = (ym, d) => `${ym}-${String(d).padStart(2, '0')} 23:59:59.999999`;
const mesAnterior = ym => { const [y, m] = ym.split('-').map(Number); const p = new Date(y, m - 2, 1); return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}`; };

// Km total (SUM de MAX−MIN por unidad) en un rango — misma regla que el reporte.
async function kmTotalRango(client, desde, hasta) {
  const r = await client.query(`
    SELECT COALESCE(SUM(km_veh),0) AS km_total, COUNT(*) AS unidades FROM (
      SELECT fl.vehicle_id, MAX(fl.odometer_km) - MIN(fl.odometer_km) AS km_veh
      FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
      WHERE fl.logged_at BETWEEN $1 AND $2
        AND fl.odometer_km IS NOT NULL AND fl.odometer_km > 0
        AND COALESCE(LOWER(fl.fuel_type),'') <> 'urea'
        AND COALESCE(LOWER(v.type),'') NOT LIKE '%autoelev%'
      GROUP BY fl.vehicle_id HAVING COUNT(*) >= 2
    ) t`, [desde, hasta]);
  return { kmTotal: Number(r.rows[0].km_total), unidades: Number(r.rows[0].unidades) };
}

// Por unidad (km_veh = MAX−MIN, min, max, cargas) en un rango.
async function porUnidadRango(client, desde, hasta) {
  const r = await client.query(`
    SELECT COALESCE(v.code, v.plate) AS code,
           MIN(fl.odometer_km) AS km_min, MAX(fl.odometer_km) AS km_max,
           MAX(fl.odometer_km) - MIN(fl.odometer_km) AS km_veh, COUNT(*) AS cargas
    FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
    WHERE fl.logged_at BETWEEN $1 AND $2
      AND fl.odometer_km IS NOT NULL AND fl.odometer_km > 0
      AND COALESCE(LOWER(fl.fuel_type),'') <> 'urea'
      AND COALESCE(LOWER(v.type),'') NOT LIKE '%autoelev%'
    GROUP BY COALESCE(v.code, v.plate) HAVING COUNT(*) >= 2
    ORDER BY km_veh DESC`, [desde, hasta]);
  return r.rows;
}

// Día del mes de la última carga en el mes (para comparar 1..D contra el otro mes).
async function ultimoDiaConDatos(client, ym) {
  const r = await client.query(`
    SELECT COALESCE(EXTRACT(DAY FROM MAX(fl.logged_at))::int, 0) AS d
    FROM fuel_logs fl
    WHERE fl.logged_at BETWEEN $1 AND $2 AND COALESCE(LOWER(fl.fuel_type),'') <> 'urea'`,
    [desdeYm(ym), hastaYmDia(ym, lastDay(ym))]);
  return r.rows[0].d;
}

// Lecturas fuera de orden (retroceso o pico aislado) en un rango.
async function sospechosas(client, desde, hasta) {
  const r = await client.query(`
    SELECT COALESCE(v.code, v.plate) AS code, fl.id, fl.logged_at, fl.odometer_km, fl.liters
    FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
    WHERE fl.logged_at BETWEEN $1 AND $2
      AND fl.odometer_km IS NOT NULL AND fl.odometer_km > 0
      AND COALESCE(LOWER(fl.fuel_type),'') <> 'urea'
      AND COALESCE(LOWER(v.type),'') NOT LIKE '%autoelev%'
    ORDER BY COALESCE(v.code, v.plate), fl.logged_at, fl.id`, [desde, hasta]);

  const porUnidad = new Map();
  for (const row of r.rows) {
    if (!porUnidad.has(row.code)) porUnidad.set(row.code, []);
    porUnidad.get(row.code).push(row);
  }

  const alertas = [];
  for (const [code, filas] of porUnidad) {
    for (let i = 0; i < filas.length; i++) {
      const cur = Number(filas[i].odometer_km);
      const prev = i > 0 ? Number(filas[i - 1].odometer_km) : null;
      const next = i < filas.length - 1 ? Number(filas[i + 1].odometer_km) : null;
      let motivo = null;
      if (prev != null && cur < prev && next != null && cur < next) {
        motivo = `dip aislado (baja a ${num(cur)} entre ${num(prev)} y ${num(next)}) — probable typo`;
      } else if (prev != null && cur < prev) {
        motivo = `retrocede vs lectura anterior (${num(prev)} → ${num(cur)})`;
      } else if (prev != null && next != null && cur > prev && cur > next && (cur - prev) > 50000 && (cur - next) > 50000) {
        motivo = `pico aislado (sube a ${num(cur)} entre ${num(prev)} y ${num(next)}) — posible typo`;
      }
      if (motivo) alertas.push({ code, ...filas[i], odometer_km: cur, motivo });
    }
  }
  return alertas;
}

(async () => {
  const client = await pool.connect();
  try {
    const [A, B] = MESES;
    console.log(`\n🔎 DIAGNÓSTICO DE KM MENSUAL (solo lectura) — ${label(A)} vs ${label(B)}\n`);

    // 1) Km total por mes COMPLETO
    const totA = await kmTotalRango(client, desdeYm(A), hastaYmDia(A, lastDay(A)));
    const totB = await kmTotalRango(client, desdeYm(B), hastaYmDia(B, lastDay(B)));
    console.log('=== 1) KM POR MES (mes completo, fórmula del reporte) ===');
    console.log(`   ${label(A).padEnd(14)} ${num(totA.kmTotal).padStart(12)} km   (${totA.unidades} unidades)`);
    console.log(`   ${label(B).padEnd(14)} ${num(totB.kmTotal).padStart(12)} km   (${totB.unidades} unidades)`);
    if (totA.kmTotal > 0) {
      const d = totB.kmTotal - totA.kmTotal;
      console.log(`   → ${label(B)} vs ${label(A)}: ${d >= 0 ? '+' : ''}${num(d)} km (${(d / totA.kmTotal * 100).toFixed(1)}%)`);
    }

    // 2) Comparación PAREJA (mismos días: 1..D)
    const D = argDia || await ultimoDiaConDatos(client, B) || lastDay(B);
    const pA = await kmTotalRango(client, desdeYm(A), hastaYmDia(A, D));
    const pB = await kmTotalRango(client, desdeYm(B), hastaYmDia(B, D));
    console.log(`\n=== 2) COMPARACIÓN PAREJA — días 1 a ${D} de cada mes ===`);
    console.log(`   (${label(B)} está incompleto; acá se recorta ${label(A)} al mismo tramo)`);
    console.log(`   ${label(A)} 1–${D}: ${num(pA.kmTotal).padStart(12)} km   (${pA.unidades} unidades)`);
    console.log(`   ${label(B)} 1–${D}: ${num(pB.kmTotal).padStart(12)} km   (${pB.unidades} unidades)`);
    if (pA.kmTotal > 0) {
      const d = pB.kmTotal - pA.kmTotal;
      console.log(`   → PAREJO: ${d >= 0 ? '+' : ''}${num(d)} km (${(d / pA.kmTotal * 100).toFixed(1)}%)`);
      console.log(`   → Si acá la diferencia casi desaparece, el bajón era solo por mes incompleto.`);
      console.log(`     Si igual queda grande, un mes está distorsionado (ver puntos 3 y 4).`);
    }

    // 3) POR UNIDAD: A vs B lado a lado (mes completo), ordenado por mayor diferencia
    const uA = await porUnidadRango(client, desdeYm(A), hastaYmDia(A, lastDay(A)));
    const uB = await porUnidadRango(client, desdeYm(B), hastaYmDia(B, lastDay(B)));
    const mapA = new Map(uA.map(u => [u.code, u]));
    const mapB = new Map(uB.map(u => [u.code, u]));
    const codes = [...new Set([...mapA.keys(), ...mapB.keys()])];
    const filas = codes.map(c => {
      const a = mapA.get(c), b = mapB.get(c);
      return { code: c, kmA: a ? Number(a.km_veh) : 0, kmB: b ? Number(b.km_veh) : 0,
               minA: a ? a.km_min : null, maxA: a ? a.km_max : null, soloA: !!a && !b, soloB: !a && !!b };
    }).sort((x, y) => (y.kmA - y.kmB) - (x.kmA - x.kmB));
    console.log(`\n=== 3) POR UNIDAD: ${label(A)} vs ${label(B)} (km_veh, mes completo) ===`);
    console.log(`   unidad       ${label(A).slice(0,3)}         ${label(B).slice(0,3)}        Δ(${label(A).slice(0,3)}−${label(B).slice(0,3)})   ${label(A).slice(0,3)} min→max`);
    filas.slice(0, 20).forEach(f => {
      const flag = f.soloA ? '  (solo ' + label(A).slice(0,3) + ')' : f.soloB ? '  (solo ' + label(B).slice(0,3) + ')' : '';
      const span = f.minA != null ? `${num(f.minA)}→${num(f.maxA)}` : '';
      console.log(`   ${String(f.code).padEnd(10)} ${num(f.kmA).padStart(9)}  ${num(f.kmB).padStart(9)}  ${((f.kmA - f.kmB) >= 0 ? '+' : '') + num(f.kmA - f.kmB)}`.padEnd(52) + `   ${span}${flag}`);
    });
    console.log(`   (Δ grande y positivo = esa unidad rindió mucho más en ${label(A)}: candidata a ${label(A)} inflado)`);

    // 4) Cargas sospechosas — ventana ampliada un mes hacia atrás
    const desde = desdeYm(mesAnterior(A));
    const hasta = hastaYmDia(B, lastDay(B));
    const alertas = await sospechosas(client, desde, hasta);
    console.log(`\n=== 4) CARGAS SOSPECHOSAS (odómetro fuera de orden, ${label(mesAnterior(A))}–${label(B)}) — ${alertas.length} ===`);
    if (!alertas.length) {
      console.log('   Sin lecturas fuera de orden. El desfase no viene de un typo detectable así.');
    } else {
      alertas.forEach(a => {
        const f = new Date(a.logged_at).toLocaleString('es-AR');
        console.log(`   ⚠ ${String(a.code).padEnd(10)} ${f}  ·  ${a.liters} L  ·  ${num(a.odometer_km)} km`);
        console.log(`       ${a.motivo}`);
      });
      console.log(`\n   Cada una se corrige con un script puntual (patrón corregir-km-*.js).`);
    }
    console.log('');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
