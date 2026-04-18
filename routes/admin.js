// ═══════════════════════════════════════════
//  FleetOS / Biletta — Admin: Backup de DB
//  Solo accesible por rol 'dueno'
// ═══════════════════════════════════════════
const router = require('express').Router();
const { exec } = require('child_process');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/admin/backup — Descargar backup completo de la DB (gzip)
router.get('/backup', authenticate, requireRole('dueno'), (req, res) => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return res.status(500).json({ error: 'DATABASE_URL no configurada' });
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `biletta-backup-${timestamp}.sql.gz`;

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const dump = exec(`pg_dump "${dbUrl}" | gzip`, {
    maxBuffer: 200 * 1024 * 1024
  });

  dump.stdout.pipe(res);

  dump.stderr.on('data', (data) => {
    const msg = data.toString();
    if (!msg.includes('WARNING') && !msg.includes('NOTICE')) {
      console.error('[BACKUP stderr]', msg);
    }
  });

  dump.on('error', (err) => {
    console.error('[BACKUP] error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al generar backup' });
    }
  });

  dump.on('close', (code) => {
    if (code !== 0) {
      console.error('[BACKUP] exit code:', code);
    } else {
      console.log('[BACKUP] OK —', filename);
    }
  });
});

// GET /api/admin/backup/status — Verificar endpoint
router.get('/backup/status', authenticate, requireRole('dueno'), (req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    user: req.user?.name,
    message: 'Endpoint de backup operativo'
  });
});

module.exports = router;
