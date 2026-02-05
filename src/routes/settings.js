const express = require('express');
const { requireCompany, requireAuth, requireRole } = require('../utils/auth');
const { setFlash } = require('../utils/flash');
const { getCompanyById } = require('../db/master');
const { runAutoBackup, buildDatabaseBackupCsv } = require('../utils/backup');

const router = express.Router();

router.get('/settings', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  const company = await getCompanyById(req.company.id);
  res.render('pages/settings', { company });
});

router.get('/backup/company', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  try {
    const csv = await buildDatabaseBackupCsv(req.company.id);
    const filename = `backup-${req.company.slug || req.company.id}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    setFlash(req, 'error', 'Gagal membuat backup CSV.');
    return res.redirect('/settings');
  }
});

router.post('/backup/test', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter((key) => !process.env[key]);
  if (missing.length) {
    setFlash(req, 'error', 'SMTP belum lengkap. Isi SMTP_HOST, SMTP_USER, SMTP_PASS di Render.');
    return res.redirect('/settings');
  }
  try {
    await runAutoBackup();
    setFlash(req, 'success', 'Backup otomatis sedang dikirim. Cek email user utama.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal menjalankan backup otomatis.');
  }
  return res.redirect('/settings');
});

module.exports = router;
