#!/usr/bin/env node
/**
 * Auditoría de cargas de gasoil, CARGA POR CARGA — detección de consumos implausibles.
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO LECTURA. Para cada carga de cada unidad calcula el tramo desde la carga
 * anterior: km recorridos (diferencia de odómetro), litros cargados y el consumo
 * implícito (L/100km). Un tramo con consumo muy por encima del patrón de la unidad
 * es una carga a revisar: puede ser ralentí extremo… o gasoil que no fue al tanque.
 *
 * Marca:
 *   🔴 CRÍTICO     → L/100km > 2× la mediana de la unidad  y  > 55 L/100km
 *   🟡 REVISAR     → L/100km > 1.5× la mediana              y  > 45 L/100km
 *   (tramos con <50 km se agrupan aparte: "cargas con pocos km" — mucha carga y
 *    poco movimiento es en sí un patrón a mirar)
 *
 * Para cada carga muestra: fecha, litros, km del tramo, L/100km, QUIÉN la registró,
 * chofer y origen (cisterna o estación). El objetivo es que una sospecha de desvío
 * se pueda bajar a cargas concretas con fecha y responsable, sin acusar a ciegas.
 *
 * Uso (Shell de Render):
 *   node scripts/auditoria-cargas-gasoil.js                  → junio + julio 2026, todas las unidades
 *   node scripts/auditoria-cargas-gasoil.js AD235FE AD644VD  → solo esas unidades
 *   node scripts/auditoria-cargas-gasoil.js 2026-05 2026-07  → otro rango de meses (desde, hasta)
 */
const { pool } = require('../db/pool');

const num = n => Math.round(Number(n || 0)).toLocaleString('es-AR');
const args = process.argv.slice(2);
const meses = args.filter(a => /^\d{4}-\d{2}$/.test(a));
const unidadesFiltro = args.filter(a => /^[A-Z]{2}\d{3}[A-Z]{2}$/i.test(a)).map(a => a.toUpperCase());
const DESDE_YM = meses[0] || '2026-06';
const HASTA_YM = meses[1] || meses[0] || '2026-07';
const lastDay = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const DESDE = `${DESDE_YM}-01`;
const HASTA = `${HASTA_YM}-${String(lastDay(HASTA_YM)).padStart(2, '0')} 23:59:59.999999`;

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n🕵️  AUDITORÍA DE CARGAS DE GASOIL — ${DESDE_YM} a ${HASTA_YM} (solo lectura)`);
    if (unidadesFiltro.length) console.log(`   Unidades: ${unidadesFiltro.join(', ')}`);
    console.log('');

    // Cargas con la carga ANTERIOR de la misma unidad (aunque caiga antes del rango,
    // para no perder el primer tramo del mes).
    const r = await client.query(`
      WITH cargas AS (
        SELECT fl.id, fl.vehicle_id, COALESCE(v.code, v.plate) AS code, fl.logged_at,
               fl.liters, fl.odometer_km, fl.tank_id, fl.location, fl.driver_name,
               u.name AS registrado_por,
               LAG(fl.odometer_km) OVER w AS odo_prev,
               LAG(fl.logged_at)  OVER w AS fecha_prev
        FROM fuel_logs fl
        JOIN vehicles v ON v.id = fl.vehicle_id
        LEFT JOIN users u ON u.id = fl.driver_id
        WHERE COALESCE(LOWER(fl.fuel_type),'') <> 'urea'
          AND COALESCE(LOWER(v.type),'') NOT LIKE '%autoelev%'
          AND fl.odometer_km > 0
        WINDOW w AS (PARTITION BY fl.vehicle_id ORDER BY fl.logged_at, fl.id)
      )
      SELECT * FROM cargas
      WHERE logged_at BETWEEN $1 AND $2 AND odo_prev IS NOT NULL
      ORDER BY code, logged_at`, [DESDE, HASTA]);

    // Agrupar por unidad y calcular consumo por tramo
    const porUnidad = new Map();
    for (const c of r.rows) {
      if (unidadesFiltro.length && !unidadesFiltro.includes(c.code)) continue;
      const kmTramo = Number(c.odometer_km) - Number(c.odo_prev);
      const litros = Number(c.liters || 0);
      const l100 = kmTramo > 0 ? (litros / kmTramo) * 100 : null;
      if (!porUnidad.has(c.code)) porUnidad.set(c.code, []);
      porUnidad.get(c.code).push({ ...c, kmTramo, litros, l100 });
    }

    let criticos = 0, revisar = 0, pocosKm = 0;
    for (const [code, tramos] of [...porUnidad.entries()].sort()) {
      const conKm = tramos.filter(t => t.kmTramo >= 50 && t.l100 != null);
      const med = median(conKm.map(t => t.l100));
      const flags = [];
      for (const t of tramos) {
        if (t.kmTramo < 50) { t.nivel = 'pocos_km'; flags.push(t); continue; }
        if (med > 0 && t.l100 > med * 2 && t.l100 > 55) { t.nivel = 'critico'; flags.push(t); }
        else if (med > 0 && t.l100 > med * 1.5 && t.l100 > 45) { t.nivel = 'revisar'; flags.push(t); }
      }
      if (!flags.length) continue;

      console.log(`── ${code} · ${tramos.length} cargas en el rango · mediana ${med.toFixed(1)} L/100km ──`);
      for (const t of flags) {
        const f = new Date(t.logged_at).toLocaleString('es-AR');
        const origen = t.tank_id ? 'cisterna' : (t.location || 'estación');
        const quien = [t.registrado_por && `cargó: ${t.registrado_por}`, t.driver_name && `chofer: ${t.driver_name}`]
          .filter(Boolean).join(' · ') || 'sin registro de quién';
        if (t.nivel === 'pocos_km') {
          pocosKm++;
          console.log(`   ⚪ ${f} · ${num(t.litros)} L con SOLO ${num(t.kmTramo)} km desde la carga anterior · ${origen}`);
        } else {
          const icon = t.nivel === 'critico' ? '🔴' : '🟡';
          if (t.nivel === 'critico') criticos++; else revisar++;
          console.log(`   ${icon} ${f} · ${num(t.litros)} L en ${num(t.kmTramo)} km = ${t.l100.toFixed(1)} L/100km (mediana ${med.toFixed(1)}) · ${origen}`);
        }
        console.log(`        ${quien}`);
      }
      console.log('');
    }

    console.log(`═ RESUMEN ═`);
    console.log(`   🔴 críticos (>2× mediana y >55 L/100km): ${criticos}`);
    console.log(`   🟡 a revisar (>1.5× mediana y >45 L/100km): ${revisar}`);
    console.log(`   ⚪ cargas grandes con <50 km desde la anterior: ${pocosKm}`);
    console.log(`\n   Cómo leerlo:`);
    console.log(`   · Un 🔴 aislado con muchos litros y pocos km es el patrón típico de gasoil que no`);
    console.log(`     fue al tanque del camión (o un odómetro no actualizado: cotejar con el GPS del día).`);
    console.log(`   · Si una unidad tiene TODOS los tramos altos por igual, es consumo real alto (ralentí,`);
    console.log(`     ruta, carga) y no una carga puntual desviada.`);
    console.log(`   · Cotejar cada 🔴 con el informe de actividades del GPS del mismo día (km reales)`);
    console.log(`     y con el ticket físico antes de hablar con nadie.\n`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
