// ═══════════════════════════════════════════════════════════
//  FleetOS — Pagos (Tesorería)
//  Expone:
//    - window.renderTesoreriaPanel()       → panel con facturas pendientes
//    - window.abrirModalPago(poId, facId)  → modal para registrar pago
// ═══════════════════════════════════════════════════════════

(function() {
  const ROLES_PAGAR = ['dueno','gerencia','tesoreria'];

  function puedePagar() {
    const role = window.App?.currentUser?.role;
    return ROLES_PAGAR.includes(role);
  }

  const fmt = (n) => parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ─────────────────────────────────────────────────────────
  //  PANEL TESORERÍA — facturas pendientes
  // ─────────────────────────────────────────────────────────
  window.renderTesoreriaPanelInline = async function() {
    const page = document.getElementById('page-tesoreria_panel');
    if (!page) return;
    page.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">Cargando facturas pendientes...</div>';

    try {
      const res = await apiFetch('/api/payments/pendientes');
      if (!res.ok) {
        page.innerHTML = '<div style="padding:40px;text-align:center;color:var(--danger)">Error al cargar</div>';
        return;
      }
      const facturas = await res.json();
      if (!facturas.length) {
        page.innerHTML = '<div class="card"><div style="padding:60px;text-align:center;color:var(--text3)">✓ Sin facturas pendientes de pago</div></div>';
        return;
      }

      // Resumen
      const totalPendiente = facturas.reduce((s, f) => s + parseFloat(f.saldo || 0), 0);
      const vencidas = facturas.filter(f => f.vencida);
      const porVencer = facturas.filter(f => f.por_vencer);

      page.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
          <div class="kpi-card danger"><div class="kpi-label">Vencidas</div><div class="kpi-value">${vencidas.length}</div><div class="kpi-sub">$${fmt(vencidas.reduce((s,f)=>s+parseFloat(f.saldo||0),0))}</div></div>
          <div class="kpi-card warn"><div class="kpi-label">Por vencer (7 días)</div><div class="kpi-value">${porVencer.length}</div><div class="kpi-sub">$${fmt(porVencer.reduce((s,f)=>s+parseFloat(f.saldo||0),0))}</div></div>
          <div class="kpi-card info"><div class="kpi-label">Total pendiente</div><div class="kpi-value">$${fmt(totalPendiente)}</div><div class="kpi-sub">${facturas.length} facturas</div></div>
        </div>

        <div class="card">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>OC</th>
                  <th>Proveedor</th>
                  <th>Factura</th>
                  <th>Fecha</th>
                  <th>Vencimiento</th>
                  <th style="text-align:right">Total</th>
                  <th style="text-align:right">Pagado</th>
                  <th style="text-align:right">Saldo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${facturas.map(f => {
                  const venc = f.vencimiento ? new Date(f.vencimiento).toLocaleDateString('es-AR') : '—';
                  let vencColor = '';
                  let vencLabel = venc;
                  if (f.vencida) { vencColor = 'color:var(--danger);font-weight:600'; vencLabel = venc + ' ⚠'; }
                  else if (f.por_vencer) { vencColor = 'color:var(--warn);font-weight:600'; }
                  return `
                  <tr>
                    <td class="td-mono">${f.po_code}</td>
                    <td>${f.supplier_name || f.proveedor || '—'}</td>
                    <td class="td-mono">${f.invoice_nro}</td>
                    <td>${new Date(f.invoice_fecha).toLocaleDateString('es-AR')}</td>
                    <td style="${vencColor}">${vencLabel}</td>
                    <td style="text-align:right">$${fmt(f.invoice_monto)}</td>
                    <td style="text-align:right;color:${parseFloat(f.monto_pagado)>0?'var(--ok)':'var(--text3)'}">$${fmt(f.monto_pagado)}</td>
                    <td style="text-align:right;color:var(--warn);font-weight:600">$${fmt(f.saldo)}</td>
                    <td style="text-align:center">
                      <button class="btn btn-primary btn-sm" onclick="abrirModalPago('${f.po_id}','${f.id}')">💳 Pagar</button>
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } catch (err) {
      console.error(err);
      page.innerHTML = '<div style="padding:40px;text-align:center;color:var(--danger)">Error de conexión</div>';
    }
  };

  // ─────────────────────────────────────────────────────────
  //  MODAL DE PAGO
  // ─────────────────────────────────────────────────────────
  window.abrirModalPago = async function(poId, facId) {
    try {
      const [facsRes, pagosRes, ocRes] = await Promise.all([
        apiFetch(`/api/purchase-orders/${poId}/facturas`),
        apiFetch(`/api/purchase-orders/${poId}/facturas/${facId}/pagos`),
        apiFetch(`/api/purchase-orders/${poId}`),
      ]);
      const facturas = await facsRes.json();
      const factura = facturas.find(f => f.id === facId);
      const pagos = await pagosRes.json();
      const oc = await ocRes.json();
      if (!factura) { showToast('error', 'Factura no encontrada'); return; }
      renderModalPago(poId, facId, factura, pagos, oc);
    } catch (err) {
      console.error('[pago]', err);
      showToast('error', 'No se pudieron cargar los datos');
    }
  };

  function renderModalPago(poId, facId, factura, pagos, oc) {
    document.querySelector('.modal-pago-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'modal-pago-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(15,23,42,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const totalFac = parseFloat(factura.invoice_monto);
    const totalPagado = parseFloat(factura.monto_pagado || 0);
    const saldo = totalFac - totalPagado;
    const pagada = saldo <= 0.01;

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:900px;width:100%;max-height:90vh;overflow-y:auto;color:var(--text);border:1px solid var(--border2);box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="padding:20px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#fff;z-index:10">
          <div>
            <div style="font-size:18px;font-weight:700">💳 Pago · Factura ${factura.invoice_nro}</div>
            <div style="font-size:13px;color:var(--text3);margin-top:4px">${oc.code} · ${oc.proveedor || '—'}</div>
          </div>
          <button onclick="this.closest('.modal-pago-overlay').remove()" style="background:transparent;border:none;color:var(--text3);font-size:28px;cursor:pointer;line-height:1">×</button>
        </div>

        <div style="padding:20px">
          <!-- Resumen factura -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
            <div style="background:var(--bg2);padding:10px;border-radius:6px;border:1px solid var(--border2)">
              <div style="font-size:11px;color:var(--text3);text-transform:uppercase">Total factura</div>
              <div style="font-size:18px;font-weight:600">$${fmt(totalFac)}</div>
            </div>
            <div style="background:var(--bg2);padding:10px;border-radius:6px;border:1px solid var(--border2)">
              <div style="font-size:11px;color:var(--text3);text-transform:uppercase">Pagado</div>
              <div style="font-size:18px;font-weight:600;color:var(--ok)">$${fmt(totalPagado)}</div>
            </div>
            <div style="background:var(--bg2);padding:10px;border-radius:6px;border:1px solid var(--border2)">
              <div style="font-size:11px;color:var(--text3);text-transform:uppercase">Saldo</div>
              <div style="font-size:18px;font-weight:600;color:${pagada?'var(--ok)':'var(--warn)'}">$${fmt(saldo)}</div>
            </div>
          </div>

          ${!pagada ? `
          <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:16px;margin-bottom:16px">
            <div style="font-weight:600;margin-bottom:12px">+ Registrar nuevo pago</div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
              <div>
                <label style="font-size:12px;color:var(--text3)">Método de pago *</label>
                <select id="pago-metodo" class="form-select" onchange="cambiarMetodoPago()">
                  <option value="">— Seleccionar —</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="cheque">Cheque físico</option>
                  <option value="echeq">eCheq</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div>
                <label style="font-size:12px;color:var(--text3)">Monto * <span style="color:var(--text3)">(saldo: $${fmt(saldo)})</span></label>
                <input id="pago-monto" type="number" step="0.01" min="0" max="${saldo}" placeholder="${fmt(saldo)}" class="form-input">
              </div>
            </div>

            <!-- Campos dinámicos por método -->
            <div id="pago-campos-dinamicos"></div>

            <div style="margin-bottom:12px">
              <label style="font-size:12px;color:var(--text3)">URL comprobante (opcional)</label>
              <input id="pago-url" type="text" placeholder="https://..." class="form-input">
            </div>

            <div style="margin-bottom:12px">
              <label style="font-size:12px;color:var(--text3)">Observaciones (opcional)</label>
              <textarea id="pago-notes" rows="2" class="form-input" style="resize:vertical"></textarea>
            </div>

            <button class="btn btn-primary" onclick="guardarPago('${poId}','${facId}')">✓ Registrar pago</button>
          </div>
          ` : (pagada ? '<div style="background:#dcfce7;color:#166534;padding:12px;border-radius:6px;margin-bottom:16px;text-align:center;font-weight:600">✓ Factura cancelada totalmente</div>' : '')}

          ${pagos.length ? `
          <div>
            <div style="font-weight:600;margin-bottom:8px">Historial de pagos (${pagos.length})</div>
            ${pagos.map(p => {
              const role = window.App?.currentUser?.role;
              const userId = window.App?.currentUser?.id;
              const puedeAnular = ['dueno','gerencia'].includes(role) || p.paid_by === userId;
              return `
              <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:12px;margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
                  <div style="flex:1">
                    <div style="font-weight:600">💰 $${fmt(p.monto)} · ${p.metodo.toUpperCase()}</div>
                    <div style="font-size:12px;color:var(--text3)">${new Date(p.paid_at).toLocaleString('es-AR')} · por ${p.paid_by_name || '—'}</div>
                    ${detallePago(p)}
                    ${p.file_url ? `<div style="font-size:12px;margin-top:4px"><a href="${p.file_url}" target="_blank" style="color:var(--accent)">📎 Ver comprobante</a></div>` : ''}
                    ${p.notes ? `<div style="font-size:12px;color:var(--text3);margin-top:4px;font-style:italic">${p.notes}</div>` : ''}
                  </div>
                  ${puedeAnular ? `<button onclick="anularPago('${poId}','${facId}','${p.id}')" class="btn btn-ghost btn-sm" style="color:var(--danger);border-color:var(--danger)">Anular</button>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>` : '<div style="text-align:center;color:var(--text3);padding:20px">Sin pagos registrados todavía</div>'}

        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  function detallePago(p) {
    let detalles = [];
    if (p.metodo === 'transferencia') {
      if (p.banco_origen)  detalles.push(`Origen: ${p.banco_origen}`);
      if (p.banco_destino) detalles.push(`Destino: ${p.banco_destino}`);
      if (p.cbu_alias_destino) detalles.push(`CBU/Alias: ${p.cbu_alias_destino}`);
    } else if (p.metodo === 'cheque') {
      if (p.cheque_nro)         detalles.push(`N° ${p.cheque_nro}`);
      if (p.cheque_banco)       detalles.push(`Banco: ${p.cheque_banco}`);
      if (p.cheque_fecha_cobro) detalles.push(`Cobro: ${new Date(p.cheque_fecha_cobro).toLocaleDateString('es-AR')}`);
      if (p.cheque_a_nombre)    detalles.push(`A nombre de: ${p.cheque_a_nombre}`);
    } else if (p.metodo === 'echeq') {
      if (p.echeq_nro)        detalles.push(`N° ${p.echeq_nro}`);
      if (p.echeq_banco)      detalles.push(`Banco: ${p.echeq_banco}`);
      if (p.echeq_fecha_pago) detalles.push(`Fecha: ${new Date(p.echeq_fecha_pago).toLocaleDateString('es-AR')}`);
    } else if (p.metodo === 'tarjeta') {
      if (p.tarjeta_aprobacion) detalles.push(`Aprobación: ${p.tarjeta_aprobacion}`);
      if (p.tarjeta_cuotas)     detalles.push(`${p.tarjeta_cuotas} cuotas`);
    }
    if (p.comprobante_nro) detalles.push(`Comp: ${p.comprobante_nro}`);
    if (!detalles.length) return '';
    return `<div style="font-size:12px;color:var(--text2);margin-top:4px">${detalles.join(' · ')}</div>`;
  }

  // ─────────────────────────────────────────────────────────
  //  Cambio dinámico de campos según método
  // ─────────────────────────────────────────────────────────
  window.cambiarMetodoPago = function() {
    const metodo = document.getElementById('pago-metodo')?.value;
    const cont = document.getElementById('pago-campos-dinamicos');
    if (!cont) return;
    let html = '';

    if (metodo === 'transferencia') {
      html = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><label style="font-size:12px;color:var(--text3)">Banco origen *</label><input id="pago-banco-origen" type="text" placeholder="Ej: Banco Galicia" class="form-input"></div>
          <div><label style="font-size:12px;color:var(--text3)">Banco destino *</label><input id="pago-banco-destino" type="text" placeholder="Ej: Banco Provincia" class="form-input"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><label style="font-size:12px;color:var(--text3)">CBU / Alias destino</label><input id="pago-cbu" type="text" placeholder="0000003100..." class="form-input"></div>
          <div><label style="font-size:12px;color:var(--text3)">N° comprobante</label><input id="pago-comprobante" type="text" placeholder="Ej: 12345678" class="form-input"></div>
        </div>`;
    } else if (metodo === 'cheque') {
      html = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><label style="font-size:12px;color:var(--text3)">N° cheque *</label><input id="pago-cheque-nro" type="text" class="form-input"></div>
          <div><label style="font-size:12px;color:var(--text3)">Banco emisor *</label><input id="pago-cheque-banco" type="text" placeholder="Ej: Banco Nación" class="form-input"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><label style="font-size:12px;color:var(--text3)">Fecha de cobro *</label><input id="pago-cheque-fecha" type="date" class="form-input"></div>
          <div><label style="font-size:12px;color:var(--text3)">A nombre de</label><input id="pago-cheque-nombre" type="text" placeholder="Nombre o razón social" class="form-input"></div>
        </div>`;
    } else if (metodo === 'echeq') {
      html = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><label style="font-size:12px;color:var(--text3)">N° eCheq *</label><input id="pago-echeq-nro" type="text" class="form-input"></div>
          <div><label style="font-size:12px;color:var(--text3)">Banco emisor *</label><input id="pago-echeq-banco" type="text" class="form-input"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><label style="font-size:12px;color:var(--text3)">Fecha de pago *</label><input id="pago-echeq-fecha" type="date" class="form-input"></div>
          <div><label style="font-size:12px;color:var(--text3)">Clave / código</label><input id="pago-echeq-clave" type="text" class="form-input"></div>
        </div>`;
    } else if (metodo === 'tarjeta') {
      html = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><label style="font-size:12px;color:var(--text3)">N° aprobación *</label><input id="pago-tarjeta-aprob" type="text" class="form-input"></div>
          <div><label style="font-size:12px;color:var(--text3)">Cuotas</label><input id="pago-tarjeta-cuotas" type="number" min="1" max="60" value="1" class="form-input"></div>
        </div>`;
    } else if (metodo === 'efectivo' || metodo === 'otro') {
      html = `
        <div style="margin-bottom:12px">
          <label style="font-size:12px;color:var(--text3)">N° comprobante (opcional)</label>
          <input id="pago-comprobante" type="text" class="form-input">
        </div>`;
    }

    cont.innerHTML = html;
  };

  window.guardarPago = async function(poId, facId) {
    const metodo = document.getElementById('pago-metodo')?.value;
    if (!metodo) { showToast('error', 'Seleccioná un método de pago'); return; }
    const monto = document.getElementById('pago-monto')?.value;
    if (!(parseFloat(monto) > 0)) { showToast('error', 'Monto inválido'); return; }

    const body = {
      metodo,
      monto: parseFloat(monto),
      file_url: document.getElementById('pago-url')?.value.trim(),
      notes:    document.getElementById('pago-notes')?.value.trim(),
      comprobante_nro: document.getElementById('pago-comprobante')?.value?.trim(),
    };

    if (metodo === 'transferencia') {
      body.banco_origen      = document.getElementById('pago-banco-origen')?.value.trim();
      body.banco_destino     = document.getElementById('pago-banco-destino')?.value.trim();
      body.cbu_alias_destino = document.getElementById('pago-cbu')?.value.trim();
    } else if (metodo === 'cheque') {
      body.cheque_nro         = document.getElementById('pago-cheque-nro')?.value.trim();
      body.cheque_banco       = document.getElementById('pago-cheque-banco')?.value.trim();
      body.cheque_fecha_cobro = document.getElementById('pago-cheque-fecha')?.value;
      body.cheque_a_nombre    = document.getElementById('pago-cheque-nombre')?.value.trim();
    } else if (metodo === 'echeq') {
      body.echeq_nro        = document.getElementById('pago-echeq-nro')?.value.trim();
      body.echeq_banco      = document.getElementById('pago-echeq-banco')?.value.trim();
      body.echeq_fecha_pago = document.getElementById('pago-echeq-fecha')?.value;
      body.echeq_clave      = document.getElementById('pago-echeq-clave')?.value.trim();
    } else if (metodo === 'tarjeta') {
      body.tarjeta_aprobacion = document.getElementById('pago-tarjeta-aprob')?.value.trim();
      body.tarjeta_cuotas     = document.getElementById('pago-tarjeta-cuotas')?.value;
    }

    try {
      const res = await apiFetch(`/api/purchase-orders/${poId}/facturas/${facId}/pagos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.json();
        showToast('error', err.error || 'Error al registrar pago');
        return;
      }
      const data = await res.json();
      showToast('ok', data.message || 'Pago registrado');
      document.querySelector('.modal-pago-overlay')?.remove();
      // Refrescar panel si está activo
      if (typeof renderTesoreriaPanelInline === 'function' && App.currentPage === 'tesoreria_panel') {
        renderTesoreriaPanelInline();
      }
    } catch (err) {
      console.error(err);
      showToast('error', 'Error al registrar pago');
    }
  };

  window.anularPago = async function(poId, facId, pagoId) {
    if (!confirm('¿Anular este pago?')) return;
    try {
      const res = await apiFetch(`/api/purchase-orders/${poId}/facturas/${facId}/pagos/${pagoId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        showToast('error', err.error || 'Error al anular');
        return;
      }
      showToast('ok', 'Pago anulado');
      document.querySelector('.modal-pago-overlay')?.remove();
      if (typeof renderTesoreriaPanelInline === 'function' && App.currentPage === 'tesoreria_panel') {
        renderTesoreriaPanelInline();
      }
    } catch (err) {
      showToast('error', 'Error al anular');
    }
  };

})();
