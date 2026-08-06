#!/usr/bin/env node
/**
 * Marca como respaldadas EN PAPEL las cargas que se tipearon desde el ticket físico.
 * ────────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA
 * Las cargas de estación que se cargaron después, a mano, desde el comprobante de
 * papel no tienen foto: nadie le saca una foto a un ticket que ya está tipeado con
 * su número anotado. El panel del auditor las contaba como "cargas sin respaldo"
 * junto con las que de verdad no tienen nada, y así el aviso mezclaba las que hay
 * que reclamar con las que ya están respaldadas.
 *
 * LA SOLUCIÓN
 * Dejarlo explícito en el dato en vez de deducirlo cada vez: ticket_estado='papel'.
 * Se reconocen porque las notas arrancan con el número del ticket ("Ticket 1234 ·
 * carga manual (script)"), que es lo que escriben los scripts de carga masiva.
 *
 * De acá en adelante esos scripts ya guardan 'papel' solos; esto es sólo para las
 * que quedaron cargadas antes.
 *
 * Uso (Shell de Render):
 *   node scripts/marcar-tickets-papel.js            → SIMULACIÓN (no toca nada)
 *   node scripts/marcar-tickets-papel.js --apply    → EJECUTA
 */
const { pool } = require('../db/pool');
const APPLY = process.argv.includes('--apply');

// Carga de estación (sin cisterna), sin foto, sin estado, y con el número de
// ticket anotado en las notas. Esa última condición es la que garantiza que el
// comprobante existe: no se marca nada que no lo tenga.
//
// Las columnas van calificadas con "fl." y el UPDATE aliasea la tabla igual, para
// poder usar la MISMA condición en los dos lados: lo que se lista es exactamente
// lo que se marca. Sin el alias, el SELECT —que hace join con vehicles, que
// también tiene una columna notes— no sabe de cuál de las dos hablamos.
const CONDICION = `
  fl.tank_id IS NULL
  AND (fl.ticket_image IS NULL OR fl.ticket_image = '')
  AND fl.ticket_estado IS NULL
  AND COALESCE(fl.notes,'') ILIKE 'ticket %'`;

(async () => {
  const client = await pool.connect();
  try {
    console.log(`\n${APPLY ? '⚡ MODO EJECUCIÓN (--apply)' : '🔎 MODO SIMULACIÓN (agregá --apply para ejecutar)'}\n`);

    const r = await client.query(`
      SELECT fl.logged_at, COALESCE(v.code, v.plate) AS unidad, fl.liters, fl.location, fl.notes
        FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
       WHERE ${CONDICION}
       ORDER BY fl.logged_at`);

    if (!r.rows.length) {
      console.log('No hay cargas para marcar: o ya están marcadas, o no tienen el número de ticket en las notas.\n');
      return;
    }

    console.log(`${r.rows.length} carga(s) tipeadas desde el ticket físico:\n`);
    for (const c of r.rows) {
      const m = c.notes.match(/^ticket\s+(\S+)/i);
      const ticket = m ? m[1] : '?';
      console.log(`   ${String(c.logged_at.toISOString().slice(0, 10))}  ${String(c.unidad).padEnd(9)} ` +
        `${String(Number(c.liters).toFixed(2)).padStart(8)} L  ticket ${String(ticket).padEnd(10)} ${c.location || ''}`);
    }

    if (APPLY) {
      const u = await client.query(`UPDATE fuel_logs fl SET ticket_estado='papel' WHERE ${CONDICION}`);
      console.log(`\n✅ ${u.rowCount} carga(s) marcadas como respaldadas en papel.`);
      console.log('   Dejan de aparecer en "Cargas en estación sin ningún respaldo".\n');
    } else {
      console.log('\n🔎 SIMULACIÓN: no se guardó nada. Si está OK, corré con --apply.\n');
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
