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

// Litros (no urea, no autoelev) por unidad en un rango — para cruzar con km.
async function litrosPorUnidad(client, desde, hasta) {
  const r = await client.query(`
    SELECT COALESCE(v.code, v.plate) AS code, COALESCE(SUM(fl.liters),0) AS litros
    FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
    WHERE fl.logged_at BETWEEN $1 AND $2 AND COALESCE(LOWER(fl.fuel_type),'') <> 'urea'
      AND COALESCE(LOWER(v.type),'') NOT LIKE '%autoelev%'
    GROUP BY COALESCE(v.code, v.plate)`, [desde, hasta]);
  return new Map(r.rows.map(x => [x.code, Number(x.litros)]));
}

// Rendimiento "interno" por unidad: km_veh / (litros SIN la última carga).
// Excluir la última carga quita el gasoil que se maneja DESPUÉS del último odómetro
// (la "cola" del mes incompleto), dejando la eficiencia real medida entre cargas.
async function rendInternoPorUnidad(client, desde, hasta) {
  const r = await client.query(`
    SELECT COALESCE(v.code, v.plate) AS code, fl.logged_at, fl.id, fl.odometer_km, fl.liters
    FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
    WHERE fl.logged_at BETWEEN $1 AND $2 AND COALESCE(LOWER(fl.fuel_type),'') <> 'urea'
      AND COALESCE(LOWER(v.type),'') NOT LIKE '%autoelev%'
      AND fl.odometer_km IS NOT NULL AND fl.odometer_km > 0
    ORDER BY COALESCE(v.code, v.plate), fl.logged_at, fl.id`, [desde, hasta]);
  const porU = new Map();
  for (const row of r.rows) {
    if (!porU.has(row.code)) porU.set(row.code, []);
    porU.get(row.code).push(row);
  }
  const out = new Map();
  for (const [code, f] of porU) {
    if (f.length < 2) continue;
    const kmVeh = Number(f[f.length - 1].odometer_km) - Number(f[0].odometer_km);
    const litrosSinUlt = f.slice(0, -1).reduce((a, x) => a + Number(x.liters || 0), 0); // fuel 1..n-1
    out.set(code, { kmVeh, litrosSinUlt, kmL: litrosSinUlt > 0 ? kmVeh / litrosSinUlt : 0 });
  }
  return out;
}

