-- ══════════════════════════════════════════════════════════════════════
-- 05 — Workflow de compras: estado terminal 'cerrada' (Etapa 3, PR A2)
-- ──────────────────────────────────────────────────────────────────────
-- Una OC se considera CERRADA cuando su pago y su entrega están ambos en total.
-- El cierre automático lo aplican los recálculos en runtime; este backfill
-- normaliza las OC existentes que ya cumplían la condición (estaban como
-- 'recibida'/'pagada' con ambos totales).
--
-- Idempotente: re-ejecutarlo no afecta OC que no cumplen la condición.
-- ══════════════════════════════════════════════════════════════════════

UPDATE purchase_orders
SET status = 'cerrada'
WHERE status NOT IN ('rechazada','cerrada')
  AND COALESCE(payment_status,  'pendiente') = 'total'
  AND COALESCE(delivery_status, 'pendiente') = 'total';
