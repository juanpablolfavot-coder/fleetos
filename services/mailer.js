// ════════════════════════════════════════════════════════════════════
//  Mailer — envío de emails reutilizable (reusa la config SMTP del backup)
//  Variables de entorno (las mismas que ya usa scripts/backup-email.js):
//    SMTP_USER, SMTP_PASS   → credenciales (Gmail: App Password de 16)
//    SMTP_HOST (def smtp.gmail.com), SMTP_PORT (def 465 = SSL)
// ════════════════════════════════════════════════════════════════════
const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

let _transport = null;
function getTransport() {
  if (!_transport) {
    _transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // 465 = SSL; 587 = STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return _transport;
}

// ¿Está configurado el envío de mails? (sin credenciales no se intenta).
function mailEnabled() {
  return !!(SMTP_USER && SMTP_PASS);
}

/**
 * Envía un email. Lanza si el SMTP no está configurado o si el envío falla;
 * quien lo llama decide si eso es fatal o no (en OC NO debe romper el flujo).
 */
async function sendMail({ to, subject, text, html, attachments, bcc, replyTo }) {
  if (!mailEnabled()) throw new Error('SMTP no configurado (faltan SMTP_USER / SMTP_PASS)');
  return getTransport().sendMail({
    from: `Expreso Biletta <${SMTP_USER}>`,
    to,
    bcc: bcc || undefined,
    replyTo: replyTo || undefined,
    subject,
    text,
    html,
    attachments,
  });
}

module.exports = { mailEnabled, sendMail };
