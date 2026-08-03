#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
//  ¿Alcanzan los datos para vigilar el consumo de combustible?
//
//  SOLO LEE. No modifica ni una fila.
//
//  La idea que se quiere evaluar: calcular litros cada 100 km por unidad y
//  avisar cuando una se sale de su propio promedio. Una unidad que pasa de 35 a
//  42 L/100km está rota o le están sacando gasoil, y hoy eso solo se ve si
//  alguien se sienta a mirar planillas.
//
//  Los datos ya están en fuel_logs (litros, odómetro, chofer, fecha). La
//  pregunta no es si se puede calcular: es si el cálculo va a dar algo en lo que
//  se pueda confiar. Y eso depende de cosas que no se saben sin mirar:
//
//   1. ¿Cuántas cargas hay? Con 20 en total no hay nada que promediar.
//   2. ¿Tienen odómetro cargado? Sin odómetro no hay km recorridos.
//   3. ¿Cada unidad tiene VARIAS cargas? El promedio es contra sí misma, no
//      contra la flota: un tractor con acoplado y una camioneta no se comparan.
//   4. ¿El odómetro que escriben a mano es confiable? Un dígito de más y el
//      consumo da 3 L/100km. Si la mitad de los pares son basura, la alerta
//      grita en falso hasta que alguien la apaga — y una alerta apagada es peor
//      que no tenerla, porque da sensación de cobertura.
//
//  Este comando responde las cuatro con números, no con opinión. El veredicto
//  del final dice si conviene construirlo ahora o esperar a tener más cargas.
//
//  Uso:  npm run diag:combustible
// ════════════════════════════════════════════════════════════════════
require('dotenv').config();
const { Client } = require('pg');

// Un consumo fuera de este rango no es un consumo: es un error de tipeo en el
// odómetro. Los límites son anchos a propósito — abarcan desde una camioneta
// liviana hasta un tractor cargado en subida — porque acá no se busca juzgar el
// consumo, se busca separar el dato del error.
const L100_MIN = 10;
const L100_MAX = 120;

// Dos cargas separadas por más de esto casi seguro tienen una carga sin
// registrar en el medio: el consumo del tramo saldría absurdamente bajo.
const KM_MAX_ENTRE_CARGAS = 3000;

