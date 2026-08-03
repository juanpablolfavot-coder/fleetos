// ═══════════════════════════════════════════════════════════════════════════
//  Extractor de esquema declarado (db/schema-sources.js).
//
//  No necesita base de datos: son funciones puras sobre texto. Corren siempre.
//
//  Por qué existe este archivo: de este extractor sale la decisión de qué DDL
//  se puede borrar de routes/ y services/. Ya dio dos respuestas equivocadas
//  EN SILENCIO —no falló, contestó mal— y las dos veces el error apuntaba a
//  borrar o conservar lo que no era. Cada caso de abajo es uno de esos.
// ═══════════════════════════════════════════════════════════════════════════
const { test } = require('node:test');
const assert = require('node:assert');
const { analizar, leerDeclarado } = require('../db/schema-sources');

const js = (t) => analizar(t, { lenguaje: 'js' });

// ── Los dos errores reales, como regresión ────────────────────────────
test('un comentario de JS no es una declaración de esquema', () => {
  // Calcado de routes/suppliers.js:134. Sin limpiar comentarios, el extractor
  // leía una tabla llamada "no".
  const g = js(`
    // Bases viejas: CREATE TABLE IF NOT EXISTS no agrega columnas nuevas.
    await query(\`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email TEXT\`);
  `);
  assert.ok(!g.tablas.has('no'), 'el comentario no puede crear la tabla "no"');
  assert.ok(g.columnas.has('suppliers.email'), 'la columna de verdad sí se detecta');
});

test('un ";" adentro de un comentario SQL no corta la sentencia', () => {
  // Calcado de services/gps-powerfleet.js:284. El ";" del comentario cortaba
  // el ALTER y las tres columnas siguientes quedaban invisibles: el comparador
  // las reportaba como "deriva" estando declaradas tres líneas más abajo.
  const g = js(`
    await query(\`ALTER TABLE vehicles
      ADD COLUMN IF NOT EXISTS gps_lat NUMERIC(10,7),
      -- el estado nativo de la unidad; se venían descartando
      ADD COLUMN IF NOT EXISTS gps_address     TEXT,
      ADD COLUMN IF NOT EXISTS gps_vehicle_id  VARCHAR(60)\`);
  `);
  for (const c of ['vehicles.gps_lat', 'vehicles.gps_address', 'vehicles.gps_vehicle_id']) {
    assert.ok(g.columnas.has(c), `${c} tiene que detectarse aunque haya un ";" en un comentario`);
  }
});

// ── Formas que aparecen en el repo ────────────────────────────────────
test('un ALTER agrega varias columnas separadas por coma', () => {
  // db/01-compras.sql agrega 7 columnas en una sola sentencia. Con una regex
  // encadenada se veía solo la primera.
  const g = analizar(`
    ALTER TABLE purchase_orders
      ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) DEFAULT 'pendiente',
      ADD COLUMN IF NOT EXISTS destino         VARCHAR(200),
      ADD COLUMN IF NOT EXISTS enviada_por     UUID REFERENCES users(id);
  `);
  for (const c of ['purchase_orders.delivery_status', 'purchase_orders.destino', 'purchase_orders.enviada_por']) {
    assert.ok(g.columnas.has(c), `falta ${c}`);
  }
  assert.ok(!g.columnas.has('purchase_orders.id'), 'el id de REFERENCES users(id) no es una columna de esta tabla');
});

test('las columnas del cuerpo de un CREATE TABLE se leen sin confundir tipos ni FKs', () => {
  const g = analizar(`
    CREATE TABLE IF NOT EXISTS tanks (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      capacity_l  NUMERIC(12,2),
      vehicle_id  UUID REFERENCES vehicles(id),
      PRIMARY KEY (id),
      CONSTRAINT tanks_chk CHECK (capacity_l > 0)
    );
  `);
  for (const c of ['tanks.id', 'tanks.capacity_l', 'tanks.vehicle_id']) {
    assert.ok(g.columnas.has(c), `falta ${c}`);
  }
  // NUMERIC(12,2) no puede partirse en dos columnas por la coma interna, y las
  // restricciones no son columnas.
  assert.ok(!g.columnas.has('tanks.2'), 'la coma de NUMERIC(12,2) no separa columnas');
  assert.ok(!g.columnas.has('tanks.primary'), 'PRIMARY KEY no es una columna');
  assert.ok(!g.columnas.has('tanks.constraint'), 'CONSTRAINT no es una columna');
});

test('dos ALTER seguidos no se mezclan entre sí', () => {
  const g = js(`
    await query(\`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS uno TEXT\`);
    await query(\`ALTER TABLE tires ADD COLUMN IF NOT EXISTS dos TEXT\`);
  `);
  assert.ok(g.columnas.has('vehicles.uno'));
  assert.ok(g.columnas.has('tires.dos'));
  assert.ok(!g.columnas.has('vehicles.dos'), 'la columna de la segunda tabla no se le atribuye a la primera');
});

test('índices y tablas se detectan con sus variantes', () => {
  const g = analizar(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_algo ON t(a);
    CREATE INDEX idx_otro ON t(b);
  `);
  assert.ok(g.indices.has('uq_algo') && g.indices.has('idx_otro'));
});

test('una URL en el código no se confunde con un comentario', () => {
  const g = js(`
    const u = 'https://ejemplo.com/x'; // https://ejemplo.com/y
    await query(\`ALTER TABLE t ADD COLUMN IF NOT EXISTS c TEXT\`);
  `);
  assert.ok(g.columnas.has('t.c'), 'el "//" de la URL no puede tragarse el resto del archivo');
});

// ── Contra el repo real ───────────────────────────────────────────────
test('sobre el repo real detecta el DDL disperso donde está', () => {
  const { sql, codigo } = leerDeclarado();

  assert.ok(sql.tablas.has('vehicles'), 'db/schema.sql declara vehicles');
  assert.ok(sql.tablas.has('work_orders'), 'db/schema.sql declara work_orders');

  // Las columnas del ALTER multilínea de gps-powerfleet: son las que el bug
  // del ";" escondía.
  for (const c of ['vehicles.gps_address', 'vehicles.gps_state', 'vehicles.gps_vehicle_id']) {
    assert.strictEqual(codigo.columnas.get(c), 'services/gps-powerfleet.js', `${c} mal atribuida`);
  }

  // Las 4 tablas que no declara ningún db/*.sql y solo existen por el DDL de
  // servicios. Si alguna dejara de detectarse, el comparador diría que se puede
  // borrar ese DDL cuando no se puede.
  for (const t of ['idle_events', 'speeding_events', 'push_subscriptions', 'gps_webhook_events']) {
    assert.ok(codigo.tablas.has(t), `${t} tiene que detectarse en el código`);
    assert.ok(!sql.tablas.has(t), `${t} no la declara ningún db/*.sql`);
  }

  assert.ok(!codigo.tablas.has('no'), 'ninguna tabla fantasma salida de un comentario');
});
