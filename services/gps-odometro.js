// ═══════════════════════════════════════════════════════════
//  FleetOS — Km del mes según el GPS (odómetro)
//
//  POR QUÉ EXISTE
//  Los km del mes se venían calculando con los odómetros anotados en las cargas
//  de combustible. Ese número depende de CUÁNDO cargó cada unidad: si un camión
//  carga el 28 y vuelve a cargar el 5, sus km quedan repartidos entre dos meses.
//  Sobre 21 unidades eso da diferencias de miles de km contra el satelital, y fue
//  lo que hizo sospechar un faltante de combustible que no existía.
//
//  El GPS mide la distancia real y su odómetro es un acumulador: no importa que
//  su valor absoluto no coincida con el tablero (cada uno tiene su origen), lo
//  que importa es la DIFERENCIA entre dos fechas. Entonces:
//
//      km del mes = odómetro del último día del mes − odómetro del último día
//                   del mes anterior
//
//  Exacto, con corte al día, y sin pedirle nada distinto a los choferes.
//
//  CÓMO
//  Una foto diaria del odómetro de cada unidad (tabla vehicle_gps_odometro) y el
//  consolidado por mes (tabla vehicle_gps_km). El odómetro sale del DETALLE de
//  cada vehículo: la lista general devuelve 0, el detalle sí lo trae.
// ═══════════════════════════════════════════════════════════
const { query } = require('../db/pool');
const { apiRequest } = require('./gps-powerfleet');

let _ultimaCaptura = null;

async function ensureTablas() {
  await query(`
    CREATE TABLE IF NOT EXISTS vehicle_gps_odometro (
      vehicle_id   UUID NOT NULL,
      fecha        DATE NOT NULL,
      odometro_km  NUMERIC(12,2) NOT NULL,
      capturado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (vehicle_id, fecha)
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS vehicle_gps_km (
      vehicle_id UUID NOT NULL,
      periodo    VARCHAR(7) NOT NULL,           -- 'YYYY-MM'
      km         NUMERIC(12,2) NOT NULL,
      fuente     VARCHAR(20) NOT NULL,          -- 'odometro' | 'informe'
      desde      DATE,                          -- cobertura real del dato…
      hasta      DATE,                          -- …para poder marcar meses parciales
      notas      TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (vehicle_id, periodo)
    )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_gps_odo_fecha ON vehicle_gps_odometro(fecha DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_gps_km_periodo ON vehicle_gps_km(periodo)`);
}

// Fecha de hoy en hora argentina (el server corre en UTC).
function hoyAR() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

// ── Foto del odómetro de todas las unidades ────────────────
// Se queda con la ÚLTIMA lectura de cada día: al correr varias veces, la del
// final del día es la que refleja todo lo recorrido.
async function capturarOdometros() {
  await ensureTablas();
  const fecha = hoyAR();

  const lista = await apiRequest('/Fleetcore.Api/api/fleetview/vehicles');
  if (lista.status !== 200) return { ok: false, error: `lista GPS status ${lista.status}` };

  const unidades = [];
  try {
    const d = JSON.parse(lista.body);
    for (const g of (d?.data?.fleet?.groups || []))
      for (const v of (g.vehicles || [])) {
        const id = v.vehicleId || v.id;
        if (id && v.licensePlate) unidades.push({ id, patente: String(v.licensePlate).trim().toUpperCase() });
      }
  } catch (e) { return { ok: false, error: 'respuesta GPS ilegible' }; }

  let guardados = 0, sinOdo = 0, sinVehiculo = 0;
  for (const u of unidades) {
    let det;
    try { det = await apiRequest(`/Fleetcore.Api/api/fleetview/vehicles/${u.id}`, { timeout: 12000 }); }
    catch (_) { continue; }
    if (det.status !== 200) continue;

    let odo = null;
    try { odo = parseFloat(JSON.parse(det.body)?.data?.vehicle?.odometer); } catch (_) {}
    if (!(odo > 0)) { sinOdo++; continue; }

    const veh = await query('SELECT id FROM vehicles WHERE UPPER(plate)=$1 OR UPPER(code)=$1', [u.patente]);
    if (!veh.rows[0]) { sinVehiculo++; continue; }

    await query(
      `INSERT INTO vehicle_gps_odometro (vehicle_id, fecha, odometro_km)
       VALUES ($1,$2::date,$3)
       ON CONFLICT (vehicle_id, fecha) DO UPDATE
         SET odometro_km = EXCLUDED.odometro_km, capturado_at = NOW()`,
      [veh.rows[0].id, fecha, odo]);
    guardados++;
  }

  _ultimaCaptura = new Date().toISOString();
  return { ok: true, fecha, guardados, sinOdo, sinVehiculo, total: unidades.length };
}

