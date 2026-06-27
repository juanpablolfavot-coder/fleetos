// ════════════════════════════════════════════════════════════════════
//  PANEL CONTADOR (legacy) — la página se fusionó con Costos operativos.
//  renderContadorPanel redirige a 'costs'; se conserva el export PDF
//  contable por compatibilidad. Cargado DESPUÉS de app.js: usa sus helpers
//  globales (navigate, showToast, _pdfHeader, _pdfTableStyle, App.data, etc.).
// ════════════════════════════════════════════════════════════════════
// ── PANEL CONTADOR (legacy, fusionado con Costos operativos) ──
// La página se mantiene por compat — si algún link viejo navega a contador_panel,
// lo redirigimos a la página Costos (que ahora incluye selector de mes + KPIs contables).
function renderContadorPanel() {
  // Sincronizar mes seleccionado entre las dos variables (por si alguien venía del contador)
  if (window._contadorMes && !window._costsMes) {
    window._costsMes = window._contadorMes;
  }
  // Redirigir a la página unificada
  navigate('costs');
}

// _buildContadorPanel queda definido más abajo solo por si algún código legacy lo llama directamente.
function _buildContadorPanel(mesStr) {
  window._costsMes = mesStr;
  window._contadorMes = mesStr;
  navigate('costs');
}

function _exportContadorPDF(mesStr) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast?.('error','jsPDF no cargado. Refrescá la página.');
    return;
  }

  const [yr, mo] = mesStr.split('-').map(Number);
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const mesNombre = meses[mo-1];

  const fuelMes = (App.data.fuelLogs||[]).filter(f => { const d=new Date(f.date); return d.getFullYear()===yr && d.getMonth()+1===mo; });
  const otsMes  = (App.data.workOrders||[]).filter(o => { if(o.status!=='Cerrada') return false; const d=new Date(o.closed_at||o.date); return d.getFullYear()===yr && d.getMonth()+1===mo; });

  const byVeh = {};
  fuelMes.forEach(f => {
    if(!byVeh[f.vehicle]) byVeh[f.vehicle]={combustible:0,litros:0,mano:0,repuestos:0,ots:0};
    byVeh[f.vehicle].combustible += (f.liters||0)*(f.ppu||0);
    byVeh[f.vehicle].litros += (f.liters||0);
  });
  otsMes.forEach(o => {
    const vc = o.vehicle_code||o.vehicle||'';
    if(!byVeh[vc]) byVeh[vc]={combustible:0,litros:0,mano:0,repuestos:0,ots:0};
    byVeh[vc].mano += parseFloat(o.labor_cost)||0;
    byVeh[vc].repuestos += parseFloat(o.parts_cost)||0;
    byVeh[vc].ots++;
  });

  const entries = Object.entries(byVeh)
    .sort((a,b)=>(b[1].combustible+b[1].mano+b[1].repuestos)-(a[1].combustible+a[1].mano+a[1].repuestos))
    .filter(([,v]) => (v.combustible+v.mano+v.repuestos) > 0);

  let tCombustible=0, tLitros=0, tMano=0, tRepuestos=0, tOts=0, tTotal=0;
  const rows = entries.map(([code, v]) => {
    const total = v.combustible + v.mano + v.repuestos;
    tCombustible += v.combustible;
    tLitros      += v.litros;
    tMano        += v.mano;
    tRepuestos   += v.repuestos;
    tOts         += v.ots;
    tTotal       += total;
    return [
      code,
      v.combustible>0 ? '$'+Math.round(v.combustible).toLocaleString('es-AR') : '—',
      v.litros>0 ? Math.round(v.litros).toLocaleString('es-AR')+' L' : '—',
      v.mano>0 ? '$'+Math.round(v.mano).toLocaleString('es-AR') : '—',
      v.repuestos>0 ? '$'+Math.round(v.repuestos).toLocaleString('es-AR') : '—',
      v.ots > 0 ? String(v.ots) : '—',
      '$'+Math.round(total).toLocaleString('es-AR'),
    ];
  });

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  const startY = _pdfHeader(doc, 'Panel Contable', `Período: ${mesNombre} ${yr}  ·  ${rows.length} unidades con movimientos`);

  // Tabla
  doc.autoTable({
    startY: startY,
    head: [['Unidad','Combustible','Litros','Mano de obra','Repuestos','OTs','Total']],
    body: rows,
    ..._pdfTableStyle(),
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 70 },
      1: { halign: 'right', cellWidth: 100 },
      2: { halign: 'right', cellWidth: 80 },
      3: { halign: 'right', cellWidth: 100 },
      4: { halign: 'right', cellWidth: 100 },
      5: { halign: 'center', cellWidth: 50 },
      6: { halign: 'right', fontStyle: 'bold', cellWidth: 100 },
    },
    foot: [[
      'TOTALES',
      '$'+Math.round(tCombustible).toLocaleString('es-AR'),
      Math.round(tLitros).toLocaleString('es-AR')+' L',
      '$'+Math.round(tMano).toLocaleString('es-AR'),
      '$'+Math.round(tRepuestos).toLocaleString('es-AR'),
      String(tOts),
      '$'+Math.round(tTotal).toLocaleString('es-AR'),
    ]],
  });

  doc.save(`Contable-Biletta-${mesStr}.pdf`);
  showToast('ok','PDF contable descargado');
}

// Wrapper de compatibilidad
function _exportContadorCSV(mesStr) { _exportContadorPDF(mesStr); }

