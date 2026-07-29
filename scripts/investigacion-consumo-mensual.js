#!/usr/bin/env node
/**
 * Investigación a fondo del consumo mensual — ¿por qué MÁS litros con MENOS km,
 * y por qué la plata no acompaña a los litros?
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO LECTURA: no modifica nada.
 *
 * Complementa a los otros dos diagnósticos:
 *   · diagnostico-km-mensual.js   → lado KM (odómetros mal tipeados, mes incompleto)
 *   · auditoria-cargas-gasoil.js  → carga por carga (consumos implausibles)
 * Este ataca el lado LITROS y DINERO del comparativo mensual del Panel de
 * Auditoría (visto en junio/julio 2026: julio +4.000 L con −45.000 km, y sin
 * embargo −9,8% de gasto porque el $/L promedio cayó de ~$2.014 a ~$1.592).
 *
 * Qué muestra:
 *   1) PANORAMA A vs B con las mismas fórmulas que el panel (litros, km, tramos,
 *      rendimiento, $, urea, mantenimiento) — para partir de los mismos números.
 *   2) LITROS POR UNIDAD: qué unidades pusieron los litros de más (Δ ordenado).
 *   3) PRECIO DEL LITRO: $/L ponderado por mes y por origen (cisterna/estación),
 *      y cargas con precio atípico o en $0 — explica por qué el gasto no sigue
 *      a los litros (efecto litros vs efecto precio, descompuesto).
 *   4) POSIBLES DUPLICADOS: misma unidad, cargas a <4 h con litros casi iguales.
 *   5) LITROS QUE NO APORTAN KM: cargas sin odómetro y unidades con 1 sola carga
 *      (suman litros al total pero jamás suman km → suben L y bajan km/L).
 *   6) RENDIMIENTO POR TRAMOS POR UNIDAD: la métrica del panel, A vs B, ordenada
 *      por la caída más grande → qué unidades explican el 5,2 → 3,7.
 *   7) MANTENIMIENTO Y UREA: OTs y $ de cada mes, top OTs del mes B por costo.
 *   8) VEREDICTO: lectura sugerida de todo lo anterior.
 *
 * Uso (Shell de Render):
 *   node scripts/investigacion-consumo-mensual.js                 → junio vs julio 2026
 *   node scripts/investigacion-consumo-mensual.js 2026-05 2026-06 → los meses que le pases
 */
const { pool } = require('../db/pool');

const num   = n => Math.round(Number(n || 0)).toLocaleString('es-AR');
const plata = n => '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const args  = process.argv.slice(2);
const argMeses = args.filter(a => /^\d{4}-\d{2}$/.test(a));
const MESES = argMeses.length >= 2 ? argMeses.slice(0, 2) : ['2026-06', '2026-07'];
const NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const label = ym => { const [y, m] = ym.split('-').map(Number); return `${NOMBRE[m - 1]} ${y}`; };
const corto = ym => label(ym).slice(0, 3);
const lastDay = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const desdeYm = ym => `${ym}-01`;
const hastaYm = ym => `${ym}-${String(lastDay(ym)).padStart(2, '0')} 23:59:59.999999`;
const esMesEnCurso = ym => { const h = new Date(); return ym === `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`; };

// Filtros idénticos a los del panel: combustible = todo lo que no es urea.
const NO_UREA  = `COALESCE(LOWER(fl.fuel_type),'') <> 'urea'`;
const NO_AUTOE = `COALESCE(LOWER(v.type),'') NOT LIKE '%autoelev%'`;

