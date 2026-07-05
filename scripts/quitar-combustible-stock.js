#!/usr/bin/env node
/**
 * Saca el COMBUSTIBLE (GEN-006) del módulo Stock/Depósito.
 * ─────────────────────────────────────────────────────────────────────────────
 * El combustible se lleva en el módulo Cisterna (nivel real, que baja con cada
 * carga). Tenerlo también como artículo de Stock generaba un número fijo que no
 * coincidía con la cisterna. Este script borra el artículo COMPLETO del stock
 * (saldos, movimientos, despachos y la ficha). No toca la cisterna ni las cargas
 * de combustible de las unidades (eso vive en otras tablas: tanks / fuel_logs).
 *
 * Uso (Shell de Render):
 *   node scripts/quitar-combustible-stock.js            → SIMULACIÓN (no toca nada)
 *   node scripts/quitar-combustible-stock.js --apply    → EJECUTA
 */
const { pool } = require('../db/pool');
const APPLY = process.argv.includes('--apply');
const CODE = 'GEN-006';

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ MODO EJECUCIÓN (--apply)' : '🔎 MODO SIMULACIÓN (agregá --apply para ejecutar)'}\n`);

    const cat = await client.query('SELECT id, name FROM stock_catalog WHERE code=$1', [CODE]);
    if (!cat.rows[0]) { console.log(`${CODE} no existe en el catálogo de stock (ya estaba fuera). Nada que hacer.\n`); return; }
    const id = cat.rows[0].id;

    const bal = await client.query(
      'SELECT base_location, area, qty_current FROM stock_balances WHERE catalog_id=$1 ORDER BY base_location, area', [id]);
    console.log(`=== ${CODE} "${cat.rows[0].name}" — saldos en Stock (se van a borrar) ===`);
    bal.rows.forEach(r => console.log(`   ${r.base_location} / ${r.area} = ${r.qty_current}`));
    if (!bal.rows.length) console.log('   (sin saldos)');

    await client.query('BEGIN');
    const disp = (await client.query('DELETE FROM stock_dispatches WHERE catalog_id=$1', [id])).rowCount;
    const mov  = (await client.query('DELETE FROM stock_movements  WHERE catalog_id=$1', [id])).rowCount;
    const bl   = (await client.query('DELETE FROM stock_balances   WHERE catalog_id=$1', [id])).rowCount;
    let ficha = 'borrada';
    try {
      await client.query('DELETE FROM stock_catalog WHERE id=$1', [id]);
    } catch (e) {
      await client.query('UPDATE stock_catalog SET active=FALSE WHERE id=$1', [id]);
      ficha = 'desactivada (tenía referencias)';
    }

    console.log(`\n=== ACCIONES ===`);
    console.log(`   ${bl} saldo(s), ${mov} movimiento(s), ${disp} despacho(s) borrados; ficha ${ficha}.`);

    if (APPLY) { await client.query('COMMIT'); console.log('\n✅ COMBUSTIBLE eliminado del módulo Stock. Sigue en la Cisterna, sin cambios.\n'); }
    else       { await client.query('ROLLBACK'); console.log('\n🔎 SIMULACIÓN: no se guardó nada. Si está OK, corré de nuevo con --apply.\n'); }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
