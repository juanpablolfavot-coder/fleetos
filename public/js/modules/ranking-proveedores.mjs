// ════════════════════════════════════════════════════════════════════
//  RANKING DE PROVEEDORES POR GASTO (ES module, Fase 3).
//
//  Modal con el ranking de proveedores ordenado de mayor a menor gasto.
//  Por cada proveedor: comprado (total OC c/IVA), facturado (c/IVA) y pagado.
//  Se ordena por facturado (el gasto comprometido). Entra desde la pantalla
//  de Proveedores (botón "🏆 Ranking de gasto").
// ════════════════════════════════════════════════════════════════════

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const money = (v) => '$' + num(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (v) => (window.escapeHtml ? window.escapeHtml(String(v ?? '')) : String(v ?? ''));
const fechaAR = (d) => { try { return d ? new Date(d).toLocaleDateString('es-AR') : '—'; } catch (e) { return '—'; } };

const medalla = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`);

window.verRankingProveedores = async function () {
  let data;
  try {
    const res = await window.apiFetch('/api/suppliers/ranking/gastos');
    if (!res.ok) { const e = await res.json().catch(() => ({})); window.showToast?.('error', e.error || 'Error al cargar el ranking'); return; }
    data = await res.json();
  } catch (e) { window.showToast?.('error', e.message); return; }

  window._rankingProvActual = data; // para imprimir
  const { ranking, totales } = data;
  const maxFact = (ranking || []).reduce((m, s) => Math.max(m, num(s.facturado)), 0) || 1;

  const rows = (ranking || []).length ? ranking.map((s, i) => {
    const pct = Math.round((num(s.facturado) / maxFact) * 100);
    return `<tr>
      <td style="text-align:center;font-weight:700;white-space:nowrap">${medalla(i)}</td>
      <td>
        <a onclick="(window.verCuentaProveedor&&verCuentaProveedor('${s.id}'))" style="color:var(--accent);cursor:pointer;text-decoration:underline;font-weight:600">${esc(s.name)}</a>
        ${s.cuit ? `<div style="font-size:11px;color:var(--text3)">CUIT ${esc(s.cuit)}</div>` : ''}
        <div style="height:5px;background:var(--bg);border-radius:3px;margin-top:5px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--accent)"></div></div>
      </td>
      <td style="text-align:center">${s.oc_count}</td>
      <td style="text-align:right;font-family:monospace">${money(s.comprado)}</td>
      <td style="text-align:right;font-family:monospace;font-weight:700">${money(s.facturado)}</td>
      <td style="text-align:right;font-family:monospace;color:var(--ok)">${money(s.pagado)}</td>
      <td style="text-align:right;font-family:monospace;color:${num(s.saldo) > 0.01 ? 'var(--danger)' : 'var(--text2)'}">${money(s.saldo)}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:24px">Sin gastos registrados todavía</td></tr>';

  document.querySelector('.modal-ranking-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-ranking-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(15,23,42,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:1040px;width:100%;max-height:90vh;overflow-y:auto;color:var(--text);border:1px solid var(--border2);box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="padding:20px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#fff;z-index:10">
        <div>
          <div style="font-size:18px;font-weight:700">🏆 Ranking de proveedores por gasto</div>
          <div style="font-size:13px;color:var(--text3);margin-top:4px">De mayor a menor · ordenado por facturado (c/IVA) · ${(ranking || []).length} proveedores con actividad</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button onclick="imprimirRankingProveedores()" class="btn btn-secondary btn-sm">🖨 Imprimir</button>
          <button onclick="this.closest('.modal-ranking-overlay').remove()" style="background:transparent;border:none;color:var(--text3);font-size:28px;cursor:pointer;line-height:1">×</button>
        </div>
      </div>

      <div style="padding:20px">
        <div class="table-wrap" style="border:1px solid var(--border2);border-radius:8px">
          <table style="font-size:13px">
            <thead><tr>
              <th style="text-align:center">#</th>
              <th>Proveedor</th>
              <th style="text-align:center">OCs</th>
              <th style="text-align:right">Comprado</th>
              <th style="text-align:right">Facturado</th>
              <th style="text-align:right">Pagado</th>
              <th style="text-align:right">Saldo</th>
            </tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr style="border-top:2px solid var(--border2);font-weight:700">
              <td></td><td>TOTAL</td><td></td>
              <td style="text-align:right;font-family:monospace">${money(totales.comprado)}</td>
              <td style="text-align:right;font-family:monospace">${money(totales.facturado)}</td>
              <td style="text-align:right;font-family:monospace;color:var(--ok)">${money(totales.pagado)}</td>
              <td style="text-align:right;font-family:monospace">${money(num(totales.facturado) - num(totales.pagado))}</td>
            </tr></tfoot>
          </table>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:8px">Comprado = total de OC c/IVA · Facturado = total facturado c/IVA · Saldo = facturado − pagado. Tocá un proveedor para ver su cuenta corriente.</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
};

// Imprime el ranking (ventana + window.print), mismo patrón que la cuenta.
window.imprimirRankingProveedores = function () {
  const data = window._rankingProvActual;
  if (!data) { window.showToast?.('error', 'Abrí primero el ranking de proveedores'); return; }
  const { ranking, totales } = data;
  const e = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const rows = (ranking || []).map((s, i) => `<tr>
    <td>${i + 1}</td><td>${e(s.name)}${s.cuit ? ' · CUIT ' + e(s.cuit) : ''}</td>
    <td class="c">${s.oc_count}</td>
    <td class="r">${money(s.comprado)}</td><td class="r">${money(s.facturado)}</td>
    <td class="r">${money(s.pagado)}</td><td class="r">${money(s.saldo)}</td>
  </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:14px">Sin gastos registrados</td></tr>';

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>Ranking de proveedores por gasto</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:0;padding:32px}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #ea580c;padding-bottom:12px;margin-bottom:18px}
      .brand{font-size:22px;font-weight:800;color:#ea580c}.brand small{display:block;font-size:11px;color:#6b7280;font-weight:400;margin-top:2px}
      .doc{text-align:right}.doc h1{font-size:16px;margin:0}.doc .s{color:#6b7280;font-size:11px;margin-top:2px}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th{background:#f3f4f6;text-align:left;padding:6px 8px}td{padding:6px 8px;border-bottom:1px solid #f0f0f0}
      td.r,th.r{text-align:right}td.c,th.c{text-align:center}
      tfoot td{font-weight:700;border-top:2px solid #d1d5db}
      .foot{margin-top:24px;color:#6b7280;font-size:10px;text-align:center;border-top:1px solid #e5e7eb;padding-top:8px}
      @media print{body{padding:12px}}
    </style></head><body>
    <div class="head">
      <div class="brand">Expreso Biletta<small>Sistema de gestión de flota — FleetOS</small></div>
      <div class="doc"><h1>RANKING DE PROVEEDORES POR GASTO</h1>
        <div class="s">De mayor a menor (facturado c/IVA)</div>
        <div class="s">Emitido: ${fechaAR(new Date())}</div></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Proveedor</th><th class="c">OCs</th><th class="r">Comprado</th><th class="r">Facturado</th><th class="r">Pagado</th><th class="r">Saldo</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td></td><td>TOTAL</td><td></td><td class="r">${money(totales.comprado)}</td><td class="r">${money(totales.facturado)}</td><td class="r">${money(totales.pagado)}</td><td class="r">${money(num(totales.facturado) - num(totales.pagado))}</td></tr></tfoot>
    </table>
    <div style="font-size:10px;color:#6b7280;margin-top:8px">Comprado = total de OC c/IVA · Facturado = total facturado c/IVA · Saldo = facturado − pagado.</div>
    <div class="foot">Generado por FleetOS · Expreso Biletta S.R.L.</div>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { window.showToast?.('error', 'Habilitá las ventanas emergentes para imprimir'); return; }
  w.document.write(html);
  w.document.close();
};