// Auditoría/reconciliación de un mes: cuántas cargas hay y cuántas entran al km.
async function auditarMes(client, ym) {
  const desde = desdeYm(ym), hasta = hastaYmDia(ym, lastDay(ym));
  const tot = (await client.query(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE COALESCE(LOWER(fuel_type),'') = 'urea')  AS urea,
           COUNT(*) FILTER (WHERE COALESCE(LOWER(fuel_type),'') <> 'urea') AS combustible
    FROM fuel_logs WHERE logged_at BETWEEN $1 AND $2`, [desde, hasta])).rows[0];
  // Cargas de combustible sin vehículo asociado (no entran).
  const sinVeh = (await client.query(`
    SELECT COUNT(*) AS n FROM fuel_logs
    WHERE logged_at BETWEEN $1 AND $2 AND COALESCE(LOWER(fuel_type),'') <> 'urea' AND vehicle_id IS NULL`,
    [desde, hasta])).rows[0].n;
  // Clasificación de las de combustible con vehículo.
  const cls = (await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE COALESCE(LOWER(v.type),'') LIKE '%autoelev%') AS autoelev,
      COUNT(*) FILTER (WHERE COALESCE(LOWER(v.type),'') NOT LIKE '%autoelev%' AND (fl.odometer_km IS NULL OR fl.odometer_km <= 0)) AS sin_odo,
      COUNT(*) FILTER (WHERE COALESCE(LOWER(v.type),'') NOT LIKE '%autoelev%' AND fl.odometer_km > 0) AS con_odo
    FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
    WHERE fl.logged_at BETWEEN $1 AND $2 AND COALESCE(LOWER(fl.fuel_type),'') <> 'urea'`, [desde, hasta])).rows[0];
  // Por unidad (con odómetro válido): cuántas cargas y km_veh.
  const perVeh = (await client.query(`
    SELECT COALESCE(v.code, v.plate) AS code, COUNT(*) AS cargas,
           MIN(fl.odometer_km) AS mn, MAX(fl.odometer_km) AS mx,
           MAX(fl.odometer_km) - MIN(fl.odometer_km) AS km_veh
    FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
    WHERE fl.logged_at BETWEEN $1 AND $2 AND COALESCE(LOWER(fl.fuel_type),'') <> 'urea'
      AND COALESCE(LOWER(v.type),'') NOT LIKE '%autoelev%' AND fl.odometer_km > 0
    GROUP BY COALESCE(v.code, v.plate) ORDER BY cargas DESC, code`, [desde, hasta])).rows;
  return { tot, sinVeh: Number(sinVeh), cls, perVeh };
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

    // 5) AUDITORÍA / RECONCILIACIÓN de las cargas del mes más nuevo (B)
    const au = await auditarMes(client, B);
    const con2 = au.perVeh.filter(u => Number(u.cargas) >= 2);
    const con1 = au.perVeh.filter(u => Number(u.cargas) === 1);
    const sumaKm = con2.reduce((a, u) => a + Number(u.km_veh), 0);
    console.log(`\n=== 5) AUDITORÍA DE CARGAS — ${label(B)} (¿se toma todo?) ===`);
    console.log(`   Cargas totales del mes: ${au.tot.total}   (urea: ${au.tot.urea} · combustible: ${au.tot.combustible})`);
    console.log(`   De las ${au.tot.combustible} de combustible, NO entran al cálculo de km:`);
    console.log(`     · ${au.cls.autoelev} en autoelevadores (excluidos a propósito)`);
    console.log(`     · ${au.sinVeh} sin vehículo asociado`);
    console.log(`     · ${au.cls.sin_odo} sin odómetro cargado (o en 0)`);
    console.log(`   Con odómetro válido: ${au.cls.con_odo} cargas en ${au.perVeh.length} unidades.`);
    console.log(`     · ${con2.length} unidades con ≥2 cargas → ENTRAN (km medible)`);
    console.log(`     · ${con1.length} unidades con 1 sola carga → NO entran (no se puede medir distancia con 1 punto)`);
    if (con1.length) {
      console.log(`       Unidades con 1 sola carga en ${label(B)} (km "perdido" para el total):`);
      con1.forEach(u => console.log(`         - ${String(u.code).padEnd(10)} 1 carga · odo ${num(u.mn)}`));
    }
    console.log(`   Reconciliación: suma de km de las ${con2.length} unidades = ${num(sumaKm)} km`);
    console.log(`     ${Math.abs(sumaKm - totB.kmTotal) < 1 ? '✓ coincide con el total del bloque 1' : '⚠ NO coincide con el bloque 1 (' + num(totB.kmTotal) + ') — revisar'}`);
    console.log(`\n   Detalle por unidad (${label(B)}, con odómetro válido):`);
    console.log(`   unidad     cargas   km_veh        min → max`);
    au.perVeh.forEach(u =>
      console.log(`   ${String(u.code).padEnd(10)} ${String(u.cargas).padStart(4)}   ${num(u.km_veh).padStart(9)}   ${num(u.mn)} → ${num(u.mx)}`));

    // 6) RENDIMIENTO km/L por unidad: A vs B, y km "faltante" en B según su gasoil.
    const litA = await litrosPorUnidad(client, desdeYm(A), hastaYmDia(A, lastDay(A)));
    const litB = await litrosPorUnidad(client, desdeYm(B), hastaYmDia(B, lastDay(B)));
    const totLitA = [...litA.values()].reduce((a, b) => a + b, 0);
    const totLitB = [...litB.values()].reduce((a, b) => a + b, 0);
    const rendA = totLitA > 0 ? totA.kmTotal / totLitA : 0;
    const rendB = totLitB > 0 ? totB.kmTotal / totLitB : 0;
    console.log(`\n=== 6) RENDIMIENTO km/L POR UNIDAD — ${label(A)} vs ${label(B)} ===`);
    console.log(`   Flota: ${label(A)} ${rendA.toFixed(2)} km/L   ·   ${label(B)} ${rendB.toFixed(2)} km/L`);
    console.log(`   "km faltante" en ${label(B)} = litros_${label(B).slice(0,3)} × rend_${label(A).slice(0,3)} − km_${label(B).slice(0,3)}`);
    console.log(`   (mide cuántos km debería haber recorrido según su gasoil, si rindiera como en ${label(A)})\n`);
    const rows = codes.map(c => {
      const kA = mapA.get(c) ? Number(mapA.get(c).km_veh) : 0;
      const kB = mapB.get(c) ? Number(mapB.get(c).km_veh) : 0;
      const lA = litA.get(c) || 0, lB = litB.get(c) || 0;
      const rA = lA > 0 ? kA / lA : 0, rB = lB > 0 ? kB / lB : 0;
      const faltante = rA > 0 ? Math.round(lB * rA - kB) : 0; // km que "faltan" en B según su gasoil
      return { code: c, kA, kB, lA, lB, rA, rB, faltante };
    }).filter(r => r.lB > 0).sort((x, y) => y.faltante - x.faltante);
    console.log(`   unidad     ${label(A).slice(0,3)} km/L   ${label(B).slice(0,3)} km/L   ${label(B).slice(0,3)} litros   ${label(B).slice(0,3)} km    km faltante`);
    rows.slice(0, 22).forEach(r => {
      const flag = (r.rA > 0 && r.rB < r.rA * 0.6 && r.faltante > 1500) ? '  ⚠ km bajo p/su gasoil' : '';
      console.log(`   ${String(r.code).padEnd(10)} ${r.rA.toFixed(2).padStart(7)}  ${r.rB.toFixed(2).padStart(8)}  ${num(r.lB).padStart(8)}  ${num(r.kB).padStart(8)}  ${(r.faltante >= 0 ? '+' : '') + num(r.faltante)}`.padEnd(66) + flag);
    });
    const totalFaltante = rows.reduce((a, r) => a + Math.max(0, r.faltante), 0);
    console.log(`\n   Suma de "km faltante" en ${label(B)}: ~${num(totalFaltante)} km`);
    console.log(`   → Si se reparte parejo entre muchas unidades = mes incompleto (se corrige al cerrar el mes).`);
    console.log(`   → Si se concentra en pocas ⚠ = esas unidades tienen odómetro subcargado (lecturas a revisar).`);

    // 7) km/L INTERNO (excluye la última carga → quita la "cola" del mes incompleto)
    const intA = await rendInternoPorUnidad(client, desdeYm(A), hastaYmDia(A, lastDay(A)));
    const intB = await rendInternoPorUnidad(client, desdeYm(B), hastaYmDia(B, lastDay(B)));
    const sum = (m, f) => [...m.values()].reduce((a, x) => a + f(x), 0);
    const flIntA = sum(intA, x => x.litrosSinUlt) > 0 ? sum(intA, x => x.kmVeh) / sum(intA, x => x.litrosSinUlt) : 0;
    const flIntB = sum(intB, x => x.litrosSinUlt) > 0 ? sum(intB, x => x.kmVeh) / sum(intB, x => x.litrosSinUlt) : 0;
    console.log(`\n=== 7) km/L INTERNO — excluye la última carga de cada unidad (quita el efecto "mes incompleto") ===`);
    console.log(`   Si al sacar la cola el km/L de ${label(B)} SE RECUPERA cerca de ${label(A)} → era timing (se arregla solo).`);
    console.log(`   Si IGUAL queda bajo → lecturas subcargadas de verdad (problema real, hay km para corregir).\n`);
    console.log(`   Flota INTERNO: ${label(A)} ${flIntA.toFixed(2)} km/L   ·   ${label(B)} ${flIntB.toFixed(2)} km/L`);
    console.log(`   (recordá: total con cola daba ${rendA.toFixed(2)} vs ${rendB.toFixed(2)})\n`);
    console.log(`   unidad     ${label(A).slice(0,3)} int   ${label(B).slice(0,3)} int   veredicto`);
    let nReal = 0, nTiming = 0;
    codes.map(c => {
      const a = intA.get(c), b = intB.get(c);
      return { code: c, ra: a ? a.kmL : 0, rb: b ? b.kmL : 0 };
    }).filter(r => r.ra > 0 && r.rb > 0).sort((x, y) => (x.rb / x.ra) - (y.rb / y.ra)).forEach(r => {
      const ratio = r.rb / r.ra;
      let vd;
      if (ratio >= 0.8) { vd = 'OK — se recupera (era timing)'; nTiming++; }
      else if (ratio < 0.6) { vd = '⚠ SIGUE BAJO — lectura subcargada (revisar)'; nReal++; }
      else { vd = '~ parcial'; }
      console.log(`   ${String(r.code).padEnd(10)} ${r.ra.toFixed(2).padStart(6)}  ${r.rb.toFixed(2).padStart(6)}   ${vd}`);
    });
    console.log(`\n   Resumen: ${nReal} unidad(es) con lectura subcargada real · ${nTiming} que se recuperan (timing).`);
    console.log(`   Veredicto flota: ${flIntB >= flIntA * 0.85
      ? 'el km/L interno se recupera → el grueso del faltante es MES INCOMPLETO (se cierra solo).'
      : 'el km/L interno SIGUE bajo → hay subcarga real de odómetros (no es solo mes incompleto).'}`);
    console.log('');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