// ── Panorama del mes: mismas fórmulas que GET /api/auditor/comparativo ──────
async function panorama(client, ym) {
  const desde = desdeYm(ym), hasta = hastaYm(ym);
  const fuel = (await client.query(`
    SELECT
      COALESCE(SUM(liters*price_per_l) FILTER (WHERE COALESCE(LOWER(fuel_type),'') <> 'urea'),0) AS costo_fuel,
      COALESCE(SUM(liters)             FILTER (WHERE COALESCE(LOWER(fuel_type),'') <> 'urea'),0) AS litros,
      COUNT(*)                         FILTER (WHERE COALESCE(LOWER(fuel_type),'') <> 'urea')    AS cargas,
      COALESCE(SUM(liters*price_per_l) FILTER (WHERE LOWER(fuel_type) = 'urea'),0)               AS costo_urea,
      COALESCE(SUM(liters)             FILTER (WHERE LOWER(fuel_type) = 'urea'),0)               AS litros_urea,
      COALESCE(SUM(liters) FILTER (WHERE COALESCE(LOWER(fuel_type),'') <> 'urea' AND tank_id IS NOT NULL),0) AS litros_cisterna,
      COALESCE(SUM(liters) FILTER (WHERE COALESCE(LOWER(fuel_type),'') <> 'urea' AND tank_id IS NULL),0)     AS litros_estacion
    FROM fuel_logs WHERE logged_at BETWEEN $1 AND $2`, [desde, hasta])).rows[0];
  const km = (await client.query(`
    SELECT COALESCE(SUM(km_veh),0) AS km_total FROM (
      SELECT fl.vehicle_id, MAX(fl.odometer_km) - MIN(fl.odometer_km) AS km_veh
      FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
      WHERE fl.logged_at BETWEEN $1 AND $2
        AND fl.odometer_km IS NOT NULL AND fl.odometer_km > 0
        AND ${NO_UREA} AND ${NO_AUTOE}
      GROUP BY fl.vehicle_id HAVING COUNT(*) >= 2
    ) t`, [desde, hasta])).rows[0];
  const ots = (await client.query(`
    SELECT COALESCE(SUM(labor_cost+parts_cost),0) AS costo_mant, COUNT(*) AS ots
    FROM work_orders WHERE opened_at BETWEEN $1 AND $2`, [desde, hasta])).rows[0];
  const tramos = (await tramosRango(client, desde, hasta)).total;
  return {
    litros: Number(fuel.litros), costoFuel: Number(fuel.costo_fuel), cargas: Number(fuel.cargas),
    cisterna: Number(fuel.litros_cisterna), estacion: Number(fuel.litros_estacion),
    urea: Number(fuel.litros_urea), costoUrea: Number(fuel.costo_urea),
    km: Number(km.km_total), kmTramos: tramos.km, litrosTramos: tramos.litros,
    costoMant: Number(ots.costo_mant), ots: Number(ots.ots),
  };
}

// ── Tramos (misma lógica que el panel): cada carga cubre el tramo desde la ──
// carga anterior; los tramos que cruzan el cambio de mes se prorratean por
// tiempo. Devuelve total y detalle por unidad para el rango pedido.
async function tramosRango(client, desde, hasta) {
  const r = await client.query(`
    WITH cargas AS (
      SELECT fl.vehicle_id, COALESCE(v.code, v.plate) AS code, fl.logged_at, fl.liters, fl.odometer_km,
             LAG(fl.odometer_km) OVER w AS odo_prev,
             LAG(fl.logged_at)  OVER w AS fecha_prev
      FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
      WHERE ${NO_UREA} AND ${NO_AUTOE}
        AND fl.odometer_km IS NOT NULL AND fl.odometer_km > 0
        AND COALESCE(fl.liters,0) > 0
      WINDOW w AS (PARTITION BY fl.vehicle_id ORDER BY fl.logged_at, fl.id)
    ), tramos AS (
      SELECT code, liters, (odometer_km - odo_prev) AS km_tramo, fecha_prev, logged_at,
             EXTRACT(EPOCH FROM (logged_at - fecha_prev)) AS dur
      FROM cargas
      WHERE odo_prev IS NOT NULL
        AND odometer_km > odo_prev
        AND (odometer_km - odo_prev) < 20000
        AND EXTRACT(EPOCH FROM (logged_at - fecha_prev)) BETWEEN 600 AND 45*86400
    )
    SELECT code,
           COALESCE(SUM(liters   * frac),0) AS litros,
           COALESCE(SUM(km_tramo * frac),0) AS km
    FROM (
      SELECT code, liters, km_tramo,
             GREATEST(0, EXTRACT(EPOCH FROM (LEAST(logged_at, $2::timestamptz) - GREATEST(fecha_prev, $1::timestamptz)))) / dur AS frac
      FROM tramos
      WHERE logged_at > $1::timestamptz AND fecha_prev < $2::timestamptz
    ) t GROUP BY code`, [desde, hasta]);
  const porUnidad = new Map(r.rows.map(x => [x.code, { litros: Number(x.litros), km: Number(x.km) }]));
  const total = [...porUnidad.values()].reduce((a, x) => ({ litros: a.litros + x.litros, km: a.km + x.km }), { litros: 0, km: 0 });
  return { total, porUnidad };
}

