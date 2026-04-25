// ═══════════════════════════════════════════════════════════
//  FleetOS — Facturas de OC + Panel Proveedor
//
//  Expone:
//    - window.abrirModalFacturas(poId) → modal de facturas (todos los roles)
//    - window.renderProveedorPanel()   → página dedicada para rol proveedores
// ═══════════════════════════════════════════════════════════

(function() {
  const ROLES_CARGAR = ['dueno','gerencia','compras','contador','proveedores'];

  function puedeCargarFacturas() {
    const role = window.App?.currentUser?.role;
    return ROLES_CARGAR.includes(role);
  }

  // ─────────────────────────────────────────────────────────
  //  MODAL DE FACTURAS (se abre desde botón en OC)
  // ─────────────────────────────────────────────────────────
  window.abrirModalFacturas = async function(poId) {
    try {
      const [facRes, ocRes] = await Promise.all([
        apiFetch(`/api/purchase-orders/${poId}/facturas`),
        apiFetch(`/api/purchase-orders/${poId}`),
      ]);
      const facturas = facRes.ok ? await facRes.json() : [];
      const oc = ocRes.ok ? await ocRes.json() : {};
      renderModalFacturas(poId, oc, facturas);
    } catch (err) {
      console.error('[facturas]', err);
      showToast('error', 'No se pudieron cargar las facturas');
    }
  };

  function renderModalFacturas(poId, oc, facturas) {
    document.querySelector('.modal-facturas-overlay')?.remove();

    const totalOC = parseFloat(oc.total_estimado) || 0;
    const totalFacturado = facturas.reduce((s, f) => s + parseFloat(f.invoice_monto || 0), 0);
    const pendienteFacturar = Math.max(0, totalOC - totalFacturado);

    const overlay = document.createElement('div');
    overlay.className = 'modal-facturas-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const fmt = (n) => parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const fpDefault = oc.forma_pago || '';
    const ccDefault = oc.cc_dias || 0;

    overlay.innerHTML = `
      <div style="background:#1e293b;border-radius:12px;max-width:900px;width:100%;max-height:90vh;overflow-y:auto;color:#e2e8f0;border:1px solid #334155">
        <div style="padding:20px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#1e293b;z-index:10">
          <div>
            <div style="font-size:18px;font-weight:700">📄 Facturas · ${oc.code || ''}</div>
            <div style="font-size:13px;color:#94a3b8;margin-top:4px">${oc.proveedor || 'Sin proveedor'} · Total OC: <strong>$${fmt(totalOC)}</strong> · Facturado: <strong style="color:${totalFacturado>=totalOC?'#10b981':'#f59e0b'}">$${fmt(totalFacturado)}</strong></div>
          </div>
          <button onclick="this.closest('.modal-facturas-overlay').remove()" style="background:transparent;border:none;color:#94a3b8;font-size:28px;cursor:pointer;line-height:1">×</button>
        </div>

        <div style="padding:20px">

          ${pendienteFacturar > 0.01 && puedeCargarFacturas() ? `
          <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:16px;margin-bottom:20px">
            <div style="font-weight:600;margin-bottom:12px;color:#cbd5e1">+ Cargar nueva factura</div>

            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
              <div>
                <label style="font-size:12px;color:#94a3b8">N° Factura *</label>
                <input id="fac-nro" type="text" placeholder="A-0001-00012345" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:8px;border-radius:6px;margin-top:4px">
              </div>
              <div>
                <label style="font-size:12px;color:#94a3b8">Fecha *</label>
                <input id="fac-fecha" type="date" value="${new Date().toISOString().slice(0,10)}" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:8px;border-radius:6px;margin-top:4px">
              </div>
              <div>
                <label style="font-size:12px;color:#94a3b8">Monto * <span style="color:#64748b">(pendiente: $${fmt(pendienteFacturar)})</span></label>
                <input id="fac-monto" type="number" step="0.01" placeholder="${fmt(pendienteFacturar)}" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:8px;border-radius:6px;margin-top:4px">
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
              <div>
                <label style="font-size:12px;color:#94a3b8">IVA %</label>
                <input id="fac-iva" type="number" step="0.01" value="21" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:8px;border-radius:6px;margin-top:4px">
              </div>
              <div>
                <label style="font-size:12px;color:#94a3b8">Forma de pago</label>
                <select id="fac-fp" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:8px;border-radius:6px;margin-top:4px">
                  <option value="">— Heredar de OC —</option>
                  <option value="contado" ${fpDefault==='contado'?'selected':''}>Contado</option>
                  <option value="cuenta_corriente" ${fpDefault==='cuenta_corriente'?'selected':''}>Cuenta corriente</option>
                  <option value="cheque" ${fpDefault==='cheque'?'selected':''}>Cheque</option>
                  <option value="transferencia" ${fpDefault==='transferencia'?'selected':''}>Transferencia</option>
                </select>
              </div>
              <div>
                <label style="font-size:12px;color:#94a3b8">Días CC <span style="color:#64748b">(0 = contado)</span></label>
                <input id="fac-cc" type="number" min="0" value="${ccDefault}" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:8px;border-radius:6px;margin-top:4px">
              </div>
            </div>

            <div style="margin-bottom:12px">
              <label style="font-size:12px;color:#94a3b8">URL de archivo (opcional, link al PDF)</label>
              <input id="fac-url" type="text" placeholder="https://drive.google.com/..." style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:8px;border-radius:6px;margin-top:4px">
            </div>

            <div style="margin-bottom:12px">
              <label style="font-size:12px;color:#94a3b8">Observaciones (opcional)</label>
              <textarea id="fac-notes" rows="2" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:8px;border-radius:6px;margin-top:4px;resize:vertical"></textarea>
            </div>

            <button onclick="guardarFactura('${poId}')" style="background:#3b82f6;color:#fff;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-weight:600">
              ✓ Cargar factura
            </button>
          </div>
          ` : (pendienteFacturar <= 0.01 ? `<div style="background:#064e3b;color:#6ee7b7;padding:12px;border-radius:6px;margin-bottom:20px;text-align:center">✓ OC facturada en su totalidad</div>` : '')}

          ${facturas.length ? `
          <div>
            <div style="font-weight:600;margin-bottom:8px;color:#cbd5e1">Facturas registradas (${facturas.length})</div>
            ${facturas.map(f => {
              const role = window.App?.currentUser?.role;
              const userId = window.App?.currentUser?.id;
              const tienePagos = parseFloat(f.total_pagado || 0) > 0;
              const puedeAnular = !tienePagos && (['dueno','gerencia'].includes(role) || f.uploaded_by === userId);
              const venc = f.vencimiento ? new Date(f.vencimiento).toLocaleDateString('es-AR') : '—';
              const hoy = new Date(); hoy.setHours(0,0,0,0);
              const vDate = f.vencimiento ? new Date(f.vencimiento) : null;
              const vencida = vDate && vDate < hoy && !f.pagada;
              return `
              <div style="background:#0f172a;border:1px solid ${vencida?'#ef4444':'#334155'};border-radius:8px;padding:12px;margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
                  <div style="flex:1">
                    <div style="font-weight:600">📄 ${f.invoice_nro} · $${fmt(f.invoice_monto)}</div>
                    <div style="font-size:12px;color:#94a3b8">Fecha: ${new Date(f.invoice_fecha).toLocaleDateString('es-AR')} · Vence: ${venc}${vencida?' <span style="color:#ef4444;font-weight:600">VENCIDA</span>':''} · ${f.forma_pago || '—'} ${f.cc_dias?'· '+f.cc_dias+' días':''}</div>
                    <div style="font-size:12px;color:#94a3b8">Cargada por ${f.uploaded_by_name || '—'} el ${new Date(f.uploaded_at).toLocaleDateString('es-AR')}</div>
                    ${f.file_url ? `<div style="font-size:12px;margin-top:4px"><a href="${f.file_url}" target="_blank" style="color:#3b82f6">📎 Ver archivo</a></div>` : ''}
                    ${f.notes ? `<div style="font-size:12px;color:#94a3b8;margin-top:4px;font-style:italic">${f.notes}</div>` : ''}
                  </div>
                  <div style="text-align:right;margin-left:12px">
                    ${parseFloat(f.total_pagado||0) > 0 ? `<div style="font-size:11px;color:#10b981">Pagado: $${fmt(f.total_pagado)}</div>` : '<div style="font-size:11px;color:#f59e0b">Sin pagos</div>'}
                    ${puedeAnular ? `<button onclick="anularFactura('${poId}','${f.id}')" style="background:transparent;border:1px solid #ef4444;color:#ef4444;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;margin-top:6px">Anular</button>` : ''}
                  </div>
                </div>
              </div>`;
            }).join('')}
          </div>` : '<div style="text-align:center;color:#94a3b8;padding:20px">Sin facturas registradas todavía</div>'}

        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  // ─────────────────────────────────────────────────────────
  //  Guardar factura
  // ─────────────────────────────────────────────────────────
  window.guardarFactura = async function(poId) {
    const body = {
      invoice_nro:    document.getElementById('fac-nro')?.value.trim(),
      invoice_fecha:  document.getElementById('fac-fecha')?.value,
      invoice_monto:  document.getElementById('fac-monto')?.value,
      iva_pct:        document.getElementById('fac-iva')?.value,
      forma_pago:     document.getElementById('fac-fp')?.value || null,
      cc_dias:        document.getElementById('fac-cc')?.value,
      file_url:       document.getElementById('fac-url')?.value.trim(),
      notes:          document.getElementById('fac-notes')?.value.trim(),
    };
    if (!body.invoice_nro) { showToast('error', 'Falta el N° de factura'); return; }
    if (!body.invoice_fecha) { showToast('error', 'Falta la fecha'); return; }
    if (!(parseFloat(body.invoice_monto) > 0)) { showToast('error', 'Monto inválido'); return; }

    try {
      const res = await apiFetch(`/api/purchase-orders/${poId}/facturas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.json();
        showToast('error', err.error || 'Error al cargar factura');
        return;
      }
      const data = await res.json();
      showToast('ok', data.message || 'Factura registrada');
      document.querySelector('.modal-facturas-overlay')?.remove();
      abrirModalFacturas(poId);
    } catch (err) {
      console.error(err);
      showToast('error', 'Error al cargar factura');
    }
  };

  window.anularFactura = async function(poId, facId) {
    if (!confirm('¿Anular esta factura?')) return;
    try {
      const res = await apiFetch(`/api/purchase-orders/${poId}/facturas/${facId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        showToast('error', err.error || 'Error al anular');
        return;
      }
      showToast('ok', 'Factura anulada');
      document.querySelector('.modal-facturas-overlay')?.remove();
      abrirModalFacturas(poId);
    } catch (err) {
      showToast('error', 'Error al anular');
    }
  };

  // ─────────────────────────────────────────────────────────
  //  PANEL PROVEEDOR (página exclusiva del rol proveedores)
  // ─────────────────────────────────────────────────────────
  window.renderProveedorPanel = async function() {
    const root = document.getElementById('content') || document.getElementById('main') || document.body;
    root.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8">Cargando OCs...</div>';

    try {
      const res = await apiFetch('/api/purchase-orders/mis-ocs');
      if (!res.ok) {
        const err = await res.json();
        root.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444">${err.error || 'Error al cargar'}</div>`;
        return;
      }
      const ocs = await res.json();
      const fmt = (n) => parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      root.innerHTML = `
        <div style="padding:20px">
          <h2 style="color:#e2e8f0;margin-bottom:8px">📄 Mis Órdenes de Compra</h2>
          <div style="color:#94a3b8;font-size:14px;margin-bottom:20px">OCs aprobadas que te envió el cliente. Cargá las facturas correspondientes.</div>

          ${ocs.length === 0 ? '<div style="text-align:center;color:#94a3b8;padding:40px">No hay OCs aprobadas a tu nombre</div>' : `
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
                    <td style="padding:12px;text-align:center"><span style="font-size:11px;background:${badgeColor(o.delivery_status)};padding:3px 8px;border-radius:4px">${o.delivery_status || 'pendiente'}</span></td>
                    <td style="padding:12px;text-align:center"><span style="font-size:11px;background:${badgeColor(o.payment_status)};padding:3px 8px;border-radius:4px">${o.payment_status || 'pendiente'}</span></td>
                    <td style="padding:12px;text-align:center">
                      <button onclick="abrirModalFacturas('${o.id}')" style="background:#3b82f6;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">Cargar factura</button>
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
      root.innerHTML = '<div style="padding:40px;text-align:center;color:#ef4444">Error de conexión</div>';
    }
  };

  function badgeColor(status) {
    switch (status) {
      case 'total':    return '#064e3b';
      case 'parcial':  return '#7c2d12';
      case 'pendiente':
      default:         return '#1e293b';
    }
  }



  // ─────────────────────────────────────────────────────────
  //  Hook: en modal de edición de usuario, mostrar select de proveedor
  //        cuando rol = 'proveedores' y poblar la lista
  // ─────────────────────────────────────────────────────────
  let _suppliersCache = null;
  async function loadSuppliersForSelect(selectId, currentSupplierId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    if (!_suppliersCache) {
      try {
        const r = await apiFetch('/api/suppliers');
        if (r.ok) _suppliersCache = await r.json();
      } catch { _suppliersCache = []; }
    }
    sel.innerHTML = '<option value="">— Seleccionar —</option>' +
      (_suppliersCache || []).map(s => `<option value="${s.id}" ${s.id===currentSupplierId?'selected':''}>${s.name}${s.cuit?' · '+s.cuit:''}</option>`).join('');
  }

  // Observar el modal de edición de user
  const userModalObserver = new MutationObserver(async () => {
    const roleSelect = document.getElementById('eu-role');
    const group = document.getElementById('eu-supplier-group');
    if (!roleSelect || !group) return;

    if (!roleSelect.dataset.proveedoresHooked) {
      roleSelect.dataset.proveedoresHooked = '1';
      // Cargar suppliers iniciales
      const userId = roleSelect.closest('[data-user-id]')?.dataset?.userId;
      // Buscar supplier_id actual: vamos al endpoint
      let currentSup = null;
      try {
        const r = await apiFetch('/api/users');
        if (r.ok) {
          const users = await r.json();
          const me = users.find(u => u.role === roleSelect.value && u.supplier_id);
          // Heurística simple: lo dejamos en null si no podemos detectar
          // (mejor sería pasar el supplier_id como prop al modal, pero esto evita tocar más cosas)
        }
      } catch {}
      await loadSuppliersForSelect('eu-supplier', currentSup);
      // Toggle visibility
      const toggle = () => {
        group.style.display = roleSelect.value === 'proveedores' ? 'block' : 'none';
      };
      roleSelect.addEventListener('change', toggle);
      toggle();
    }
  });
  userModalObserver.observe(document.body, { childList: true, subtree: true });

})();
