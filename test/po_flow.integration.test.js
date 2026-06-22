// ═══════════════════════════════════════════════════════════════════════════
//  Tests de INTEGRACIÓN de los flujos de plata (recepción y pago de OC)
//
//  Validan que los triggers/máquina de estados de la base dejen la OC en el
//  estado correcto. Necesitan una base de Postgres DE PRUEBA (descartable):
//    TEST_DATABASE_URL=postgresql://... npm test
//  Si no está esa variable, TODA la suite se SALTA (npm test sigue verde sin DB).
//
//  Preparar la base de prueba una vez:  DATABASE_URL=<test> npm run migrate
// ═══════════════════════════════════════════════════════════════════════════
const { test, before, after } = require('node:test');
const assert = require('node:assert');

const DBURL = process.env.TEST_DATABASE_URL || (process.env.NODE_ENV === 'test' ? process.env.DATABASE_URL : null);
const SKIP = !DBURL;

let client;
let _seq = 0;
const num = (v) => Number(v);
const nextCode = () => 'ITEST-' + (++_seq); // code es VARCHAR(20); lo mantenemos corto

before(async () => {
  if (SKIP) return;
  const { Client } = require('pg');
  client = new Client({ connectionString: DBURL });
  await client.connect();
  await client.query("DELETE FROM purchase_orders WHERE code LIKE 'ITEST-%'"); // limpiar corridas previas
});

after(async () => {
  if (!client) return;
  await client.query("DELETE FROM purchase_orders WHERE code LIKE 'ITEST-%'").catch(() => {});
  await client.end();
});

async function nuevaOC(code, { status = 'enviada_proveedor', delivery = 'pendiente', payment = 'pendiente', isOpen = false } = {}) {
  const r = await client.query(
    `INSERT INTO purchase_orders (code, status, is_open, delivery_status, payment_status)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [code, status, isOpen, delivery, payment]
  );
  return r.rows[0].id;
}
const poEstado = async (id) =>
  (await client.query(`SELECT status, delivery_status, payment_status FROM purchase_orders WHERE id=$1`, [id])).rows[0];

// ── Recepción: parcial vs total ─────────────────────────────────────────────
test('recepción parcial deja delivery=parcial; completar deja recibida', { skip: SKIP }, async () => {
  const poId = await nuevaOC(nextCode());
  const item = (await client.query(
    `INSERT INTO purchase_order_items (po_id, descripcion, cantidad, unidad) VALUES ($1,'Filtro',10,'un') RETURNING id`, [poId]
  )).rows[0];

  // Recibo 4 de 10
  const rec1 = (await client.query(`INSERT INTO purchase_order_receipts (po_id, received_at, destino) VALUES ($1,NOW(),'Test') RETURNING id`, [poId])).rows[0];
  await client.query(`INSERT INTO purchase_order_receipt_items (receipt_id, po_item_id, cantidad) VALUES ($1,$2,4)`, [rec1.id, item.id]);

  let e = await poEstado(poId);
  assert.equal(e.delivery_status, 'parcial', 'recepción parcial → delivery_status=parcial');
  assert.notEqual(e.status, 'recibida', 'recepción parcial NO debe marcar recibida');

  // Recibo los 6 restantes (total 10)
  const rec2 = (await client.query(`INSERT INTO purchase_order_receipts (po_id, received_at, destino) VALUES ($1,NOW(),'Test') RETURNING id`, [poId])).rows[0];
  await client.query(`INSERT INTO purchase_order_receipt_items (receipt_id, po_item_id, cantidad) VALUES ($1,$2,6)`, [rec2.id, item.id]);

  e = await poEstado(poId);
  assert.equal(e.delivery_status, 'total', 'recepción completa → delivery_status=total');
  assert.equal(e.status, 'recibida', 'recepción completa → status=recibida');
});

// ── Pagos: parcial, total con cierre, y NO duplicación ──────────────────────
test('pago parcial→parcial; pago total con entrega total→cerrada; monto no se duplica', { skip: SKIP }, async () => {
  const poId = await nuevaOC(nextCode(), { status: 'recibida', delivery: 'total' });
  const inv = (await client.query(
    `INSERT INTO purchase_order_invoices (po_id, invoice_nro, invoice_fecha, invoice_monto, iva_pct, uploaded_at, monto_pagado, pagada)
     VALUES ($1,'F-1',CURRENT_DATE,1000,0,NOW(),0,false) RETURNING id`, [poId]
  )).rows[0];

  // Pago parcial de 400
  await client.query(`INSERT INTO purchase_order_payments (invoice_id, paid_at, monto, metodo) VALUES ($1,NOW(),400,'efectivo')`, [inv.id]);
  let invRow = (await client.query(`SELECT monto_pagado, pagada FROM purchase_order_invoices WHERE id=$1`, [inv.id])).rows[0];
  let e = await poEstado(poId);
  assert.equal(num(invRow.monto_pagado), 400);
  assert.equal(invRow.pagada, false);
  assert.equal(e.payment_status, 'parcial', 'pago parcial → payment_status=parcial');
  assert.notEqual(e.status, 'cerrada', 'pago parcial no debe cerrar la OC');

  // Pago final de 600 (suma 1000)
  await client.query(`INSERT INTO purchase_order_payments (invoice_id, paid_at, monto, metodo) VALUES ($1,NOW(),600,'efectivo')`, [inv.id]);
  invRow = (await client.query(`SELECT monto_pagado, pagada FROM purchase_order_invoices WHERE id=$1`, [inv.id])).rows[0];
  e = await poEstado(poId);
  assert.equal(num(invRow.monto_pagado), 1000, 'monto_pagado = SUMA de pagos (no se duplica)');
  assert.equal(invRow.pagada, true);
  assert.equal(e.payment_status, 'total', 'pago total → payment_status=total');
  assert.equal(e.status, 'cerrada', 'entrega total + pago total → status=cerrada');
});

// ── El pago total se evalúa CON IVA incluido ────────────────────────────────
test('una factura no queda pagada hasta cubrir el total CON IVA', { skip: SKIP }, async () => {
  const poId = await nuevaOC(nextCode(), { status: 'recibida', delivery: 'total' });
  // Neto 1000 + 21% IVA = 1210 total
  const inv = (await client.query(
    `INSERT INTO purchase_order_invoices (po_id, invoice_nro, invoice_fecha, invoice_monto, iva_pct, uploaded_at, monto_pagado, pagada)
     VALUES ($1,'F-IVA',CURRENT_DATE,1000,21,NOW(),0,false) RETURNING id`, [poId]
  )).rows[0];

  await client.query(`INSERT INTO purchase_order_payments (invoice_id, paid_at, monto, metodo) VALUES ($1,NOW(),1000,'efectivo')`, [inv.id]);
  let invRow = (await client.query(`SELECT pagada FROM purchase_order_invoices WHERE id=$1`, [inv.id])).rows[0];
  assert.equal(invRow.pagada, false, 'pagar solo el neto (1000) NO cubre el total con IVA (1210)');

  await client.query(`INSERT INTO purchase_order_payments (invoice_id, paid_at, monto, metodo) VALUES ($1,NOW(),210,'efectivo')`, [inv.id]);
  invRow = (await client.query(`SELECT pagada FROM purchase_order_invoices WHERE id=$1`, [inv.id])).rows[0];
  assert.equal(invRow.pagada, true, 'cubrir 1210 (neto + IVA) marca la factura pagada');
});
