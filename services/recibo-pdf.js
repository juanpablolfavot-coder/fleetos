// ════════════════════════════════════════════════════════════════════
//  Generador del PDF de un COMPROBANTE DE PAGO (server-side, pdfkit).
//  Recibo consolidado por factura: lista todos los pagos de esa factura.
//  Devuelve un Buffer listo para adjuntar a un email. Espeja oc-pdf.js.
// ════════════════════════════════════════════════════════════════════
const PDFDocument = require('pdfkit');

const ORANGE = '#ea580c';
const DARK   = '#1f2937';
const GREY   = '#6b7280';

function money(n) {
  return '$' + (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fechaAR(d) { try { return d ? new Date(d).toLocaleDateString('es-AR') : '—'; } catch { return '—'; } }
function fechaHoraAR(d) { try { return d ? new Date(d).toLocaleString('es-AR') : '—'; } catch { return '—'; } }

// Detalle del medio de pago (espeja el modal de pago del frontend).
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
    if (p.tarjeta_aprobacion) out.push('Aprob: ' + p.tarjeta_aprobacion);
    if (p.tarjeta_cuotas) out.push(p.tarjeta_cuotas + ' cuotas');
  }
  if (p.comprobante_nro) out.push('Comp: ' + p.comprobante_nro);
  return out.join(' · ');
}

/**
 * @param {object} oc       {code, proveedor}
 * @param {object} factura  {invoice_nro, invoice_fecha, invoice_monto, iva_pct, invoice_total}
 * @param {Array}  pagos    filas de purchase_order_payments (+ paid_by_name)
 * @param {object} supplier {name, email, cuit}
 * @returns {Promise<Buffer>}
 */
function buildReciboPdf(oc, factura, pagos, supplier) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = 50;
      const right = 545;

      // ── Encabezado ──
      doc.fillColor(ORANGE).fontSize(22).font('Helvetica-Bold').text('Expreso Biletta', left, 50);
      doc.fillColor(GREY).fontSize(10).font('Helvetica').text('Sistema de gestión de flota — FleetOS', left, 76);
      doc.fillColor(DARK).fontSize(16).font('Helvetica-Bold')
        .text('COMPROBANTE DE PAGO', left, 50, { width: right - left, align: 'right' });
      doc.fillColor(ORANGE).fontSize(13).font('Helvetica-Bold')
        .text('Factura ' + (factura.invoice_nro || ''), left, 72, { width: right - left, align: 'right' });
      doc.fillColor(GREY).fontSize(9).font('Helvetica')
        .text('Emitido: ' + fechaAR(new Date()), left, 90, { width: right - left, align: 'right' });

      doc.moveTo(left, 112).lineTo(right, 112).strokeColor('#e5e7eb').stroke();

      // ── Datos proveedor / factura ──
      let y = 126;
      doc.fillColor(GREY).fontSize(9).font('Helvetica-Bold').text('PROVEEDOR', left, y);
      doc.fillColor(GREY).fontSize(9).font('Helvetica-Bold').text('DATOS', 320, y);
      y += 14;
      doc.fillColor(DARK).fontSize(10).font('Helvetica');
      doc.text((supplier && supplier.name) || oc.proveedor || '—', left, y, { width: 250 });
      if (supplier && supplier.cuit) doc.fillColor(GREY).fontSize(9).text('CUIT: ' + supplier.cuit, left, y + 14);
      if (supplier && supplier.email) doc.fillColor(GREY).fontSize(9).text(supplier.email, left, y + 27);

      const datos = [
        ['Orden de compra', oc.code || '—'],
        ['Factura', (factura.invoice_nro || '—') + '  ' + fechaAR(factura.invoice_fecha)],
        ['Total c/IVA', money(factura.invoice_total)],
        ['Neto · IVA', money(factura.invoice_monto) + ' · ' + (Number(factura.iva_pct) || 0) + '%'],
      ];
      let yd = y;
      datos.forEach(([k, v]) => {
        doc.fillColor(GREY).fontSize(9).font('Helvetica').text(k + ':', 320, yd, { width: 100 });
        doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text(String(v), 422, yd, { width: right - 422 });
        yd += 14;
      });

      y = Math.max(y + 45, yd) + 10;

      // ── Tabla de pagos ──
      const cols = { fecha: left, metodo: 175, det: 270, monto: 470 };
      doc.rect(left, y, right - left, 18).fill('#f3f4f6');
      doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold');
      doc.text('Fecha', cols.fecha + 4, y + 5, { width: cols.metodo - cols.fecha - 6 });
      doc.text('Método', cols.metodo, y + 5, { width: cols.det - cols.metodo - 4 });
      doc.text('Detalle', cols.det, y + 5, { width: cols.monto - cols.det - 4 });
      doc.text('Monto', cols.monto, y + 5, { width: right - cols.monto - 4, align: 'right' });
      y += 18;

      let pagado = 0;
      doc.font('Helvetica').fontSize(9).fillColor(DARK);
      (pagos || []).forEach((p) => {
        pagado += Number(p.monto) || 0;
        const det = detalleMetodo(p) + (p.paid_by_name ? (detalleMetodo(p) ? '  ·  ' : '') + 'por ' + p.paid_by_name : '');
        const detH = doc.heightOfString(det || '—', { width: cols.monto - cols.det - 6 });
        const rowH = Math.max(16, detH + 6);
        if (y + rowH > 760) { doc.addPage(); y = 50; }
        doc.fillColor(DARK).fontSize(9).font('Helvetica');
        doc.text(fechaHoraAR(p.paid_at), cols.fecha + 4, y + 3, { width: cols.metodo - cols.fecha - 6 });
        doc.text(String(p.metodo || '—').toUpperCase(), cols.metodo, y + 3, { width: cols.det - cols.metodo - 4 });
        doc.text(det || '—', cols.det, y + 3, { width: cols.monto - cols.det - 6 });
        doc.text(money(p.monto), cols.monto, y + 3, { width: right - cols.monto - 4, align: 'right' });
        doc.moveTo(left, y + rowH).lineTo(right, y + rowH).strokeColor('#f0f0f0').stroke();
        y += rowH;
      });

      // ── Totales ──
      const totalFac = Number(factura.invoice_total) || 0;
      const saldo = +(totalFac - pagado).toFixed(2);
      y += 10;
      const tot = (label, val, bold) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(bold ? DARK : GREY);
        doc.text(label, 360, y, { width: 95, align: 'right' });
        doc.text(money(val), 460, y, { width: right - 460, align: 'right' });
        y += bold ? 18 : 14;
      };
      tot('Total factura c/IVA', totalFac, false);
      tot('Total pagado', pagado, false);
      tot(saldo <= 0.01 ? 'SALDO (CANCELADA)' : 'SALDO PENDIENTE', saldo, true);

      // ── Pie ──
      doc.fillColor(GREY).fontSize(8).font('Helvetica')
        .text('Comprobante generado automáticamente por FleetOS · Expreso Biletta S.R.L.', left, 800, { width: right - left, align: 'center' });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { buildReciboPdf };
