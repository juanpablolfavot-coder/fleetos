#!/usr/bin/env node
/**
 * Migración Fase 1 — Stock a "catálogo único + saldos por sucursal".
 * ────────────────────────────────────────────────────────────────────────────
 * Crea dos tablas nuevas SIN tocar las viejas (la app sigue andando igual):
 *   • stock_catalog  — la ficha del artículo, con CÓDIGO ÚNICO (prefijo por rubro).
 *   • stock_balances — el saldo de cada artículo POR sucursal/área.
 *
 * Arma el catálogo desde stock_items deduplicando por NOMBRE (los códigos viejos
 * 01/02/03 eran correlativos locales y no sirven como identificador).
 *
 * Uso (Shell de Render):
 *   DRY_RUN=1 node scripts/migrar-stock-catalogo.js   → preview, NO crea ni inserta nada
 *   node scripts/migrar-stock-catalogo.js             → crea tablas e inserta
 *
 * Idempotente: si stock_catalog ya tiene datos, no re-inserta (avisa y corta).
 */
const { pool } = require('../db/pool');

const DRY_RUN = !!process.env.DRY_RUN;

const stripAccents = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const normName = (s) => stripAccents(s).trim().toLowerCase().replace(/\s+/g, ' ');

// Prefijo de código por categoría. Para categorías no listadas, usa las primeras 3 letras.
const PREFIJOS = { lubricantes: 'LUB', electrico: 'ELE', filtros: 'FIL', general: 'GEN', palet: 'PAL', frenos: 'FRE' };
const prefijo = (cat) => {
  const k = normName(cat);
  if (PREFIJOS[k]) return PREFIJOS[k];
  return (stripAccents(cat).replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase()) || 'GEN';
};

async function main() {
  console.log(DRY_RUN ? '🔎 DRY RUN — preview, no se crea ni inserta nada\n' : '🚚 Migrando stock a catálogo + saldos\n');

  const { rows } = await pool.query(
    `SELECT name, category, unit, qty_current, qty_min, qty_reorder, unit_cost, supplier, base_location, area
       FROM stock_items WHERE active = TRUE`);

  // ── Agrupar por nombre (artículo real) ──
  const map = new Map();
  for (const r of rows) {
    const k = normName(r.name);
    if (!k) { console.log(`⚠ Ítem sin nombre salteado (cód ${r.code || '—'})`); continue; }
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }

  // ── Construir artículos del catálogo ──
  const articles = [];
  for (const [, items] of map) {
    const main = items.slice().sort((a, b) => (parseFloat(b.qty_current) || 0) - (parseFloat(a.qty_current) || 0))[0];
    articles.push({
      name: String(main.name).trim(),
      category: main.category || 'General',
      unit: main.unit || 'un',
      qty_min: Math.max(0, ...items.map((i) => parseFloat(i.qty_min) || 0)),
      qty_reorder: Math.max(0, ...items.map((i) => parseFloat(i.qty_reorder) || 0)),
      unit_cost: parseFloat(main.unit_cost) || 0,
      supplier: main.supplier || null,
      merged: items.length > 1,
      balances: items.map((i) => ({ base_location: i.base_location, area: i.area, qty: parseFloat(i.qty_current) || 0 })),
    });
  }

  // ── Asignar códigos: orden (prefijo, nombre) y correlativo por prefijo ──
  articles.forEach((a) => { a.prefix = prefijo(a.category); });
  articles.sort((a, b) => a.prefix.localeCompare(b.prefix) || normName(a.name).localeCompare(normName(b.name)));
  const counters = {};
  articles.forEach((a) => {
    counters[a.prefix] = (counters[a.prefix] || 0) + 1;
    a.code = `${a.prefix}-${String(counters[a.prefix]).padStart(3, '0')}`;
  });

  // ── Preview ──
  const totalBalances = articles.reduce((n, a) => n + a.balances.length, 0);
  const fusionados = articles.filter((a) => a.merged).length;
  console.log(`Artículos del catálogo: ${articles.length}  (desde ${rows.length} filas · ${fusionados} fusionados por nombre)`);
  console.log(`Saldos por sucursal/área: ${totalBalances}\n`);
  for (const a of articles) {
    const saldos = a.balances.map((b) => `${b.base_location}/${b.area}=${b.qty}`).join(' · ');
    console.log(`  ${a.code.padEnd(8)} ${a.name}${a.merged ? ' 🔀' : ''}`);
    console.log(`           ${a.category} · ${a.unit} · ${saldos}`);
  }
  console.log('');

  if (DRY_RUN) { console.log('🔎 DRY RUN: no se creó ni insertó nada.\n'); await pool.end(); return; }

  // ── Crear tablas (sin tocar las viejas) ──
  await pool.query(`CREATE TABLE IF NOT EXISTS stock_catalog (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'General',
    unit VARCHAR(20) NOT NULL DEFAULT 'un',
    qty_min NUMERIC(10,2) NOT NULL DEFAULT 0,
    qty_reorder NUMERIC(10,2) NOT NULL DEFAULT 0,
    unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    supplier VARCHAR(200),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS stock_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    catalog_id UUID NOT NULL REFERENCES stock_catalog(id) ON DELETE CASCADE,
    base_location VARCHAR(200) NOT NULL,
    area VARCHAR(100) NOT NULL,
    qty_current NUMERIC(10,2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (catalog_id, base_location, area)
  )`);

  // Idempotencia: si ya hay catálogo, no duplicar.
  const yaHay = await pool.query('SELECT COUNT(*)::int AS n FROM stock_catalog');
  if (yaHay.rows[0].n > 0) {
    console.log(`↩️  stock_catalog ya tiene ${yaHay.rows[0].n} artículos — no se re-inserta. (Para rehacer, hay que vaciar las tablas a mano.)\n`);
    await pool.end();
    return;
  }

  // ── Insertar en transacción ──
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const a of articles) {
      const r = await client.query(
        `INSERT INTO stock_catalog (code, name, category, unit, qty_min, qty_reorder, unit_cost, supplier)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [a.code, a.name, a.category, a.unit, a.qty_min, a.qty_reorder, a.unit_cost, a.supplier]);
      const catId = r.rows[0].id;
      for (const b of a.balances) {
        await client.query(
          `INSERT INTO stock_balances (catalog_id, base_location, area, qty_current)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (catalog_id, base_location, area) DO UPDATE SET qty_current = stock_balances.qty_current + EXCLUDED.qty_current`,
          [catId, b.base_location, b.area, b.qty]);
      }
    }
    await client.query('COMMIT');
    console.log(`✅ Migrado: ${articles.length} artículos y ${totalBalances} saldos. Las tablas viejas quedaron intactas.\n`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Error, se revirtió todo:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
