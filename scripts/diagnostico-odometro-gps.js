#!/usr/bin/env node
/**
 * Cruce ODÓMETRO GPS vs TICKETS de combustible — desempata si las lecturas de km
 * cargadas a mano están atrasadas respecto de la realidad.
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO LECTURA. El km del reporte sale del odómetro que se anota en cada carga de
 * combustible (fuel_logs.odometer_km). El GPS (Powerfleet) trae el odómetro REAL y
 * el servicio lo guarda en vehicles.km_current (= GREATEST de todo lo visto).
 *
 * Si km_current (GPS/real) está muy por ENCIMA del último odómetro de los tickets,
 * los tickets están subcargados: se anota el km más bajo que el real → el reporte
 * mide de menos. Este script lo muestra por unidad.
 *
 * OJO: km_current es el valor ACTUAL (una foto), no histórico por mes. Sirve para
 * confirmar la subcarga y su magnitud HOY, no para recalcular meses pasados.
 * Además, si el GPS de una unidad está inactivo (gps_updated_at viejo), km_current
 * puede venir de los propios tickets: en ese caso el cruce no aporta (se marca).
 *
 * Uso (Shell de Render):
 *   node scripts/diagnostico-odometro-gps.js
 */
const { pool } = require('../db/pool');
const num = n => Math.round(Number(n || 0)).toLocaleString('es-AR');
const DIAS_GPS_OK = 10; // gps_updated_at dentro de este rango = GPS reciente/confiable

(async () => {
  const client = await pool.connect();
  try {
    const r = await client.query(`
      SELECT v.code, v.plate, v.km_current, v.gps_status, v.gps_updated_at,
             (v.gps_updated_at IS NOT NULL AND v.gps_updated_at > NOW() - INTERVAL '${DIAS_GPS_OK} days') AS gps_reciente,
             t.ult_ticket, t.ult_fecha
      FROM vehicles v
      LEFT JOIN LATERAL (
        SELECT MAX(fl.odometer_km) AS ult_ticket, MAX(fl.logged_at) AS ult_fecha
        FROM fuel_logs fl
        WHERE fl.vehicle_id = v.id AND fl.odometer_km > 0
          AND COALESCE(LOWER(fl.fuel_type),'') <> 'urea'
      ) t ON TRUE
      WHERE COALESCE(v.active, TRUE) = TRUE
        AND COALESCE(LOWER(v.type),'') NOT LIKE '%autoelev%'
        AND t.ult_ticket IS NOT NULL
      ORDER BY (COALESCE(v.km_current,0) - t.ult_ticket) DESC`);

    console.log(`\n🛰️  ODÓMETRO GPS vs ÚLTIMO TICKET DE COMBUSTIBLE (solo lectura)\n`);
    console.log(`   km_current = odómetro real del GPS (Powerfleet).  ult_ticket = último km cargado en un ticket.`);
    console.log(`   diff = km_current − ult_ticket.  Diff grande con GPS reciente = tickets subcargados.\n`);
    console.log(`   unidad     km_current    ult_ticket        diff     GPS`);
    console.log(`   ${'─'.repeat(64)}`);

    let sumDiffGpsOk = 0, nSub = 0;
    for (const v of r.rows) {
      const kmc = Number(v.km_current || 0);
      const ult = Number(v.ult_ticket || 0);
      const diff = kmc - ult;
      const gps = v.gps_reciente ? 'ok' : (v.gps_updated_at ? 'viejo' : 'sin GPS');
      let mark = '';
      if (v.gps_reciente && diff > 2000) { mark = '  ⚠ tickets atrasados vs GPS'; nSub++; sumDiffGpsOk += diff; }
      else if (!v.gps_reciente) mark = '  (GPS no confiable: cruce no aplica)';
      console.log(`   ${String(v.code || v.plate).padEnd(10)} ${num(kmc).padStart(11)}  ${num(ult).padStart(12)}  ${(diff >= 0 ? '+' : '') + num(diff)}`.padEnd(56) + `  ${gps}${mark}`);
    }

    console.log(`\n   Resumen: ${nSub} unidad(es) con GPS reciente y tickets atrasados > 2.000 km.`);
    console.log(`   Suma de esos "diff" (km reales por encima de los tickets): ~${num(sumDiffGpsOk)} km.`);
    console.log(`\n   Interpretación:`);
    console.log(`   · Si hay varias unidades con diff grande y GPS ok → los tickets vienen subcargados`);
    console.log(`     (el km real es mayor): el bajón de km del mes es por lecturas, no por manejar menos.`);
    console.log(`   · Si casi todas dan diff ~0 → los tickets están al día y el bajón es real (o mes incompleto).`);
    console.log('');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
