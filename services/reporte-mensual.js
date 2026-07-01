// ════════════════════════════════════════════════════════════════════
//  Reporte gerencial MENSUAL automático (server-side, pdfkit + mailer).
//
//  El día 1 de cada mes (o el primer arranque posterior, si el server estaba
//  dormido) genera un PDF con el resumen del MES ANTERIOR — costos, km,
//  combustible, compras, deuda — y lo manda por email al dueño.
//
//  Cero configuración: usa el SMTP ya configurado para los backups y manda a
//  REPORTE_EMAIL_TO o, si no está, a BACKUP_EMAIL_TO. El "ya lo mandé" se
//  guarda en app_config (clave reporte_mensual_last), así no se duplica aunque
//  el server se reinicie mil veces.
// ════════════════════════════════════════════════════════════════════
const PDFDocument = require('pdfkit');
const { query } = require('../db/pool');
const { mailEnabled, sendMail } = require('./mailer');

const ORANGE = '#ea580c';
const DARK   = '#1f2937';
const GREY   = '#6b7280';
const OK     = '#16a34a';
const DANGER = '#dc2626';

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function money(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-AR'); }
function num(n)   { return (Number(n) || 0).toLocaleString('es-AR'); }

// Mes actual y anterior en hora ARGENTINA (el server puede correr en UTC).
function mesesAR(now = new Date()) {
  const ar = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  const actual = `${ar.getFullYear()}-${String(ar.getMonth() + 1).padStart(2, '0')}`;
  const prev = new Date(ar.getFullYear(), ar.getMonth() - 1, 1);
  const anterior = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  return { actual, anterior };
}
function labelMes(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MESES[m - 1]} ${y}`;
}
function rangoMes(ym) {
  const [y, m] = ym.split('-').map(Number);
  const desde = `${ym}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  return { desde, hasta: `${ym}-${String(lastDay).padStart(2, '0')} 23:59:59.999999` };
}

// ── Datos del mes (mismas reglas que el comparativo del Auditor) ──────
async function datosDelMes(ym) {
  const { desde, hasta } = rangoMes(ym);
  const [fuel, km, ots, compras, deuda, topUnidades, criticos] = await Promise.all([
    query(`SELECT
             COALESCE(SUM(liters*price_per_l) FILTER (WHERE COALESCE(LOWER(fuel_type),'') <> 'urea'),0) AS costo_fuel,
             COALESCE(SUM(liters)             FILTER (WHERE COALESCE(LOWER(fuel_type),'') <> 'urea'),0) AS litros,
             COUNT(*)                         FILTER (WHERE COALESCE(LOWER(fuel_type),'') <> 'urea')    AS cargas,
             COALESCE(SUM(liters*price_per_l) FILTER (WHERE LOWER(fuel_type) = 'urea'),0)               AS costo_urea,
             COALESCE(SUM(liters) FILTER (WHERE COALESCE(LOWER(fuel_type),'') <> 'urea' AND tank_id IS NOT NULL),0) AS litros_cisterna,
             COALESCE(SUM(liters) FILTER (WHERE COALESCE(LOWER(fuel_type),'') <> 'urea' AND tank_id IS NULL),0)     AS litros_estacion
           FROM fuel_logs WHERE logged_at BETWEEN $1 AND $2`, [desde, hasta]),
    query(`SELECT COALESCE(SUM(km_veh),0) AS km_total FROM (
             SELECT fl.vehicle_id, MAX(fl.odometer_km) - MIN(fl.odometer_km) AS km_veh
             FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
             WHERE fl.logged_at BETWEEN $1 AND $2
               AND fl.odometer_km IS NOT NULL AND fl.odometer_km > 0
               AND COALESCE(LOWER(fl.fuel_type),'') <> 'urea'
               AND COALESCE(LOWER(v.type),'') NOT LIKE '%autoelev%'
             GROUP BY fl.vehicle_id HAVING COUNT(*) >= 2
           ) t`, [desde, hasta]),
    query(`SELECT COALESCE(SUM(labor_cost+parts_cost),0) AS costo, COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status = 'Cerrada') AS cerradas
           FROM work_orders WHERE opened_at BETWEEN $1 AND $2`, [desde, hasta]),
    query(`SELECT COUNT(*) AS ocs, COALESCE(SUM(total_estimado),0) AS total_oc
           FROM purchase_orders WHERE created_at BETWEEN $1 AND $2 AND status <> 'rechazada'`, [desde, hasta]),
    // Deuda con proveedores HOY (facturas no pagadas, con IVA), foto al momento del reporte.
    query(`SELECT COALESCE(SUM(ROUND(f.invoice_monto * (1 + COALESCE(f.iva_pct,0)/100.0), 2) - COALESCE(f.monto_pagado,0)),0) AS deuda
           FROM purchase_order_invoices f
           WHERE COALESCE(f.pagada, FALSE) = FALSE`),
    query(`SELECT v.code, COALESCE(SUM(fl.liters*fl.price_per_l),0) AS costo, COALESCE(SUM(fl.liters),0) AS litros
           FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
           WHERE fl.logged_at BETWEEN $1 AND $2 AND COALESCE(LOWER(fl.fuel_type),'') <> 'urea'
           GROUP BY v.code ORDER BY costo DESC LIMIT 5`, [desde, hasta]),
    query(`SELECT COUNT(*) AS n FROM (
             SELECT c.id FROM stock_catalog c
             LEFT JOIN stock_balances b ON b.catalog_id = c.id
             WHERE c.active = TRUE GROUP BY c.id, c.qty_min
             HAVING COALESCE(SUM(b.qty_current),0) <= c.qty_min
           ) t`),
  ]);
  const f = fuel.rows[0];
  const costoFuel = parseFloat(f.costo_fuel), costoUrea = parseFloat(f.costo_urea);
  const costoMant = parseFloat(ots.rows[0].costo);
  const litros = parseFloat(f.litros), kmTotal = parseFloat(km.rows[0].km_total);
  return {
    ym, label: labelMes(ym),
    costoFuel, costoUrea, costoMant,
    total: costoFuel + costoUrea + costoMant,
    litros, cargas: parseInt(f.cargas, 10),
    litrosCisterna: parseFloat(f.litros_cisterna), litrosEstacion: parseFloat(f.litros_estacion),
    kmTotal, rendimiento: (kmTotal > 0 && litros > 0) ? kmTotal / litros : 0,
    otsTotal: parseInt(ots.rows[0].total, 10), otsCerradas: parseInt(ots.rows[0].cerradas, 10),
    ocs: parseInt(compras.rows[0].ocs, 10), totalOC: parseFloat(compras.rows[0].total_oc),
    deudaProveedores: parseFloat(deuda.rows[0].deuda),
    topUnidades: topUnidades.rows,
    stockCriticos: parseInt(criticos.rows[0].n, 10),
  };
}

