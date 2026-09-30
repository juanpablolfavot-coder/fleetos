// ═══════════════════════════════════════════════════════════════════════════
//  FleetOS — Tiempos de respuesta por área
//
//  Mide cuánto tarda cada área desde que "se abre algo" hasta que se termina,
//  usando los timestamps que el sistema ya guarda en cada transición:
//
//   Órdenes de compra: created_at → cotizado_at (Compras) → aprobado_compras_at
//                      (Aprobación) → pagado_at (Tesorería) → recibido_at
//                      (Proveedor / Recepción) → closed_at (Compras).
//   Órdenes de trabajo: opened_at → started_at (Taller: asignación/inicio) →
//                      closed_at (Taller: ejecución). Si la OT generó OC, la
//                      cadena completa pasa por Compras/Tesorería/Recepción.
//   Tickets de combustible: logged_at → ticket_verificado_at (Verificación).
//   Despachos internos: created_at → received_at (Sucursal).
//
//  Los plazos objetivo (en días) se configuran en app_config.sla_plazos y
//  sirven para el semáforo y el % cumplido.
// ═══════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

// Plazos objetivo por defecto, en días. Se pisan con app_config.sla_plazos.
const SLA_PLAZOS_DEFAULT = {
  oc_cotizar: 2,      // pedido → cotizada           (Compras)
  oc_aprobar: 1,      // cotizada → aprobada         (Gerencia / Compras)
  oc_pagar: 7,        // aprobada → pagada           (Tesorería)
  oc_recibir: 7,      // aprobada → recibida         (Proveedor / Recepción)
  oc_total: 15,       // pedido → recibida
  ot_iniciar: 1,      // abierta → en proceso        (Taller)
  ot_cerrar: 5,       // en proceso → cerrada        (Taller)
  ot_total: 7,        // abierta → cerrada
  fuel_verificar: 2,  // carga → ticket verificado   (Verificación)
  despacho_recibir: 2 // despachado → recibido       (Sucursal)
};

const DAY_MS = 86400000;
const dias = (a, b) => (a && b) ? (new Date(b) - new Date(a)) / DAY_MS : null;
const round1 = n => n === null || n === undefined ? null : Math.round(n * 10) / 10;

function stats(valores, plazo) {
  const v = valores.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, prom: null, mediana: null, max: null, cumple_pct: null, plazo };
  const prom = v.reduce((a, b) => a + b, 0) / v.length;
  const mediana = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  const cumple = plazo > 0 ? v.filter(x => x <= plazo).length : null;
  return {
    n: v.length, prom: round1(prom), mediana: round1(mediana), max: round1(v[v.length - 1]),
    cumple_pct: cumple === null ? null : Math.round(cumple / v.length * 100), plazo
  };
}

// Agrupa por una clave y devuelve stats de cada grupo (ordenado por cantidad).
function porGrupo(items, keyFn, valFn, plazo) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it) || '—';
    const v = valFn(it);
    if (!Number.isFinite(v)) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(v);
  }
  return [...m.entries()].map(([k, vals]) => ({ grupo: k, ...stats(vals, plazo) })).sort((a, b) => b.n - a.n);
}

// Serie mensual (YYYY-MM en hora Argentina) del promedio de una duración.
function mensual(items, dateFn, valFn) {
  const m = new Map();
  for (const it of items) {
    const v = valFn(it); const d = dateFn(it);
    if (!Number.isFinite(v) || !d) continue;
    const k = new Date(d).toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 7);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(v);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mes, vals]) => ({ mes, n: vals.length, prom: round1(vals.reduce((a, b) => a + b, 0) / vals.length) }));
}

async function cargarPlazos() {
  try {
    const r = await query(`SELECT value FROM app_config WHERE key='sla_plazos'`);
    const v = r.rows[0]?.value;
    return { ...SLA_PLAZOS_DEFAULT, ...(v && typeof v === 'object' ? v : {}) };
  } catch (_) { return { ...SLA_PLAZOS_DEFAULT }; }
}

