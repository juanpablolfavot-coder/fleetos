#!/usr/bin/env node
/**
 * Corrige la OT-00154 (EMBRAGUE — FREGGIARO): se cargó SIN desglose el mismo importe
 * dos veces — una vez como "KIT DE EMBRAGUE" y otra como "Mano de obra tercerizada" —,
 * dejando el costo al DOBLE ($4.380.165,20) cuando el total real es UNO SOLO de
 * $2.190.082,60.
 *
 * Decisión (confirmada): dejar una única línea con el KIT DE EMBRAGUE ($2.190.082,60)
 * y eliminar la línea duplicada de mano de obra tercerizada. Se corrige tanto la OT
 * como la OC-0122 (que también quedó al doble).
 *
 * SEGURIDAD: si la OC-0122 ya tiene factura y/o pago cargado, el script NO toca la OC
 * (ni sus ítems ni su total): solo corrige la OT y avisa para que Compras/Tesorería lo
 * resuelvan aparte (p. ej. nota de crédito). La OT siempre se corrige.
 *
 * Uso (Shell de Render):
 *   node scripts/corregir-ot-00154-duplicado.js            → SIMULACIÓN (no toca nada)
 *   node scripts/corregir-ot-00154-duplicado.js --apply    → EJECUTA
 */
const { pool } = require('../db/pool');
const APPLY = process.argv.includes('--apply');

