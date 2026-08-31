import { Router } from 'express';
import multer from 'multer';
import { dashboardController } from '../controllers/dashboardController';
import { absensiController } from '../controllers/absensiController';
import { ekinerjaController } from '../controllers/ekinerjaController';

const router = Router();

// Configure multer for disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Public Menus
router.get('/', dashboardController.show);

// Absensi & Klarifikasi
router.get('/absensi', absensiController.show);
router.post('/absensi/klarifikasi', upload.single('file'), absensiController.submitKlarifikasi);
router.post('/absensi/direct-update', absensiController.directUpdate);
router.post('/absensi/bulk-date-update', absensiController.bulkDateUpdate);

// Ekinerja
router.get('/ekinerja', ekinerjaController.show);
router.post('/ekinerja/submit', upload.fields([
  { name: 'fileHarian', maxCount: 1 },
  { name: 'fileBulanan', maxCount: 1 }
]), ekinerjaController.submitLaporan);

export default router;