const fmt = (n) => Number(n || 0).toLocaleString('es-AR');
const f1 = (n) => Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('✗ Falta DATABASE_URL. Desde el Shell de Render: npm run diag:combustible');
    process.exit(2);
  }
  const client = new Client({
    connectionString: url,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  console.log('═'.repeat(74));
  console.log('  ¿Alcanzan los datos para vigilar el consumo?');
  console.log('═'.repeat(74));

  // ── 1. Qué hay ──────────────────────────────────────────────────────
  const g = (await client.query(`
    SELECT COUNT(*)                                                    AS total,
           COUNT(*) FILTER (WHERE fuel_type IS DISTINCT FROM 'urea')   AS gasoil,
           COUNT(*) FILTER (WHERE fuel_type = 'urea')                  AS urea,
           COUNT(*) FILTER (WHERE odometer_km IS NOT NULL
                              AND odometer_km > 0)                     AS con_odo,
           COUNT(*) FILTER (WHERE ticket_image IS NOT NULL)            AS con_foto,
           COUNT(DISTINCT vehicle_id)                                  AS unidades,
           MIN(logged_at)                                              AS desde,
           MAX(logged_at)                                              AS hasta
      FROM fuel_logs`)).rows[0];

  const total = Number(g.total);
  console.log(`\n── Lo que hay cargado ──`);
  if (!total) {
    console.log('  fuel_logs está vacía. No hay nada que analizar.');
    await client.end();
    process.exit(0);
  }
  const dias = Math.max(1, Math.round((new Date(g.hasta) - new Date(g.desde)) / 86400000));
  console.log(`  cargas registradas:   ${fmt(total)}  (${fmt(g.gasoil)} gasoil · ${fmt(g.urea)} urea)`);
  // pg devuelve un Date, no un string: String(date) da "Tue Jul 14 …", no la
  // fecha ISO. Hay que pasar por toISOString().
  const fecha = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  console.log(`  período:              ${fecha(g.desde)} → ${fecha(g.hasta)}  (${fmt(dias)} días, ~${f1(total / dias * 30)} por mes)`);
  console.log(`  unidades distintas:   ${fmt(g.unidades)}`);
  console.log(`  con odómetro:         ${fmt(g.con_odo)}  (${(g.con_odo / total * 100).toFixed(0)}%)  ← sin esto no hay km recorridos`);
  console.log(`  con foto del ticket:  ${fmt(g.con_foto)}  (${(g.con_foto / total * 100).toFixed(0)}%)`);

  // ── 2. Los pares consecutivos, que es de donde sale el consumo ──────
  // El consumo de un tramo son los litros de la carga N sobre los km entre la
  // carga N-1 y la N. Un par sirve solo si el odómetro avanzó algo razonable.
  const pares = await client.query(`
    WITH ordenadas AS (
      SELECT vehicle_id, liters, odometer_km, logged_at,
             LAG(odometer_km) OVER (PARTITION BY vehicle_id ORDER BY logged_at, odometer_km) AS odo_prev
        FROM fuel_logs
       WHERE fuel_type IS DISTINCT FROM 'urea'
         AND odometer_km IS NOT NULL AND odometer_km > 0
         AND liters IS NOT NULL AND liters > 0
    )
    SELECT vehicle_id,
           odometer_km - odo_prev                                     AS km,
           liters,
           (liters / NULLIF(odometer_km - odo_prev, 0)) * 100         AS l100
      FROM ordenadas
     WHERE odo_prev IS NOT NULL`);

  let atras = 0, salto = 0, fuera = 0;
  const buenos = [];
  const porUnidad = new Map();

  for (const p of pares.rows) {
    const km = Number(p.km);
    const l100 = Number(p.l100);
    if (km <= 0) { atras++; continue; }
    if (km > KM_MAX_ENTRE_CARGAS) { salto++; continue; }
    if (!Number.isFinite(l100) || l100 < L100_MIN || l100 > L100_MAX) { fuera++; continue; }
    buenos.push(l100);
    if (!porUnidad.has(p.vehicle_id)) porUnidad.set(p.vehicle_id, []);
    porUnidad.get(p.vehicle_id).push(l100);
  }

  const totalPares = pares.rows.length;
  console.log(`\n── Los pares de cargas consecutivas (de ahí sale el consumo) ──`);
  console.log(`  pares posibles:       ${fmt(totalPares)}`);
  if (totalPares) {
    console.log(`  ✓ utilizables:        ${fmt(buenos.length)}  (${(buenos.length / totalPares * 100).toFixed(0)}%)`);
    console.log(`  ✗ odómetro para atrás:${String(fmt(atras)).padStart(6)}   (error de tipeo o carga fuera de orden)`);
    console.log(`  ✗ salto > ${fmt(KM_MAX_ENTRE_CARGAS)} km:  ${String(fmt(salto)).padStart(6)}   (falta una carga en el medio)`);
    console.log(`  ✗ consumo imposible:  ${String(fmt(fuera)).padStart(6)}   (fuera de ${L100_MIN}-${L100_MAX} L/100km)`);
  }

  // ── 3. ¿Cada unidad tiene suficiente historia propia? ───────────────
  // La comparación es contra el promedio de la MISMA unidad. Con menos de 5
  // tramos buenos, ese promedio se mueve tanto que cualquier cosa parece
  // anomalía. Con 5+ ya se puede decir algo.
  const MIN_TRAMOS = 5;
  const listas = [...porUnidad.values()];
  const conHistoria = listas.filter((v) => v.length >= MIN_TRAMOS);

  console.log(`\n── Historia por unidad (el promedio es contra sí misma) ──`);
  console.log(`  unidades con algún tramo bueno:   ${fmt(listas.length)}`);
  console.log(`  unidades con ${MIN_TRAMOS}+ tramos:            ${fmt(conHistoria.length)}  ← sobre estas se podría alertar`);

  // Con 3 tramos, "la mediana" y "la mitad central" son adorno estadístico
  // sobre nada. Mejor no imprimirlos que imprimir un número que invita a
  // sacar una conclusión que los datos no sostienen.
  if (buenos.length >= 5) {
    const orden = [...buenos].sort((a, b) => a - b);
    const pct = (p) => orden[Math.min(orden.length - 1, Math.floor(orden.length * p))];
    console.log(`\n  Consumo de los tramos buenos (L/100km):`);
    console.log(`    mínimo ${f1(orden[0])} · mediana ${f1(pct(0.5))} · máximo ${f1(orden[orden.length - 1])}`);
    console.log(`    la mitad central cae entre ${f1(pct(0.25))} y ${f1(pct(0.75))}`);
  } else if (buenos.length) {
    console.log(`\n  (${buenos.length} tramo(s) bueno(s): muy pocos para describir el consumo)`);
  }

  await client.end();

  // ── Veredicto ───────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(74));
  const utiles = totalPares ? buenos.length / totalPares : 0;

  // El orden de estos tres casos importa. Cuando los datos son pocos Y sucios
  // los dos diagnósticos son ciertos a la vez, pero mandan a hacer cosas
  // distintas: "esperá a que se acumulen cargas" es un mal consejo si el
  // problema es que el odómetro se carga mal, porque esperar no lo arregla —
  // solo junta más basura. Así que la calidad del dato se evalúa primero,
  // apenas hay pares suficientes para que el porcentaje signifique algo.
  const MIN_PARES_PARA_JUZGAR = 10;

  if (totalPares < MIN_PARES_PARA_JUZGAR) {
    console.log('VEREDICTO: todavía no se puede saber.');
    console.log(`  Hay ${fmt(totalPares)} par(es) de cargas consecutivas: muy pocos para juzgar`);
    console.log('  ni la calidad del dato ni el consumo. Volvé a correr esto cuando se');
    console.log('  hayan registrado más cargas con odómetro.');
  } else if (utiles < 0.5) {
    console.log('VEREDICTO: primero hay que arreglar el DATO, no construir la alerta.');
    console.log(`  Solo el ${(utiles * 100).toFixed(0)}% de los pares sirve. El resto son odómetros mal`);
    console.log('  cargados o cargas que no se registraron. Una alerta sobre esto grita en');
    console.log('  falso hasta que alguien la apaga, y una alerta apagada es peor que no');
    console.log('  tenerla: da sensación de cobertura sin darla.');
    console.log('  Lo que sí conviene: validar el odómetro EN EL MOMENTO de cargar (avisarle');
    console.log('  al chofer si el número que puso es menor al anterior o salta demasiado).');
  } else if (conHistoria.length === 0) {
    console.log('VEREDICTO: el dato está limpio, pero todavía NO alcanza.');
    console.log(`  El ${(utiles * 100).toFixed(0)}% de los pares sirve, así que el odómetro se carga bien.`);
    console.log(`  Lo que falta es historia: ninguna unidad llega a ${MIN_TRAMOS} tramos propios, y el`);
    console.log('  promedio es contra sí misma. Acá sí conviene esperar y volver a medir.');
  } else {
    console.log('VEREDICTO: sí, hay con qué.');
    console.log(`  ${fmt(conHistoria.length)} unidad(es) con historia propia y ${(utiles * 100).toFixed(0)}% de pares utilizables.`);
    console.log('  La alerta se puede construir sobre promedio móvil por unidad.');
  }
  console.log('─'.repeat(74));
  console.log('\nEste comando no modificó nada: solo leyó.\n');
}

main().catch((e) => {
  console.error('✗ Error:', e.message);
  process.exit(1);
});
