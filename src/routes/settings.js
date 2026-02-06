const express = require('express');
const { requireCompany, requireAuth, requireRole } = require('../utils/auth');
const { setFlash } = require('../utils/flash');
const { getCompanyById } = require('../db/master');
const { runAutoBackup, buildDatabaseBackupWorkbook } = require('../utils/backup');

const router = express.Router();

router.get('/settings', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  const company = await getCompanyById(req.company.id);
  res.render('pages/settings', { company });
});

router.get('/backup/company', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  try {
    const { workbook } = await buildDatabaseBackupWorkbook(req.company.id);
    const filename = `backup-${req.company.slug || req.company.id}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    setFlash(req, 'error', 'Gagal membuat backup Excel.');
    return res.redirect('/settings');
  }
});

router.post('/backup/test', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter((key) => !process.env[key]);
  if (missing.length) {
    setFlash(req, 'error', 'SMTP belum lengkap. Isi SMTP_HOST, SMTP_USER, SMTP_PASS di Render.');
    return res.redirect('/settings');
  }
  runAutoBackup().catch((err) => {
    console.error('Manual backup failed:', err);
  });
  setFlash(req, 'success', 'Backup sedang diproses. Cek email user utama dan Logs bila belum masuk.');
  return res.redirect('/settings');
});

module.exports = router;