const OT_CODE = 'OT-00154';
const OC_CODE = 'OC-0122';
const ars = n => '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ MODO EJECUCIÓN (--apply)' : '🔎 MODO SIMULACIÓN (agregá --apply para ejecutar)'}\n`);

    // ── OT ──────────────────────────────────────────────────────────────────
    const otRes = await client.query('SELECT id, code, parts_cost FROM work_orders WHERE code=$1', [OT_CODE]);
    if (!otRes.rows[0]) { console.log(`${OT_CODE} no encontrada.`); return; }
    const ot = otRes.rows[0];

    const parts = await client.query(
      `SELECT id, name, origin, qty, unit, unit_cost, subtotal, po_id
         FROM work_order_parts WHERE wo_id=$1 ORDER BY added_at`, [ot.id]);
    console.log(`=== OT ${ot.code} · repuestos actuales (parts_cost = ${ars(ot.parts_cost)}) ===`);
    parts.rows.forEach(p =>
      console.log(`   [${p.origin}/${p.unit}] ${p.name} · ${p.qty} × ${ars(p.unit_cost)} = ${ars(p.subtotal)}`));

    // Línea a eliminar: la mano de obra tercerizada (unidad 'servicio').
    const rm = parts.rows.filter(p =>
      p.origin === 'externo' && p.unit === 'servicio' && /^Mano de obra tercerizada/i.test(p.name || ''));
    if (rm.length !== 1) {
      console.log(`\n⚠ Se esperaba exactamente 1 línea de "Mano de obra tercerizada" para eliminar y se encontraron ${rm.length}.`);
      console.log('  No se aplica nada automáticamente. Revisar manualmente (¿ya se corrigió?).');
      return;
    }
    const rmPart = rm[0];
    const projected = parts.rows.filter(p => p.id !== rmPart.id)
      .reduce((a, p) => a + Number(p.subtotal || 0), 0);
    console.log(`\n   → Se elimina: "${rmPart.name}" (${ars(rmPart.subtotal)})`);
    console.log(`   → parts_cost proyectado: ${ars(projected)}`);
    if (Math.abs(projected - 2190082.60) > 0.5)
      console.log(`   ⚠ OJO: el proyectado no da $2.190.082,60. Revisar antes de aplicar.`);

    // ── OC-0122 ─────────────────────────────────────────────────────────────
    const ocRes = await client.query(
      'SELECT id, code, status, total_estimado, factura_nro, factura_monto FROM purchase_orders WHERE code=$1', [OC_CODE]);
    const oc = ocRes.rows[0] || null;
    let ocHasFinance = false, ocItemToDelete = null, ocProjectedTotal = null;

    if (!oc) {
      console.log(`\n⚠ ${OC_CODE} no encontrada — solo se corrige la OT.`);
    } else {
      const items = await client.query(
        'SELECT id, descripcion, cantidad, precio_unit, subtotal, work_order_part_id FROM purchase_order_items WHERE po_id=$1 ORDER BY id', [oc.id]);
      console.log(`\n=== OC ${oc.code} · estado=${oc.status} · total_estimado=${ars(oc.total_estimado)} ===`);
      items.rows.forEach(i =>
        console.log(`   ${i.descripcion} · ${i.cantidad} × ${ars(i.precio_unit)} = ${ars(i.subtotal)}${i.work_order_part_id ? '' : '  (sin work_order_part_id)'}`));

      // Ítem de OC a borrar: el ligado a la línea eliminada; fallback por descripción.
      ocItemToDelete = items.rows.find(i => i.work_order_part_id === rmPart.id)
        || items.rows.find(i => /^Mano de obra tercerizada/i.test(i.descripcion || ''));
      ocProjectedTotal = items.rows.filter(i => !ocItemToDelete || i.id !== ocItemToDelete.id)
        .reduce((a, i) => a + Number(i.subtotal || 0), 0);

      // ¿Tiene factura/pago? (facturas nuevas, pagos, o campos legacy de factura)
      const inv = await client.query(
        'SELECT COUNT(*)::int n, COALESCE(SUM(monto_pagado),0) pagado, COUNT(*) FILTER (WHERE pagada) pagadas FROM purchase_order_invoices WHERE po_id=$1', [oc.id]).catch(() => ({ rows: [{ n: 0, pagado: 0, pagadas: 0 }] }));
      const pay = await client.query(
        'SELECT COUNT(*)::int n FROM purchase_order_payments WHERE invoice_id IN (SELECT id FROM purchase_order_invoices WHERE po_id=$1)', [oc.id]).catch(() => ({ rows: [{ n: 0 }] }));
      const iv = inv.rows[0], pv = pay.rows[0];
      const legacyFactura = !!(oc.factura_nro || Number(oc.factura_monto) > 0);
      ocHasFinance = iv.n > 0 || pv.n > 0 || legacyFactura;

      console.log(`\n   Facturas cargadas: ${iv.n}${iv.pagadas ? ` (${iv.pagadas} pagada/s)` : ''} · pagos: ${pv.n} · pagado: ${ars(iv.pagado)}${legacyFactura ? ` · factura legacy: ${oc.factura_nro || ''} ${ars(oc.factura_monto)}` : ''}`);
      if (ocHasFinance) {
        console.log(`   ⛔ La OC ya tiene factura/pago → NO se toca la OC (queda para Compras/Tesorería).`);
      } else {
        console.log(`   → Se elimina de la OC: "${ocItemToDelete ? ocItemToDelete.descripcion : '(no se encontró ítem ligado)'}"`);
        console.log(`   → total_estimado proyectado: ${ars(ocProjectedTotal)}`);
      }
    }

    // ── Aplicar ───────────────────────────────────────────────────────────────
    await client.query('BEGIN');

    // OT: borrar la línea duplicada y recalcular parts_cost.
    await client.query('DELETE FROM work_order_parts WHERE id=$1', [rmPart.id]);
    await client.query(
      `UPDATE work_orders SET parts_cost = COALESCE((SELECT SUM(COALESCE(subtotal,0)) FROM work_order_parts WHERE wo_id=$1),0) WHERE id=$1`,
      [ot.id]);

    // OC: solo si no tiene factura/pago.
    let ocChanged = false;
    if (oc && !ocHasFinance && ocItemToDelete) {
      await client.query('DELETE FROM purchase_order_items WHERE id=$1', [ocItemToDelete.id]);
      await client.query(
        `UPDATE purchase_orders SET total_estimado = COALESCE((SELECT SUM(COALESCE(subtotal,0)) FROM purchase_order_items WHERE po_id=$1),0) WHERE id=$1`,
        [oc.id]);
      ocChanged = true;
    }

    const otAfter = await client.query('SELECT parts_cost FROM work_orders WHERE id=$1', [ot.id]);
    console.log(`\n=== RESULTADO ===`);
    console.log(`   OT ${ot.code}: parts_cost = ${ars(otAfter.rows[0].parts_cost)}`);
    if (oc) {
      const ocAfter = await client.query('SELECT total_estimado FROM purchase_orders WHERE id=$1', [oc.id]);
      console.log(`   OC ${oc.code}: total_estimado = ${ars(ocAfter.rows[0].total_estimado)}${ocChanged ? '' : ' (sin cambios)'}`);
    }

    if (APPLY) {
      await client.query('COMMIT');
      console.log(`\n✅ Corrección aplicada.`);
      if (oc && ocHasFinance) console.log(`⚠ La OC ${oc.code} NO se modificó por tener factura/pago. Revisar con Compras/Tesorería (posible nota de crédito).`);
      console.log('');
    } else {
      await client.query('ROLLBACK');
      console.log(`\n🔎 SIMULACIÓN: no se guardó nada. Si está OK, corré con --apply.\n`);
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