// ── PDF ───────────────────────────────────────────────────────────────
function buildReporteMensualPdf(d, dPrev) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 46 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 92;

    // Encabezado
    doc.rect(0, 0, doc.page.width, 86).fill(ORANGE);
    doc.fill('white').font('Helvetica-Bold').fontSize(20).text('Expreso Biletta — FleetOS', 46, 24);
    doc.font('Helvetica').fontSize(12).text(`Reporte gerencial · ${d.label}`, 46, 52);
    doc.y = 108;

    // KPIs principales
    const varPct = (dPrev && dPrev.total > 0) ? ((d.total - dPrev.total) / dPrev.total * 100) : null;
    const kpis = [
      ['Costo total del mes', money(d.total), varPct == null ? 'combustible + urea + mantenimiento' : `${varPct >= 0 ? '+' : ''}${varPct.toFixed(1)}% vs ${dPrev.label}`],
      ['Combustible', money(d.costoFuel), `${num(Math.round(d.litros))} L en ${d.cargas} cargas`],
      ['Mantenimiento', money(d.costoMant), `${d.otsTotal} OTs (${d.otsCerradas} cerradas)`],
      ['Km recorridos', num(Math.round(d.kmTotal)) + ' km', d.rendimiento > 0 ? d.rendimiento.toFixed(1) + ' km/L promedio' : 'sin datos de rendimiento'],
    ];
    const bw = (W - 24) / 2;
    kpis.forEach(([t, v, sub], i) => {
      const x = 46 + (i % 2) * (bw + 24);
      const y = doc.y + Math.floor(i / 2) * 74 - (i % 2 === 1 ? 0 : 0);
      const yy = 108 + Math.floor(i / 2) * 78;
      doc.roundedRect(x, yy, bw, 66, 6).lineWidth(0.8).stroke('#e5e7eb');
      doc.fill(GREY).font('Helvetica').fontSize(8.5).text(t.toUpperCase(), x + 12, yy + 10);
      doc.fill(DARK).font('Helvetica-Bold').fontSize(17).text(v, x + 12, yy + 24);
      doc.fill(GREY).font('Helvetica').fontSize(8.5).text(sub, x + 12, yy + 46, { width: bw - 24 });
    });
    doc.y = 108 + 2 * 78 + 6;

    const section = (titulo) => {
      doc.moveDown(0.6);
      doc.fill(ORANGE).font('Helvetica-Bold').fontSize(11).text(titulo, 46);
      doc.moveTo(46, doc.y + 2).lineTo(46 + W, doc.y + 2).lineWidth(0.8).stroke('#f3d5c3');
      doc.moveDown(0.4);
    };
    const linea = (label, valor, color = DARK) => {
      const y = doc.y;
      doc.fill(GREY).font('Helvetica').fontSize(9.5).text(label, 46, y);
      doc.fill(color).font('Helvetica-Bold').fontSize(9.5).text(valor, 46, y, { width: W, align: 'right' });
      doc.moveDown(0.35);
    };

    section('Combustible');
    linea('Gasoil de cisterna propia', num(Math.round(d.litrosCisterna)) + ' L');
    linea('Gasoil en estaciones (con ticket)', num(Math.round(d.litrosEstacion)) + ' L');
    linea('Urea / AdBlue', money(d.costoUrea));

    section('Compras y deuda');
    linea('Órdenes de compra del mes', `${d.ocs} OCs · ${money(d.totalOC)}`);
    linea('Deuda con proveedores (facturas impagas, hoy)', money(d.deudaProveedores), d.deudaProveedores > 0 ? DANGER : OK);

    section('Top 5 unidades por gasto de combustible');
    if (!d.topUnidades.length) {
      doc.fill(GREY).font('Helvetica').fontSize(9.5).text('Sin cargas en el mes.', 46);
      doc.moveDown(0.35);
    } else {
      d.topUnidades.forEach((u, i) => linea(`${i + 1}. ${u.code}`, `${money(u.costo)} · ${num(Math.round(u.litros))} L`));
    }

    section('Alertas');
    linea('Artículos de stock en estado crítico (hoy)', String(d.stockCriticos), d.stockCriticos > 0 ? DANGER : OK);

    doc.moveDown(1);
    doc.fill(GREY).font('Helvetica').fontSize(8)
      .text(`Generado automáticamente por FleetOS el ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}. Los datos del mes salen de las cargas de combustible, órdenes de trabajo y compras registradas en el sistema.`, 46, doc.y, { width: W });

    doc.end();
  });
}

