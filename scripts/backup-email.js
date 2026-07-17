// ═══════════════════════════════════════════════════════════════════════════
//  FleetOS — Backup automático por email
//  Corre pg_dump → gzip → manda el .sql.gz adjunto a un email.
//  Pensado para ejecutarse como Cron Job de Render (capa 2: copia fuera de Render).
//  Uso manual:  npm run backup
//
//  Variables de entorno necesarias:
//    DATABASE_URL      cadena de conexión a Postgres (ya la usa el resto del sistema)
//    BACKUP_EMAIL_TO   destinatario del backup (ej: tu Gmail)
//    SMTP_USER         usuario SMTP (ej: tu Gmail)
//    SMTP_PASS         contraseña SMTP (en Gmail: una "App Password" de 16 caracteres)
//  Opcionales:
//    SMTP_HOST         por defecto smtp.gmail.com
//    SMTP_PORT         por defecto 465 (SSL)
//    BACKUP_MAX_MB     límite de adjunto en MB, por defecto 20 (Gmail corta en ~25)
//    BACKUP_MIN_KB     tamaño mínimo esperado del .gz en KB, por defecto 5 — un dump
//                      más chico casi seguro es una base vacía/equivocada y se rechaza
// ═══════════════════════════════════════════════════════════════════════════
require('dotenv').config();
const { spawn } = require('child_process');
const zlib = require('zlib');
const nodemailer = require('nodemailer');

const DB_URL    = process.env.DATABASE_URL;
const TO        = process.env.BACKUP_EMAIL_TO;
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAX_MB    = parseInt(process.env.BACKUP_MAX_MB || '20', 10);
const MIN_KB    = parseInt(process.env.BACKUP_MIN_KB || '5', 10);

// pg_dump en formato plano cierra SIEMPRE con esta línea; si no está, el dump
// quedó cortado a la mitad (conexión caída, OOM, proceso matado).
const DUMP_END_MARKER = 'PostgreSQL database dump complete';

function fail(msg, err) {
  console.error('[backup] ✗ ' + msg + (err ? ' — ' + (err.message || err) : ''));
  process.exit(1);
}

// pg_dump → gzip en memoria. Usamos spawn con array de argumentos (sin shell),
// así la DATABASE_URL no puede inyectar comandos.
// Resuelve SOLO si: pg_dump salió con código 0 Y el dump termina con el marcador
// de cierre. Un exit≠0 o un dump truncado rechazan, aunque gzip haya emitido
// bytes — antes resolvíamos en gzip 'end' y un dump cortado se mandaba como OK.
function dumpGzip() {
  return new Promise((resolve, reject) => {
    const dump = spawn('pg_dump', [DB_URL]);
    const gzip = zlib.createGzip();
    const chunks = [];
    let stderr = '';
    let tail = '';          // últimos bytes del dump sin comprimir, para verificar el cierre
    let gzipDone = false;
    let exitCode = null;    // null = pg_dump todavía no terminó
    let settled = false;

    const settle = (err) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(Buffer.concat(chunks));
    };

    // Hace falta que terminen LOS DOS (proceso y stream) para decidir.
    const tryFinish = () => {
      if (!gzipDone || exitCode === null) return;
      if (exitCode !== 0) {
        return settle(new Error('pg_dump terminó con código ' + exitCode + ': ' + stderr.trim()));
      }
      if (!tail.includes(DUMP_END_MARKER)) {
        return settle(new Error('El dump está TRUNCADO (no termina con "' + DUMP_END_MARKER + '") — no se envía.'));
      }
      settle(null);
    };

    dump.stdout.on('data', (d) => { tail = (tail + d.toString('latin1')).slice(-500); });
    dump.stdout.pipe(gzip);
    dump.stderr.on('data', (d) => { stderr += d.toString(); });
    dump.on('error', (e) => settle(new Error('No se pudo ejecutar pg_dump (¿está instalado en el entorno?): ' + e.message)));
    dump.on('close', (code) => { exitCode = code; tryFinish(); });

    gzip.on('data', (c) => chunks.push(c));
    gzip.on('end', () => { gzipDone = true; tryFinish(); });
    gzip.on('error', (e) => settle(e));
  });
}