// ── Litros/cargas/km por unidad en un rango (para el Δ de litros) ────────────
async function litrosPorUnidad(client, desde, hasta) {
  const r = await client.query(`
    SELECT COALESCE(v.code, v.plate) AS code,
           COALESCE(SUM(fl.liters),0) AS litros, COUNT(*) AS cargas,
           COALESCE(SUM(fl.liters) FILTER (WHERE fl.tank_id IS NOT NULL),0) AS cisterna,
           CASE WHEN COUNT(*) FILTER (WHERE fl.odometer_km > 0) >= 2
                THEN MAX(fl.odometer_km) FILTER (WHERE fl.odometer_km > 0)
                   - MIN(fl.odometer_km) FILTER (WHERE fl.odometer_km > 0)
                ELSE 0 END AS km_veh
    FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
    WHERE fl.logged_at BETWEEN $1 AND $2 AND ${NO_UREA} AND ${NO_AUTOE}
    GROUP BY COALESCE(v.code, v.plate)`, [desde, hasta]);
  return new Map(r.rows.map(x => [x.code, {
    litros: Number(x.litros), cargas: Number(x.cargas), cisterna: Number(x.cisterna), km: Number(x.km_veh),
  }]));
}

// ── Precio del litro: ponderado, mediana y por origen, en un rango ───────────
async function precios(client, desde, hasta) {
  const r = (await client.query(`
    SELECT
      COALESCE(SUM(fl.liters*fl.price_per_l) / NULLIF(SUM(fl.liters) FILTER (WHERE fl.price_per_l > 0),0),0) AS pond,
      COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fl.price_per_l) FILTER (WHERE fl.price_per_l > 0),0) AS mediana,
      COALESCE(SUM(fl.liters*fl.price_per_l) FILTER (WHERE fl.tank_id IS NOT NULL) / NULLIF(SUM(fl.liters) FILTER (WHERE fl.tank_id IS NOT NULL AND fl.price_per_l > 0),0),0) AS pond_cisterna,
      COALESCE(SUM(fl.liters*fl.price_per_l) FILTER (WHERE fl.tank_id IS NULL)     / NULLIF(SUM(fl.liters) FILTER (WHERE fl.tank_id IS NULL AND fl.price_per_l > 0),0),0)     AS pond_estacion,
      COUNT(*) FILTER (WHERE COALESCE(fl.price_per_l,0) <= 0) AS sin_precio,
      COALESCE(SUM(fl.liters) FILTER (WHERE COALESCE(fl.price_per_l,0) <= 0),0)    AS litros_sin_precio
    FROM fuel_logs fl
    WHERE fl.logged_at BETWEEN $1 AND $2 AND ${NO_UREA}`, [desde, hasta])).rows[0];
  return {
    pond: Number(r.pond), mediana: Number(r.mediana),
    cisterna: Number(r.pond_cisterna), estacion: Number(r.pond_estacion),
    sinPrecio: Number(r.sin_precio), litrosSinPrecio: Number(r.litros_sin_precio),
  };
}

