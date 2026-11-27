#!/usr/bin/env node
/**
 * Cruce de la planilla contable de cargas directas contra FleetOS — SOLO LECTURA
 * ────────────────────────────────────────────────────────────────────────────
 * Pensado para correrse en la SHELL DE RENDER:
 *
 *    node scripts/cruzar-planilla-combustible.js
 *
 * No inserta ni modifica nada. Para cada factura de la planilla
 * "GASOIL - CARGAS DIRECTAS OCTUBRE" (todas las sucursales) busca en fuel_logs
 * una carga externa (sin cisterna) que corresponda:
 *   1) por número de comprobante (las cargadas desde tickets lo tienen en notes), o
 *   2) por fecha (±1 día) + litros (±0,5 L).
 * y lista cuáles ya están (con la unidad) y cuáles faltan, agrupado por depósito.
 *
 * La planilla no trae patente ni km: las que falten hay que pedirlas con el
 * ticket (patente + km anotados) para poder cargarlas.
 *
 * Para otro mes, reemplazar el array PLANILLA (se arma desde el Excel).
 */
const { pool } = require('../db/pool');

// Depósito, proveedor, comprobante (P.Venta-Número), fecha de emisión, litros e
// importe tal como vienen en la planilla (importe null = vacío en el Excel).
const PLANILLA = [
  { prov:"LA BLANCA SRL", cpte:'00021-00006680', fecha:'2026-10-01', dep:"ROSARIO", litros:58.7, importe:149999.96 },
  { prov:"LA FUENTE COMBUSTIBLES SRL", cpte:'00004-00016364', fecha:'2026-10-01', dep:"BUENOS AIRES", litros:154.73, importe:400000 },
  { prov:"NORBAYRES SRL", cpte:'00003-00004021', fecha:'2026-10-01', dep:"BUENOS AIRES", litros:133.63, importe:300000.02 },
  { prov:"ESER SA.", cpte:'00039-00075738', fecha:'2026-10-02', dep:"CORDOBA", litros:62.7, importe:149999.92 },
  { prov:"LA CUARTA S.A.", cpte:'00112-00001464', fecha:'2026-10-02', dep:"RIO TERCERO", litros:125.99, importe:300000.05 },
  { prov:"LA FUENTE COMBUSTIBLES SRL", cpte:'00004-00016373', fecha:'2026-10-02', dep:"BUENOS AIRES", litros:116.05, importe:300000 },
  { prov:"ZOKFA S.A.S.", cpte:'00002-00110759', fecha:'2026-10-02', dep:"CORDOBA", litros:49.1, importe:171993.99 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049085', fecha:'2026-10-03', dep:"RIO TERCERO", litros:629.98, importe:1515221.97 },
  { prov:"ZOKFA S.A.S.", cpte:'00006-00083009', fecha:'2026-10-03', dep:"CORDOBA", litros:36.64, importe:100000.1 },
  { prov:"ZOKFA S.A.S.", cpte:'00002-00110811', fecha:'2026-10-04', dep:"CORDOBA", litros:36.64, importe:100000.1 },
  { prov:"LA BALLESTRA SRL", cpte:'00014-00050754', fecha:'2026-10-05', dep:"RIO TERCERO", litros:330.71, importe:800000.07 },
  { prov:"OPERADORA DE ESTACION", cpte:'07768-00019052', fecha:'2026-10-05', dep:"BUENOS AIRES", litros:72.82, importe:190000 },
  { prov:"ARGUMAL SA", cpte:'00009-00006627', fecha:'2026-10-06', dep:"BUENOS AIRES", litros:86.95, importe:199999.95 },
  { prov:"GENERAL ROCA GNC SRL", cpte:'00014-00010078', fecha:'2026-10-06', dep:"RIO TERCERO", litros:165.42, importe:400000.07 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049209', fecha:'2026-10-06', dep:"RIO TERCERO", litros:499.03, importe:1206653.09 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049225', fecha:'2026-10-06', dep:"RIO TERCERO", litros:145.45, importe:351698.1 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049223', fecha:'2026-10-06', dep:"RIO TERCERO", litros:451.43, importe:1091556.05 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049226', fecha:'2026-10-06', dep:"RIO TERCERO", litros:409.43, importe:990000.05 },
  { prov:"SANTA BARBARA S A", cpte:'00060-00021298', fecha:'2026-10-06', dep:"CORDOBA", litros:124.89, importe:299999.95 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049253', fecha:'2026-10-07', dep:"RIO TERCERO", litros:158.38, importe:382963.08 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049292', fecha:'2026-10-07', dep:"SANTA ROSA CALAMUCHITA", litros:70, importe:169260 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00014-00052677', fecha:'2026-10-07', dep:"RIO TERCERO", litros:40.37, importe:97619.01 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049297', fecha:'2026-10-07', dep:"RIO TERCERO", litros:626.52, importe:1514928.02 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049278', fecha:'2026-10-07', dep:"RIO TERCERO", litros:576.81, importe:1394718.12 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049298', fecha:'2026-10-07', dep:"RIO TERCERO", litros:581.84, importe:1406886.94 },
  { prov:"NORBAYRES SRL", cpte:'00004-00024147', fecha:'2026-10-07', dep:"BUENOS AIRES", litros:119.14, importe:300000.06 },
  { prov:"OPERADORA DE ESTACION", cpte:'07108-00039314', fecha:'2026-10-07', dep:"SANTA ROSA CALAMUCHITA", litros:62.72, importe:151030 },
  { prov:"CENTRO BEBIDAS S.R.L.", cpte:'00019-00023411', fecha:'2026-10-08', dep:"CORDOBA", litros:36.47, importe:99999.92 },
  { prov:"DUEL SRL", cpte:'00018-00108511', fecha:'2026-10-08', dep:"RIO TERCERO", litros:456.81, importe:null },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049319', fecha:'2026-10-08', dep:"RIO TERCERO", litros:81.73, importe:197634.99 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049340', fecha:'2026-10-08', dep:"RIO TERCERO", litros:605.46, importe:1464004.94 },
  { prov:"JORGE ALBERTO CASO S A", cpte:'00131-00023705', fecha:'2026-10-08', dep:"RIO TERCERO", litros:206.78, importe:500000.09 },
  { prov:"LA FUENTE COMBUSTIBLES SRL", cpte:'00004-00016439', fecha:'2026-10-08', dep:"BUENOS AIRES", litros:154.73, importe:400000 },
  { prov:"OPERADORA DE COMBUSTIBLES ROSARIO SA", cpte:'00200-00052515', fecha:'2026-10-08', dep:"RIO TERCERO", litros:30.53, importe:84671.06 },
  { prov:"OPERADORA DE ESTACION", cpte:'06398-00030536', fecha:'2026-10-08', dep:"BUENOS AIRES", litros:80.25, importe:201693.77 },
  { prov:"OPERADORA DE ESTACION", cpte:'07686-00035475', fecha:'2026-10-08', dep:"ROSARIO", litros:57.87, importe:150000 },
  { prov:"RED PETROL SA", cpte:'00025-00027352', fecha:'2026-10-08', dep:"BUENOS AIRES", litros:84.27, importe:210004.08 },
  { prov:"CENTRO BEBIDAS S.R.L.", cpte:'00019-00023423', fecha:'2026-10-09', dep:"CORDOBA", litros:72.94, importe:200001.42 },
  { prov:"LA FUENTE COMBUSTIBLES SRL", cpte:'00004-00016444', fecha:'2026-10-09', dep:"BUENOS AIRES", litros:116.05, importe:300000 },
  { prov:"DEVENTER S.A", cpte:'00023-00080104', fecha:'2026-10-11', dep:"CORDOBA", litros:69.71, importe:179786.99 },
  { prov:"ZOKFA S.A.S.", cpte:'00002-00111219', fecha:'2026-10-12', dep:"CORDOBA", litros:36.03, importe:99999.91 },
  { prov:"CRUCERO DE ALTA GRACIA SA.", cpte:'00012-00048388', fecha:'2026-10-13', dep:"CORDOBA", litros:20.76, importe:49991.71 },
  { prov:"G.P COMBUSTIBLES S.A.S", cpte:'00009-00004038', fecha:'2026-10-14', dep:"CORDOBA", litros:124.74, importe:299999.94 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049634', fecha:'2026-10-14', dep:"RIO TERCERO", litros:99.18, importe:241514.99 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049645', fecha:'2026-10-14', dep:"RIO TERCERO", litros:100, importe:243500 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00014-00053042', fecha:'2026-10-14', dep:"RIO TERCERO", litros:45.18, importe:110005.99 },
  { prov:"LA FUENTE COMBUSTIBLES SRL", cpte:'00004-00016481', fecha:'2026-10-14', dep:"BUENOS AIRES", litros:75.61, importe:200000 },
  { prov:"RED PETROL SA", cpte:'00025-00027426', fecha:'2026-10-14', dep:"BUENOS AIRES", litros:80.35, importe:200000.11 },
  { prov:"GENERAL ROCA GNC SRL", cpte:'00014-00010443', fecha:'2026-10-15', dep:"RIO TERCERO", litros:407.57, importe:989999.94 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049713', fecha:'2026-10-15', dep:"RIO TERCERO", litros:20, importe:48580 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049722', fecha:'2026-10-15', dep:"RIO TERCERO", litros:120.52, importe:292736.04 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049729', fecha:'2026-10-15', dep:"RIO TERCERO", litros:482.6, importe:1172227.87 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049723', fecha:'2026-10-15', dep:"RIO TERCERO", litros:517.61, importe:1257263.03 },
  { prov:"MEDIAR SA", cpte:'00011-00017428', fecha:'2026-10-15', dep:"CORDOBA", litros:73.01, importe:200000.14 },
  { prov:"GENERAL ROCA GNC SRL", cpte:'00014-00010492', fecha:'2026-10-16', dep:"RIO TERCERO", litros:82.33, importe:199999.97 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049755', fecha:'2026-10-16', dep:"RIO TERCERO", litros:156.34, importe:379737.96 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049754', fecha:'2026-10-16', dep:"RIO TERCERO", litros:177.98, importe:432318.04 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00049766', fecha:'2026-10-16', dep:"RIO TERCERO", litros:554.18, importe:1346090.83 },
  { prov:"LA FUENTE COMBUSTIBLES SRL", cpte:'00004-00016516', fecha:'2026-10-16', dep:"BUENOS AIRES", litros:113.42, importe:300000 },
  { prov:"MARTINATTI RAUL ALBERTO", cpte:'00008-00026275', fecha:'2026-10-16', dep:"CORDOBA", litros:182.74, importe:442052.91 },
  { prov:"NAFPUR XXI SA", cpte:'00022-00082299', fecha:'2026-10-16', dep:"BUENOS AIRES", litros:120.53, importe:299999.92 },
  { prov:"RED PETROL SA", cpte:'00028-00015673', fecha:'2026-10-16', dep:"BUENOS AIRES", litros:80.35, importe:200000.11 },
  { prov:"SANTA BARBARA S A", cpte:'00060-00021816', fecha:'2026-10-16', dep:"CORDOBA", litros:58.87, importe:163006.1 },
  { prov:"CAPELLINO DOMINGO PEDRO", cpte:'00009-00079245', fecha:'2026-10-17', dep:"CORDOBA", litros:24.79, importe:57999.95 },
  { prov:"ALT SA", cpte:'00043-00027617', fecha:'2026-10-19', dep:"SANTA ROSA CALAMUCHITA", litros:58.14, importe:140005.94 },
  { prov:"LA FUENTE COMBUSTIBLES SRL", cpte:'00004-00016533', fecha:'2026-10-19', dep:"BUENOS AIRES", litros:151.22, importe:400000 },
  { prov:"RED PETROL SA", cpte:'00027-00054722', fecha:'2026-10-19', dep:"BUENOS AIRES", litros:80.25, importe:199999.94 },
  { prov:"SANTA BARBARA S A", cpte:'00094-00006415', fecha:'2026-10-19', dep:"CORDOBA", litros:83.26, importe:199999.89 },
  { prov:"ZOKFA S.A.S.", cpte:'00002-00111572', fecha:'2026-10-19', dep:"CORDOBA", litros:36.03, importe:99999.91 },
  { prov:"CENTRO BEBIDAS S.R.L.", cpte:'00019-00023524', fecha:'2026-10-20', dep:"CORDOBA", litros:61.99, importe:169999.88 },
  { prov:"HECTOR A. REGINA S.R.L.", cpte:'00019-00040695', fecha:'2026-10-20', dep:"ROSARIO", litros:57.56, importe:150000.06 },
  { prov:"SANTA BARBARA S A", cpte:'00088-00002820', fecha:'2026-10-20', dep:"RIO TERCERO", litros:510.53, importe:1225804.14 },
  { prov:"EL CORCEL SRL", cpte:'00005-00008976', fecha:'2026-10-21', dep:"RIO TERCERO", litros:45.11, importe:113001.05 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00050034', fecha:'2026-10-21', dep:"RIO TERCERO", litros:194.01, importe:469690.95 },
  { prov:"SANTA BARBARA S A", cpte:'00094-00006496', fecha:'2026-10-21', dep:"CORDOBA", litros:124.79, importe:299999.97 },
  { prov:"GROTSCHL JORGE MIGUEL ANGEL", cpte:'00011-00050072', fecha:'2026-10-22', dep:"RIO TERCERO", litros:131.05, importe:340603.89 },
  { prov:"NAFPUR XXI SA", cpte:'00036-00000010', fecha:'2026-10-22', dep:"BUENOS AIRES", litros:120.19, importe:299999.98 },
  { prov:"ZOKFA S.A.S.", cpte:'00001-00088329', fecha:'2026-10-22', dep:"CORDOBA", litros:36.03, importe:99999.91 },
  { prov:"ALT SA", cpte:'00040-00040961', fecha:'2026-10-23', dep:"SANTA ROSA CALAMUCHITA", litros:33.12, importe:80000.01 },
  { prov:"GENERAL ROCA GNC SRL", cpte:'00014-00010766', fecha:'2026-10-23', dep:"RIO TERCERO", litros:408.92, importe:989999.92 },
  { prov:"GUISI SA", cpte:'00010-00028699', fecha:'2026-10-23', dep:"CORDOBA", litros:51.78, importe:141999.96 },
  { prov:"LA FUENTE COMBUSTIBLES SRL", cpte:'00004-00016603', fecha:'2026-10-23', dep:"BUENOS AIRES", litros:113.42, importe:300000 },
  { prov:"RED PETROL SA", cpte:'00029-00029480', fecha:'2026-10-23', dep:"BUENOS AIRES", litros:80.16, importe:199999.96 },
  { prov:"RED PETROL SA", cpte:'00025-00027567', fecha:'2026-10-23', dep:"BUENOS AIRES", litros:80.16, importe:199999.96 },
  { prov:"VESCAP S.R.L", cpte:'00002-00031889', fecha:'2026-10-23', dep:"CORDOBA", litros:93.01, importe:223980.12 },
  { prov:"ZOKFA S.A.S.", cpte:'00011-00050971', fecha:'2026-10-24', dep:"CORDOBA", litros:36.03, importe:99999.91 },
  { prov:"ARGUMAL SA", cpte:'00009-00007011', fecha:'2026-10-26', dep:"BUENOS AIRES", litros:86.95, importe:199999.96 },
  { prov:"BIFUEL SRL", cpte:'00016-00018089', fecha:'2026-10-26', dep:"CORDOBA", litros:77.66, importe:212956.88 },
  { prov:"CAPELLINO DOMINGO PEDRO", cpte:'00011-00115667', fecha:'2026-10-26', dep:"CORDOBA", litros:95.39, importe:229999.99 },
  { prov:"CAPELLINO DOMINGO PEDRO", cpte:'00018-00022672', fecha:'2026-10-26', dep:"CORDOBA", litros:19.64, importe:45999.94 },
  { prov:"LA FUENTE COMBUSTIBLES SRL", cpte:'00004-00016616', fecha:'2026-10-26', dep:"BUENOS AIRES", litros:151.22, importe:400000 },
  { prov:"ALT SA", cpte:'00042-00035241', fecha:'2026-10-27', dep:"SANTA ROSA CALAMUCHITA", litros:64.85, importe:168999.1 },
  { prov:"NORBAYRES SRL", cpte:'00003-00004518', fecha:'2026-10-27', dep:"BUENOS AIRES", litros:79.14, importe:199999.92 },
  { prov:"SANTA BARBARA S A", cpte:'00094-00006677', fecha:'2026-10-27', dep:"CORDOBA", litros:62.24, importe:150000.09 },
  { prov:"SANTA BARBARA S A", cpte:'00094-00006696', fecha:'2026-10-27', dep:"RIO TERCERO", litros:518.66, importe:1250000 },
  { prov:"VESCAP S.R.L", cpte:'00002-00032257', fecha:'2026-10-27', dep:"CORDOBA", litros:195.03, importe:470038.94 },
  { prov:"BAIDAS SRL", cpte:'00016-00026620', fecha:'2026-10-28', dep:"ROSARIO", litros:53.97, importe:149999.3 },
  { prov:"LA BALLESTRA SRL", cpte:'00014-00051526', fecha:'2026-10-28', dep:"RIO TERCERO", litros:338.05, importe:900000.04 },
  { prov:"LA ROTONDA SAS", cpte:'00020-00014751', fecha:'2026-10-28', dep:"RIO TERCERO", litros:39.47, importe:99034.99 },
  { prov:"OPERADORA DE ESTACION", cpte:'06400-00037119', fecha:'2026-10-28', dep:"BUENOS AIRES", litros:119.95, importe:302540.47 },
  { prov:"ZOKFA S.A.S.", cpte:'00001-00088570', fecha:'2026-10-28', dep:"CORDOBA", litros:36.03, importe:137999.91 },
  { prov:"GNC AU VILLA MARIA S.R.L.", cpte:'00014-00006131', fecha:'2026-10-29', dep:"RIO TERCERO", litros:206.44, importe:500000.1 },
  { prov:"JORGE ALBERTO CASO S A", cpte:'00131-00024141', fecha:'2026-10-29', dep:"RIO TERCERO", litros:328.67, importe:800000.06 },
  { prov:"RED PETROL SA", cpte:'00027-00055019', fecha:'2026-10-29', dep:"BUENOS AIRES", litros:79.8, importe:200000.1 },
  { prov:"SANTA BARBARA S A", cpte:'00094-00006761', fecha:'2026-10-29', dep:"CORDOBA", litros:82.88, importe:200000.06 },
  { prov:"FGC FUELS MARKETING SA", cpte:'00060-00012249', fecha:'2026-10-30', dep:"RIO TERCERO", litros:162.07, importe:400000.12 },
  { prov:"LA FUENTE COMBUSTIBLES SRL", cpte:'00004-00016688', fecha:'2026-10-30', dep:"BUENOS AIRES", litros:37.8, importe:100000 },
  { prov:"LA FUENTE COMBUSTIBLES SRL", cpte:'00004-00016690', fecha:'2026-10-30', dep:"BUENOS AIRES", litros:189.03, importe:500000 },
  { prov:"REPARKER CORDOBA SA.", cpte:'00026-00019522', fecha:'2026-10-30', dep:"CORDOBA", litros:13.77, importe:29999.77 },
  { prov:"SAIFAN SARA ROSA", cpte:'00017-00091614', fecha:'2026-10-30', dep:"RIO TERCERO", litros:242.91, importe:600000.06 },
];

const fmtL = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  console.log(`🔎 Cruce planilla vs FleetOS — ${PLANILLA.length} facturas (solo lectura)\n`);

  const desde = PLANILLA.reduce((m, r) => (r.fecha < m ? r.fecha : m), '9999-99-99');
  const hasta = PLANILLA.reduce((m, r) => (r.fecha > m ? r.fecha : m), '0000-00-00');
  // Cargas externas (tank_id NULL = no salieron de una cisterna propia) del período ±1 día.
  const { rows: cargas } = await pool.query(
    `SELECT fl.id, v.code, v.base, fl.liters::float AS litros, fl.logged_at::date::text AS dia,
            to_char(fl.logged_at, 'DD/MM HH24:MI') AS cuando, COALESCE(fl.notes,'') AS notes
       FROM fuel_logs fl JOIN vehicles v ON v.id = fl.vehicle_id
      WHERE fl.tank_id IS NULL
        AND COALESCE(LOWER(fl.fuel_type),'diesel') <> 'urea'
        AND fl.logged_at::date BETWEEN ($1::date - 1) AND ($2::date + 1)`,
    [desde, hasta]
  );

  const usadas = new Set();
  const diasEntre = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);
  // Comprobante "00004-00016481" ↔ ticket en notes "Ticket 0004-00016481 ·" (ceros a la izquierda varían).
  const norm = (c) => c.split('-').map((p) => String(parseInt(p, 10))).join('-');
  const ticketDe = (notes) => {
    const m = notes.match(/Ticket\s+(\d+)-(\d+)/i);
    return m ? `${parseInt(m[1], 10)}-${parseInt(m[2], 10)}` : null;
  };

  // Primera pasada: por número de comprobante, para TODAS las facturas. Tiene que
  // ir antes que la de fecha+litros: si no, una factura de otra sucursal con los
  // mismos litros "se roba" una carga que en realidad tiene su comprobante exacto.
  const resultado = PLANILLA.map((r) => {
    const hit = cargas.find((c) => !usadas.has(c.id) && ticketDe(c.notes) === norm(r.cpte));
    if (hit) usadas.add(hit.id);
    return { ...r, hit, como: 'comprobante' };
  });
  // Segunda pasada: las que quedaron, por fecha ±1 día + litros ±0,5 L (la más cercana).
  for (const r of resultado) {
    if (r.hit) continue;
    const cands = cargas
      .filter((c) => !usadas.has(c.id) && diasEntre(c.dia, r.fecha) <= 1 && Math.abs(c.litros - r.litros) <= 0.5)
      .sort((a, b) => diasEntre(a.dia, r.fecha) - diasEntre(b.dia, r.fecha) || Math.abs(a.litros - r.litros) - Math.abs(b.litros - r.litros));
    r.hit = cands[0];
    r.como = cands.length > 1 ? `fecha+litros (hay ${cands.length} parecidas, revisar)` : 'fecha+litros';
    if (r.hit) usadas.add(r.hit.id);
  }

  const deps = [...new Set(PLANILLA.map((r) => r.dep))];
  let totYa = 0, totFalta = 0, litrosFalta = 0;
  for (const dep of deps) {
    const filas = resultado.filter((r) => r.dep === dep);
    const ya = filas.filter((r) => r.hit).length;
    console.log(`══ ${dep} — ${filas.length} facturas · ${ya} ya en FleetOS · ${filas.length - ya} faltan`);
    for (const r of filas) {
      const base = `${r.fecha.split('-').reverse().join('/')}  ${r.prov.slice(0, 30).padEnd(30)} ${r.cpte.padEnd(15)} ${fmtL(r.litros).padStart(8)} L`;
      if (r.hit) console.log(`  ✅ ${base}  → ${r.hit.code} (${r.hit.cuando}, ${fmtL(r.hit.litros)} L) por ${r.como}`);
      else { console.log(`  ❌ ${base}  → NO está en FleetOS`); litrosFalta += r.litros; }
    }
    totYa += ya; totFalta += filas.length - ya;
    console.log('');
  }
  console.log(`Resumen: ${totYa} ya en FleetOS · ${totFalta} faltan (${fmtL(litrosFalta)} L) · de ${PLANILLA.length} facturas.`);
  console.log('Las ❌ hay que pedirlas con el ticket (patente + km) para poder cargarlas.');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
