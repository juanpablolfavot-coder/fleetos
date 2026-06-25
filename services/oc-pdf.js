// ════════════════════════════════════════════════════════════════════
//  Generador del PDF de una Orden de Compra (server-side, con pdfkit).
//  Devuelve un Buffer listo para adjuntar a un email.
// ════════════════════════════════════════════════════════════════════
const PDFDocument = require('pdfkit');

const ORANGE = '#ea580c';
const DARK   = '#1f2937';
const GREY    = '#6b7280';

function money(n, moneda) {
  const sym = moneda === 'USD' ? 'US$' : '$';
  return sym + (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fechaAR(d) {
  try { return new Date(d).toLocaleDateString('es-AR'); } catch { return '—'; }
}

/**
 * @param {object} oc       fila de purchase_orders
 * @param {Array}  items    [{descripcion, cantidad, unidad, precio_unit}]
 * @param {object} supplier {name, email, cuit, ...} (puede ser null)
 * @returns {Promise<Buffer>}
 */
function buildOCPdf(oc, items, supplier) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const moneda = oc.moneda || 'ARS';
      const left = 50;
      const right = 545; // A4 width 595 - margin

      // ── Encabezado ──
      doc.fillColor(ORANGE).fontSize(22).font('Helvetica-Bold').text('Expreso Biletta', left, 50);
      doc.fillColor(GREY).fontSize(10).font('Helvetica').text('Sistema de gestión de flota — FleetOS', left, 76);
      doc.fillColor(DARK).fontSize(16).font('Helvetica-Bold')
        .text('ORDEN DE COMPRA', left, 50, { width: right - left, align: 'right' });
      doc.fillColor(ORANGE).fontSize(13).font('Helvetica-Bold')
        .text(oc.code || '', left, 72, { width: right - left, align: 'right' });
      doc.fillColor(GREY).fontSize(9).font('Helvetica')
        .text('Fecha de envío: ' + fechaAR(oc.fecha_envio_prov || new Date()), left, 90, { width: right - left, align: 'right' });

      doc.moveTo(left, 112).lineTo(right, 112).strokeColor('#e5e7eb').stroke();

      // ── Datos del proveedor / OC ──
      let y = 126;
      doc.fillColor(GREY).fontSize(9).font('Helvetica-Bold').text('PROVEEDOR', left, y);
      doc.fillColor(GREY).fontSize(9).font('Helvetica-Bold').text('DATOS', 320, y);
      y += 14;
      doc.fillColor(DARK).fontSize(10).font('Helvetica');
      const provNombre = (supplier && supplier.name) || oc.proveedor || '—';
      doc.text(provNombre, left, y, { width: 250 });
      if (supplier && supplier.cuit) doc.fillColor(GREY).fontSize(9).text('CUIT: ' + supplier.cuit, left, y + 14);
      if (supplier && supplier.email) doc.fillColor(GREY).fontSize(9).text(supplier.email, left, y + 27);

      const datos = [
        ['Sucursal', oc.sucursal || '—'],
        ['Área', oc.area || '—'],
        ['Forma de pago', (oc.forma_pago || '—') + (oc.cc_dias ? ` (${oc.cc_dias} días)` : '')],
        ['Moneda', moneda],
      ];
      let yd = y;
      datos.forEach(([k, v]) => {
        doc.fillColor(GREY).fontSize(9).font('Helvetica').text(k + ':', 320, yd, { width: 90 });
        doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text(String(v), 412, yd, { width: right - 412 });
        yd += 14;
      });

      y = Math.max(y + 45, yd) + 10;

      // ── Tabla de ítems ──
      const cols = { desc: left, cant: 330, unit: 380, precio: 440, sub: 500 };
      doc.rect(left, y, right - left, 18).fill('#f3f4f6');
      doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold');
      doc.text('Descripción', cols.desc + 4, y + 5, { width: cols.cant - cols.desc - 6 });
      doc.text('Cant.', cols.cant, y + 5, { width: cols.unit - cols.cant - 4, align: 'right' });
      doc.text('Unidad', cols.unit, y + 5, { width: cols.precio - cols.unit - 4 });
      doc.text('P. unit', cols.precio, y + 5, { width: cols.sub - cols.precio - 4, align: 'right' });
      doc.text('Subtotal', cols.sub, y + 5, { width: right - cols.sub - 4, align: 'right' });
      y += 18;

      let subtotal = 0;
      doc.font('Helvetica').fontSize(9).fillColor(DARK);
      (items || []).forEach((it) => {
        const cant = Number(it.cantidad) || 0;
        const pu = Number(it.precio_unit) || 0;
        const sub = cant * pu;
        subtotal += sub;
        const descHeight = doc.heightOfString(it.descripcion || '—', { width: cols.cant - cols.desc - 6 });
        const rowH = Math.max(16, descHeight + 6);
        if (y + rowH > 760) { doc.addPage(); y = 50; }
        doc.fillColor(DARK).text(it.descripcion || '—', cols.desc + 4, y + 3, { width: cols.cant - cols.desc - 6 });
        doc.text(cant.toLocaleString('es-AR'), cols.cant, y + 3, { width: cols.unit - cols.cant - 4, align: 'right' });
        doc.text(it.unidad || 'un', cols.unit, y + 3, { width: cols.precio - cols.unit - 4 });
        doc.text(pu ? money(pu, moneda) : '—', cols.precio, y + 3, { width: cols.sub - cols.precio - 4, align: 'right' });
        doc.text(sub ? money(sub, moneda) : '—', cols.sub, y + 3, { width: right - cols.sub - 4, align: 'right' });
        doc.moveTo(left, y + rowH).lineTo(right, y + rowH).strokeColor('#f0f0f0').stroke();
        y += rowH;
      });

      // ── Totales ──
      const ivaPct = Number(oc.iva_pct) || 0;
      const iva = subtotal * ivaPct / 100;
      const total = subtotal + iva;
      y += 10;
      const tot = (label, val, bold) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(bold ? DARK : GREY);
        doc.text(label, 360, y, { width: 90, align: 'right' });
        doc.text(money(val, moneda), 455, y, { width: right - 455, align: 'right' });
        y += bold ? 18 : 14;
      };
      tot('Subtotal', subtotal, false);
      if (ivaPct) tot(`IVA ${ivaPct}%`, iva, false);
      tot('TOTAL', total, true);

      // ── Notas ──
      if (oc.notes) {
        y += 12;
        doc.fillColor(GREY).fontSize(9).font('Helvetica-Bold').text('Observaciones', left, y);
        doc.fillColor(DARK).fontSize(9).font('Helvetica').text(oc.notes, left, y + 13, { width: right - left });
      }

      // ── Pie ──
      doc.fillColor(GREY).fontSize(8).font('Helvetica')
        .text('Documento generado automáticamente por FleetOS · Expreso Biletta S.R.L.', left, 800, { width: right - left, align: 'center' });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { buildOCPdf };
