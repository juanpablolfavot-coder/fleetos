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
    <div style="background:var(--bg1);border-radius:12px;max-width:980px;width:100%;max-height:90vh;overflow-y:auto;color:var(--text);border:1px solid var(--border2);box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="padding:20px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg1);z-index:10">
        <div>
          <div style="font-size:18px;font-weight:700">📒 Cuenta corriente · ${esc(supplier.name || '—')}</div>
          ${supplier.cuit ? `<div style="font-size:13px;color:var(--text3);margin-top:4px">CUIT ${esc(supplier.cuit)}</div>` : ''}
        </div>
        <button onclick="this.closest('.modal-cuenta-overlay').remove()" style="background:transparent;border:none;color:var(--text3);font-size:28px;cursor:pointer;line-height:1">×</button>
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
