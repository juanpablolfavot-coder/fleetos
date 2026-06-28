// ════════════════════════════════════════════════════════════════════
//  RESUMEN DE CUENTA POR PROVEEDOR (ES module, Fase 3).
//
//  Modal con la cuenta corriente de un proveedor: totales (comprado /
//  facturado / pagado / saldo), las OCs que le hicimos, y el detalle de
//  movimientos (facturas y pagos) con saldo acumulado.
//  saldo = facturado − pagado:  >0 = le debemos · <0 = saldo a favor nuestro.
//  Entra desde la pantalla de Proveedores (botón "📒 Cuenta").
// ════════════════════════════════════════════════════════════════════

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const money = (v) => '$' + num(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (v) => (window.escapeHtml ? window.escapeHtml(String(v ?? '')) : String(v ?? ''));
const fechaAR = (d) => { try { return d ? new Date(d).toLocaleDateString('es-AR') : '—'; } catch (e) { return '—'; } };

const estadoOC = {
  borrador: 'Borrador', pendiente: 'Pendiente', aprobada: 'Aprobada', aprobada_compras: 'Aprobada',
  recibida: 'Recibida', cerrada: 'Cerrada', rechazada: 'Rechazada', anulada: 'Anulada',
};

function saldoInfo(saldo) {
  if (saldo > 0.01) return { label: 'Le debemos', color: 'var(--danger)' };
  if (saldo < -0.01) return { label: 'Saldo a favor', color: 'var(--ok)' };
  return { label: 'Al día', color: 'var(--text2)' };
}

function kpi(label, valor, color) {
  return `<div style="background:var(--bg2);padding:12px;border-radius:8px;border:1px solid var(--border2)">
    <div style="font-size:11px;color:var(--text3);text-transform:uppercase">${label}</div>
    <div style="font-size:18px;font-weight:700;${color ? `color:${color}` : ''}">${valor}</div>
  </div>`;
}

window.verCuentaProveedor = async function (id) {
  let data;
  try {
    const res = await window.apiFetch(`/api/suppliers/${id}/cuenta`);
    if (!res.ok) { const e = await res.json().catch(() => ({})); window.showToast?.('error', e.error || 'Error al cargar la cuenta'); return; }
    data = await res.json();
  } catch (e) { window.showToast?.('error', e.message); return; }

  window._cuentaActual = data; // para imprimir
  const { supplier, totals, ocs, movimientos } = data;
  const si = saldoInfo(num(totals.saldo));
  const saldoAbs = money(Math.abs(num(totals.saldo)));

  const ocsRows = (ocs || []).length ? ocs.map((o) => `
    <tr>
      <td class="td-mono"><a onclick="(window.openPODetail&&openPODetail('${o.id}'))" style="color:var(--accent);cursor:pointer;text-decoration:underline">${esc(o.code)}</a></td>
      <td>${fechaAR(o.created_at)}</td>
      <td style="text-align:right;font-family:monospace">${money(o.total_oc)}</td>
      <td style="text-align:right;font-family:monospace">${money(o.facturado)}</td>
      <td style="text-align:right;font-family:monospace">${money(o.pagado)}</td>
      <td>${estadoOC[o.status] || esc(o.status || '—')}</td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:18px">Sin órdenes de compra</td></tr>';

  const movRows = (movimientos || []).length ? movimientos.map((m) => {
    const esFactura = m.tipo === 'factura';
    return `<tr>
      <td>${fechaAR(m.fecha)}</td>
      <td><span class="badge ${esFactura ? 'badge-warn' : 'badge-ok'}">${esFactura ? 'Factura' : 'Pago'}</span></td>
      <td>${esc(m.oc_code || '—')}${m.ref ? ` · ${esc(m.ref)}` : ''}${m.metodo ? ` · ${esc(m.metodo)}` : ''}</td>
      <td style="text-align:right;font-family:monospace;color:${esFactura ? 'var(--danger)' : 'var(--ok)'}">${esFactura ? '+' : '−'}${money(m.monto)}</td>
      <td style="text-align:right;font-family:monospace">${money(m.saldo_acum)}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:18px">Sin movimientos</td></tr>';

  document.querySelector('.modal-cuenta-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-cuenta-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(15,23,42,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:980px;width:100%;max-height:90vh;overflow-y:auto;color:var(--text);border:1px solid var(--border2);box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="padding:20px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#fff;z-index:10">
        <div>
          <div style="font-size:18px;font-weight:700">📒 Cuenta corriente · ${esc(supplier.name || '—')}</div>
          ${supplier.cuit ? `<div style="font-size:13px;color:var(--text3);margin-top:4px">CUIT ${esc(supplier.cuit)}</div>` : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button onclick="imprimirCuentaProveedor()" class="btn btn-secondary btn-sm">🖨 Imprimir</button>
          <button onclick="this.closest('.modal-cuenta-overlay').remove()" style="background:transparent;border:none;color:var(--text3);font-size:28px;cursor:pointer;line-height:1">×</button>
        </div>
      </div>

      <div style="padding:20px">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:20px">
          ${kpi('Comprado (OCs)', money(totals.comprado))}
          ${kpi('Facturado', money(totals.facturado))}
          ${kpi('Pagado', money(totals.pagado), 'var(--ok)')}
          ${kpi(si.label, saldoAbs, si.color)}
        </div>

        <div style="font-weight:600;margin-bottom:8px">Órdenes de compra (${(ocs || []).length})</div>
        <div class="table-wrap" style="margin-bottom:24px;border:1px solid var(--border2);border-radius:8px">
          <table style="font-size:13px">
            <thead><tr>
              <th>OC</th><th>Fecha</th>
              <th style="text-align:right">Total c/IVA</th>
              <th style="text-align:right">Facturado</th>
              <th style="text-align:right">Pagado</th>
              <th>Estado</th>
            </tr></thead>
            <tbody>${ocsRows}</tbody>
          </table>
        </div>

        <div style="font-weight:600;margin-bottom:8px">Movimientos (${(movimientos || []).length}) <span style="font-size:11px;color:var(--text3);font-weight:400">· facturas (+) y pagos (−), con saldo acumulado</span></div>
        <div class="table-wrap" style="border:1px solid var(--border2);border-radius:8px">
          <table style="font-size:13px">
            <thead><tr>
              <th>Fecha</th><th>Tipo</th><th>Referencia</th>
              <th style="text-align:right">Importe</th>
              <th style="text-align:right">Saldo</th>
            </tr></thead>
            <tbody>${movRows}</tbody>
          </table>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:8px">Saldo = facturado − pagado. Positivo = le debemos al proveedor · negativo = saldo a favor nuestro.</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
};

// Imprime el resumen de cuenta (ventana + window.print), patrón de ticket.
window.imprimirCuentaProveedor = function () {
  const data = window._cuentaActual;
  if (!data) { window.showToast?.('error', 'Abrí primero la cuenta del proveedor'); return; }
  const { supplier, totals, ocs, movimientos } = data;
  const si = saldoInfo(num(totals.saldo));
  const e = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const ocsRows = (ocs || []).map((o) => `<tr>
    <td>${e(o.code)}</td><td>${fechaAR(o.created_at)}</td>
    <td class="r">${money(o.total_oc)}</td><td class="r">${money(o.facturado)}</td>
    <td class="r">${money(o.pagado)}</td><td>${e(estadoOC[o.status] || o.status || '—')}</td>
  </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:#6b7280;padding:14px">Sin órdenes de compra</td></tr>';

  const movRows = (movimientos || []).map((m) => {
    const esFac = m.tipo === 'factura';
    return `<tr>
      <td>${fechaAR(m.fecha)}</td><td>${esFac ? 'Factura' : 'Pago'}</td>
      <td>${e(m.oc_code || '—')}${m.ref ? ' · ' + e(m.ref) : ''}${m.metodo ? ' · ' + e(m.metodo) : ''}</td>
      <td class="r">${esFac ? '+' : '−'}${money(m.monto)}</td>
      <td class="r">${money(m.saldo_acum)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:#6b7280;padding:14px">Sin movimientos</td></tr>';

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>Resumen de cuenta — ${e(supplier.name || '')}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:0;padding:32px}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #ea580c;padding-bottom:12px;margin-bottom:18px}
      .brand{font-size:22px;font-weight:800;color:#ea580c}.brand small{display:block;font-size:11px;color:#6b7280;font-weight:400;margin-top:2px}
      .doc{text-align:right}.doc h1{font-size:16px;margin:0}.doc .s{color:#6b7280;font-size:11px;margin-top:2px}
      .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
      .kpi{border:1px solid #e5e7eb;border-radius:8px;padding:10px}.kpi .k{font-size:10px;color:#6b7280;text-transform:uppercase}.kpi .v{font-size:16px;font-weight:700;margin-top:3px}
      h2{font-size:13px;margin:18px 0 6px}
      table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px}
      th{background:#f3f4f6;text-align:left;padding:6px 8px}td{padding:6px 8px;border-bottom:1px solid #f0f0f0}
      td.r,th.r{text-align:right}
      .foot{margin-top:24px;color:#6b7280;font-size:10px;text-align:center;border-top:1px solid #e5e7eb;padding-top:8px}
      @media print{body{padding:12px}}
    </style></head><body>
    <div class="head">
      <div class="brand">Expreso Biletta<small>Sistema de gestión de flota — FleetOS</small></div>
      <div class="doc"><h1>RESUMEN DE CUENTA</h1>
        <div class="s">${e(supplier.name || '—')}${supplier.cuit ? ' · CUIT ' + e(supplier.cuit) : ''}</div>
        <div class="s">Emitido: ${fechaAR(new Date())}</div></div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="k">Comprado (OCs)</div><div class="v">${money(totals.comprado)}</div></div>
      <div class="kpi"><div class="k">Facturado</div><div class="v">${money(totals.facturado)}</div></div>
      <div class="kpi"><div class="k">Pagado</div><div class="v">${money(totals.pagado)}</div></div>
      <div class="kpi"><div class="k">${si.label}</div><div class="v">${money(Math.abs(num(totals.saldo)))}</div></div>
    </div>
    <h2>Órdenes de compra (${(ocs || []).length})</h2>
    <table><thead><tr><th>OC</th><th>Fecha</th><th class="r">Total c/IVA</th><th class="r">Facturado</th><th class="r">Pagado</th><th>Estado</th></tr></thead><tbody>${ocsRows}</tbody></table>
    <h2>Movimientos (${(movimientos || []).length})</h2>
    <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Referencia</th><th class="r">Importe</th><th class="r">Saldo</th></tr></thead><tbody>${movRows}</tbody></table>
    <div style="font-size:10px;color:#6b7280">Saldo = facturado − pagado. Positivo = le debemos · negativo = saldo a favor nuestro.</div>
    <div class="foot">Generado por FleetOS · Expreso Biletta S.R.L.</div>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { window.showToast?.('error', 'Habilitá las ventanas emergentes para imprimir'); return; }
  w.document.write(html);
  w.document.close();
};
