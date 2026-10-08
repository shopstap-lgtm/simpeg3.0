import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dashboardController } from '../controllers/dashboardController';
import { absensiController } from '../controllers/absensiController';
import { ekinerjaController } from '../controllers/ekinerjaController';
import { ncrPublicController } from '../controllers/ncrPublicController';
import { publicFormController } from '../controllers/publicFormController';
import { sheetPublicController } from '../controllers/sheetPublicController';
import { smartSheetController } from '../controllers/admin/smartSheetController';
import { checkMaintenance } from '../middleware/maintenanceMiddleware';
import { presenceService } from '../services/presenceService';

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

// Configure multer for form file uploads (disk storage, up to 10MB)
const formDiskUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, getUploadDir());
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, 'form-' + uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Configure multer for sheet cell file uploads (disk storage, up to 50MB ceiling)
const sheetCellUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, getUploadDir());
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const cleanBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
      cb(null, `sheet-${uniqueSuffix}-${cleanBase}${ext}`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 }
});

// Public Menus
router.get('/ping', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), env: process.env.NODE_ENV });
});
router.get('/', checkMaintenance('dashboard', 'Dashboard Utama'), dashboardController.show);

// Absensi & Klarifikasi
router.get('/absensi/export/excel', absensiController.exportExcel);
router.get('/absensi/export/pdf', absensiController.exportPdf);
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

// NCR Gaji Pegawai
router.get('/ncr-gaji', checkMaintenance('ncr', 'NCR Gaji Pegawai'), ncrPublicController.show);
router.get('/ncr-gaji/search-employees', ncrPublicController.searchEmployees);
router.post('/ncr-gaji/check', checkMaintenance('ncr', 'NCR Gaji Pegawai'), ncrPublicController.checkEligibility);
router.post('/ncr-gaji/download', checkMaintenance('ncr', 'NCR Gaji Pegawai'), ncrPublicController.downloadSlip);

// Dynamic Forms (Public & Pegawai)
router.get('/form/:slug', publicFormController.renderForm);
router.post('/form/:slug/submit', formDiskUpload.any(), publicFormController.submitForm);
router.get('/form/:slug/success', publicFormController.renderSuccess);

router.get('/sheet/:slug', sheetPublicController.show);
router.post('/sheet/:slug/verify-nip', sheetPublicController.verifyNip);
router.post('/sheet/:slug/lock-row', sheetPublicController.lockRow);
router.post('/sheet/:slug/save-row', sheetPublicController.saveRow);
router.post('/sheet/:slug/upload-cell', sheetCellUpload.single('file'), sheetPublicController.uploadCellFile);
router.post('/sheet/:slug/bulk-save', sheetPublicController.bulkSave);
router.get('/sheet/:slug/export', sheetPublicController.exportXlsx);

// Smart Sheets (Grid Spreadsheet Interaktif)
router.get('/smart-sheet/:slug', smartSheetController.viewGrid);
router.post('/smart-sheet/:id/save', smartSheetController.saveGrid);
router.post('/smart-sheet/:id/upload-cell', sheetCellUpload.single('file'), smartSheetController.uploadCellFile);

// Real-time Presence Heartbeat
router.post('/api/presence/ping', (req, res) => {
  const clientId = req.body?.clientId || (req.session as any)?.id || req.ip || 'anonymous';
  const isAdmin = !!(req.session as any)?.user;
  const path = req.body?.path || '/';
  presenceService.recordPing(clientId, isAdmin ? 'ADMIN' : 'PUBLIC', path);
  res.json({ ok: true });
});

router.post('/api/presence/leave', (req, res) => {
  const clientId = req.body?.clientId || (req.session as any)?.id || req.ip;
  if (clientId) {
    presenceService.recordLeave(clientId);
  }
  res.json({ ok: true });
});

export default router;
