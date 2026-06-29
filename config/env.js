// ════════════════════════════════════════════════════════════════════
//  Validación de variables de entorno al ARRANQUE (auditoría P0).
//
//  Sin esto, si una env falta o queda mal en Render, el server levanta igual y
//  la falla aparece tarde y disfrazada (401 confusos sin JWT_SECRET; explota en
//  la primera query sin DATABASE_URL). Acá abortamos temprano con un mensaje
//  claro de causa raíz.
//
//  Criterio CONSERVADOR: solo se aborta por las variables sin las cuales el
//  sistema NO puede funcionar (JWT_SECRET, DATABASE_URL) — si el deploy hoy
//  anda, esas ya están, así que esta guarda nunca rompe algo que funcionaba.
//  El resto son advertencias.
// ════════════════════════════════════════════════════════════════════

function validateEnv() {
  const isProd = process.env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];

  // Críticas: sin estas el sistema no arranca de forma útil.
  if (!process.env.JWT_SECRET) {
    errors.push('JWT_SECRET — sin esto TODO login/refresh falla con 401.');
  } else if (process.env.JWT_SECRET.length < 32) {
    warnings.push('JWT_SECRET es corto (<32 caracteres): conviene uno más largo y aleatorio.');
  }
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL — sin esto la primera query a la base explota.');
  }

  // Recomendadas en producción (no abortan: solo avisan).
  if (isProd && !process.env.FRONTEND_URL) {
    warnings.push('FRONTEND_URL no está seteada en producción: el CORS queda sin whitelist (ver auditoría P3).');
  }
  if (isProd && !process.env.ADMIN_PASSWORD) {
    warnings.push('ADMIN_PASSWORD no está seteada: el admin inicial usa una contraseña aleatoria de un solo uso.');
  }

  warnings.forEach((w) => console.warn('[env] ⚠ ' + w));

  if (errors.length) {
    console.error('\n[env] ❌ Faltan variables de entorno CRÍTICAS:');
    errors.forEach((e) => console.error('   - ' + e));
    console.error('[env] Abortando el arranque. Configurá esas variables en Render y reintentá.\n');
    process.exit(1);
  }

  console.log('[env] ✓ Variables de entorno verificadas');
}

module.exports = { validateEnv };