// ── Envío + control de duplicados ─────────────────────────────────────
async function _yaEnviado(ym) {
  await query(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value JSONB NOT NULL)`).catch(() => {});
  const r = await query(`SELECT value FROM app_config WHERE key = 'reporte_mensual_last'`);
  return r.rows[0] && String(r.rows[0].value).replace(/"/g, '') === ym;
}
async function _marcarEnviado(ym) {
  await query(`INSERT INTO app_config(key,value) VALUES('reporte_mensual_last',$1)
               ON CONFLICT(key) DO UPDATE SET value=$1`, [JSON.stringify(ym)]);
}

async function generarYEnviarReporteMensual({ force = false } = {}) {
  const { anterior } = mesesAR();
  const to = process.env.REPORTE_EMAIL_TO || process.env.BACKUP_EMAIL_TO;
  if (!mailEnabled() || !to) return { skipped: 'mail no configurado (SMTP_USER/SMTP_PASS + BACKUP_EMAIL_TO o REPORTE_EMAIL_TO)' };
  if (!force && await _yaEnviado(anterior)) return { skipped: 'ya enviado ' + anterior };

  const d = await datosDelMes(anterior);
  let dPrev = null;
  try {
    const [y, m] = anterior.split('-').map(Number);
    const pm = new Date(y, m - 2, 1);
    dPrev = await datosDelMes(`${pm.getFullYear()}-${String(pm.getMonth() + 1).padStart(2, '0')}`);
    if (!(dPrev.total > 0)) dPrev = null; // sin datos del mes previo: no comparar
  } catch (_) { dPrev = null; }

  const pdf = await buildReporteMensualPdf(d, dPrev);
  await sendMail({
    to,
    subject: `📊 FleetOS — Reporte mensual ${d.label}`,
    text: [
      `Reporte gerencial de ${d.label} (adjunto en PDF).`,
      ``,
      `Costo total: ${money(d.total)}`,
      `Combustible: ${money(d.costoFuel)} (${num(Math.round(d.litros))} L, ${d.cargas} cargas)`,
      `Mantenimiento: ${money(d.costoMant)} (${d.otsTotal} OTs)`,
      `Km recorridos: ${num(Math.round(d.kmTotal))} km · ${d.rendimiento > 0 ? d.rendimiento.toFixed(1) + ' km/L' : 'sin rendimiento'}`,
      `Deuda con proveedores hoy: ${money(d.deudaProveedores)}`,
    ].join('\n'),
    attachments: [{ filename: `Reporte-FleetOS-${d.ym}.pdf`, content: pdf }],
  });
  await _marcarEnviado(anterior);
  console.log(`[reporte-mensual] enviado ${d.label} a ${to}`);
  return { sent: anterior };
}

// Chequeo perezoso: al arrancar (con un pequeño retraso para no competir con el
// boot) y después cada 6 horas. Si el reporte del mes anterior no salió todavía
// —arranque de mes o server dormido el día 1— se genera y envía una sola vez.
function programarReporteMensual() {
  const tick = () => generarYEnviarReporteMensual()
    .then((r) => { if (r.sent) console.log('[reporte-mensual] OK', r.sent); })
    .catch((e) => console.error('[reporte-mensual]', e.message));
  setTimeout(tick, 45 * 1000);
  setInterval(tick, 6 * 60 * 60 * 1000);
}

module.exports = { generarYEnviarReporteMensual, programarReporteMensual, buildReporteMensualPdf, datosDelMes };
