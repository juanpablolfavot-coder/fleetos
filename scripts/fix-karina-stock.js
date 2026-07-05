#!/usr/bin/env node
/**
 * Corrección puntual de las cargas erróneas de "Dominguez Karina" (02/07),
 * que duplicaron stock al hacer "Recepción OC" hacia el área Administración.
 *
 *   • GEN-006 COMBUSTIBLE: se borran los 10.000 de Administración (fila + movimiento).
 *     Se MANTIENE la carga correcta de Taller (área Mantenimiento).
 *   • GEN-001 Etiquetas y GEN-005 Ribbons: se borran los artículos COMPLETOS
 *     (saldos, movimientos, despachos y la ficha) para que Enzo los recargue de cero.
 *
 * Uso (Shell de Render):
 *   node scripts/fix-karina-stock.js            → SIMULACIÓN (no toca nada, muestra qué haría)
 *   node scripts/fix-karina-stock.js --apply    → EJECUTA de verdad
 */
const { pool } = require('../db/pool');
const APPLY = process.argv.includes('--apply');

async function codeId(client, code) {
  const r = await client.query('SELECT id FROM stock_catalog WHERE code=$1', [code]);
  return r.rows[0]?.id || null;
}
async function showBalances(client, id, label) {
  const b = await client.query(
    'SELECT base_location, area, qty_current FROM stock_balances WHERE catalog_id=$1 ORDER BY base_location, area', [id]);
  console.log(`  ${label}:` + (b.rows.length ? '' : ' (sin saldos)'));
  b.rows.forEach(r => console.log(`       ${r.base_location} / ${r.area} = ${r.qty_current}`));
}

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ MODO EJECUCIÓN (--apply)' : '🔎 MODO SIMULACIÓN (agregá --apply para ejecutar)'}\n`);

    const comb = await codeId(client, 'GEN-006');
    const etiq = await codeId(client, 'GEN-001');
    const ribb = await codeId(client, 'GEN-005');

    console.log('=== ANTES ===');
    if (comb) await showBalances(client, comb, 'GEN-006 COMBUSTIBLE'); else console.log('  GEN-006 no encontrado');
    if (etiq) await showBalances(client, etiq, 'GEN-001 Etiquetas');   else console.log('  GEN-001 no encontrado');
    if (ribb) await showBalances(client, ribb, 'GEN-005 Ribbons');     else console.log('  GEN-005 no encontrado');

    await client.query('BEGIN');

    // 1) COMBUSTIBLE — borrar SOLO lo del área Administración (queda Mantenimiento/Taller).
    //    'Administraci%' evita problemas de acento en la 'ó' final.
    let combBal = 0, combMov = 0;
    if (comb) {
      combBal = (await client.query(
        `DELETE FROM stock_balances WHERE catalog_id=$1 AND area LIKE 'Administraci%'`, [comb])).rowCount;
      combMov = (await client.query(
        `DELETE FROM stock_movements WHERE catalog_id=$1 AND area LIKE 'Administraci%'`, [comb])).rowCount;
    }

    // 2) ETIQUETAS y RIBBONS — borrar los artículos COMPLETOS (por catalog_id, sin depender del texto del área).
    const wipe = async (id) => {
      if (!id) return { disp: 0, mov: 0, bal: 0, ficha: '—' };
      const disp = (await client.query('DELETE FROM stock_dispatches WHERE catalog_id=$1', [id])).rowCount;
      const mov  = (await client.query('DELETE FROM stock_movements  WHERE catalog_id=$1', [id])).rowCount;
      const bal  = (await client.query('DELETE FROM stock_balances   WHERE catalog_id=$1', [id])).rowCount;
      let ficha = 'borrada';
      try {
        await client.query('DELETE FROM stock_catalog WHERE id=$1', [id]);
      } catch (e) {
        // Si algo la referencia (p.ej. una OC), no se borra: se DESACTIVA.
        await client.query('UPDATE stock_catalog SET active=FALSE WHERE id=$1', [id]);
        ficha = 'desactivada (tenía referencias)';
      }
      return { disp, mov, bal, ficha };
    };
    const etiqR = await wipe(etiq);
    const ribbR = await wipe(ribb);

    console.log('\n=== ACCIONES ===');
    console.log(`  COMBUSTIBLE: ${combBal} saldo(s) y ${combMov} movimiento(s) de Administración borrados. Se mantiene Mantenimiento (Taller).`);
    console.log(`  Etiquetas:   ${etiqR.bal} saldo(s), ${etiqR.mov} mov, ${etiqR.disp} despacho(s); ficha ${etiqR.ficha}.`);
    console.log(`  Ribbons:     ${ribbR.bal} saldo(s), ${ribbR.mov} mov, ${ribbR.disp} despacho(s); ficha ${ribbR.ficha}.`);

    if (APPLY) {
      await client.query('COMMIT');
      console.log('\n✅ CAMBIOS APLICADOS.');
      console.log('\n=== DESPUÉS ===');
      if (comb) await showBalances(client, comb, 'GEN-006 COMBUSTIBLE');
      console.log('  GEN-001 Etiquetas / GEN-005 Ribbons: eliminados (Enzo los recarga de cero).');
    } else {
      await client.query('ROLLBACK');
      console.log('\n🔎 SIMULACIÓN: no se guardó nada. Si está OK, corré de nuevo con --apply.');
    }
    console.log('');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
