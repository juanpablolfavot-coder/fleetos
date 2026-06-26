#!/usr/bin/env node
/**
 * Diagnóstico del stock actual (Fase 0 — SOLO LECTURA, no modifica nada).
 * ────────────────────────────────────────────────────────────────────────────
 * Sirve para ver, antes de migrar a "catálogo único + saldos por sucursal",
 * qué tan prolija está la base: cuántos ítems hay, cuántos códigos se repiten
 * en varias sucursales (se unificarían) y cuántos están en conflicto (mismo
 * código usado para ítems distintos → necesitan revisión manual).
 *
 * Uso (en la Shell de Render):  node scripts/diagnostico-stock.js
 */
const { pool } = require('../db/pool');

const norm = (s) => String(s == null ? '' : s).trim().toUpperCase();
const normName = (s) => String(s == null ? '' : s).trim().toLowerCase();

async function main() {
  const { rows } = await pool.query(
    `SELECT id, code, name, category, unit, qty_current, base_location, area
       FROM stock_items WHERE active = TRUE`);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  DIAGNÓSTICO DE STOCK — solo lectura');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── Totales ──
  const codigosVacios = rows.filter(r => !norm(r.code));
  const conCodigo = rows.filter(r => norm(r.code));
  const ubicaciones = new Map();
  rows.forEach(r => {
    const k = `${r.base_location || '—'} / ${r.area || '—'}`;
    ubicaciones.set(k, (ubicaciones.get(k) || 0) + 1);
  });

  console.log(`Ítems activos:            ${rows.length}`);
  console.log(`Códigos distintos:        ${new Set(conCodigo.map(r => norm(r.code))).size}`);
  console.log(`Ítems sin código:         ${codigosVacios.length}${codigosVacios.length ? '  ⚠ (hay que asignarles uno antes de migrar)' : ''}`);
  console.log(`\nUbicaciones (sucursal / área):`);
  [...ubicaciones.entries()].sort().forEach(([k, n]) => console.log(`   • ${k}: ${n} ítems`));

  // ── Agrupar por código normalizado ──
  const grupos = new Map(); // code -> [rows]
  conCodigo.forEach(r => {
    const k = norm(r.code);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(r);
  });

  const unicos = [];        // 1 sola fila → ya está
  const duplicadosLimpios = []; // varias filas, mismo nombre/cat/unidad → se fusionan solos
  const conflictos = [];    // varias filas con nombre/cat/unidad distinto → revisión manual

  for (const [code, items] of grupos) {
    if (items.length === 1) { unicos.push(code); continue; }
    const nombres = new Set(items.map(r => normName(r.name)));
    const cats = new Set(items.map(r => r.category || ''));
    const units = new Set(items.map(r => r.unit || ''));
    if (nombres.size > 1 || cats.size > 1 || units.size > 1) {
      conflictos.push({ code, items, nombres, cats, units });
    } else {
      duplicadosLimpios.push({ code, items });
    }
  }

  console.log(`\n───────────────────────────────────────────────────────────`);
  console.log(`  RESULTADO DE LA UNIFICACIÓN POR CÓDIGO`);
  console.log(`───────────────────────────────────────────────────────────`);
  console.log(`✅ Códigos en una sola ubicación:     ${unicos.length}  (sin cambios)`);
  console.log(`🔀 Códigos en varias ubicaciones:     ${duplicadosLimpios.length}  (se unifican solos, se suman cantidades)`);
  console.log(`⚠️  Códigos EN CONFLICTO:              ${conflictos.length}  (mismo código, ítem distinto → revisar a mano)`);

  if (duplicadosLimpios.length) {
    console.log(`\n🔀 Ejemplos de unificación limpia (hasta 10):`);
    duplicadosLimpios.slice(0, 10).forEach(({ code, items }) => {
      const total = items.reduce((a, r) => a + (parseFloat(r.qty_current) || 0), 0);
      const ubis = items.map(r => `${r.base_location}/${r.area}=${r.qty_current}`).join(', ');
      console.log(`   • ${code}  "${items[0].name}"  → total ${total}  [${ubis}]`);
    });
  }

  if (conflictos.length) {
    console.log(`\n⚠️  CONFLICTOS a revisar (hasta 20) — mismo código, datos distintos:`);
    conflictos.slice(0, 20).forEach(({ code, items }) => {
      console.log(`   • Código ${code}:`);
      items.forEach(r => console.log(`        - ${r.base_location}/${r.area}: "${r.name}" · cat=${r.category} · unidad=${r.unit} · cant=${r.qty_current}`));
    });
    if (conflictos.length > 20) console.log(`     … y ${conflictos.length - 20} más.`);
  }

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  RESUMEN`);
  console.log(`═══════════════════════════════════════════════════════════`);
  if (conflictos.length === 0 && codigosVacios.length === 0) {
    console.log(`✅ Base limpia. La migración a catálogo único debería ser directa.`);
  } else {
    console.log(`Antes de migrar conviene resolver:`);
    if (codigosVacios.length) console.log(`   • ${codigosVacios.length} ítem(s) sin código → asignarles uno.`);
    if (conflictos.length) console.log(`   • ${conflictos.length} código(s) en conflicto → decidir cuál es el nombre/categoría correcto, o separarlos en códigos distintos.`);
  }
  console.log('');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