// ── Consolidar el km de un mes a partir de las fotas diarias ──
// km del mes = última lectura del mes − última lectura del mes anterior.
// Solo escribe si hay lectura de ambos meses (si no, no se puede medir).
async function consolidarMes(periodo) {
  await ensureTablas();
  const r = await query(`
    WITH ult AS (   -- última lectura de cada unidad en cada mes
      SELECT DISTINCT ON (vehicle_id, TO_CHAR(fecha,'YYYY-MM'))
             vehicle_id, TO_CHAR(fecha,'YYYY-MM') AS periodo, fecha, odometro_km
        FROM vehicle_gps_odometro
       ORDER BY vehicle_id, TO_CHAR(fecha,'YYYY-MM'), fecha DESC
    )
    INSERT INTO vehicle_gps_km (vehicle_id, periodo, km, fuente, desde, hasta, notas, updated_at)
    SELECT a.vehicle_id, a.periodo, a.odometro_km - p.odometro_km, 'odometro', p.fecha, a.fecha,
           'Odómetro GPS: diferencia entre la última lectura del mes y la del mes anterior', NOW()
      FROM ult a
      JOIN ult p ON p.vehicle_id = a.vehicle_id
                AND p.periodo = TO_CHAR((a.periodo || '-01')::date - INTERVAL '1 month', 'YYYY-MM')
     WHERE a.periodo = $1 AND a.odometro_km >= p.odometro_km
    ON CONFLICT (vehicle_id, periodo) DO UPDATE
      SET km = EXCLUDED.km, fuente = EXCLUDED.fuente, desde = EXCLUDED.desde,
          hasta = EXCLUDED.hasta, notas = EXCLUDED.notas, updated_at = NOW()
     WHERE vehicle_gps_km.fuente <> 'informe'   -- un dato cargado del informe no se pisa
    RETURNING vehicle_id`, [periodo]);
  return { periodo, unidades: r.rowCount };
}

// ── Programación: una captura por día ──────────────────────
// Se revisa cada hora si ya hay foto de hoy; si no, la toma. Así no depende de
// que el server esté vivo a una hora exacta.
function programarCaptura() {
  const correr = async () => {
    try {
      const fecha = hoyAR();
      await ensureTablas();
      const ya = await query('SELECT 1 FROM vehicle_gps_odometro WHERE fecha=$1::date LIMIT 1', [fecha]);
      const esFinDeDia = new Date(Date.now() - 3 * 3600 * 1000).getUTCHours() >= 21;
      if (ya.rows[0] && !esFinDeDia) return;      // ya hay foto de hoy y no es el cierre
      const res = await capturarOdometros();
      if (res.ok) {
        console.log(`[GPS-ODO] Foto ${res.fecha}: ${res.guardados}/${res.total} unidades` +
          (res.sinOdo ? ` · ${res.sinOdo} sin odómetro` : '') +
          (res.sinVehiculo ? ` · ${res.sinVehiculo} sin vehículo en FleetOS` : ''));
        const per = res.fecha.slice(0, 7);
        const c = await consolidarMes(per);
        if (c.unidades) console.log(`[GPS-ODO] Km consolidado ${per}: ${c.unidades} unidades`);
      } else {
        console.warn('[GPS-ODO] No se pudo capturar:', res.error);
      }
    } catch (e) { console.warn('[GPS-ODO] Error:', e.message); }
  };
  setTimeout(correr, 60 * 1000);            // primera pasada al minuto de arrancar
  setInterval(correr, 60 * 60 * 1000);      // y después, una revisión por hora
  console.log('[GPS-ODO] Captura diaria de odómetro programada');
}

module.exports = { capturarOdometros, consolidarMes, programarCaptura, ensureTablas,
  estado: () => ({ ultimaCaptura: _ultimaCaptura }) };
