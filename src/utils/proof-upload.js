const fs = require('fs');
const path = require('path');
const multer = require('multer');
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const proofDir = path.join(dataDir, 'uploads', 'proofs');
if (!fs.existsSync(proofDir)) fs.mkdirSync(proofDir, { recursive: true });

const allowedMime = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const allowedExt = ['.png', '.jpg', '.jpeg', '.webp', '.pdf'];

function createProofUpload(prefix) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, proofDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      const safeExt = allowedExt.includes(ext) ? ext : '.jpg';
      const companyId = req.company ? req.company.id : 'company';
      cb(null, `${prefix}-${companyId}-${Date.now()}${safeExt}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!allowedMime.includes(file.mimetype)) {
        return cb(new Error('Format bukti harus PNG/JPG/WEBP/PDF'));
      }
      return cb(null, true);
    },
  });
}

module.exports = { createProofUpload };
