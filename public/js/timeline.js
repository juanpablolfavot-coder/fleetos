// ═══════════════════════════════════════════════════════════
//  FleetOS — Timeline mejorado para OC
//  Después que se abre el modal de OC, agrega secciones de
//  recepciones, facturas y pagos a la trazabilidad existente.
// ═══════════════════════════════════════════════════════════

(function() {
  // Detectar cuando se abre el modal de OC
  const observer = new MutationObserver(async () => {
    // Buscar el bloque de Trazabilidad que ya está en el DOM
    const cards = document.querySelectorAll('.card');
    for (const card of cards) {
      const header = card.querySelector('div[style*="text-transform:uppercase"]');
      if (header && header.textContent.includes('Trazabilidad') && !card.dataset.timelineExtended) {
        card.dataset.timelineExtended = '1';
        // Buscar el ID de la OC del modal abierto
        const poId = extractPOId();
        if (poId) {
          await enriquecerTimeline(card, poId);
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function extractPOId() {
    // Estrategia 1: leer del título del modal
    const titulo = document.querySelector('.modal-title, [id*="modal-title"]');
    // Estrategia 2: del último onclick
    const buttons = document.querySelectorAll('button[onclick*="po-detail"], button[onclick*="openPODetail"]');
    // Estrategia 3: leer de la variable global de App
    if (window.App?.currentPODetailId) return window.App.currentPODetailId;

    // Mejor estrategia: capturar el id desde el href del PDF/print
    const printBtn = document.querySelector('button[onclick*="printPO"]');
    if (printBtn) {
      const m = printBtn.getAttribute('onclick').match(/printPO\('([^']+)'\)/);
      if (m) return m[1];
    }
    return null;
  }

  const fmt = (n) => parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d) => d ? new Date(d).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';

  async function enriquecerTimeline(card, poId) {
    try {
      const [recRes, facRes] = await Promise.all([
        apiFetch(`/api/purchase-orders/${poId}/recepciones`).catch(() => null),
        apiFetch(`/api/purchase-orders/${poId}/facturas`).catch(() => null),
      ]);
      const recepciones = (recRes && recRes.ok) ? await recRes.json() : [];
      const facturas    = (facRes && facRes.ok) ? await facRes.json() : [];

      // Para cada factura, traer pagos
      const pagosByFactura = {};
      for (const f of facturas) {
        try {
          const r = await apiFetch(`/api/purchase-orders/${poId}/facturas/${f.id}/pagos`);
          if (r.ok) pagosByFactura[f.id] = await r.json();
        } catch {}
      }

      // Si no hay datos, igual intentamos actualizar los puntos PAGÓ y RECIBIÓ del timeline existente
      if (recepciones.length || facturas.length) {
        // Actualizar puntos del timeline (PAGÓ y RECIBIÓ) si están vacíos pero ya hay datos en flujo nuevo
        const points = card.querySelectorAll('div[style*="border-radius:50%"]');
        const labels = card.querySelectorAll('div[style*="text-transform:uppercase"]');
        labels.forEach(lbl => {
          const txt = lbl.textContent.trim().toUpperCase();
          const point = lbl.parentElement?.previousElementSibling;
          const valueDiv = lbl.nextElementSibling;
          const fechaDiv = lbl.parentElement?.parentElement?.lastElementChild;
          if (txt === 'PAGÓ' && facturas.length) {
            const todasPagadas = facturas.every(f => f.pagada);
            const algunaPagada = facturas.some(f => parseFloat(f.monto_pagado||0) > 0);
            if (todasPagadas || algunaPagada) {
              if (point) point.style.background = 'var(--accent)';
              if (valueDiv) {
                valueDiv.style.fontWeight = '600';
                valueDiv.style.color = 'var(--text)';
                valueDiv.textContent = todasPagadas ? '✓ Todas las facturas pagadas' : 'Pago parcial';
              }
            }
          }
          if (txt === 'RECIBIÓ' && recepciones.length) {
            if (point) point.style.background = 'var(--accent)';
            if (valueDiv) {
              valueDiv.style.fontWeight = '600';
              valueDiv.style.color = 'var(--text)';
              valueDiv.textContent = `${recepciones.length} recepción${recepciones.length>1?'es':''}`;
            }
            if (fechaDiv && recepciones[0].received_at) {
              fechaDiv.textContent = fmtDate(recepciones[0].received_at);
            }
          }
        });
      }
      if (!recepciones.length && !facturas.length) return; // nada más que sumar

      const html = `
        <div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--border)">

          ${recepciones.length ? `
          <div style="margin-bottom:12px">
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">📦 Recepciones (${recepciones.length})</div>
            ${recepciones.map(r => `
              <div style="display:flex;align-items:start;gap:10px;padding:6px 0;border-left:2px solid var(--ok);padding-left:10px;margin-bottom:6px">
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600">${r.destino || '—'}${r.remito_nro ? ' · Remito '+r.remito_nro : ''}</div>
                  <div style="font-size:11px;color:var(--text3)">por ${r.received_by_name || '—'} · ${fmtDate(r.received_at)}</div>
                  ${(r.items || []).length ? `<div style="font-size:12px;color:var(--text2);margin-top:3px">${r.items.map(it => `${it.descripcion}: <strong>${parseFloat(it.cantidad).toFixed(2)} ${it.unidad||''}</strong>`).join(' · ')}</div>` : ''}
                  ${r.notes ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;font-style:italic">${r.notes}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>` : ''}

          ${facturas.length ? `
          <div style="margin-bottom:8px">
            <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">📄 Facturas (${facturas.length})</div>
            ${facturas.map(f => {
              const pagos = pagosByFactura[f.id] || [];
              const venc = f.vencimiento ? new Date(f.vencimiento).toLocaleDateString('es-AR') : '—';
              const hoy = new Date(); hoy.setHours(0,0,0,0);
              const vDate = f.vencimiento ? new Date(f.vencimiento) : null;
              const vencida = vDate && vDate < hoy && !f.pagada;
              const borderColor = f.pagada ? 'var(--ok)' : (vencida ? 'var(--danger)' : 'var(--warn)');
              return `
                <div style="border-left:2px solid ${borderColor};padding-left:10px;margin-bottom:8px">
                  <div style="font-size:13px;font-weight:600">${f.invoice_nro} · $${fmt(f.invoice_monto)}${f.pagada?' <span style="color:var(--ok);font-size:11px">✓ PAGADA</span>':(vencida?' <span style="color:var(--danger);font-size:11px">⚠ VENCIDA</span>':'')}</div>
                  <div style="font-size:11px;color:var(--text3)">Fecha ${new Date(f.invoice_fecha).toLocaleDateString('es-AR')} · Vence ${venc} · ${f.forma_pago||'—'}${f.cc_dias?' '+f.cc_dias+'d':''}</div>
                  <div style="font-size:11px;color:var(--text3)">Cargada por ${f.uploaded_by_name||'—'}</div>

                  ${pagos.length ? `
                    <div style="margin-top:6px;margin-left:8px;border-left:1px dashed var(--border2);padding-left:8px">
                      ${pagos.map(p => `
                        <div style="font-size:12px;padding:3px 0">
                          <strong style="color:var(--ok)">💰 $${fmt(p.monto)}</strong> · ${p.metodo}${p.comprobante_nro?' #'+p.comprobante_nro:''}
                          <div style="font-size:11px;color:var(--text3)">${p.paid_by_name||'—'} · ${fmtDate(p.paid_at)}</div>
                          ${detallesPago(p)}
                        </div>
                      `).join('')}
                    </div>
                  ` : '<div style="font-size:11px;color:var(--warn);margin-top:3px">Sin pagos registrados</div>'}
                </div>
              `;
            }).join('')}
          </div>` : ''}

        </div>
      `;

      card.insertAdjacentHTML('beforeend', html);
    } catch (err) {
      console.error('[timeline]', err);
    }
  }

  function detallesPago(p) {
    const d = [];
    if (p.metodo === 'transferencia') {
      if (p.banco_origen)      d.push(`Origen: ${p.banco_origen}`);
      if (p.banco_destino)     d.push(`Destino: ${p.banco_destino}`);
      if (p.cbu_alias_destino) d.push(`CBU/Alias: ${p.cbu_alias_destino}`);
    } else if (p.metodo === 'cheque') {
      if (p.cheque_nro)         d.push(`Cheque N° ${p.cheque_nro}`);
      if (p.cheque_banco)       d.push(`${p.cheque_banco}`);
      if (p.cheque_fecha_cobro) d.push(`Cobro: ${new Date(p.cheque_fecha_cobro).toLocaleDateString('es-AR')}`);
    } else if (p.metodo === 'echeq') {
      if (p.echeq_nro)        d.push(`eCheq N° ${p.echeq_nro}`);
      if (p.echeq_banco)      d.push(`${p.echeq_banco}`);
      if (p.echeq_fecha_pago) d.push(`Fecha: ${new Date(p.echeq_fecha_pago).toLocaleDateString('es-AR')}`);
    } else if (p.metodo === 'tarjeta') {
      if (p.tarjeta_aprobacion) d.push(`Aprob: ${p.tarjeta_aprobacion}`);
      if (p.tarjeta_cuotas)     d.push(`${p.tarjeta_cuotas} cuotas`);
    }
    if (!d.length) return '';
    return `<div style="font-size:11px;color:var(--text2);margin-left:6px">${d.join(' · ')}</div>`;
  }

})();
