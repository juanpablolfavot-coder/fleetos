#!/usr/bin/env node
/**
 * Diagnóstico de km recorridos por mes — detecta odómetros mal tipeados.
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO LECTURA: no modifica nada. Sirve para entender por qué un mes puede dar
 * "más km" que otro cuando en realidad hay una lectura de odómetro cargada mal.
 *
 * Los "km recorridos" del reporte mensual se calculan, por unidad, como
 * MAX(odómetro) − MIN(odómetro) entre las cargas de combustible del mes. Por eso
 * UNA sola lectura mal tipeada (p. ej. 12.325 en vez de 123.251) infla o desinfla
 * el km del mes entero.
 *
 * Qué muestra:
 *   1) Km total por mes (misma fórmula que el reporte mensual) y variación.
 *   2) Desglose por unidad (km_veh = MAX−MIN) del mes.
 *   3) Cargas SOSPECHOSAS: lecturas donde el odómetro "retrocede" en el tiempo
 *      (dip aislado = típico error de tipeo) o pega un salto anómalo.
 *
 * Uso (Shell de Render):
 *   node scripts/diagnostico-km-mensual.js                 → junio vs julio 2026
 *   node scripts/diagnostico-km-mensual.js 2026-05 2026-06 → los meses que le pases
 */
const { pool } = require('../db/pool');

const num = n => Math.round(Number(n || 0)).toLocaleString('es-AR');
const argMeses = process.argv.slice(2).filter(a => /^\d{4}-\d{2}$/.test(a));
const MESES = argMeses.length >= 2 ? argMeses.slice(0, 2) : ['2026-06', '2026-07'];
const NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const label = ym => { const [y, m] = ym.split('-').map(Number); return `${NOMBRE[m - 1]} ${y}`; };
const rango = ym => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { desde: `${ym}-01`, hasta: `${ym}-${String(last).padStart(2, '0')} 23:59:59.999999` };
};

// Km del mes con la MISMA regla que services/reporte-mensual.js
async function kmTotalMes(client, ym) {
  const { desde, hasta } = rango(ym);
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

// Desglose por unidad del mes (km_veh = MAX−MIN), con min/max para ver qué lo empuja.
async function porUnidadMes(client, ym) {
  const { desde, hasta } = rango(ym);
  const r = await client.query(`
    SELECT v.code, v.plate,
           MIN(fl.odometer_km) AS km_min, MAX(fl.odometer_km) AS km_max,
           MAX(fl.odometer_km) - MIN(fl.odometer_km) AS km_veh, COUNT(*) AS cargas
    FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
    WHERE fl.logged_at BETWEEN $1 AND $2
      AND fl.odometer_km IS NOT NULL AND fl.odometer_km > 0
      AND COALESCE(LOWER(fl.fuel_type),'') <> 'urea'
      AND COALESCE(LOWER(v.type),'') NOT LIKE '%autoelev%'
    GROUP BY v.code, v.plate HAVING COUNT(*) >= 2
    ORDER BY km_veh DESC`, [desde, hasta]);
  return r.rows;
}

// Detección de lecturas fuera de orden (odómetro que retrocede en el tiempo).
async function sospechosas(client, desde, hasta) {
  const r = await client.query(`
    SELECT v.code, v.plate, fl.id, fl.logged_at, fl.odometer_km, fl.liters, fl.fuel_type
    FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
    WHERE fl.logged_at BETWEEN $1 AND $2
      AND fl.odometer_km IS NOT NULL AND fl.odometer_km > 0
      AND COALESCE(LOWER(fl.fuel_type),'') <> 'urea'
      AND COALESCE(LOWER(v.type),'') NOT LIKE '%autoelev%'
    ORDER BY v.code, fl.logged_at, fl.id`, [desde, hasta]);

  const porUnidad = new Map();
  for (const row of r.rows) {
    const k = row.code || row.plate;
    if (!porUnidad.has(k)) porUnidad.set(k, []);
    porUnidad.get(k).push(row);
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
      if (motivo) {
        alertas.push({ code, ...filas[i], odometer_km: cur, motivo });
      }
    }
  }
  return alertas;
}

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n🔎 DIAGNÓSTICO DE KM MENSUAL (solo lectura) — ${MESES.map(label).join(' vs ')}\n`);

    // 1) Km total por mes
    const totales = [];
    for (const ym of MESES) totales.push({ ym, ...(await kmTotalMes(client, ym)) });
    console.log('=== KM RECORRIDOS POR MES (misma fórmula que el reporte) ===');
    totales.forEach(t => console.log(`   ${label(t.ym).padEnd(14)} ${num(t.kmTotal).padStart(12)} km   (${t.unidades} unidades)`));
    if (totales.length === 2 && totales[0].kmTotal > 0) {
      const d = totales[1].kmTotal - totales[0].kmTotal;
      const pct = (d / totales[0].kmTotal) * 100;
      console.log(`   → Variación ${label(totales[1].ym)} vs ${label(totales[0].ym)}: ${d >= 0 ? '+' : ''}${num(d)} km (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`);
    }

    // 2) Desglose por unidad (mes más reciente y quién lo empuja)
    const ymUlt = MESES[MESES.length - 1];
    const desg = await porUnidadMes(client, ymUlt);
    console.log(`\n=== DESGLOSE POR UNIDAD — ${label(ymUlt)} (top 15 por km) ===`);
    console.log('   unidad     km_veh        min → max            cargas');
    desg.slice(0, 15).forEach(u =>
      console.log(`   ${String(u.code || u.plate).padEnd(10)} ${num(u.km_veh).padStart(10)}   ${num(u.km_min)} → ${num(u.km_max)}`.padEnd(58) + `   ${u.cargas}`));

    // 3) Cargas sospechosas en toda la ventana analizada
    const desde = rango(MESES[0]).desde;
    const hasta = rango(MESES[MESES.length - 1]).hasta;
    const alertas = await sospechosas(client, desde, hasta);
    console.log(`\n=== CARGAS SOSPECHOSAS (odómetro fuera de orden) — ${alertas.length} ===`);
    if (!alertas.length) {
      console.log('   No se detectaron lecturas fuera de orden en la ventana. El desfase entre meses');
      console.log('   puede deberse a distinto Nº de cargas por unidad, altas/bajas de unidades, etc.');
    } else {
      alertas.forEach(a => {
        const f = new Date(a.logged_at).toLocaleString('es-AR');
        console.log(`   ⚠ ${String(a.code).padEnd(10)} ${f}  ·  ${a.liters} L  ·  ${num(a.odometer_km)} km`);
        console.log(`       ${a.motivo}`);
      });
      console.log(`\n   Estas lecturas son las candidatas a corregir. Cada una se arregla con un script`);
      console.log(`   puntual (patrón corregir-km-*.js): odometer_km actual → valor real.`);
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
