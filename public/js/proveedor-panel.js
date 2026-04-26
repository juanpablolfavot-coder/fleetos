// ═══════════════════════════════════════════════════════════
//  FleetOS — Panel rol Proveedores (tema claro, integrado)
// ═══════════════════════════════════════════════════════════

window.renderProveedorPanelInline = async function() {
  const page = document.getElementById('page-proveedor_panel');
  if (!page) return;
  page.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center;color:var(--text3)">Cargando OCs...</div>';

  try {
    const res = await apiFetch('/api/purchase-orders/mis-ocs');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      page.innerHTML = `<div class="empty-state" style="padding:40px;text-align:center;color:var(--danger)">${err.error || 'Error al cargar'}</div>`;
      return;
    }
    const ocs = await res.json();
    const fmt = (n) => parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const badgeClass = (status) => {
      switch (status) {
        case 'total':   return 'badge-success';
        case 'parcial': return 'badge-warn';
        default:        return 'badge-gray';
      }
    };

    if (ocs.length === 0) {
      page.innerHTML = '<div class="card"><div style="padding:60px;text-align:center;color:var(--text3)">No hay OCs aprobadas a tu nombre todavía</div></div>';
      return;
    }

    const renderRows = (filtro = '') => {
      const f = (filtro || '').toLowerCase().trim();
      const filtered = !f ? ocs : ocs.filter(o =>
        (o.code || '').toLowerCase().includes(f) ||
        (o.supplier_name || o.proveedor || '').toLowerCase().includes(f)
      );
      if (!filtered.length) {
        return '<tr><td colspan="7" style="padding:30px;text-align:center;color:var(--text3)">Sin resultados</td></tr>';
      }
      return filtered.map(o => {
        const facturado  = parseFloat(o.total_facturado);
        const totalEst   = parseFloat(o.total_estimado);
        const facColor   = facturado >= totalEst && totalEst > 0 ? 'var(--ok)' : 'var(--warn)';
        return `
        <tr>
          <td class="td-main td-mono">${o.code}</td>
          <td>${o.supplier_name || o.proveedor || '—'}</td>
          <td>${new Date(o.created_at).toLocaleDateString('es-AR')}</td>
          <td style="text-align:right">$${fmt(o.total_estimado)}</td>
          <td style="text-align:right;color:${facColor};font-weight:600">$${fmt(o.total_facturado)}</td>
          <td style="text-align:center"><span class="badge ${badgeClass(o.delivery_status)}">${o.delivery_status || 'pendiente'}</span></td>
          <td style="text-align:center"><span class="badge ${badgeClass(o.payment_status)}">${o.payment_status || 'pendiente'}</span></td>
          <td style="text-align:center;white-space:nowrap">
            <button class="btn btn-secondary btn-sm" onclick="openPODetail('${o.id}')">👁 Ver OC</button>
            <button class="btn btn-primary btn-sm" onclick="abrirModalFacturas('${o.id}')" style="margin-left:4px">📄 Cargar factura</button>
          </td>
        </tr>
      `;}).join('');
    };

    page.innerHTML = `
      <div class="card" style="padding:14px;margin-bottom:12px">
        <input id="proveedor-search" class="form-input" placeholder="🔍 Buscar por código de OC o proveedor..." oninput="document.getElementById('proveedor-tbody').innerHTML = window._renderRowsProveedor(this.value)">
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>OC</th>
                <th>Proveedor</th>
                <th>Fecha</th>
                <th style="text-align:right">Total OC</th>
                <th style="text-align:right">Facturado</th>
                <th style="text-align:center">Entrega</th>
                <th style="text-align:center">Pago</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="proveedor-tbody">
              ${renderRows()}
            </tbody>
          </table>
        </div>
      </div>
    `;
    window._renderRowsProveedor = renderRows;
  } catch (err) {
    console.error(err);
    page.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center;color:var(--danger)">Error de conexión</div>';
  }
};
