#!/usr/bin/env node
/**
 * Ajuste de stock de la cisterna de GASOIL contra medición física (varilla).
 * ────────────────────────────────────────────────────────────────────────────
 * El nivel de la cisterna no se edita desde la app a propósito: se mueve solo con
 * ingresos y cargas. Cuando la medición física difiere del sistema (p. ej. tras
 * cargar movimientos históricos), el ajuste se hace acá y queda REGISTRADO como
 * movimiento en el historial de la cisterna (fuel_tank_entries), con nivel
 * anterior, nivel nuevo y el motivo — no es un cambio silencioso.
 *
 * Uso (Shell de Render):
 *   node scripts/ajustar-stock-cisterna.js                      → SIMULACIÓN a 5110 L
 *   node scripts/ajustar-stock-cisterna.js --apply              → EJECUTA
 *   node scripts/ajustar-stock-cisterna.js 4800 --apply         → otro valor
 *   node scripts/ajustar-stock-cisterna.js --tanque="R3" --apply → elegir cisterna por nombre
 */
const { pool } = require('../db/pool');
const APPLY = process.argv.includes('--apply');
const NIVEL = (() => {
  const n = process.argv.slice(2).map(Number).find(x => Number.isFinite(x) && x >= 0);
  return n !== undefined ? n : 5110;
})();
const FILTRO = (process.argv.find(a => a.startsWith('--tanque=')) || '').split('=')[1] || null;
const L = n => Math.round(Number(n) || 0).toLocaleString('es-AR') + ' L';

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ MODO EJECUCIÓN (--apply)' : '🔎 MODO SIMULACIÓN (agregá --apply para ejecutar)'}\n`);

    const all = await client.query(
      `SELECT id, location, current_l, capacity_l FROM tanks
        WHERE type IN ('fuel','gasoil') AND active IS DISTINCT FROM FALSE
        ORDER BY current_l DESC`);
    if (!all.rows.length) { console.log('No hay cisternas de gasoil activas.'); return; }

    console.log('Cisternas de gasoil activas:');
    all.rows.forEach(t => console.log(`   · ${t.location || '(sin nombre)'} — stock actual ${L(t.current_l)} / capacidad ${L(t.capacity_l)}`));

    let objetivo;
    if (FILTRO) {
      const m = all.rows.filter(t => String(t.location || '').toLowerCase().includes(FILTRO.toLowerCase()));
      if (m.length !== 1) { console.log(`\n❌ El filtro --tanque="${FILTRO}" coincide con ${m.length} cisternas. Afiná el nombre.`); return; }
      objetivo = m[0];
    } else if (all.rows.length === 1) {
      objetivo = all.rows[0];
    } else {
      objetivo = all.rows[0];
      console.log(`\n⚠ Hay ${all.rows.length} cisternas de gasoil: se toma la de mayor stock ("${objetivo.location}").`);
      console.log(`  Si querés otra, usá --tanque="parte del nombre".`);
    }

    const previo = parseFloat(objetivo.current_l) || 0;
    const cap = parseFloat(objetivo.capacity_l) || 0;
    const delta = +(NIVEL - previo).toFixed(2);

    console.log(`\n=== AJUSTE ===`);
    console.log(`   Cisterna:      ${objetivo.location || '(sin nombre)'}`);
    console.log(`   Stock sistema: ${L(previo)}`);
    console.log(`   Medición real: ${L(NIVEL)}`);
    console.log(`   Diferencia:    ${delta >= 0 ? '+' : ''}${L(delta)}  (${delta >= 0 ? 'faltaba cargar' : 'sobraba'} en el sistema)`);
    if (cap > 0 && NIVEL > cap) console.log(`   ⚠ El valor supera la capacidad declarada (${L(cap)}). Revisar antes de aplicar.`);
    if (delta === 0) { console.log('\n   El stock ya coincide: nada para ajustar.\n'); return; }

    await client.query('BEGIN');
    // Registro del ajuste en el historial de la cisterna (queda auditable).
    await client.query(
      `INSERT INTO fuel_tank_entries (tank_id, type, liters, price_per_l, supplier, remito, notes, previous_l, new_l, created_by)
       VALUES ($1,'ajuste',$2,NULL,NULL,NULL,$3,$4,$5,$6)`,
      [objetivo.id, delta,
       `Ajuste por medición física (varilla): ${L(previo)} → ${L(NIVEL)}. Corrige la diferencia acumulada del stock del sistema.`,
       previo, NIVEL,
       (await client.query(`SELECT id FROM users WHERE role IN ('dueno','gerencia') ORDER BY (role='dueno') DESC, created_at LIMIT 1`)).rows[0]?.id || null]);
    await client.query('UPDATE tanks SET current_l=$1, updated_at=NOW() WHERE id=$2', [NIVEL, objetivo.id]);

    if (APPLY) { await client.query('COMMIT'); console.log(`\n✅ Stock ajustado a ${L(NIVEL)} y registrado en el historial de la cisterna.\n`); }
    else { await client.query('ROLLBACK'); console.log('\n🔎 SIMULACIÓN: no se guardó nada. Si está OK, corré con --apply.\n'); }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
