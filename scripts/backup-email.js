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

function fail(msg, err) {
  console.error('[backup] ✗ ' + msg + (err ? ' — ' + (err.message || err) : ''));
  process.exit(1);
}

// pg_dump → gzip en memoria. Usamos spawn con array de argumentos (sin shell),
// así la DATABASE_URL no puede inyectar comandos.
function dumpGzip() {
  return new Promise((resolve, reject) => {
    const dump = spawn('pg_dump', [DB_URL]);
    const gzip = zlib.createGzip();
    const chunks = [];
    let stderr = '';

    dump.stdout.pipe(gzip);
    dump.stderr.on('data', (d) => { stderr += d.toString(); });
    dump.on('error', (e) => reject(new Error('No se pudo ejecutar pg_dump (¿está instalado en el entorno?): ' + e.message)));
    dump.on('close', (code) => {
      if (code !== 0) reject(new Error('pg_dump terminó con código ' + code + ': ' + stderr.trim()));
    });

    gzip.on('data', (c) => chunks.push(c));
    gzip.on('end', () => resolve(Buffer.concat(chunks)));
    gzip.on('error', reject);
  });
}

async function main() {
  if (!DB_URL) fail('Falta DATABASE_URL');
  if (!TO || !SMTP_USER || !SMTP_PASS) fail('Faltan BACKUP_EMAIL_TO / SMTP_USER / SMTP_PASS');

  console.log('[backup] Generando dump con pg_dump…');
  const gz = await dumpGzip();
  const mb = gz.length / (1024 * 1024);

  const stamp = new Date()
    .toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
    .replace(' ', '_')
    .replace(/:/g, '-');
  const filename = `fleetos-backup-${stamp}.sql.gz`;

  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // 465 = SSL; 587 = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  if (mb > MAX_MB) {
    // Demasiado grande para adjuntar: avisamos igual para que no pase desapercibido.
    await transport.sendMail({
      from: SMTP_USER,
      to: TO,
      subject: `⚠ Backup FleetOS ${stamp} — DEMASIADO GRANDE para email (${mb.toFixed(1)} MB)`,
      text:
        `El backup se generó OK pero pesa ${mb.toFixed(1)} MB comprimido y supera el límite de adjunto (${MAX_MB} MB).\n` +
        `No se adjuntó. Conviene migrar el destino a un bucket (S3/Backblaze).`,
    });
    console.log(`[backup] ⚠ ${mb.toFixed(1)}MB > ${MAX_MB}MB: enviado aviso SIN adjunto a ${TO}`);
    return;
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

main().catch((e) => fail('Error general', e));
