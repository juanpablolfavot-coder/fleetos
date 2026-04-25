// ═══════════════════════════════════════════════════════════
//  FleetOS — Recepciones parciales (UI)
//  Expone window.abrirModalRecepciones(poId)
//  Roles: dueno, gerencia, jefe_mantenimiento, paniol, contador, compras
// ═══════════════════════════════════════════════════════════

(function() {
  const ROLES_RECIBIR = ['dueno','gerencia','jefe_mantenimiento','paniol','contador','compras'];

  function puedeRecibir() {
    const role = window.App?.currentUser?.role;
    return ROLES_RECIBIR.includes(role);
  }

  window.abrirModalRecepciones = async function(poId) {
    try {
      const [itemsRes, recsRes, destRes, ocRes] = await Promise.all([
        apiFetch(`/api/purchase-orders/${poId}/items-pendientes`),
        apiFetch(`/api/purchase-orders/${poId}/recepciones`),
        apiFetch(`/api/purchase-orders/${poId}/recepciones/aux/destinos`),
        apiFetch(`/api/purchase-orders/${poId}`),
      ]);
      const items = itemsRes.ok ? await itemsRes.json() : [];
      const recepciones = recsRes.ok ? await recsRes.json() : [];
      const destinos = destRes.ok ? await destRes.json() : { fijos: [], sucursales: [] };
      const oc = ocRes.ok ? await ocRes.json() : {};
      renderModalRecepciones(poId, oc, items, recepciones, destinos);
    } catch (err) {
      console.error('[recepciones]', err);
      showToast('error', 'No se pudieron cargar las recepciones');
    }
  };

  function renderModalRecepciones(poId, oc, items, recepciones, destinos) {
    document.querySelector('.modal-recepciones-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'modal-recepciones-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const totalPendiente = items.reduce((s, i) => s + parseFloat(i.pendiente || 0), 0);
    const totalRecibido  = items.reduce((s, i) => s + parseFloat(i.recibida || 0), 0);
    const status = totalRecibido === 0 ? 'Pendiente' : (totalPendiente <= 0.001 ? 'Total' : 'Parcial');
    const statusColor = totalRecibido === 0 ? '#f59e0b' : (totalPendiente <= 0.001 ? '#10b981' : '#3b82f6');

    overlay.innerHTML = `
      <div style="background:#1e293b;border-radius:12px;max-width:900px;width:100%;max-height:90vh;overflow-y:auto;color:#e2e8f0;border:1px solid #334155">
        <div style="padding:20px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#1e293b;z-index:10">
          <div>
            <div style="font-size:18px;font-weight:700">📦 Recepciones · ${oc.code || ''}</div>
            <div style="font-size:13px;color:#94a3b8;margin-top:4px">${oc.proveedor || 'Sin proveedor'} · Estado entrega: <strong style="color:${statusColor}">${status}</strong></div>
          </div>
          <button onclick="this.closest('.modal-recepciones-overlay').remove()" style="background:transparent;border:none;color:#94a3b8;font-size:28px;cursor:pointer;line-height:1">×</button>
        </div>
        <div style="padding:20px">

          <div style="margin-bottom:20px">
            <div style="font-weight:600;margin-bottom:8px;color:#cbd5e1">Ítems de la OC</div>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead><tr style="background:#0f172a;color:#94a3b8">
                <th style="padding:8px;text-align:left">Descripción</th>
                <th style="padding:8px;text-align:right">Pedido</th>
                <th style="padding:8px;text-align:right">Recibido</th>
                <th style="padding:8px;text-align:right">Pendiente</th>
              </tr></thead>
              <tbody>
                ${items.map(i => {
                  const ped = parseFloat(i.pedida).toFixed(2);
                  const rec = parseFloat(i.recibida).toFixed(2);
                  const pen = parseFloat(i.pendiente).toFixed(2);
                  const completo = parseFloat(i.pendiente) <= 0.001;
                  return `<tr style="border-bottom:1px solid #334155">
                    <td style="padding:8px">${i.descripcion}</td>
                    <td style="padding:8px;text-align:right">${ped} ${i.unidad || ''}</td>
                    <td style="padding:8px;text-align:right;color:${rec > 0 ? '#10b981' : '#94a3b8'}">${rec}</td>
                    <td style="padding:8px;text-align:right;color:${completo ? '#10b981' : '#f59e0b'};font-weight:600">${completo ? '✓' : pen}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>

          ${totalPendiente > 0.001 && puedeRecibir() ? `
          <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:16px;margin-bottom:20px">
            <div style="font-weight:600;margin-bottom:12px;color:#cbd5e1">+ Registrar nueva recepción</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
              <div>
                <label style="font-size:12px;color:#94a3b8">Destino *</label>
                <select id="recep-destino" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:8px;border-radius:6px;margin-top:4px">
                  <option value="">— Seleccionar —</option>
                  <optgroup label="Destinos">${destinos.fijos.map(d => `<option value="${d}">${d}</option>`).join('')}</optgroup>
                  ${destinos.sucursales.length ? `<optgroup label="Sucursales">${destinos.sucursales.map(s => `<option value="${s}">${s}</option>`).join('')}</optgroup>` : ''}
                </select>
              </div>
              <div>
                <label style="font-size:12px;color:#94a3b8">N° Remito (opcional)</label>
                <input id="recep-remito" type="text" placeholder="R-12345" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:8px;border-radius:6px;margin-top:4px">
              </div>
            </div>
            <div style="margin-bottom:12px">
              <label style="font-size:12px;color:#94a3b8">Cantidades recibidas</label>
              <div style="background:#1e293b;border:1px solid #334155;border-radius:6px;padding:10px;margin-top:4px">
                ${items.filter(i => parseFloat(i.pendiente) > 0.001).map(i => `
                  <div style="display:grid;grid-template-columns:1fr 110px 90px;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #334155">
                    <div style="font-size:13px">${i.descripcion}</div>
                    <input type="number" step="0.01" min="0" max="${i.pendiente}" data-recep-item="${i.id}" placeholder="0" style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:6px;border-radius:4px;text-align:right">
                    <div style="font-size:11px;color:#94a3b8">/ ${parseFloat(i.pendiente).toFixed(2)} ${i.unidad || ''}</div>
                  </div>
                `).join('')}
              </div>
            </div>
            <div style="margin-bottom:12px">
              <label style="font-size:12px;color:#94a3b8">Observaciones (opcional)</label>
              <textarea id="recep-notes" rows="2" style="width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:8px;border-radius:6px;margin-top:4px;resize:vertical"></textarea>
            </div>
            <button onclick="guardarRecepcion('${poId}')" style="background:#3b82f6;color:#fff;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-weight:600">✓ Registrar recepción</button>
          </div>` : (totalPendiente <= 0.001 ? `<div style="background:#064e3b;color:#6ee7b7;padding:12px;border-radius:6px;margin-bottom:20px;text-align:center">✓ Esta OC ya fue recibida en su totalidad</div>` : '')}

          ${recepciones.length ? `
          <div>
            <div style="font-weight:600;margin-bottom:8px;color:#cbd5e1">Historial de recepciones</div>
            ${recepciones.map(r => {
              const role = window.App?.currentUser?.role;
              const userId = window.App?.currentUser?.id;
              const puedeAnular = ['dueno','gerencia'].includes(role) || r.received_by === userId;
              return `<div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
                  <div>
                    <div style="font-weight:600">📥 ${new Date(r.received_at).toLocaleString('es-AR')}</div>
                    <div style="font-size:12px;color:#94a3b8">por ${r.received_by_name || '—'} · Destino: <strong>${r.destino}</strong>${r.remito_nro ? ' · Remito: '+r.remito_nro : ''}</div>
                  </div>
                  ${puedeAnular ? `<button onclick="anularRecepcion('${poId}','${r.id}')" style="background:transparent;border:1px solid #ef4444;color:#ef4444;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px">Anular</button>` : ''}
                </div>
                ${(r.items || []).length ? `<div style="font-size:13px">${r.items.map(it => `<div style="padding:2px 0;color:#cbd5e1">• ${it.descripcion}: <strong>${parseFloat(it.cantidad).toFixed(2)} ${it.unidad || ''}</strong></div>`).join('')}</div>` : ''}
                ${r.notes ? `<div style="font-size:12px;color:#94a3b8;margin-top:6px;font-style:italic">${r.notes}</div>` : ''}
              </div>`;
            }).join('')}
          </div>` : '<div style="text-align:center;color:#94a3b8;padding:20px">Sin recepciones registradas todavía</div>'}

        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  window.guardarRecepcion = async function(poId) {
    const destino = document.getElementById('recep-destino')?.value;
    if (!destino) { showToast('error', 'Seleccioná un destino'); return; }
    const remito = document.getElementById('recep-remito')?.value.trim();
    const notes  = document.getElementById('recep-notes')?.value.trim();
    const inputs = document.querySelectorAll('[data-recep-item]');
    const items = [];
    inputs.forEach(inp => {
      const cant = parseFloat(inp.value);
      if (cant > 0) items.push({ po_item_id: inp.dataset.recepItem, cantidad: cant });
    });
    if (!items.length) { showToast('error', 'Indicá al menos una cantidad recibida'); return; }
    try {
      const res = await apiFetch(`/api/purchase-orders/${poId}/recepciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destino, remito_nro: remito, notes, items })
      });
      if (!res.ok) {
        const err = await res.json();
        showToast('error', err.error || 'Error al registrar recepción');
        return;
      }
      const data = await res.json();
      showToast('ok', data.message || 'Recepción registrada');
      document.querySelector('.modal-recepciones-overlay')?.remove();
      abrirModalRecepciones(poId);
    } catch (err) {
      console.error(err);
      showToast('error', 'Error al registrar recepción');
    }
  };

  window.anularRecepcion = async function(poId, recId) {
    if (!confirm('¿Anular esta recepción?')) return;
    try {
      const res = await apiFetch(`/api/purchase-orders/${poId}/recepciones/${recId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        showToast('error', err.error || 'Error al anular');
        return;
      }
      showToast('ok', 'Recepción anulada');
      document.querySelector('.modal-recepciones-overlay')?.remove();
      abrirModalRecepciones(poId);
    } catch (err) {
      console.error(err);
      showToast('error', 'Error al anular');
    }
  };

})();
