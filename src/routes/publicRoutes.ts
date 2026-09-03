import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dashboardController } from '../controllers/dashboardController';
import { absensiController } from '../controllers/absensiController';
import { ekinerjaController } from '../controllers/ekinerjaController';
import { checkMaintenance } from '../middleware/maintenanceMiddleware';

const router = Router();

// Helper to get safe writable upload directory (handles Vercel Serverless read-only filesystem)
const getUploadDir = () => {
  const localUploadDir = path.join(process.cwd(), 'public', 'uploads');
  try {
    if (!fs.existsSync(localUploadDir)) {
      fs.mkdirSync(localUploadDir, { recursive: true });
    }
    fs.accessSync(localUploadDir, fs.constants.W_OK);
    return localUploadDir;
  } catch {
    const tmpUploadDir = path.join(os.tmpdir(), 'uploads');
    if (!fs.existsSync(tmpUploadDir)) {
      fs.mkdirSync(tmpUploadDir, { recursive: true });
    }
    return tmpUploadDir;
  }
};

// Configure multer for memory storage (Max 1MB per berkas)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 } // 1MB
});

// Public Menus
router.get('/ping', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), env: process.env.NODE_ENV });
});
router.get('/', checkMaintenance('dashboard', 'Dashboard Utama'), dashboardController.show);

// Absensi & Klarifikasi
router.get('/absensi', checkMaintenance('absensi', 'Rekap Absensi Harian'), absensiController.show);
router.post('/absensi/klarifikasi', checkMaintenance('klarifikasi', 'Pengajuan Klarifikasi Absensi'), upload.single('file'), absensiController.submitKlarifikasi);
router.post('/absensi/direct-update', absensiController.directUpdate);
router.post('/absensi/bulk-date-update', absensiController.bulkDateUpdate);

// Ekinerja
router.get('/ekinerja', checkMaintenance('ekinerja', 'Laporan E-Kinerja Pegawai'), ekinerjaController.show);
router.post('/ekinerja/submit', checkMaintenance('ekinerja', 'Pengunggahan Laporan E-Kinerja'), upload.fields([
  { name: 'fileHarian', maxCount: 1 },
  { name: 'fileBulanan', maxCount: 1 }
]), ekinerjaController.submitLaporan);

export default router;
