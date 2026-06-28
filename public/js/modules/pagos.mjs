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
  const escAttr = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const num = (v) => Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0;
  const totalFacturaConIva = (f) => {
    // Tesorería siempre trabaja sobre el TOTAL FINAL de la factura: neto + IVA.
    if (f && f.total_a_pagar != null) return num(f.total_a_pagar);
    if (f && f.invoice_total != null) return num(f.invoice_total);
    if (f && f.total_con_iva != null) return num(f.total_con_iva);
    const neto = num(f?.invoice_monto);
    const iva  = num(f?.iva_pct);
    return +(neto * (1 + iva / 100)).toFixed(2);
  };

  const pagadoFactura = (f) => num(f?.total_pagado != null ? f.total_pagado : f?.monto_pagado);

  const saldoFactura = (f) => {
    const saldo = +(totalFacturaConIva(f) - pagadoFactura(f)).toFixed(2);
    return Math.max(0, saldo);
  };

  function datosTransferenciaProveedor() {
    const f = window._pagoFacturaActual || {};
    const oc = window._pagoOcActual || {};
    const bancoDestino = f.supplier_bank || oc.supplier_bank || f.supplier_name || oc.supplier_name || oc.proveedor || '';
    const cbuAlias = f.supplier_alias || oc.supplier_alias || f.supplier_cbu || oc.supplier_cbu || '';
    return {
      bancoDestino,
      cbuAlias,
      tieneDatos: !!(f.supplier_bank || oc.supplier_bank || f.supplier_alias || oc.supplier_alias || f.supplier_cbu || oc.supplier_cbu)
    };
  }

  function formaPagoRaw(factura={}, oc={}) {
    return String(
      factura.forma_pago ||
      factura.oc_forma_pago ||
      oc.forma_pago ||
      factura.condicion_forma_pago ||
      factura.supplier_forma_pago ||
      oc.supplier_forma_pago ||
      ''
    ).trim().toLowerCase();
  }

  function normalizarMetodoPagoParaTesoreria(forma, factura={}, oc={}) {
    const fp = String(forma || '').trim().toLowerCase();
    if (!fp) return '';
    if (['transferencia','cheque','echeq','tarjeta','efectivo','otro'].includes(fp)) return fp;
    if (['contado','cash'].includes(fp)) return 'efectivo';
    if (['cuenta_corriente','cc','cta_cte','cta cte','cuenta corriente'].includes(fp)) {
      const t = datosTransferenciaProveedor();
      return t.tieneDatos ? 'transferencia' : '';
    }
    return '';
  }

  function metodoPagoPorDefecto(factura={}, oc={}) {
    return normalizarMetodoPagoParaTesoreria(formaPagoRaw(factura, oc), factura, oc);
  }

  function metodoPagoFuenteTexto(factura={}, oc={}) {
    const tieneFactura = !!factura.forma_pago;
    const tieneOC = !!(factura.oc_forma_pago || oc.forma_pago || factura.condicion_forma_pago);
    const tieneProveedor = !!(factura.supplier_forma_pago || oc.supplier_forma_pago);
    if (tieneFactura) return 'tomado de la factura';
    if (tieneOC) return 'tomado de la OC';
    if (tieneProveedor) return 'tomado del proveedor';
    return '';
  }

  function fechaInput(v) {
    if (!v) return '';
    const s = String(v).slice(0,10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  // ─────────────────────────────────────────────────────────
  //  PANEL TESORERÍA — facturas pendientes
  // ─────────────────────────────────────────────────────────
  function formaPagoLabel(forma, dias) {
    const fp = String(forma || '').toLowerCase();
    const cc = parseInt(dias || 0, 10) || 0;
    if (!fp && cc > 0) return `Cuenta corriente ${cc} días`;
    if (!fp) return 'Sin condición pactada';
    if (fp === 'cuenta_corriente') return cc > 0 ? `Cuenta corriente ${cc} días` : 'Cuenta corriente';
    if (fp === 'transferencia') return 'Transferencia';
    if (fp === 'efectivo') return 'Efectivo';
    if (fp === 'cheque') return 'Cheque físico';
    if (fp === 'echeq') return 'eCheq';
    if (fp === 'tarjeta') return 'Tarjeta';
    if (fp === 'otro') return 'Otro';
    return fp.replace(/_/g, ' ');
  }

  function fechaAR(v) {
    if (!v) return '—';
    try {
      const s = String(v).slice(0,10);
      const [y,m,d] = s.split('-');
      if (y && m && d) return `${d}/${m}/${y}`;
      return new Date(v).toLocaleDateString('es-AR');
    } catch { return '—'; }
  }

  function estadoPagoFactura(f) {
    const saldo = saldoFactura(f);
    const total = totalFacturaConIva(f);
    const pagado = pagadoFactura(f);
    if (saldo <= 0.01 || f.estado_pago_calculado === 'pagada') return 'pagadas';
    if (f.vencida) return 'vencidas';
    if (f.por_vencer) return 'por_vencer';
    if (pagado > 0 && pagado < total) return 'parciales';
    return 'pendientes';
  }

  function badgeEstadoPago(f) {
    const estado = estadoPagoFactura(f);
    if (estado === 'pagadas') return '<span style="background:#dcfce7;color:#166534;border:1px solid #86efac;border-radius:12px;padding:2px 8px;font-size:11px;font-weight:700">Pagada</span>';
    if (estado === 'vencidas') return '<span style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;border-radius:12px;padding:2px 8px;font-size:11px;font-weight:700">Vencida</span>';
    if (estado === 'por_vencer') return '<span style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:12px;padding:2px 8px;font-size:11px;font-weight:700">Por vencer</span>';
    if (estado === 'parciales') return '<span style="background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe;border-radius:12px;padding:2px 8px;font-size:11px;font-weight:700">Pago parcial</span>';
    return '<span style="background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:12px;padding:2px 8px;font-size:11px;font-weight:700">Pendiente</span>';
  }

  function filtrarFacturasTesoreria(facturas, filtro) {
    if (!filtro || filtro === 'todas') return facturas;
    if (filtro === 'no_pagadas') return facturas.filter(f => estadoPagoFactura(f) !== 'pagadas');
    return facturas.filter(f => estadoPagoFactura(f) === filtro);
  }

  function renderTesoreriaFiltroButton(key, label, count, active) {
    return `<button class="btn ${active ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="window._tesFiltroPago='${key}'; renderTesoreriaPanelInline()">${label} <span style="opacity:.8">(${count})</span></button>`;
  }

  // ─────────────────────────────────────────────────────────
  //  PANEL TESORERÍA — facturas con filtros de pago
  // ─────────────────────────────────────────────────────────
  window.renderTesoreriaPanelInline = async function() {
    const page = document.getElementById('page-tesoreria_panel');
    if (!page) return;
    const filtro = window._tesFiltroPago || 'no_pagadas';
    page.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">Cargando tesorería...</div>';

    try {
      const res = await apiFetch('/api/payments/pendientes?filtro=todas&_t=' + Date.now());
      if (!res.ok) {
        page.innerHTML = '<div style="padding:40px;text-align:center;color:var(--danger)">Error al cargar</div>';
        return;
      }

      const todas = await res.json();
      const facturas = filtrarFacturasTesoreria(todas, filtro);

      const noPagadas = todas.filter(f => estadoPagoFactura(f) !== 'pagadas');
      const pagadas   = todas.filter(f => estadoPagoFactura(f) === 'pagadas');
      const parciales = todas.filter(f => estadoPagoFactura(f) === 'parciales');
      const vencidas  = todas.filter(f => estadoPagoFactura(f) === 'vencidas');
      const porVencer = todas.filter(f => estadoPagoFactura(f) === 'por_vencer');
      const pendientes = todas.filter(f => estadoPagoFactura(f) === 'pendientes');

      const totalPendiente = noPagadas.reduce((s, f) => s + saldoFactura(f), 0);
      const totalVencido   = vencidas.reduce((s, f) => s + saldoFactura(f), 0);
      const totalPorVencer = porVencer.reduce((s, f) => s + saldoFactura(f), 0);

      page.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;flex-wrap:wrap">
          <div>
            <h2 style="font-size:20px;font-weight:700;margin:0;color:var(--text)">💳 Tesorería / Pagos</h2>
            <p style="font-size:13px;color:var(--text3);margin:4px 0 0">Facturas de OC con condición pactada, vencimientos, pagos parciales e historial de pagos. Los importes son con IVA incluido.</p>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="renderTesoreriaPanelInline()">↻ Actualizar</button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
          <div class="kpi-card danger"><div class="kpi-label">Vencidas</div><div class="kpi-value">${vencidas.length}</div><div class="kpi-sub">$${fmt(totalVencido)}</div></div>
          <div class="kpi-card warn"><div class="kpi-label">Por vencer (7 días)</div><div class="kpi-value">${porVencer.length}</div><div class="kpi-sub">$${fmt(totalPorVencer)}</div></div>
          <div class="kpi-card info"><div class="kpi-label">No pagadas</div><div class="kpi-value">${noPagadas.length}</div><div class="kpi-sub">$${fmt(totalPendiente)}</div></div>
          <div class="kpi-card ok"><div class="kpi-label">Pagadas</div><div class="kpi-value">${pagadas.length}</div><div class="kpi-sub">histórico</div></div>
        </div>

        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px 14px;margin-bottom:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="font-size:12px;color:var(--text3);font-weight:700;margin-right:4px">Filtro:</span>
          ${renderTesoreriaFiltroButton('no_pagadas', 'No pagadas', noPagadas.length, filtro === 'no_pagadas')}
          ${renderTesoreriaFiltroButton('vencidas', 'Vencidas', vencidas.length, filtro === 'vencidas')}
          ${renderTesoreriaFiltroButton('por_vencer', 'Por vencer', porVencer.length, filtro === 'por_vencer')}
          ${renderTesoreriaFiltroButton('parciales', 'Pago parcial', parciales.length, filtro === 'parciales')}
          ${renderTesoreriaFiltroButton('pendientes', 'Sin pagar', pendientes.length, filtro === 'pendientes')}
          ${renderTesoreriaFiltroButton('pagadas', 'Pagadas', pagadas.length, filtro === 'pagadas')}
          ${renderTesoreriaFiltroButton('todas', 'Todas', todas.length, filtro === 'todas')}
        </div>

        ${facturas.length === 0 ? `
          <div class="card"><div style="padding:60px;text-align:center;color:var(--text3)">No hay facturas para el filtro seleccionado.</div></div>
        ` : `
          <div class="card">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Estado</th>
                    <th>OC</th>
                    <th>Proveedor</th>
                    <th>Factura</th>
                    <th>Condición OC</th>
                    <th>Factura / vencimiento</th>
                    <th style="text-align:right">Total</th>
                    <th style="text-align:right">Pagado</th>
                    <th style="text-align:right">Saldo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${facturas.map(f => {
                    const venc = fechaAR(f.vencimiento);
                    let vencColor = '';
                    let vencLabel = venc;
                    if (f.vencida) { vencColor = 'color:var(--danger);font-weight:700'; vencLabel = venc + ' ⚠'; }
                    else if (f.por_vencer) { vencColor = 'color:var(--warn);font-weight:700'; }
                    const condicionOC = formaPagoLabel(f.oc_forma_pago || f.condicion_forma_pago || f.forma_pago, f.oc_cc_dias ?? f.condicion_cc_dias ?? f.cc_dias);
                    const condicionFactura = formaPagoLabel(f.forma_pago || f.oc_forma_pago, f.cc_dias ?? f.oc_cc_dias);
                    const accion = estadoPagoFactura(f) === 'pagadas' ? 'Ver pagos' : '💳 Pagar';
                    return `
                    <tr>
                      <td>${badgeEstadoPago(f)}</td>
                      <td class="td-mono">${escapeHtml(f.po_code || '—')}</td>
                      <td>
                        <div style="font-weight:600">${escapeHtml(f.supplier_name || f.proveedor || '—')}</div>
                        ${f.supplier_cuit ? `<div style="font-size:10px;color:var(--text3)">CUIT ${escapeHtml(f.supplier_cuit)}</div>` : ''}
                      </td>
                      <td>
                        <div class="td-mono">${escapeHtml(f.invoice_nro || '—')}</div>
                        <div style="font-size:10px;color:var(--text3)">${fechaAR(f.invoice_fecha)}</div>
                      </td>
                      <td>
                        <div style="font-weight:600">${condicionOC}</div>
                        <div style="font-size:10px;color:var(--text3)">Pactada por Compras en la OC</div>
                      </td>
                      <td>
                        <div style="${vencColor}">${vencLabel}</div>
                        <div style="font-size:10px;color:var(--text3)">Factura: ${condicionFactura}</div>
                      </td>
                      <td style="text-align:right">$${fmt(totalFacturaConIva(f))}</td>
                      <td style="text-align:right;color:${pagadoFactura(f)>0?'var(--ok)':'var(--text3)'}">$${fmt(pagadoFactura(f))}</td>
                      <td style="text-align:right;color:${saldoFactura(f)>0.01?'var(--warn)':'var(--ok)'};font-weight:700">$${fmt(saldoFactura(f))}</td>
                      <td style="text-align:center">
                        <button class="btn btn-primary btn-sm" onclick="abrirModalPago('${f.po_id}','${f.id}')">${accion}</button>
                      </td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `}
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
    window._pagoFacturaActual = factura;
    window._pagoOcActual = oc;
    window._pagoPagosActual = pagos; // para el comprobante imprimible (recibos.mjs)
    window._pagoIds = { poId, facId }; // para enviar el comprobante por mail
    document.querySelector('.modal-pago-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'modal-pago-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(15,23,42,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const totalFac = totalFacturaConIva(factura);
    const totalPagado = pagadoFactura(factura);
    const saldo = saldoFactura(factura);
    const pagada = saldo <= 0.01;
    const metodoDefault = metodoPagoPorDefecto(factura, oc);
    const fuenteMetodoDefault = metodoPagoFuenteTexto(factura, oc);
    const condicionOC = formaPagoLabel(
      oc.forma_pago || factura.oc_forma_pago || factura.condicion_forma_pago || factura.supplier_forma_pago || oc.supplier_forma_pago || factura.forma_pago,
      oc.cc_dias ?? factura.oc_cc_dias ?? factura.condicion_cc_dias ?? factura.supplier_cc_dias ?? oc.supplier_cc_dias ?? factura.cc_dias
    );
    const condicionFactura = formaPagoLabel(
      factura.forma_pago || oc.forma_pago || factura.supplier_forma_pago || oc.supplier_forma_pago,
      factura.cc_dias ?? oc.cc_dias ?? factura.supplier_cc_dias ?? oc.supplier_cc_dias
    );
    const vencimientoFactura = factura.vencimiento ? fechaAR(factura.vencimiento) : '—';
    const diasVenc = factura.dias_vencimiento;
    let vencimientoDetalle = vencimientoFactura;
    if (factura.vencida) vencimientoDetalle += ' · VENCIDA';
    else if (factura.por_vencer) vencimientoDetalle += ' · por vencer';
    else if (diasVenc != null && !Number.isNaN(parseInt(diasVenc,10))) vencimientoDetalle += ` · faltan ${parseInt(diasVenc,10)} días`;

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:900px;width:100%;max-height:90vh;overflow-y:auto;color:var(--text);border:1px solid var(--border2);box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="padding:20px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#fff;z-index:10">
          <div>
            <div style="font-size:18px;font-weight:700">💳 Pago · Factura ${escapeHtml(factura.invoice_nro)}</div>
            <div style="font-size:13px;color:var(--text3);margin-top:4px">${escapeHtml(oc.code)} · ${escapeHtml(oc.proveedor || '—')}</div>
          </div>
          <button onclick="this.closest('.modal-pago-overlay').remove()" style="background:transparent;border:none;color:var(--text3);font-size:28px;cursor:pointer;line-height:1">×</button>
        </div>

        <div style="padding:20px">
          <!-- Resumen factura -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
            <div style="background:var(--bg2);padding:10px;border-radius:6px;border:1px solid var(--border2)">
              <div style="font-size:11px;color:var(--text3);text-transform:uppercase">Total a pagar con IVA</div>
              <div style="font-size:18px;font-weight:600">$${fmt(totalFac)}</div>
              <div style="font-size:10px;color:var(--text3);margin-top:2px">Neto $${fmt(factura.invoice_monto)} · IVA ${fmt(factura.iva_pct || 0)}%</div>
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

          <div style="background:#f8fafc;border:1px solid var(--border2);border-radius:8px;padding:14px;margin-bottom:16px">
            <div style="font-weight:700;margin-bottom:8px;color:var(--text)">📌 Condición pactada y vencimiento</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:12px">
              <div>
                <div style="color:var(--text3);text-transform:uppercase;font-size:10px">Condición pactada en OC</div>
                <div style="font-weight:700">${condicionOC}</div>
              </div>
              <div>
                <div style="color:var(--text3);text-transform:uppercase;font-size:10px">Condición de esta factura</div>
                <div style="font-weight:700">${condicionFactura}</div>
              </div>
              <div>
                <div style="color:var(--text3);text-transform:uppercase;font-size:10px">Vencimiento</div>
                <div style="font-weight:700;color:${factura.vencida ? 'var(--danger)' : factura.por_vencer ? 'var(--warn)' : 'var(--text)'}">${vencimientoDetalle}</div>
              </div>
            </div>
            <div style="font-size:11px;color:var(--text3);margin-top:8px">Tesorería registra el pago según la condición que Compras dejó pactada en la OC. Si la factura trae otros días, se muestra separado para control.</div>
          </div>

          ${!pagada ? `
          <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:16px;margin-bottom:16px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px;flex-wrap:wrap">
              <div style="font-weight:600">+ Registrar nuevo pago</div>
              <div style="display:flex;gap:4px">
                <button type="button" id="pago-tab-simple" class="btn btn-sm btn-primary" onclick="togglePagoModo('simple')">Simple</button>
                <button type="button" id="pago-tab-combinado" class="btn btn-sm btn-secondary" onclick="togglePagoModo('combinado')">Combinado (varios cheques/efectivo)</button>
              </div>
            </div>

            <div id="pago-simple-wrap">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
              <div>
                <label style="font-size:12px;color:var(--text3)">Método de pago *</label>
                <select id="pago-metodo" class="form-select" onchange="cambiarMetodoPago()">
                  <option value="" ${!metodoDefault ? 'selected' : ''}>— Seleccionar —</option>
                  <option value="efectivo" ${metodoDefault==='efectivo'?'selected':''}>Efectivo</option>
                  <option value="transferencia" ${metodoDefault==='transferencia'?'selected':''}>Transferencia</option>
                  <option value="cheque" ${metodoDefault==='cheque'?'selected':''}>Cheque físico</option>
                  <option value="echeq" ${metodoDefault==='echeq'?'selected':''}>eCheq</option>
                  <option value="tarjeta" ${metodoDefault==='tarjeta'?'selected':''}>Tarjeta</option>
                  <option value="otro" ${metodoDefault==='otro'?'selected':''}>Otro</option>
                </select>
                ${metodoDefault && fuenteMetodoDefault ? `<div style="font-size:10px;color:var(--ok);margin-top:3px">Método sugerido ${fuenteMetodoDefault}. Podés cambiarlo si Tesorería paga de otra forma.</div>` : `<div style="font-size:10px;color:var(--text3);margin-top:3px">No hay método claro en proveedor/OC. Seleccionalo manualmente.</div>`}
              </div>
              <div>
                <label style="font-size:12px;color:var(--text3)">Monto a pagar * <span style="color:var(--text3)">(saldo con IVA: $${fmt(saldo)})</span></label>
                <input id="pago-monto" type="number" step="0.01" min="0" max="${saldo}" value="${saldo.toFixed(2)}" placeholder="${fmt(saldo)}" class="form-input">
                <div style="font-size:10px;color:var(--text3);margin-top:3px">El saldo se calcula con IVA incluido.</div>
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
            </div><!-- /pago-simple-wrap -->

            <div id="pago-combinado-wrap" style="display:none">
              <div style="font-size:12px;color:var(--text3);margin-bottom:10px">Cargá varios instrumentos (cheques, e-cheqs, efectivo…). El total no puede superar el saldo. Cada cheque/e-cheq queda registrado individualmente.</div>
              <div id="pci-list"></div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0">
                <button type="button" class="btn btn-secondary btn-sm" onclick="pciAgregar('cheque')">+ Cheque</button>
                <button type="button" class="btn btn-secondary btn-sm" onclick="pciAgregar('echeq')">+ eCheq</button>
                <button type="button" class="btn btn-secondary btn-sm" onclick="pciAgregar('efectivo')">+ Efectivo</button>
                <button type="button" class="btn btn-secondary btn-sm" onclick="pciAgregar('transferencia')">+ Transferencia</button>
                <button type="button" class="btn btn-ghost btn-sm" onclick="pciCompletarEfectivo()" title="Agrega una línea de efectivo por lo que falta para llegar al saldo">⚡ Completar con efectivo</button>
              </div>
              <div id="pci-resumen" style="background:var(--bg2);border:1px solid var(--border2);border-radius:6px;padding:10px;font-size:13px;margin-bottom:10px"></div>
              <div style="margin-bottom:12px">
                <label style="font-size:12px;color:var(--text3)">Observaciones (opcional)</label>
                <textarea id="pci-notes" rows="2" class="form-input" style="resize:vertical"></textarea>
              </div>
              <button class="btn btn-primary" onclick="guardarPagoCombinado('${poId}','${facId}')">✓ Registrar pago combinado</button>
            </div>
          </div>
          ` : (pagada ? '<div style="background:#dcfce7;color:#166534;padding:12px;border-radius:6px;margin-bottom:16px;text-align:center;font-weight:600">✓ Factura cancelada totalmente</div>' : '')}

          ${pagos.length ? `
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <div style="font-weight:600">Historial de pagos (${pagos.length})</div>
              <div style="display:flex;gap:6px">
                <button onclick="imprimirReciboPago()" class="btn btn-secondary btn-sm">🖨 Imprimir comprobante</button>
                <button onclick="enviarReciboPagoMail()" class="btn btn-secondary btn-sm">✉ Enviar al proveedor</button>
              </div>
            </div>
            ${pagos.map(p => {
              const role = window.App?.currentUser?.role;
              const userId = window.App?.currentUser?.id;
              const puedeAnular = ['dueno','gerencia'].includes(role) || p.paid_by === userId;
              return `
              <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:12px;margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
                  <div style="flex:1">
                    <div style="font-weight:600">💰 $${fmt(p.monto)} · ${p.metodo.toUpperCase()}</div>
                    <div style="font-size:12px;color:var(--text3)">${new Date(p.paid_at).toLocaleString('es-AR')} · por ${escapeHtml(p.paid_by_name || '—')}</div>
                    ${detallePago(p)}
                    ${p.file_url ? `<div style="font-size:12px;margin-top:4px"><a href="${escapeHtml(p.file_url)}" target="_blank" style="color:var(--accent)">📎 Ver comprobante</a></div>` : ''}
                    ${p.notes ? `<div style="font-size:12px;color:var(--text3);margin-top:4px;font-style:italic">${escapeHtml(p.notes)}</div>` : ''}
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
    setTimeout(() => {
      if (document.getElementById('pago-metodo')?.value) cambiarMetodoPago();
    }, 0);
  }

  function detallePago(p) {
    let detalles = [];
    if (p.metodo === 'transferencia') {
      if (p.banco_origen)  detalles.push(`Origen: ${escapeHtml(p.banco_origen)}`);
      if (p.banco_destino) detalles.push(`Destino: ${escapeHtml(p.banco_destino)}`);
      if (p.cbu_alias_destino) detalles.push(`CBU/Alias: ${escapeHtml(p.cbu_alias_destino)}`);
    } else if (p.metodo === 'cheque') {
      if (p.cheque_nro)         detalles.push(`N° ${escapeHtml(p.cheque_nro)}`);
      if (p.cheque_banco)       detalles.push(`Banco: ${escapeHtml(p.cheque_banco)}`);
      if (p.cheque_fecha_cobro) detalles.push(`Fecha: ${new Date(p.cheque_fecha_cobro).toLocaleDateString('es-AR')}`);
      if (p.cheque_a_nombre)    detalles.push(`A nombre de: ${escapeHtml(p.cheque_a_nombre)}`);
    } else if (p.metodo === 'echeq') {
      if (p.echeq_nro)        detalles.push(`N° ${escapeHtml(p.echeq_nro)}`);
      if (p.echeq_banco)      detalles.push(`Banco: ${escapeHtml(p.echeq_banco)}`);
      if (p.echeq_fecha_pago) detalles.push(`Fecha: ${new Date(p.echeq_fecha_pago).toLocaleDateString('es-AR')}`);
    } else if (p.metodo === 'tarjeta') {
      if (p.tarjeta_aprobacion) detalles.push(`Aprobación: ${escapeHtml(p.tarjeta_aprobacion)}`);
      if (p.tarjeta_cuotas)     detalles.push(`${p.tarjeta_cuotas} cuotas`);
    }
    if (p.comprobante_nro) detalles.push(`Comp: ${escapeHtml(p.comprobante_nro)}`);
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
      const t = datosTransferenciaProveedor();
      html = `
        ${t.tieneDatos ? '<div style="font-size:12px;color:var(--ok);margin-bottom:8px">✓ Datos bancarios tomados del proveedor cargado en la OC.</div>' : '<div style="font-size:12px;color:var(--warn);margin-bottom:8px">⚠ No hay banco/CBU/Alias cargado en Proveedores. Podés completarlo manualmente acá.</div>'}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><label style="font-size:12px;color:var(--text3)">Banco origen *</label><input id="pago-banco-origen" type="text" placeholder="Ej: Banco Galicia" class="form-input"></div>
          <div><label style="font-size:12px;color:var(--text3)">Banco destino *</label><input id="pago-banco-destino" type="text" value="${escAttr(t.bancoDestino)}" placeholder="Banco del proveedor" class="form-input"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><label style="font-size:12px;color:var(--text3)">CBU / Alias destino</label><input id="pago-cbu" type="text" value="${escAttr(t.cbuAlias)}" placeholder="CBU o Alias del proveedor" class="form-input"></div>
          <div><label style="font-size:12px;color:var(--text3)">N° comprobante</label><input id="pago-comprobante" type="text" placeholder="Ej: 12345678" class="form-input"></div>
        </div>`;
    } else if (metodo === 'cheque') {
      html = `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
          <div><label style="font-size:12px;color:var(--text3)">Banco *</label><input id="pago-cheque-banco" type="text" value="${escAttr((window._pagoFacturaActual||{}).supplier_bank || (window._pagoOcActual||{}).supplier_bank || '')}" placeholder="Ej: Banco Nación" class="form-input"></div>
          <div><label style="font-size:12px;color:var(--text3)">N° cheque *</label><input id="pago-cheque-nro" type="text" class="form-input"></div>
          <div><label style="font-size:12px;color:var(--text3)">Fecha de pago del cheque *</label><input id="pago-cheque-fecha" type="date" value="${fechaInput((window._pagoFacturaActual||{}).vencimiento)}" class="form-input"></div>
        </div>`;
    } else if (metodo === 'echeq') {
      html = `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
          <div><label style="font-size:12px;color:var(--text3)">Banco *</label><input id="pago-echeq-banco" type="text" value="${escAttr((window._pagoFacturaActual||{}).supplier_bank || (window._pagoOcActual||{}).supplier_bank || '')}" class="form-input"></div>
          <div><label style="font-size:12px;color:var(--text3)">N° eCheq *</label><input id="pago-echeq-nro" type="text" class="form-input"></div>
          <div><label style="font-size:12px;color:var(--text3)">Fecha de pago del eCheq *</label><input id="pago-echeq-fecha" type="date" value="${fechaInput((window._pagoFacturaActual||{}).vencimiento)}" class="form-input"></div>
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
    } else if (metodo === 'echeq') {
      body.echeq_nro        = document.getElementById('pago-echeq-nro')?.value.trim();
      body.echeq_banco      = document.getElementById('pago-echeq-banco')?.value.trim();
      body.echeq_fecha_pago = document.getElementById('pago-echeq-fecha')?.value;
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
      if (typeof renderTesoreriaPanelInline === 'function' && window.App.currentPage === 'tesoreria_panel') {
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
      if (typeof renderTesoreriaPanelInline === 'function' && window.App.currentPage === 'tesoreria_panel') {
        renderTesoreriaPanelInline();
      }
    } catch (err) {
      showToast('error', 'Error al anular');
    }
  };

  // ─────────────────────────────────────────────────────────────
  //  PAGO COMBINADO — varios instrumentos (cheques/echeqs/efectivo) juntos
  // ─────────────────────────────────────────────────────────────
  let _pciSeq = 0;

  window.togglePagoModo = function(modo) {
    const sw = document.getElementById('pago-simple-wrap');
    const cw = document.getElementById('pago-combinado-wrap');
    const ts = document.getElementById('pago-tab-simple');
    const tc = document.getElementById('pago-tab-combinado');
    if (!sw || !cw) return;
    const comb = modo === 'combinado';
    sw.style.display = comb ? 'none' : '';
    cw.style.display = comb ? '' : 'none';
    if (ts) ts.className = 'btn btn-sm ' + (comb ? 'btn-secondary' : 'btn-primary');
    if (tc) tc.className = 'btn btn-sm ' + (comb ? 'btn-primary' : 'btn-secondary');
    if (comb && !document.querySelector('#pci-list .pci-row')) pciAgregar('cheque');
    pciRecalcular();
  };

  function pciCamposHTML(idx, metodo) {
    const supplierBank = escAttr((window._pagoFacturaActual||{}).supplier_bank || (window._pagoOcActual||{}).supplier_bank || '');
    const vencInput = fechaInput((window._pagoFacturaActual||{}).vencimiento);
    if (metodo === 'cheque') {
      return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:6px">
          <div><label style="font-size:11px;color:var(--text3)">Banco *</label><input id="pci-cheque-banco-${idx}" type="text" value="${supplierBank}" placeholder="Ej: Banco Nación" class="form-input"></div>
          <div><label style="font-size:11px;color:var(--text3)">N° cheque *</label><input id="pci-cheque-nro-${idx}" type="text" class="form-input"></div>
          <div><label style="font-size:11px;color:var(--text3)">Fecha de pago *</label><input id="pci-cheque-fecha-${idx}" type="date" value="${vencInput}" class="form-input"></div>
        </div>`;
    }
    if (metodo === 'echeq') {
      return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:6px">
          <div><label style="font-size:11px;color:var(--text3)">Banco *</label><input id="pci-echeq-banco-${idx}" type="text" value="${supplierBank}" class="form-input"></div>
          <div><label style="font-size:11px;color:var(--text3)">N° eCheq *</label><input id="pci-echeq-nro-${idx}" type="text" class="form-input"></div>
          <div><label style="font-size:11px;color:var(--text3)">Fecha de pago *</label><input id="pci-echeq-fecha-${idx}" type="date" value="${vencInput}" class="form-input"></div>
        </div>`;
    }
    if (metodo === 'transferencia') {
      const t = datosTransferenciaProveedor();
      return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">
          <div><label style="font-size:11px;color:var(--text3)">Banco origen *</label><input id="pci-banco-origen-${idx}" type="text" class="form-input"></div>
          <div><label style="font-size:11px;color:var(--text3)">Banco destino</label><input id="pci-banco-destino-${idx}" type="text" value="${escAttr(t.bancoDestino)}" class="form-input"></div>
        </div>`;
    }
    return '';
  }

  window.pciMetodoCampos = function(idx) {
    const sel = document.getElementById('pci-metodo-' + idx);
    const cont = document.getElementById('pci-campos-' + idx);
    if (sel && cont) cont.innerHTML = pciCamposHTML(idx, sel.value);
    pciRecalcular();
  };

  window.pciAgregar = function(metodo, montoSugerido) {
    const list = document.getElementById('pci-list');
    if (!list) return;
    const idx = ++_pciSeq;
    const row = document.createElement('div');
    row.className = 'pci-row';
    row.id = 'pci-row-' + idx;
    row.style.cssText = 'border:1px solid var(--border2);border-radius:8px;padding:10px;margin-bottom:8px;background:#fff';
    row.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end">
        <div>
          <label style="font-size:11px;color:var(--text3)">Método</label>
          <select id="pci-metodo-${idx}" class="form-select" onchange="pciMetodoCampos(${idx})">
            <option value="cheque" ${metodo==='cheque'?'selected':''}>Cheque físico</option>
            <option value="echeq" ${metodo==='echeq'?'selected':''}>eCheq</option>
            <option value="efectivo" ${metodo==='efectivo'?'selected':''}>Efectivo</option>
            <option value="transferencia" ${metodo==='transferencia'?'selected':''}>Transferencia</option>
            <option value="otro" ${metodo==='otro'?'selected':''}>Otro</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--text3)">Monto *</label>
          <input id="pci-monto-${idx}" type="number" step="0.01" min="0" value="${montoSugerido != null ? Number(montoSugerido).toFixed(2) : ''}" class="form-input" oninput="pciRecalcular()">
        </div>
        <button type="button" class="btn btn-ghost btn-sm" onclick="pciQuitar(${idx})" style="color:var(--danger)" title="Quitar">✕</button>
      </div>
      <div id="pci-campos-${idx}"></div>`;
    list.appendChild(row);
    pciMetodoCampos(idx);
  };

  window.pciQuitar = function(idx) {
    document.getElementById('pci-row-' + idx)?.remove();
    pciRecalcular();
  };

  function pciLeerInstrumentos() {
    const items = [];
    document.querySelectorAll('#pci-list .pci-row').forEach(r => {
      const idx = r.id.replace('pci-row-', '');
      const metodo = document.getElementById('pci-metodo-' + idx)?.value;
      const it = { metodo, monto: parseFloat(document.getElementById('pci-monto-' + idx)?.value) };
      if (metodo === 'cheque') {
        it.cheque_banco = document.getElementById('pci-cheque-banco-' + idx)?.value.trim();
        it.cheque_nro = document.getElementById('pci-cheque-nro-' + idx)?.value.trim();
        it.cheque_fecha_cobro = document.getElementById('pci-cheque-fecha-' + idx)?.value;
      } else if (metodo === 'echeq') {
        it.echeq_banco = document.getElementById('pci-echeq-banco-' + idx)?.value.trim();
        it.echeq_nro = document.getElementById('pci-echeq-nro-' + idx)?.value.trim();
        it.echeq_fecha_pago = document.getElementById('pci-echeq-fecha-' + idx)?.value;
      } else if (metodo === 'transferencia') {
        it.banco_origen = document.getElementById('pci-banco-origen-' + idx)?.value.trim();
        it.banco_destino = document.getElementById('pci-banco-destino-' + idx)?.value.trim();
      }
      items.push(it);
    });
    return items;
  }

  window.pciRecalcular = function() {
    const resumen = document.getElementById('pci-resumen');
    if (!resumen) return;
    const saldo = saldoFactura(window._pagoFacturaActual || {});
    const items = pciLeerInstrumentos();
    const total = +(items.reduce((s, it) => s + (parseFloat(it.monto) || 0), 0)).toFixed(2);
    const dif = +(saldo - total).toFixed(2);
    const difColor = Math.abs(dif) <= 0.01 ? 'var(--ok)' : (dif < 0 ? 'var(--danger)' : 'var(--warn)');
    const difLabel = Math.abs(dif) <= 0.01 ? 'Cubre el saldo exacto ✓' : (dif < 0 ? `Excede el saldo en $${fmt(Math.abs(dif))}` : `Falta $${fmt(dif)} para cubrir el saldo`);
    resumen.innerHTML = `
      <div style="display:flex;justify-content:space-between"><span>Saldo de la factura:</span><b>$${fmt(saldo)}</b></div>
      <div style="display:flex;justify-content:space-between"><span>Total instrumentos (${items.length}):</span><b>$${fmt(total)}</b></div>
      <div style="display:flex;justify-content:space-between;color:${difColor}"><span>Diferencia:</span><b>${difLabel}</b></div>`;
  };

  window.pciCompletarEfectivo = function() {
    const saldo = saldoFactura(window._pagoFacturaActual || {});
    const items = pciLeerInstrumentos();
    const total = items.reduce((s, it) => s + (parseFloat(it.monto) || 0), 0);
    const falta = +(saldo - total).toFixed(2);
    if (falta <= 0.01) { showToast('ok', 'El saldo ya está cubierto'); return; }
    pciAgregar('efectivo', falta);
  };

  window.guardarPagoCombinado = async function(poId, facId) {
    const items = pciLeerInstrumentos();
    if (!items.length) { showToast('error', 'Agregá al menos un instrumento'); return; }
    for (let i = 0; i < items.length; i++) {
      if (!(parseFloat(items[i].monto) > 0)) { showToast('error', `Instrumento ${i+1}: monto inválido`); return; }
    }
    const saldo = saldoFactura(window._pagoFacturaActual || {});
    const total = +(items.reduce((s, it) => s + parseFloat(it.monto), 0)).toFixed(2);
    if (total > saldo + 0.01) { showToast('error', `El total ($${fmt(total)}) supera el saldo ($${fmt(saldo)})`); return; }
    const body = { instrumentos: items, notes: document.getElementById('pci-notes')?.value.trim() };
    try {
      const res = await apiFetch(`/api/purchase-orders/${poId}/facturas/${facId}/pagos-multiple`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (!res.ok) { const err = await res.json(); showToast('error', err.error || 'Error al registrar el pago combinado'); return; }
      const data = await res.json();
      showToast('ok', data.message || 'Pago combinado registrado');
      document.querySelector('.modal-pago-overlay')?.remove();
      if (typeof renderTesoreriaPanelInline === 'function' && window.App.currentPage === 'tesoreria_panel') renderTesoreriaPanelInline();
    } catch (err) {
      console.error(err);
      showToast('error', 'Error al registrar el pago combinado');
    }
  };

})();
