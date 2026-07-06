#!/usr/bin/env node
/**
 * Corrige la OC-0081: se cargó el TOTAL de cada renglón en el campo "precio unitario";
 * como la cantidad es 2, al multiplicar el monto quedó al DOBLE. (Opción B confirmada:
 * compraron 2 de cada uno y el precio ingresado era el total de los 2.)
 *
 * Divide el precio unitario a la mitad en TODOS los renglones y recalcula el total
 * de la OC (total_estimado). NO toca facturas ni pagos: si hay una factura con el
 * monto duplicado, la simulación la muestra para decidirla aparte.
 *
 * Uso (Shell de Render):
 *   node scripts/fix-oc-0081-precios.js            → SIMULACIÓN (no toca nada)
 *   node scripts/fix-oc-0081-precios.js --apply    → EJECUTA
 */
const { pool } = require('../db/pool');
const APPLY = process.argv.includes('--apply');
const CODE = 'OC-0081';
const ars = n => '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ MODO EJECUCIÓN (--apply)' : '🔎 MODO SIMULACIÓN (agregá --apply para ejecutar)'}\n`);

    const po = await client.query('SELECT id, code, status, total_estimado, iva_pct FROM purchase_orders WHERE code=$1', [CODE]);
    if (!po.rows[0]) { console.log(`${CODE} no encontrada.`); return; }
    const oc = po.rows[0];
    const iva = parseFloat(oc.iva_pct) || 0;
    console.log(`OC ${oc.code} · estado=${oc.status} · IVA=${iva}%`);

    const showItems = async () => {
      const it = await client.query(
        'SELECT descripcion, cantidad, precio_unit, subtotal FROM purchase_order_items WHERE po_id=$1 ORDER BY subtotal DESC', [oc.id]);
      let sub = 0;
      it.rows.forEach(r => { sub += parseFloat(r.subtotal) || 0; console.log(`   ${r.descripcion} | cant ${r.cantidad} × ${ars(r.precio_unit)} = ${ars(r.subtotal)}`); });
      console.log(`   Subtotal: ${ars(sub)}  ·  IVA ${iva}%: ${ars(sub * iva / 100)}  ·  TOTAL: ${ars(sub * (1 + iva / 100))}`);
      return sub;
    };

    console.log('\n=== ITEMS ACTUALES ===');
    await showItems();

    console.log('\n=== FACTURAS DE ESTA OC (informativo, NO se tocan) ===');
    const inv = await client.query(
      'SELECT invoice_nro, invoice_fecha, invoice_monto, iva_pct FROM purchase_order_invoices WHERE po_id=$1', [oc.id]).catch(() => ({ rows: [] }));
    if (!inv.rows.length) console.log('   (sin facturas cargadas)');
    inv.rows.forEach(r => {
      const i = parseFloat(r.iva_pct) || 0;
      console.log(`   N° ${r.invoice_nro} · ${r.invoice_fecha} · neto ${ars(r.invoice_monto)} + IVA ${i}% = ${ars(parseFloat(r.invoice_monto) * (1 + i / 100))}`);
    });

    await client.query('BEGIN');
    const upd = await client.query('UPDATE purchase_order_items SET precio_unit = ROUND(precio_unit / 2, 2) WHERE po_id=$1', [oc.id]);
    const t = await client.query('SELECT COALESCE(SUM(subtotal),0) AS s FROM purchase_order_items WHERE po_id=$1', [oc.id]);
    const newSub = parseFloat(t.rows[0].s);
    await client.query('UPDATE purchase_orders SET total_estimado=$1 WHERE id=$2', [newSub, oc.id]);

    console.log('\n=== ITEMS CORREGIDOS (precio unitario ÷ 2) ===');
    await showItems();
    console.log(`\n   ${upd.rowCount} renglón(es) ajustado(s). Nuevo total (neto) de la OC: ${ars(newSub)}`);

    if (APPLY) { await client.query('COMMIT'); console.log('\n✅ OC-0081 corregida.'); }
    else { await client.query('ROLLBACK'); console.log('\n🔎 SIMULACIÓN: no se guardó nada. Si está OK, corré con --apply.'); }

    if (inv.rows.length) {
      console.log('\n⚠ Esta OC tiene factura(s) cargada(s). Este script NO las modifica.');
      console.log('  Si el NETO de la factura también está al doble, hay que corregirla aparte antes de pagar.');
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