// ── Cargas con precio atípico (>±30% de la mediana del mes) o en $0 ─────────
async function preciosAtipicos(client, desde, hasta, mediana) {
  if (!(mediana > 0)) return [];
  const r = await client.query(`
    SELECT COALESCE(v.code, v.plate) AS code, fl.logged_at, fl.liters, fl.price_per_l,
           fl.tank_id, fl.location, u.name AS registrado_por
    FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
    LEFT JOIN users u ON u.id = fl.driver_id
    WHERE fl.logged_at BETWEEN $1 AND $2 AND ${NO_UREA}
      AND (COALESCE(fl.price_per_l,0) <= 0 OR fl.price_per_l > $3 * 1.3 OR fl.price_per_l < $3 * 0.7)
    ORDER BY ABS(COALESCE(fl.price_per_l,0) - $3) * fl.liters DESC
    LIMIT 12`, [desde, hasta, mediana]);
  return r.rows;
}

// ── Posibles duplicados: misma unidad, <4 h entre cargas, litros a <10% ──────
async function duplicados(client, desde, hasta) {
  const r = await client.query(`
    WITH c AS (
      SELECT fl.id, COALESCE(v.code, v.plate) AS code, fl.logged_at, fl.liters, fl.tank_id,
             u.name AS registrado_por,
             LAG(fl.logged_at) OVER w AS fecha_prev,
             LAG(fl.liters)    OVER w AS litros_prev
      FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
      LEFT JOIN users u ON u.id = fl.driver_id
      WHERE ${NO_UREA}
      WINDOW w AS (PARTITION BY fl.vehicle_id ORDER BY fl.logged_at, fl.id)
    )
    SELECT * FROM c
    WHERE logged_at BETWEEN $1 AND $2 AND fecha_prev IS NOT NULL
      AND logged_at - fecha_prev < INTERVAL '4 hours'
      AND ABS(liters - litros_prev) <= GREATEST(litros_prev * 0.10, 5)
    ORDER BY logged_at`, [desde, hasta]);
  return r.rows;
}

// ── Litros que no aportan km: sin odómetro, o unidad con 1 sola carga ────────
async function litrosHuerfanos(client, desde, hasta) {
  const sinOdo = (await client.query(`
    SELECT COUNT(*) AS n, COALESCE(SUM(fl.liters),0) AS litros
    FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
    WHERE fl.logged_at BETWEEN $1 AND $2 AND ${NO_UREA} AND ${NO_AUTOE}
      AND (fl.odometer_km IS NULL OR fl.odometer_km <= 0)`, [desde, hasta])).rows[0];
  const unaCarga = (await client.query(`
    SELECT COALESCE(v.code, v.plate) AS code, COALESCE(SUM(fl.liters),0) AS litros
    FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
    WHERE fl.logged_at BETWEEN $1 AND $2 AND ${NO_UREA} AND ${NO_AUTOE}
      AND fl.odometer_km > 0
    GROUP BY COALESCE(v.code, v.plate) HAVING COUNT(*) = 1`, [desde, hasta])).rows;
  const autoelev = (await client.query(`
    SELECT COUNT(*) AS n, COALESCE(SUM(fl.liters),0) AS litros
    FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
    WHERE fl.logged_at BETWEEN $1 AND $2 AND ${NO_UREA}
      AND COALESCE(LOWER(v.type),'') LIKE '%autoelev%'`, [desde, hasta])).rows[0];
  return {
    sinOdo: { n: Number(sinOdo.n), litros: Number(sinOdo.litros) },
    unaCarga: unaCarga.map(x => ({ code: x.code, litros: Number(x.litros) })),
    autoelev: { n: Number(autoelev.n), litros: Number(autoelev.litros) },
  };
}

// ── Top OTs del mes por costo (lado mantenimiento del "todo eso") ────────────
async function topOts(client, desde, hasta) {
  const r = await client.query(`
    SELECT wo.code, wo.description, wo.type, COALESCE(v.code, v.plate) AS unidad,
           COALESCE(wo.labor_cost,0) + COALESCE(wo.parts_cost,0) AS costo
    FROM work_orders wo LEFT JOIN vehicles v ON v.id = wo.vehicle_id
    WHERE wo.opened_at BETWEEN $1 AND $2
    ORDER BY costo DESC LIMIT 8`, [desde, hasta]);
  return r.rows;
}

