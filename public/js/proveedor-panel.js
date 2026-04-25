// ═══════════════════════════════════════════════════════════
//  FleetOS — Panel rol Proveedores
//  Renderiza la lista de OCs del proveedor logueado
// ═══════════════════════════════════════════════════════════

window.renderProveedorPanelInline = async function() {
  const page = document.getElementById('page-proveedor_panel');
  if (!page) return;
  page.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8">Cargando OCs...</div>';

  try {
    const res = await apiFetch('/api/purchase-orders/mis-ocs');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      page.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444">${err.error || 'Error al cargar'}</div>`;
      return;
    }
    const ocs = await res.json();
    const fmt = (n) => parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const badgeColor = (status) => {
      switch (status) {
        case 'total':   return '#064e3b';
        case 'parcial': return '#7c2d12';
        default:        return '#1e293b';
      }
    };

    page.innerHTML = `
      <div style="padding:20px">
        ${ocs.length === 0 ? '<div style="text-align:center;color:#94a3b8;padding:60px;background:#1e293b;border-radius:8px">No hay OCs aprobadas a tu nombre todavía</div>' : `
        <div style="background:#1e293b;border-radius:8px;overflow:hidden">
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:#0f172a;color:#94a3b8;font-size:13px">
                <th style="padding:12px;text-align:left">OC</th>
                <th style="padding:12px;text-align:left">Fecha</th>
                <th style="padding:12px;text-align:right">Total OC</th>
                <th style="padding:12px;text-align:right">Facturado</th>
                <th style="padding:12px;text-align:center">Entrega</th>
                <th style="padding:12px;text-align:center">Pago</th>
                <th style="padding:12px;text-align:center"></th>
              </tr>
            </thead>
            <tbody>
              ${ocs.map(o => `
                <tr style="border-bottom:1px solid #334155;color:#e2e8f0">
                  <td style="padding:12px;font-weight:600">${o.code}</td>
                  <td style="padding:12px;font-size:13px">${new Date(o.created_at).toLocaleDateString('es-AR')}</td>
                  <td style="padding:12px;text-align:right">$${fmt(o.total_estimado)}</td>
                  <td style="padding:12px;text-align:right;color:${parseFloat(o.total_facturado)>=parseFloat(o.total_estimado)?'#10b981':'#f59e0b'}">$${fmt(o.total_facturado)}</td>
                  <td style="padding:12px;text-align:center"><span style="font-size:11px;background:${badgeColor(o.delivery_status)};padding:3px 8px;border-radius:4px;color:#fff">${o.delivery_status || 'pendiente'}</span></td>
                  <td style="padding:12px;text-align:center"><span style="font-size:11px;background:${badgeColor(o.payment_status)};padding:3px 8px;border-radius:4px;color:#fff">${o.payment_status || 'pendiente'}</span></td>
                  <td style="padding:12px;text-align:center">
                    <button onclick="abrirModalFacturas('${o.id}')" style="background:#3b82f6;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">📄 Cargar factura</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`}
      </div>
    `;
  } catch (err) {
    console.error(err);
    page.innerHTML = '<div style="padding:40px;text-align:center;color:#ef4444">Error de conexión</div>';
  }
};
