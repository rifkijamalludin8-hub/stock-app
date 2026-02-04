const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { requireCompany, requireAuth, requireRole } = require('../utils/auth');
const { setFlash } = require('../utils/flash');
const { dataDir, updateCompanyLogo, getCompanyById } = require('../db/master');

const router = express.Router();

const uploadDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png';
    cb(null, `logo-company-${req.company.id}-${Date.now()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    if (!ok) return cb(new Error('Format logo harus PNG/JPG/WEBP'));
    cb(null, true);
  },
});

router.get('/settings', requireCompany, requireAuth, requireRole('user'), (req, res) => {
  const company = getCompanyById(req.company.id);
  res.render('pages/settings', { company });
});

router.post(
  '/settings/logo',
  requireCompany,
  requireAuth,
  requireRole('user'),
  upload.single('logo'),
  (req, res) => {
    if (!req.file) {
      setFlash(req, 'error', 'File logo wajib diunggah.');
      return res.redirect('/settings');
    }
    const relativePath = path.join('uploads', req.file.filename);
    try {
      const company = getCompanyById(req.company.id);
      if (company && company.logo_path) {
        const oldPath = path.join(dataDir, company.logo_path);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      updateCompanyLogo(req.company.id, relativePath);
      setFlash(req, 'success', 'Logo berhasil diperbarui.');
    } catch (err) {
      setFlash(req, 'error', 'Gagal menyimpan logo.');
    }
    res.redirect('/settings');
  }
);

router.get('/backup/company', requireCompany, requireAuth, requireRole('user'), (req, res) => {
  const company = getCompanyById(req.company.id);
  if (!company || !company.db_path) {
    setFlash(req, 'error', 'Database perusahaan tidak ditemukan.');
    return res.redirect('/settings');
  }
  const filename = `backup-${company.slug}-${new Date().toISOString().slice(0, 10)}.db`;
  res.download(company.db_path, filename);
});

module.exports = router;