(async () => {
  const client = await pool.connect();
  try {
    const [A, B] = MESES;
    console.log(`\n🔬 INVESTIGACIÓN DE CONSUMO MENSUAL (solo lectura) — ${label(A)} vs ${label(B)}\n`);

    // 1) PANORAMA — mismos números que el panel, lado a lado
    const pA = await panorama(client, A);
    const pB = await panorama(client, B);
    const rendTrA = pA.litrosTramos > 0 ? pA.kmTramos / pA.litrosTramos : 0;
    const rendTrB = pB.litrosTramos > 0 ? pB.kmTramos / pB.litrosTramos : 0;
    const rendCalA = pA.litros > 0 ? pA.km / pA.litros : 0;
    const rendCalB = pB.litros > 0 ? pB.km / pB.litros : 0;
    console.log('=== 1) PANORAMA (mismas fórmulas que el panel) ===');
    console.log(`                          ${corto(A).padStart(14)} ${corto(B).padStart(14)}          Δ`);
    const fila = (nombre, a, b, fmt = num) =>
      console.log(`   ${nombre.padEnd(22)} ${String(fmt(a)).padStart(14)} ${String(fmt(b)).padStart(14)} ${(b - a >= 0 ? '+' : '') + fmt(b - a)}`);
    fila('Litros gasoil', pA.litros, pB.litros);
    fila('  · cisterna', pA.cisterna, pB.cisterna);
    fila('  · estación', pA.estacion, pB.estacion);
    fila('Cargas', pA.cargas, pB.cargas);
    fila('Km (MAX−MIN)', pA.km, pB.km);
    fila('Km por tramos', pA.kmTramos, pB.kmTramos);
    fila('Litros por tramos', pA.litrosTramos, pB.litrosTramos);
    fila('Gasto combustible', pA.costoFuel, pB.costoFuel, plata);
    fila('Urea (L)', pA.urea, pB.urea);
    fila('Urea ($)', pA.costoUrea, pB.costoUrea, plata);
    fila('Mantenimiento ($)', pA.costoMant, pB.costoMant, plata);
    fila('OTs abiertas', pA.ots, pB.ots);
    console.log(`   Rendimiento tramos:    ${rendTrA.toFixed(2)} km/L ${String(rendTrB.toFixed(2) + ' km/L').padStart(15)}`);
    console.log(`   Rendimiento calendario: ${rendCalA.toFixed(2)} km/L ${String(rendCalB.toFixed(2) + ' km/L').padStart(14)}`);
    if (esMesEnCurso(B)) console.log(`   ⚠ ${label(B)} está EN CURSO: km y tramos consolidan recién con las primeras cargas de ${NOMBRE[(Number(B.split('-')[1])) % 12]}.`);

    // 2) LITROS POR UNIDAD — quién puso los litros de más
    const uA = await litrosPorUnidad(client, desdeYm(A), hastaYm(A));
    const uB = await litrosPorUnidad(client, desdeYm(B), hastaYm(B));
    const codes = [...new Set([...uA.keys(), ...uB.keys()])];
    const deltas = codes.map(c => {
      const a = uA.get(c) || { litros: 0, cargas: 0, km: 0 };
      const b = uB.get(c) || { litros: 0, cargas: 0, km: 0 };
      return { code: c, lA: a.litros, lB: b.litros, dL: b.litros - a.litros,
               cA: a.cargas, cB: b.cargas, kA: a.km, kB: b.km };
    }).sort((x, y) => y.dL - x.dL);
    const dLTotal = pB.litros - pA.litros;
    console.log(`\n=== 2) ¿QUÉ UNIDADES PUSIERON LOS LITROS DE MÁS? (Δ litros ${corto(B)}−${corto(A)}, total ${(dLTotal >= 0 ? '+' : '') + num(dLTotal)} L) ===`);
    console.log(`   unidad       L ${corto(A)}    L ${corto(B)}       ΔL   cargas ${corto(A)}→${corto(B)}   km ${corto(A)}→${corto(B)}`);
    deltas.slice(0, 15).forEach(d => {
      const soloB = d.lA === 0 ? '  (solo ' + corto(B) + ')' : '';
      console.log(`   ${String(d.code).padEnd(10)} ${num(d.lA).padStart(7)} ${num(d.lB).padStart(8)} ${((d.dL >= 0 ? '+' : '') + num(d.dL)).padStart(8)}   ${String(d.cA + '→' + d.cB).padStart(9)}   ${num(d.kA)}→${num(d.kB)}${soloB}`);
    });
    const top5 = deltas.slice(0, 5).reduce((a, d) => a + Math.max(0, d.dL), 0);
    if (dLTotal > 0) console.log(`   → Las 5 primeras concentran ${num(top5)} L (${(top5 / dLTotal * 100).toFixed(0)}% del aumento). Concentrado en pocas = mirar esas unidades; repartido = cambio operativo general.`);

    // 3) PRECIO DEL LITRO — por qué la plata no acompaña a los litros
    const prA = await precios(client, desdeYm(A), hastaYm(A));
    const prB = await precios(client, desdeYm(B), hastaYm(B));
    console.log(`\n=== 3) PRECIO DEL LITRO — el lado del DINERO ===`);
    console.log(`   $/L ponderado:  ${corto(A)} ${plata(prA.pond)}   ·   ${corto(B)} ${plata(prB.pond)}   (${prA.pond > 0 ? ((prB.pond / prA.pond - 1) * 100).toFixed(1) + '%' : '—'})`);
    console.log(`     · cisterna:   ${corto(A)} ${plata(prA.cisterna)}   ·   ${corto(B)} ${plata(prB.cisterna)}`);
    console.log(`     · estación:   ${corto(A)} ${plata(prA.estacion)}   ·   ${corto(B)} ${plata(prB.estacion)}`);
    console.log(`   Mediana $/L:    ${corto(A)} ${plata(prA.mediana)}   ·   ${corto(B)} ${plata(prB.mediana)}`);
    if (prA.sinPrecio || prB.sinPrecio)
      console.log(`   ⚠ Cargas con precio $0 o vacío (no suman al gasto pero SÍ a los litros): ${corto(A)} ${prA.sinPrecio} (${num(prA.litrosSinPrecio)} L) · ${corto(B)} ${prB.sinPrecio} (${num(prB.litrosSinPrecio)} L)`);
    // Descomposición: Δgasto = efecto litros (a precio de A) + efecto precio (sobre litros de B)
    const efLitros = (pB.litros - pA.litros) * prA.pond;
    const efPrecio = (prB.pond - prA.pond) * pB.litros;
    console.log(`   Descomposición del Δ gasto (${plata(pB.costoFuel - pA.costoFuel)}):`);
    console.log(`     · efecto LITROS (ΔL × $/L de ${corto(A)}):  ${plata(efLitros)}`);
    console.log(`     · efecto PRECIO (Δ$/L × L de ${corto(B)}):  ${plata(efPrecio)}`);
    console.log(`   → Si el efecto precio es grande y negativo, el gasto bajó AUNQUE se quemó más: revisar si el $/L de ${corto(A)} estaba inflado (typos) o si ${corto(B)} tiene cargas baratas/sin precio.`);
    const atipA = await preciosAtipicos(client, desdeYm(A), hastaYm(A), prA.mediana);
    const atipB = await preciosAtipicos(client, desdeYm(B), hastaYm(B), prB.mediana);
    for (const [ym, atip] of [[A, atipA], [B, atipB]]) {
      if (!atip.length) continue;
      console.log(`   Cargas con precio atípico en ${label(ym)} (>±30% de la mediana, o $0) — top por impacto:`);
      atip.forEach(x => {
        const f = new Date(x.logged_at).toLocaleString('es-AR');
        const origen = x.tank_id ? 'cisterna' : (x.location || 'estación');
        console.log(`     ⚠ ${String(x.code).padEnd(10)} ${f} · ${num(x.liters)} L a ${plata(x.price_per_l)} /L · ${origen} · ${x.registrado_por || 'sin registro'}`);
      });
    }

    // 4) POSIBLES DUPLICADOS — inflan litros sin km
    console.log(`\n=== 4) POSIBLES CARGAS DUPLICADAS (misma unidad, <4 h, litros a <10%) ===`);
    for (const ym of [A, B]) {
      const dups = await duplicados(client, desdeYm(ym), hastaYm(ym));
      console.log(`   ${label(ym)}: ${dups.length} caso(s)`);
      dups.forEach(d => {
        const f = new Date(d.logged_at).toLocaleString('es-AR');
        console.log(`     ⚠ ${String(d.code).padEnd(10)} ${f} · ${num(d.liters)} L (la anterior fue de ${num(d.litros_prev)} L) · ${d.registrado_por || 'sin registro'}`);
      });
    }
    console.log(`   → Cotejar con los tickets físicos antes de anular nada: dos cargas legítimas pueden caer juntas (tanque doble, cisterna+estación).`);

    // 5) LITROS QUE NO APORTAN KM
    const hA = await litrosHuerfanos(client, desdeYm(A), hastaYm(A));
    const hB = await litrosHuerfanos(client, desdeYm(B), hastaYm(B));
    console.log(`\n=== 5) LITROS QUE SUMAN AL TOTAL PERO NO APORTAN KM ===`);
    const filaH = (nombre, a, b) => console.log(`   ${nombre.padEnd(38)} ${corto(A)}: ${String(a).padStart(12)}   ${corto(B)}: ${b}`);
    filaH('Cargas sin odómetro (o en 0)', `${hA.sinOdo.n} (${num(hA.sinOdo.litros)} L)`, `${hB.sinOdo.n} (${num(hB.sinOdo.litros)} L)`);
    filaH('Autoelevadores (excluidos del km)', `${hA.autoelev.n} (${num(hA.autoelev.litros)} L)`, `${hB.autoelev.n} (${num(hB.autoelev.litros)} L)`);
    const sum1 = arr => arr.reduce((a, x) => a + x.litros, 0);
    filaH('Unidades con 1 sola carga', `${hA.unaCarga.length} (${num(sum1(hA.unaCarga))} L)`, `${hB.unaCarga.length} (${num(sum1(hB.unaCarga))} L)`);
    if (hB.unaCarga.length) console.log(`     ${corto(B)}: ${hB.unaCarga.map(x => `${x.code} (${num(x.litros)} L)`).join(' · ')}`);
    console.log(`   → Si estos rubros crecieron en ${corto(B)}, explican litros de más SIN km: el gasoil existe pero el recorrido no entra al cálculo.`);

    // 6) RENDIMIENTO POR TRAMOS POR UNIDAD — la métrica del panel, A vs B
    const trA = (await tramosRango(client, desdeYm(A), hastaYm(A))).porUnidad;
    const trB = (await tramosRango(client, desdeYm(B), hastaYm(B))).porUnidad;
    const codesTr = [...new Set([...trA.keys(), ...trB.keys()])];
    const rendRows = codesTr.map(c => {
      const a = trA.get(c), b = trB.get(c);
      const rA = a && a.litros > 0 ? a.km / a.litros : 0;
      const rB = b && b.litros > 0 ? b.km / b.litros : 0;
      // "Litros de más" de la unidad en B: lo que quemó por encima de lo que
      // hubiese quemado recorriendo los mismos km con el rendimiento de A.
      const exceso = (rA > 0 && b) ? b.litros - b.km / rA : 0;
      return { code: c, rA, rB, lB: b ? b.litros : 0, kB: b ? b.km : 0, exceso };
    }).filter(r => r.rA > 0 && r.lB > 0).sort((x, y) => y.exceso - x.exceso);
    console.log(`\n=== 6) RENDIMIENTO POR TRAMOS POR UNIDAD — ${corto(A)} vs ${corto(B)} (la métrica del panel) ===`);
    console.log(`   "Litros de más" = lo quemado en ${corto(B)} por encima de lo esperable con el rendimiento de ${corto(A)}.\n`);
    console.log(`   unidad     ${corto(A)} km/L   ${corto(B)} km/L   L ${corto(B)}      km ${corto(B)}    L de más`);
    rendRows.slice(0, 20).forEach(r => {
      const flag = (r.rB < r.rA * 0.7 && r.exceso > 300) ? '  ⚠ caída fuerte' : '';
      console.log(`   ${String(r.code).padEnd(10)} ${r.rA.toFixed(2).padStart(7)} ${r.rB.toFixed(2).padStart(9)} ${num(r.lB).padStart(8)} ${num(r.kB).padStart(9)}  ${((r.exceso >= 0 ? '+' : '') + num(r.exceso)).padStart(8)}${flag}`);
    });
    const excesoTotal = rendRows.reduce((a, r) => a + Math.max(0, r.exceso), 0);
    console.log(`\n   Exceso total en ${corto(B)}: ~${num(excesoTotal)} L quemados por encima del patrón de ${corto(A)}.`);
    console.log(`   → Concentrado en pocas unidades ⚠ = cruzar cada una con auditoria-cargas-gasoil.js (carga por carga) y el GPS (ralentí).`);
    console.log(`   → Repartido parejo = causa operativa general: más ralentí (ver tab Ralentí), rutas más cortas con más maniobra, clima, carga.`);

    // 7) MANTENIMIENTO Y UREA — el resto del "todo eso"
    console.log(`\n=== 7) MANTENIMIENTO — ${corto(A)}: ${plata(pA.costoMant)} en ${pA.ots} OTs · ${corto(B)}: ${plata(pB.costoMant)} en ${pB.ots} OTs ===`);
    const ots = await topOts(client, desdeYm(B), hastaYm(B));
    console.log(`   Top OTs de ${label(B)} por costo:`);
    ots.forEach(o => console.log(`     ${String(o.code || '—').padEnd(10)} ${String(o.unidad || '—').padEnd(10)} ${plata(o.costo).padStart(15)}  ${(o.description || '').slice(0, 60)}`));

    // 8) VEREDICTO
    console.log(`\n=== 8) VEREDICTO SUGERIDO ===`);
    if (esMesEnCurso(B)) console.log(`   · ${label(B)} está en curso: parte del km "faltante" aparece al consolidar con las primeras cargas del mes siguiente. Re-correr este script pasado el día 5.`);
    if (rendTrA > 0 && rendTrB < rendTrA * 0.85) console.log(`   · El rendimiento por tramos cayó ${((1 - rendTrB / rendTrA) * 100).toFixed(0)}% (${rendTrA.toFixed(1)} → ${rendTrB.toFixed(1)} km/L): eso NO es efecto calendario, es consumo real. Ver bloque 6 para saber si es de pocas unidades o de toda la flota.`);
    if (Math.abs(efPrecio) > Math.abs(efLitros)) console.log(`   · En la plata manda el PRECIO, no los litros: el $/L pasó de ${plata(prA.pond)} a ${plata(prB.pond)}. Verificar con facturas si el precio de ${corto(A)} estaba bien cargado.`);
    if (hB.sinOdo.litros > hA.sinOdo.litros * 1.5 && hB.sinOdo.litros > 500) console.log(`   · Crecieron los litros sin odómetro (${num(hA.sinOdo.litros)} → ${num(hB.sinOdo.litros)} L): litros que suman sin aportar km. Exigir odómetro en cada carga.`);
    console.log(`   · Cruces recomendados: diagnostico-km-mensual.js (odómetros), auditoria-cargas-gasoil.js (carga por carga), tabs Ralentí y Excesos del panel (GPS).\n`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
