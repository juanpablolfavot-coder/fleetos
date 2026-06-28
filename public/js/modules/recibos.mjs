// ════════════════════════════════════════════════════════════════════
//  COMPROBANTE DE PAGO (ES module, Fase 3) — recibo consolidado por factura.
//
//  Genera un comprobante imprimible con TODOS los pagos de una factura (para
//  entregar/archivar como constancia para el proveedor). Usa los datos que el
//  modal de pago ya dejó en window (_pagoFacturaActual / _pagoOcActual /
//  _pagoPagosActual), así no re-consulta el backend.
//
//  Imprime con el patrón de ticket del sistema: abre una ventana con el HTML
//  del comprobante y dispara window.print(). El envío por mail va aparte
//  (endpoint de backend con PDF adjunto).
// ════════════════════════════════════════════════════════════════════

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const money = (v) => '$' + num(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fechaAR = (d) => { try { return d ? new Date(d).toLocaleDateString('es-AR') : '—'; } catch (e) { return '—'; } };
const fechaHoraAR = (d) => { try { return d ? new Date(d).toLocaleString('es-AR') : '—'; } catch (e) { return '—'; } };

// Detalle según el método de pago (espeja lo que muestra el modal de pago).
function detalleMetodo(p) {
  const out = [];
  if (p.metodo === 'transferencia') {
    if (p.banco_origen) out.push('Origen: ' + p.banco_origen);
    if (p.banco_destino) out.push('Destino: ' + p.banco_destino);
    if (p.cbu_alias_destino) out.push('CBU/Alias: ' + p.cbu_alias_destino);
  } else if (p.metodo === 'cheque') {
    if (p.cheque_nro) out.push('N° ' + p.cheque_nro);
    if (p.cheque_banco) out.push('Banco: ' + p.cheque_banco);
    if (p.cheque_fecha_cobro) out.push('Cobro: ' + fechaAR(p.cheque_fecha_cobro));
    if (p.cheque_a_nombre) out.push('A nombre de: ' + p.cheque_a_nombre);
  } else if (p.metodo === 'echeq') {
    if (p.echeq_nro) out.push('N° ' + p.echeq_nro);
    if (p.echeq_banco) out.push('Banco: ' + p.echeq_banco);
    if (p.echeq_fecha_pago) out.push('Pago: ' + fechaAR(p.echeq_fecha_pago));
  } else if (p.metodo === 'tarjeta') {
    if (p.tarjeta_aprobacion) out.push('Aprobación: ' + p.tarjeta_aprobacion);
    if (p.tarjeta_cuotas) out.push(p.tarjeta_cuotas + ' cuotas');
  }
  if (p.comprobante_nro) out.push('Comp: ' + p.comprobante_nro);
  return out.map(esc).join(' · ');
}

// Arma el HTML del comprobante a partir de factura + oc + pagos.
function comprobanteHtml(factura, oc, pagos) {
  const totalFac = num(factura.invoice_total) || num(factura.invoice_monto) * (1 + num(factura.iva_pct) / 100);
  const pagado = (pagos || []).reduce((s, p) => s + num(p.monto), 0);
  const saldo = +(totalFac - pagado).toFixed(2);
  const filas = (pagos || []).map((p) => {
    const det = detalleMetodo(p);
    return `<tr>
      <td>${fechaHoraAR(p.paid_at)}</td>
      <td style="text-transform:uppercase">${esc(p.metodo || '—')}</td>
      <td>${det || '—'}${p.paid_by_name ? `<div class="sub">por ${esc(p.paid_by_name)}</div>` : ''}</td>
      <td class="r">${money(p.monto)}</td>
    </tr>`;
  }).join('');

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>Comprobante de pago — ${esc(factura.invoice_nro || '')}</title>
    <style>
      * { box-sizing:border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color:#1f2937; margin:0; padding:32px; }
      .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #ea580c; padding-bottom:12px; margin-bottom:18px; }
      .brand { font-size:22px; font-weight:800; color:#ea580c; }
      .brand small { display:block; font-size:11px; color:#6b7280; font-weight:400; margin-top:2px; }
      .doc { text-align:right; }
      .doc h1 { font-size:16px; margin:0; letter-spacing:.5px; }
      .doc .code { color:#ea580c; font-weight:700; font-size:14px; margin-top:2px; }
      .doc .date { color:#6b7280; font-size:11px; margin-top:2px; }
      .grid { display:grid; grid-template-columns:1fr 1fr; gap:8px 24px; margin-bottom:18px; font-size:13px; }
      .grid .k { color:#6b7280; font-size:11px; text-transform:uppercase; }
      table { width:100%; border-collapse:collapse; font-size:12px; margin-bottom:14px; }
      th { background:#f3f4f6; text-align:left; padding:7px 8px; font-size:11px; }
      td { padding:7px 8px; border-bottom:1px solid #f0f0f0; vertical-align:top; }
      td.r, th.r { text-align:right; }
      .sub { color:#6b7280; font-size:10px; margin-top:2px; }
      .tot { margin-left:auto; width:260px; font-size:13px; }
      .tot div { display:flex; justify-content:space-between; padding:3px 0; }
      .tot .big { font-weight:700; font-size:15px; border-top:1px solid #d1d5db; padding-top:6px; margin-top:4px; }
      .foot { margin-top:28px; color:#6b7280; font-size:10px; text-align:center; border-top:1px solid #e5e7eb; padding-top:8px; }
      @media print { body { padding:12px; } }
    </style></head><body>
    <div class="head">
      <div class="brand">Expreso Biletta<small>Sistema de gestión de flota — FleetOS</small></div>
      <div class="doc">
        <h1>COMPROBANTE DE PAGO</h1>
        <div class="code">Factura ${esc(factura.invoice_nro || '—')}</div>
        <div class="date">Emitido: ${fechaAR(new Date())}</div>
      </div>
    </div>

    <div class="grid">
      <div><div class="k">Proveedor</div>${esc(oc.proveedor || oc.supplier_name || '—')}${oc.supplier_cuit ? `<div class="sub">CUIT ${esc(oc.supplier_cuit)}</div>` : ''}</div>
      <div><div class="k">Orden de compra</div>${esc(oc.code || '—')}</div>
      <div><div class="k">Factura</div>${esc(factura.invoice_nro || '—')} · ${fechaAR(factura.invoice_fecha)}</div>
      <div><div class="k">Total factura c/IVA</div>${money(totalFac)} <span class="sub">(neto ${money(factura.invoice_monto)} · IVA ${num(factura.iva_pct)}%)</span></div>
    </div>

    <table>
      <thead><tr><th>Fecha</th><th>Método</th><th>Detalle</th><th class="r">Monto</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="4" style="text-align:center;color:#6b7280;padding:18px">Sin pagos registrados</td></tr>'}</tbody>
    </table>

    <div class="tot">
      <div><span>Total pagado</span><span>${money(pagado)}</span></div>
      <div><span>Saldo</span><span>${money(saldo)}</span></div>
      <div class="big"><span>${saldo <= 0.01 ? 'CANCELADA' : 'PENDIENTE'}</span><span>${money(saldo <= 0.01 ? totalFac : pagado)}</span></div>
    </div>

    <div class="foot">Comprobante generado por FleetOS · Expreso Biletta S.R.L. · ${fechaHoraAR(new Date())}</div>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
  </body></html>`;
}

// Imprime el comprobante de la factura abierta en el modal de pago.
window.imprimirReciboPago = function () {
  const factura = window._pagoFacturaActual;
  const oc = window._pagoOcActual || {};
  const pagos = window._pagoPagosActual || [];
  if (!factura) { window.showToast?.('error', 'No hay factura activa'); return; }
  if (!pagos.length) { window.showToast?.('warn', 'La factura todavía no tiene pagos'); return; }
  const w = window.open('', '_blank');
  if (!w) { window.showToast?.('error', 'Habilitá las ventanas emergentes para imprimir'); return; }
  w.document.write(comprobanteHtml(factura, oc, pagos));
  w.document.close();
};