function makeTransport() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // 465 = SSL; 587 = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

// Si el backup falla, avisar por email (si hay SMTP configurado): que el cron
// falle en silencio es exactamente lo que no puede pasar con la copia principal.
async function notifyFailure(err) {
  if (!TO || !SMTP_USER || !SMTP_PASS) return;
  try {
    await makeTransport().sendMail({
      from: SMTP_USER,
      to: TO,
      subject: '❌ Backup FleetOS FALLÓ — NO hay copia de hoy',
      text:
        'El backup automático de FleetOS falló y NO se generó copia.\n\n' +
        'Error: ' + (err && (err.message || err)) + '\n\n' +
        'Revisá los logs del Cron Job en Render y volvé a correrlo a mano (npm run backup).\n',
    });
    console.error('[backup] Aviso de falla enviado a ' + TO);
  } catch (e2) {
    console.error('[backup] No se pudo enviar el aviso de falla: ' + (e2.message || e2));
  }
}

async function main() {
  if (!DB_URL) fail('Falta DATABASE_URL');
  if (!TO || !SMTP_USER || !SMTP_PASS) fail('Faltan BACKUP_EMAIL_TO / SMTP_USER / SMTP_PASS');

  console.log('[backup] Generando dump con pg_dump…');
  const gz = await dumpGzip();
  const kb = gz.length / 1024;
  const mb = kb / 1024;

  if (kb < MIN_KB) {
    throw new Error(`El dump pesa solo ${kb.toFixed(1)} KB (mínimo esperado ${MIN_KB} KB) — ` +
      '¿DATABASE_URL apunta a la base correcta? No se envía.');
  }

  const stamp = new Date()
    .toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
    .replace(' ', '_')
    .replace(/:/g, '-');
  const filename = `fleetos-backup-${stamp}.sql.gz`;

  const transport = makeTransport();

  if (mb > MAX_MB) {
    // Demasiado grande para adjuntar: avisamos Y salimos con error, porque el
    // resultado real es que HOY no quedó copia externa — no es un éxito.
    await transport.sendMail({
      from: SMTP_USER,
      to: TO,
      subject: `❌ Backup FleetOS ${stamp} — SIN COPIA: supera el límite de email (${mb.toFixed(1)} MB)`,
      text:
        `El dump se generó bien pero pesa ${mb.toFixed(1)} MB comprimido y supera el límite de adjunto (${MAX_MB} MB), ` +
        `así que NO se adjuntó: hoy NO quedó copia externa de la base.\n\n` +
        `Esto va a pasar todos los días de acá en más (la base solo crece). Hay que migrar el destino ` +
        `del backup a un bucket (S3/Backblaze) o sacar las imágenes base64 de la base.\n`,
    });
    fail(`${mb.toFixed(1)}MB > ${MAX_MB}MB: no se pudo adjuntar — enviado aviso a ${TO}`);
  }

  await transport.sendMail({
    from: SMTP_USER,
    to: TO,
    subject: `✅ Backup FleetOS ${stamp} (${mb.toFixed(1)} MB)`,
    text:
      `Backup automático de la base de FleetOS.\n\n` +
      `Archivo:   ${filename}\n` +
      `Tamaño:    ${mb.toFixed(1)} MB (comprimido)\n` +
      `Generado:  ${stamp} (hora Argentina)\n\n` +
      `Guardá este adjunto en un lugar seguro. Para restaurar:\n` +
      `  gunzip -c ${filename} | psql "TU_DATABASE_URL"\n`,
    attachments: [{ filename, content: gz }],
  });
  console.log(`[backup] ✓ ${filename} (${mb.toFixed(1)} MB) enviado a ${TO}`);
}

if (require.main === module) {
  main().catch(async (e) => {
    await notifyFailure(e);
    fail('Error general', e);
  });
} else {
  // Para tests: exponer la pieza crítica sin ejecutar nada.
  module.exports = { dumpGzip, DUMP_END_MARKER };
}
