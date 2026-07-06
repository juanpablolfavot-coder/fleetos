#!/usr/bin/env node
/**
 * Corrige la factura A-4-15244 de la OC-0081, que quedó cargada al DOBLE
 * (neto $246.760,33 → total $298.580) mientras la OC ya está en $149.290.
 * Deja el neto de la factura igual al neto de la OC (total_estimado), para que
 * coincidan y no figure "sobre-facturada" ni te cobre el doble al pagar.
 *
 * No toca pagos. Uso (Shell de Render):
 *   node scripts/fix-factura-oc0081.js            → SIMULACIÓN (no toca nada)
 *   node scripts/fix-factura-oc0081.js --apply    → EJECUTA
 */
const { pool } = require('../db/pool');
const APPLY = process.argv.includes('--apply');
const OC = 'OC-0081';
const NRO = 'A-4-15244';
const ars = n => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-AR');

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ EJECUCIÓN (--apply)' : '🔎 SIMULACIÓN (agregá --apply para ejecutar)'}\n`);
    const po = await client.query('SELECT id, total_estimado, iva_pct FROM purchase_orders WHERE code=$1', [OC]);
    if (!po.rows[0]) { console.log(`${OC} no encontrada.`); return; }
    const oc = po.rows[0];
    const ocNeto = parseFloat(oc.total_estimado) || 0;      // neto correcto = el de la OC
    const iva = parseFloat(oc.iva_pct) || 0;

    const inv = await client.query(
      'SELECT id, invoice_nro, invoice_monto, iva_pct FROM purchase_order_invoices WHERE po_id=$1 AND invoice_nro=$2', [oc.id, NRO]);
    if (!inv.rows[0]) { console.log(`Factura ${NRO} no encontrada en ${OC}.`); return; }
    const f = inv.rows[0];
    const fIva = parseFloat(f.iva_pct) || 0;

    console.log(`OC ${OC}: neto ${ars(ocNeto)}  ->  total c/IVA ${ars(ocNeto * (1 + iva / 100))}`);
    console.log(`Factura ${NRO} (ANTES): neto ${ars(f.invoice_monto)}  ->  total c/IVA ${ars(parseFloat(f.invoice_monto) * (1 + fIva / 100))}`);
    console.log(`Factura ${NRO} (DESPUÉS): neto ${ars(ocNeto)}  ->  total c/IVA ${ars(ocNeto * (1 + fIva / 100))}`);

    await client.query('BEGIN');
    await client.query('UPDATE purchase_order_invoices SET invoice_monto=$1 WHERE id=$2', [ocNeto, f.id]);
    if (APPLY) { await client.query('COMMIT'); console.log('\n✅ Factura corregida: ahora coincide con la OC.'); }
    else { await client.query('ROLLBACK'); console.log('\n🔎 SIMULACIÓN: no se guardó nada. Si está OK, corré con --apply.'); }
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
