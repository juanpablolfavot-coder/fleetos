-- ════════════════════════════════════════════════════════════════════
--  004 — Traer los planes de mantenimiento que ya estaban en tech_spec
--
--  La pantalla de Mantenimiento venía guardando su configuración adentro del
--  JSONB vehicles.tech_spec:
--
--    maint_task_name    "Cambio aceite + filtros"
--    maint_interval_km  15000
--    maint_last_km      180000
--
--  Un solo plan por unidad, sin poder consultarlo desde SQL y sin nadie que
--  avise. La migración 003 creó maintenance_schedules, que soporta varios planes
--  por unidad, tres tipos de contador (km/horas/días) y aviso por push.
--
--  Esta migración importa lo que ya estaba configurado, para que nadie pierda su
--  trabajo al cambiar la pantalla. Es idempotente por partida doble: el índice
--  único (vehicle_id, lower(nombre)) más el ON CONFLICT DO NOTHING.
--
--  Solo importa unidades que TIENEN intervalo cargado. Las que nunca se
--  configuraron no se inventan.
--
--  ── El tipo: km u horas ──
--  La pantalla vieja guardaba las horas de una autoelevadora en la MISMA clave
--  maint_last_km que usaba para los kilómetros de un camión. Lo único que
--  decidía qué era ese número es isAutoelevador() de public/js/app.js:
--
--      trim → lower → sacar acentos → sacar espacios/guiones/_ → == 'autoelevador'
--
--  Acá se reproduce ese helper tal cual, con comparación exacta. Hoy da igual
--  hacerlo así o con un LIKE: vehicles.type tiene un CHECK que lo limita a 9
--  valores en minúscula ('camion', 'autoelevador', 'semirremolque', …), y sobre
--  ese conjunto las dos formas coinciden. Se copia el helper igual porque es la
--  única definición que existe de "esto se mide en horas", y si mañana se
--  relaja el CHECK el error no se vería: el plan quedaría comparando kilómetros
--  contra el horómetro sin fallar. test/mantenimiento.test.js corre el helper
--  real de app.js contra este CASE para que no se separen.
-- ════════════════════════════════════════════════════════════════════
INSERT INTO maintenance_schedules
    (vehicle_id, nombre, tipo, intervalo, aviso_antes, ultimo_valor, notas)
SELECT
    v.id,
    COALESCE(NULLIF(TRIM(v.tech_spec->>'maint_task_name'), ''), 'Cambio aceite + filtros'),
    CASE WHEN regexp_replace(
                 translate(LOWER(TRIM(COALESCE(v.type, ''))),
                           'áàäâãéèëêíìïîóòöôõúùüûñç',
                           'aaaaaeeeeiiiiooooouuuunc'),
                 '[[:space:]_-]+', '', 'g') = 'autoelevador'
         THEN 'horas' ELSE 'km' END,
    (v.tech_spec->>'maint_interval_km')::int,
    -- La pantalla vieja pintaba la barra en amarillo al 80% del intervalo y en
    -- rojo al 95%. Un décimo del intervalo deja el aviso en el 90%: en el medio,
    -- y con margen para llegar al taller.
    GREATEST(1, ((v.tech_spec->>'maint_interval_km')::int) / 10),
    -- El 0 que escribía `parseInt(...) || 0` cuando el campo quedaba vacío NO es
    -- una línea de base: es "no lo sé". Entra como NULL para que el plan quede
    -- 'sin_base' y alguien lo complete, en vez de fingir un service en el km 0.
    -- El guard del ~ es porque un ::numeric contra basura aborta la migración
    -- entera; si el valor no es un número, se importa sin base.
    CASE WHEN (v.tech_spec->>'maint_last_km') ~ '^[0-9]+(\.[0-9]+)?$'
         THEN NULLIF((v.tech_spec->>'maint_last_km')::numeric, 0) END,
    'Importado de tech_spec por la migración 004'
FROM vehicles v
WHERE v.tech_spec ? 'maint_interval_km'
  AND (v.tech_spec->>'maint_interval_km') ~ '^[0-9]+$'
  AND (v.tech_spec->>'maint_interval_km')::int > 0
ON CONFLICT DO NOTHING;
