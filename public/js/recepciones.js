// ═══════════════════════════════════════════════════════════
//  FleetOS — Recepciones parciales (UI claro + OC abierta)
//  Expone window.abrirModalRecepciones(poId)
// ═══════════════════════════════════════════════════════════

(function() {

  window.abrirModalRecepciones = async function(poId) {
    try {
      const [itemsRes, recsRes, destRes, ocRes, catRes] = await Promise.all([
        apiFetch(`/api/purchase-orders/${poId}/items-pendientes`),
        apiFetch(`/api/purchase-orders/${poId}/recepciones`),
        apiFetch(`/api/purchase-orders/${poId}/recepciones/aux/destinos`),
        apiFetch(`/api/purchase-orders/${poId}`),
        apiFetch(`/api/stock/catalog`).catch(() => null),
      ]);
      const items = itemsRes.ok ? await itemsRes.json() : [];
      const recepciones = recsRes.ok ? await recsRes.json() : [];
      const destinos = destRes.ok ? await destRes.json() : { fijos: [], sucursales: [] };
      const oc = ocRes.ok ? await ocRes.json() : {};
      const catalogo = (catRes && catRes.ok) ? await catRes.json() : [];
      console.log('[recepciones] OC:', oc.code, 'is_open:', oc.is_open, 'items pend:', items.length);
      renderModalRecepciones(poId, oc, items, recepciones, destinos, catalogo);
    } catch (err) {
      console.error('[recepciones]', err);
      showToast('error', 'No se pudieron cargar las recepciones');
    }
  };

  function renderModalRecepciones(poId, oc, items, recepciones, destinos, catalogo) {
    document.querySelector('.modal-recepciones-overlay')?.remove();
    // Opciones para "ingresar al stock": catálogo + sucursal/área del modelo nuevo.
    const _cat = Array.isArray(catalogo) ? catalogo : [];
    const catalogOpts = _cat.map(a => `<option value="${a.id}">${escapeHtml(a.code)} — ${escapeHtml(a.name)}</option>`).join('');
    const userSuc = window.App?.currentUser?.sucursal || '';
    const sucList = (typeof stockBaseOptions === 'function') ? stockBaseOptions() : (userSuc ? [userSuc] : ['Central']);
    const sucOpts = sucList.map(b => `<option value="${escapeHtml(b)}"${b === userSuc ? ' selected' : ''}>${escapeHtml(b)}</option>`).join('');
    const areaOptsFor = (suc) => {
      const areas = (typeof stockAreaOptions === 'function') ? stockAreaOptions(suc) : ['Administración', 'Depósito', 'Taller'];
      return areas.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
    };
    const areaOptsDefault = areaOptsFor(userSuc || sucList[0]);
    // Expuesto para los onchange por ítem.
    window._recepCtx = { catalogOpts, sucOpts, areaOptsFor };
    const overlay = document.createElement('div');
    overlay.className = 'modal-recepciones-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(15,23,42,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const totalPendiente = items.reduce((s, i) => s + parseFloat(i.pendiente || 0), 0);
    const totalRecibido  = items.reduce((s, i) => s + parseFloat(i.recibida || 0), 0);
    const isOpen = !!oc.is_open;

    let statusLabel = 'Pendiente', statusColor = 'var(--warn)';
    if (isOpen) { statusLabel = 'Abierta (servicios)'; statusColor = 'var(--info)'; }
    else if (totalRecibido === 0) { statusLabel = 'Pendiente'; statusColor = 'var(--warn)'; }
    else if (totalPendiente <= 0.001) { statusLabel = 'Total'; statusColor = 'var(--ok)'; }
    else { statusLabel = 'Parcial'; statusColor = 'var(--info)'; }

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:900px;width:100%;max-height:90vh;overflow-y:auto;color:var(--text);border:1px solid var(--border2);box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="padding:20px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#fff;z-index:10">
          <div>
            <div style="font-size:18px;font-weight:700">📦 Recepciones · ${oc.code || ''}</div>
            <div style="font-size:13px;color:var(--text3);margin-top:4px">${escapeHtml(oc.proveedor || 'Sin proveedor')} · Estado entrega: <strong style="color:${statusColor}">${statusLabel}</strong></div>
          </div>
          <button onclick="this.closest('.modal-recepciones-overlay').remove()" style="background:transparent;border:none;color:var(--text3);font-size:28px;cursor:pointer;line-height:1">×</button>
        </div>

        <div style="padding:20px">

          <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:12px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
            <input id="recep-is-open" type="checkbox" ${isOpen ? 'checked' : ''} onchange="toggleOCAbierta('${poId}', this.checked)" style="width:18px;height:18px;cursor:pointer">
            <label for="recep-is-open" style="cursor:pointer;flex:1">
              <strong>OC abierta</strong>
              <div style="font-size:12px;color:var(--text3)">Para servicios fraccionados (ej: 10.000 km de flete que se descuentan progresivamente). No se cierra automáticamente.</div>
            </label>
          </div>

          <div style="margin-bottom:18px">
            <div style="font-weight:600;margin-bottom:8px">Ítems de la OC</div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Descripción</th>
                    <th style="text-align:right">Pedido</th>
                    <th style="text-align:right">Recibido</th>
                    <th style="text-align:right">Pendiente</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map(i => {
                    const ped = parseFloat(i.pedida).toFixed(2);
                    const rec = parseFloat(i.recibida).toFixed(2);
                    const pen = parseFloat(i.pendiente).toFixed(2);
                    const completo = parseFloat(i.pendiente) <= 0.001;
                    return `<tr>
                      <td>${escapeHtml(i.descripcion)}</td>
                      <td style="text-align:right">${ped} ${i.unidad || ''}</td>
                      <td style="text-align:right;color:${rec > 0 ? 'var(--ok)' : 'var(--text3)'}">${rec}</td>
                      <td style="text-align:right;color:${completo && !isOpen ? 'var(--ok)' : 'var(--warn)'};font-weight:600">${(completo && !isOpen) ? '✓' : pen}${isOpen ? ' (abierta)' : ''}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>

          ${(totalPendiente > 0.001 || isOpen) ? `
          <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:16px;margin-bottom:16px">
            <div style="font-weight:600;margin-bottom:12px">+ Registrar nueva recepción</div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
              <div>
                <label style="font-size:12px;color:var(--text3)">Destino *</label>
                <select id="recep-destino" class="form-select">
                  <option value="">— Seleccionar —</option>
                  <optgroup label="Destinos">${destinos.fijos.map(d => `<option value="${d}">${d}</option>`).join('')}</optgroup>
                  ${destinos.sucursales.length ? `<optgroup label="Sucursales">${destinos.sucursales.map(s => `<option value="${s}">${s}</option>`).join('')}</optgroup>` : ''}
                </select>
              </div>
              <div>
                <label style="font-size:12px;color:var(--text3)">N° Remito (opcional)</label>
                <input id="recep-remito" type="text" placeholder="R-12345" class="form-input">
              </div>
            </div>

            <div style="margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <label style="font-size:12px;color:var(--text3)">Cantidades recibidas / utilizadas</label>
                ${!isOpen ? `<button type="button" class="btn btn-ghost btn-sm" onclick="recepRecibirTodo()" style="font-size:11px">✓ Recibir todo lo pendiente</button>` : ''}
              </div>
              <div style="background:#fff;border:1px solid var(--border2);border-radius:6px;padding:10px;margin-top:4px">
                ${items.filter(i => isOpen || parseFloat(i.pendiente) > 0.001).map(i => {
                  const max = isOpen ? '' : `max="${i.pendiente}"`;
                  const unidad = i.unidad || 'un';
                  return `
                  <div style="padding:6px 0;border-bottom:1px solid var(--border)">
                    <div style="display:grid;grid-template-columns:1fr 110px 90px;gap:8px;align-items:center">
                      <div style="font-size:13px">${escapeHtml(i.descripcion)}</div>
                      <input type="number" step="0.01" min="0" ${max} data-recep-item="${i.id}" placeholder="0" class="form-input" style="text-align:right">
                      <div style="font-size:11px;color:var(--text3)">${isOpen ? 'libre' : '/ ' + parseFloat(i.pendiente).toFixed(2)} ${unidad}</div>
                    </div>
                    <label style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:12px;color:var(--text2);cursor:pointer">
                      <input type="checkbox" id="recep-stk-${i.id}" onchange="recepToggleStock('${i.id}')" style="width:15px;height:15px;cursor:pointer"> 📦 Ingresar al stock
                    </label>
                    <div id="recep-stkbox-${i.id}" style="display:none;margin-top:8px;padding:10px;background:#fff;border:1px solid var(--border2);border-radius:6px">
                      <label style="font-size:11px;color:var(--text3)">Artículo de stock</label>
                      <select id="recep-art-${i.id}" class="form-select" onchange="recepArtChanged('${i.id}')">
                        <option value="">— Elegir artículo del catálogo —</option>
                        ${catalogOpts ? `<optgroup label="Catálogo">${catalogOpts}</optgroup>` : ''}
                        <option value="__new__">➕ Crear artículo nuevo</option>
                      </select>
                      <div id="recep-new-${i.id}" style="display:none;margin-top:8px">
                        <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px">
                          <div><label style="font-size:11px;color:var(--text3)">Nombre nuevo</label><input id="recep-nname-${i.id}" class="form-input" value="${escapeHtml(i.descripcion)}"></div>
                          <div><label style="font-size:11px;color:var(--text3)">Categoría</label><input id="recep-ncat-${i.id}" class="form-input" value="General"></div>
                          <div><label style="font-size:11px;color:var(--text3)">Unidad</label><input id="recep-nunit-${i.id}" class="form-input" value="${escapeHtml(unidad)}"></div>
                        </div>
                      </div>
                      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
                        <div><label style="font-size:11px;color:var(--text3)">Sucursal</label><select id="recep-suc-${i.id}" class="form-select" onchange="recepAreaRefresh('${i.id}')">${sucOpts}</select></div>
                        <div><label style="font-size:11px;color:var(--text3)">Área</label><select id="recep-area-${i.id}" class="form-select">${areaOptsDefault}</select></div>
                      </div>
                    </div>
                  </div>`;
                }).join('')}
              </div>
            </div>

            <div style="margin-bottom:12px">
              <label style="font-size:12px;color:var(--text3)">Observaciones (opcional)</label>
              <textarea id="recep-notes" rows="2" class="form-input" style="resize:vertical"></textarea>
            </div>

            <button class="btn btn-primary" onclick="guardarRecepcion('${poId}')">✓ Registrar recepción</button>
          </div>
          ` : `<div style="background:#dcfce7;color:#166534;padding:12px;border-radius:6px;margin-bottom:16px;text-align:center;font-weight:600">✓ Esta OC ya fue recibida en su totalidad</div>`}

          ${recepciones.length ? `
          <div>
            <div style="font-weight:600;margin-bottom:8px">Historial de recepciones (${recepciones.length})</div>
            ${recepciones.map(r => {
              const role = window.App?.currentUser?.role;
              const userId = window.App?.currentUser?.id;
              const puedeAnular = ['dueno','gerencia'].includes(role) || r.received_by === userId;
              return `<div style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:12px;margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
                  <div style="flex:1">
                    <div style="font-weight:600">📥 ${new Date(r.received_at).toLocaleString('es-AR')}</div>
                    <div style="font-size:12px;color:var(--text3)">por ${escapeHtml(r.received_by_name || '—')} · Destino: <strong>${escapeHtml(r.destino)}</strong>${r.remito_nro ? ' · Remito: '+escapeHtml(r.remito_nro) : ''}</div>
                  </div>
                  ${puedeAnular ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger);border-color:var(--danger)" onclick="anularRecepcion('${poId}','${r.id}')">Anular</button>` : ''}
                </div>
                ${(r.items || []).length ? `<div style="font-size:13px;margin-top:6px">${r.items.map(it => `<div style="padding:2px 0">• ${escapeHtml(it.descripcion)}: <strong>${parseFloat(it.cantidad).toFixed(2)} ${escapeHtml(it.unidad || '')}</strong></div>`).join('')}</div>` : ''}
                ${r.notes ? `<div style="font-size:12px;color:var(--text3);margin-top:6px;font-style:italic">${escapeHtml(r.notes)}</div>` : ''}
              </div>`;
            }).join('')}
          </div>` : '<div style="text-align:center;color:var(--text3);padding:20px">Sin recepciones registradas todavía</div>'}

        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  window.toggleOCAbierta = async function(poId, isOpen) {
    try {
      const res = await apiFetch(`/api/purchase-orders/${poId}/toggle-open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_open: isOpen })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast('error', err.error || 'No se pudo cambiar el estado');
        const cb = document.getElementById('recep-is-open');
        if (cb) cb.checked = !isOpen;
        return;
      }
      showToast('ok', isOpen ? 'OC marcada como abierta' : 'OC ya no queda como abierta');
      abrirModalRecepciones(poId);
    } catch (err) {
      console.error(err);
      showToast('error', 'Error al cambiar el estado');
    }
  };

  // Muestra/oculta el panel "ingresar al stock" de un ítem.
  window.recepToggleStock = function(itemId) {
    const cb = document.getElementById('recep-stk-' + itemId);
    const box = document.getElementById('recep-stkbox-' + itemId);
    if (box) box.style.display = (cb && cb.checked) ? '' : 'none';
  };

  // Muestra los campos del artículo nuevo solo si se eligió "Crear artículo nuevo".
  window.recepArtChanged = function(itemId) {
    const sel = document.getElementById('recep-art-' + itemId);
    const nb = document.getElementById('recep-new-' + itemId);
    if (nb) nb.style.display = (sel && sel.value === '__new__') ? '' : 'none';
  };

  // Repuebla el área según la sucursal elegida.
  window.recepAreaRefresh = function(itemId) {
    const suc = document.getElementById('recep-suc-' + itemId)?.value;
    const areaSel = document.getElementById('recep-area-' + itemId);
    if (areaSel && window._recepCtx) areaSel.innerHTML = window._recepCtx.areaOptsFor(suc);
  };

  // Atajo: completar cada cantidad con lo pendiente (el "max" de cada input).
  window.recepRecibirTodo = function() {
    document.querySelectorAll('[data-recep-item]').forEach(inp => {
      const max = inp.getAttribute('max');
      if (max != null && max !== '') inp.value = max;
    });
  };

  window.guardarRecepcion = async function(poId) {
    const destino = document.getElementById('recep-destino')?.value;
    if (!destino) { showToast('error', 'Seleccioná un destino'); return; }
    const remito = document.getElementById('recep-remito')?.value.trim();
    const notes  = document.getElementById('recep-notes')?.value.trim();
    const inputs = document.querySelectorAll('[data-recep-item]');
    const items = [];
    let stockError = null;
    inputs.forEach(inp => {
      const cant = parseFloat(inp.value);
      if (!(cant > 0)) return;
      const id = inp.dataset.recepItem;
      const item = { po_item_id: id, cantidad: cant };
      const stk = document.getElementById('recep-stk-' + id);
      if (stk && stk.checked) {
        item.to_stock = true;
        const art = document.getElementById('recep-art-' + id)?.value;
        if (art === '__new__') {
          const name = document.getElementById('recep-nname-' + id)?.value.trim();
          if (!name) { stockError = 'Falta el nombre del artículo nuevo a ingresar al stock'; return; }
          item.new_article = {
            name,
            category: document.getElementById('recep-ncat-' + id)?.value.trim() || 'General',
            unit: document.getElementById('recep-nunit-' + id)?.value.trim() || 'un',
          };
        } else if (art) {
          item.catalog_id = art;
        } else {
          stockError = 'Elegí o creá el artículo para los ítems marcados "ingresar al stock"';
          return;
        }
        item.base_location = document.getElementById('recep-suc-' + id)?.value || 'Central';
        item.area = document.getElementById('recep-area-' + id)?.value || 'Depósito';
      }
      items.push(item);
    });
    if (stockError) { showToast('error', stockError); return; }
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
      if (Array.isArray(data.stock_warnings) && data.stock_warnings.length) {
        showToast('warn', '⚠ Stock: ' + data.stock_warnings.join(' '));
      }
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