// GET /api/tiempos?from=YYYY-MM-DD&to=YYYY-MM-DD
// Rango por fecha de apertura (created_at / opened_at / logged_at). Por defecto
// los últimos 90 días. Lo pendiente ("abiertas") se lista siempre, sin rango.
router.get('/', authenticate, requireRole('dueno', 'gerencia', 'contador', 'auditor'), async (req, res) => {
  try {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const to   = dateRe.test(req.query.to || '') ? req.query.to : new Date().toISOString().slice(0, 10);
    const from = dateRe.test(req.query.from || '') ? req.query.from : new Date(Date.now() - 90 * DAY_MS).toISOString().slice(0, 10);
    const P = await cargarPlazos();
    const now = new Date();
    const rango = (col) => `(${col} AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN $1::date AND $2::date`;

    // ── Órdenes de compra ────────────────────────────────────────────────
    const ocRows = (await query(`
      SELECT po.id, po.code, po.status, po.area, po.sucursal, po.tipo, po.proveedor, po.total_estimado,
             po.created_at, po.cotizado_at, po.aprobado_compras_at, po.pagado_at, po.recibido_at, po.closed_at,
             po.rechazado_at, po.ot_id, wo.code AS ot_code, u.name AS solicitante
        FROM purchase_orders po
        LEFT JOIN work_orders wo ON wo.id = po.ot_id
        LEFT JOIN users u ON u.id = po.requested_by
       WHERE ${rango('po.created_at')} OR po.status NOT IN ('recibida','cerrada','rechazada','dividida')
       ORDER BY po.created_at DESC`, [from, to])).rows;

    const enRango = (d) => { const k = new Date(d).toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }); return k >= from && k <= to; };
    const ocPeriodo = ocRows.filter(o => enRango(o.created_at) && o.status !== 'rechazada' && o.status !== 'dividida');
    const ocDur = o => ({
      cotizar: dias(o.created_at, o.cotizado_at),
      aprobar: dias(o.cotizado_at || o.created_at, o.aprobado_compras_at),
      pagar:   dias(o.aprobado_compras_at, o.pagado_at),
      recibir: dias(o.aprobado_compras_at, o.recibido_at),
      total:   dias(o.created_at, o.recibido_at || o.closed_at),
    });
    const ocEtapas = [
      { key: 'cotizar', label: 'Pedido → Cotizada',    area: 'Compras',               plazo: P.oc_cotizar },
      { key: 'aprobar', label: 'Cotizada → Aprobada',  area: 'Gerencia / Compras',    plazo: P.oc_aprobar },
      { key: 'pagar',   label: 'Aprobada → Pagada',    area: 'Tesorería',             plazo: P.oc_pagar },
      { key: 'recibir', label: 'Aprobada → Recibida',  area: 'Proveedor / Recepción', plazo: P.oc_recibir },
      { key: 'total',   label: 'Pedido → Recibida (total)', area: 'Todas',           plazo: P.oc_total },
    ].map(e => ({ ...e, ...stats(ocPeriodo.map(o => ocDur(o)[e.key]), e.plazo) }));

    // Etapa actual de una OC abierta y desde cuándo espera ahí.
    const ocEtapaActual = (o) => {
      switch (o.status) {
        case 'pendiente_cotizacion': return { etapa: 'Esperando cotización', area: 'Compras', desde: o.created_at, plazo: P.oc_cotizar };
        case 'en_cotizacion':        return { etapa: 'Esperando aprobación', area: 'Gerencia / Compras', desde: o.cotizado_at || o.created_at, plazo: P.oc_aprobar };
        case 'aprobada_compras':
        case 'enviada_proveedor':    return { etapa: 'Esperando entrega / pago', area: 'Proveedor / Tesorería', desde: o.aprobado_compras_at || o.created_at, plazo: Math.min(P.oc_pagar, P.oc_recibir) };
        case 'pagada':               return { etapa: 'Pagada, esperando entrega', area: 'Proveedor / Recepción', desde: o.pagado_at || o.aprobado_compras_at || o.created_at, plazo: P.oc_recibir };
        default:                     return { etapa: o.status, area: '—', desde: o.created_at, plazo: P.oc_total };
      }
    };
    const ocAbiertas = ocRows
      .filter(o => !['recibida', 'cerrada', 'rechazada', 'dividida'].includes(o.status))
      .map(o => { const e = ocEtapaActual(o); const enEtapa = dias(e.desde, now); const total = dias(o.created_at, now);
        return { id: o.id, code: o.code, status: o.status, etapa: e.etapa, area: e.area, area_solicitante: o.area, sucursal: o.sucursal,
          proveedor: o.proveedor, ot_code: o.ot_code, solicitante: o.solicitante, created_at: o.created_at,
          dias_en_etapa: round1(enEtapa), dias_total: round1(total), plazo: e.plazo, vencida: e.plazo > 0 && enEtapa > e.plazo }; })
      .sort((a, b) => b.dias_en_etapa - a.dias_en_etapa);

    // ── Órdenes de trabajo ───────────────────────────────────────────────
    const otRows = (await query(`
      SELECT wo.id, wo.code, wo.status, wo.type, wo.priority, wo.title, wo.opened_at, wo.started_at, wo.closed_at,
             v.code AS vehicle_code, v.base AS sucursal, m.name AS mecanico,
             po.code AS po_code, po.status AS po_status, po.created_at AS po_created_at, po.cotizado_at AS po_cotizado_at,
             po.aprobado_compras_at AS po_aprobado_at, po.pagado_at AS po_pagado_at, po.recibido_at AS po_recibido_at
        FROM work_orders wo
        LEFT JOIN vehicles v ON v.id = wo.vehicle_id
        LEFT JOIN users m ON m.id = wo.mechanic_id
        LEFT JOIN LATERAL (
          SELECT p.* FROM purchase_orders p WHERE p.ot_id = wo.id AND p.status <> 'rechazada'
          ORDER BY p.created_at LIMIT 1
        ) po ON TRUE
       WHERE ${rango('wo.opened_at')} OR wo.status <> 'Cerrada'
       ORDER BY wo.opened_at DESC`, [from, to])).rows;

    const otPeriodo = otRows.filter(o => enRango(o.opened_at));
    const otDur = o => ({
      iniciar: dias(o.opened_at, o.started_at),
      cerrar:  dias(o.started_at || o.opened_at, o.closed_at),
      repuestos: o.po_created_at ? dias(o.po_created_at, o.po_recibido_at) : null,
      total:   dias(o.opened_at, o.closed_at),
    });
    const otEtapas = [
      { key: 'iniciar',   label: 'Abierta → En proceso',      area: 'Taller (asignación)', plazo: P.ot_iniciar },
      { key: 'cerrar',    label: 'En proceso → Cerrada',      area: 'Taller (ejecución)',  plazo: P.ot_cerrar },
      { key: 'repuestos', label: 'OC pedida → OC recibida',   area: 'Compras / Proveedor', plazo: P.oc_total },
      { key: 'total',     label: 'Abierta → Cerrada (total)', area: 'Todas',               plazo: P.ot_total },
    ].map(e => ({ ...e, ...stats(otPeriodo.map(o => otDur(o)[e.key]), e.plazo) }));

    const otCerradas = otPeriodo.filter(o => o.closed_at);
    const otPorMecanico = porGrupo(otCerradas, o => o.mecanico, o => otDur(o).total, P.ot_total);
    const otPorTipo     = porGrupo(otCerradas, o => o.type, o => otDur(o).total, P.ot_total);
    const otPorPrioridad= porGrupo(otCerradas, o => o.priority, o => otDur(o).total, P.ot_total);

    const otEtapaActual = (o) => {
      if (o.po_code && !o.po_recibido_at && !['recibida', 'cerrada'].includes(o.po_status || '')) {
        return { etapa: `Esperando repuesto (${o.po_code})`, area: 'Compras / Proveedor', desde: o.po_created_at, plazo: P.oc_total };
      }
      if (!o.started_at && (o.status === 'Pendiente' || o.status === 'Asignada')) return { etapa: 'Sin iniciar', area: 'Taller', desde: o.opened_at, plazo: P.ot_iniciar };
      return { etapa: o.status, area: 'Taller', desde: o.started_at || o.opened_at, plazo: P.ot_cerrar };
    };
    const otAbiertas = otRows.filter(o => o.status !== 'Cerrada')
      .map(o => { const e = otEtapaActual(o); const enEtapa = dias(e.desde, now); const total = dias(o.opened_at, now);
        return { id: o.id, code: o.code, status: o.status, etapa: e.etapa, area: e.area, vehicle_code: o.vehicle_code, sucursal: o.sucursal,
          mecanico: o.mecanico, priority: o.priority, title: o.title, opened_at: o.opened_at, po_code: o.po_code,
          dias_en_etapa: round1(enEtapa), dias_total: round1(total), plazo: e.plazo, vencida: e.plazo > 0 && enEtapa > e.plazo }; })
      .sort((a, b) => b.dias_en_etapa - a.dias_en_etapa);

    // Cadena completa de las OT con OC (últimas 30 cerradas o en curso): cada hito con
    // los días acumulados desde que se abrió la OT.
    const otCadena = otRows.filter(o => o.po_code).slice(0, 30).map(o => ({
      code: o.code, vehicle_code: o.vehicle_code, status: o.status, po_code: o.po_code, opened_at: o.opened_at,
      hitos: [
        { label: 'OT abierta',    at: o.opened_at,       dias: 0 },
        { label: 'En proceso',    at: o.started_at,      dias: round1(dias(o.opened_at, o.started_at)) },
        { label: 'OC pedida',     at: o.po_created_at,   dias: round1(dias(o.opened_at, o.po_created_at)) },
        { label: 'OC cotizada',   at: o.po_cotizado_at,  dias: round1(dias(o.opened_at, o.po_cotizado_at)) },
        { label: 'OC aprobada',   at: o.po_aprobado_at,  dias: round1(dias(o.opened_at, o.po_aprobado_at)) },
        { label: 'OC pagada',     at: o.po_pagado_at,    dias: round1(dias(o.opened_at, o.po_pagado_at)) },
        { label: 'OC recibida',   at: o.po_recibido_at,  dias: round1(dias(o.opened_at, o.po_recibido_at)) },
        { label: 'OT cerrada',    at: o.closed_at,       dias: round1(dias(o.opened_at, o.closed_at)) },
      ],
      total: round1(dias(o.opened_at, o.closed_at || now)),
    }));

    // ── Tickets de combustible ───────────────────────────────────────────
    const fuelRows = (await query(`
      SELECT fl.id, fl.logged_at, fl.ticket_verificado_at, fl.ticket_estado, fl.liters, v.code AS vehicle_code, u.name AS driver
        FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id LEFT JOIN users u ON u.id = fl.driver_id
       WHERE fl.ticket_image IS NOT NULL
         AND (${rango('fl.logged_at')} OR fl.ticket_estado IS NULL OR fl.ticket_estado = 'pendiente')
       ORDER BY fl.logged_at DESC`, [from, to])).rows;
    const fuelPeriodo = fuelRows.filter(f => enRango(f.logged_at));
    const fuelEtapa = { key: 'verificar', label: 'Carga → Ticket verificado', area: 'Verificación de tickets', plazo: P.fuel_verificar,
      ...stats(fuelPeriodo.map(f => dias(f.logged_at, f.ticket_verificado_at)), P.fuel_verificar) };
    const fuelPendientes = fuelRows.filter(f => !f.ticket_verificado_at && (f.ticket_estado === null || f.ticket_estado === 'pendiente'))
      .map(f => ({ id: f.id, vehicle_code: f.vehicle_code, driver: f.driver, liters: f.liters, logged_at: f.logged_at,
        dias_en_etapa: round1(dias(f.logged_at, now)), plazo: P.fuel_verificar, vencida: dias(f.logged_at, now) > P.fuel_verificar }))
      .sort((a, b) => b.dias_en_etapa - a.dias_en_etapa);

    // ── Despachos internos ───────────────────────────────────────────────
    const despRows = (await query(`
      SELECT d.id, d.destination, d.liters, d.status, d.created_at, d.received_at
        FROM fuel_internal_dispatches d
       WHERE ${rango('d.created_at')} OR d.status <> 'recibido'
       ORDER BY d.created_at DESC`, [from, to])).rows;
    const despPeriodo = despRows.filter(d => enRango(d.created_at));
    const despEtapa = { key: 'recibir', label: 'Despachado → Recibido', area: 'Sucursal', plazo: P.despacho_recibir,
      ...stats(despPeriodo.map(d => dias(d.created_at, d.received_at)), P.despacho_recibir) };
    const despPendientes = despRows.filter(d => d.status !== 'recibido')
      .map(d => ({ id: d.id, destination: d.destination, liters: d.liters, created_at: d.created_at,
        dias_en_etapa: round1(dias(d.created_at, now)), plazo: P.despacho_recibir, vencida: dias(d.created_at, now) > P.despacho_recibir }))
      .sort((a, b) => b.dias_en_etapa - a.dias_en_etapa);

    res.json({
      from, to, plazos: P,
      oc: {
        etapas: ocEtapas,
        por_area_solicitante: porGrupo(ocPeriodo, o => o.area, o => ocDur(o).total, P.oc_total),
        por_sucursal: porGrupo(ocPeriodo, o => o.sucursal, o => ocDur(o).total, P.oc_total),
        mensual: mensual(ocPeriodo, o => o.created_at, o => ocDur(o).total),
        abiertas: ocAbiertas,
        vencidas: ocAbiertas.filter(o => o.vencida).length,
      },
      ot: {
        etapas: otEtapas,
        por_mecanico: otPorMecanico, por_tipo: otPorTipo, por_prioridad: otPorPrioridad,
        mensual: mensual(otPeriodo, o => o.opened_at, o => otDur(o).total),
        abiertas: otAbiertas,
        vencidas: otAbiertas.filter(o => o.vencida).length,
        cadena: otCadena,
      },
      combustible: { etapa: fuelEtapa, pendientes: fuelPendientes, vencidas: fuelPendientes.filter(f => f.vencida).length },
      despachos:   { etapa: despEtapa, pendientes: despPendientes, vencidas: despPendientes.filter(d => d.vencida).length },
    });
  } catch (err) {
    console.error('[tiempos GET]', err.message);
    res.status(500).json({ error: 'Error al calcular tiempos de respuesta' });
  }
});

module.exports = { router, SLA_PLAZOS_DEFAULT };
