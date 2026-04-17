// ═══════════════════════════════════════════════════════════
//  FleetOS — Órdenes de Compra
// ═══════════════════════════════════════════════════════════
const router   = require('express').Router();
const { query } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

async function ensureTables() {
  await query(`CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'borrador',
    requested_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    sucursal VARCHAR(200), notes TEXT, proveedor VARCHAR(200),
    factura_nro VARCHAR(100), factura_fecha DATE,
    factura_monto NUMERIC(14,2), iva_pct NUMERIC(5,2) DEFAULT 0,
    area VARCHAR(200), tipo VARCHAR(30) DEFAULT 'flota',
    vehicle_id UUID REFERENCES vehicles(id),
    ot_id UUID REFERENCES work_orders(id),
    total_estimado NUMERIC(14,2) DEFAULT 0
  )`).catch(()=>{});
  await query(`CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    descripcion TEXT NOT NULL, cantidad NUMERIC(10,2) DEFAULT 1,
    unidad VARCHAR(20) DEFAULT 'un', precio_uni
