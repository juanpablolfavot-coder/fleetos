-- ══════════════════════════════════════════════════════════════════════
-- 04 — Workflow de compras: estado "enviada al proveedor" (Etapa 3, PR A1)
-- ──────────────────────────────────────────────────────────────────────
-- Introduce el estado 'enviada_proveedor' como paso OBLIGATORIO entre
-- 'aprobada_compras' y pagar/recibir.
--
-- Backfill SEGURO y conservador: solo mueve a 'enviada_proveedor' las OC que
-- estaban en 'aprobada_compras' PERO que ya tenían actividad de pago/recepción/
-- factura (es decir, en el flujo viejo ya se habían "enviado" de hecho). Así no
-- quedan trabadas por el nuevo gate. Las OC aprobadas SIN actividad se quedan en
-- 'aprobada_compras' y siguen el flujo nuevo normal (alguien las marca enviada).
--
-- Idempotente: re-ejecutarlo no afecta OC nuevas sin actividad.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS fecha_envio_prov TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS enviada_por UUID REFERENCES users(id);

UPDATE purchase_orders po
SET status = 'enviada_proveedor',
    fecha_envio_prov = COALESCE(po.fecha_envio_prov, NOW())
WHERE po.status = 'aprobada_compras'
  AND (
        COALESCE(po.delivery_status, 'pendiente') <> 'pendiente'
     OR COALESCE(po.payment_status,  'pendiente') <> 'pendiente'
     OR EXISTS (SELECT 1 FROM purchase_order_invoices f WHERE f.po_id = po.id)
     OR EXISTS (SELECT 1 FROM purchase_order_receipts r WHERE r.po_id = po.id)
  );
