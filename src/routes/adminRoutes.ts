import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { authController } from '../controllers/admin/authController';
import { klarifikasiController } from '../controllers/admin/klarifikasiController';
import { ekinerjaReviewController } from '../controllers/admin/ekinerjaReviewController';
import { cmsController } from '../controllers/admin/cmsController';
import { usersController } from '../controllers/admin/usersController';
import { pegawaiAdminController } from '../controllers/admin/pegawaiAdminController';
import { employeeController } from '../controllers/admin/employeeController';
import { uploadAbsensiController } from '../controllers/admin/uploadAbsensiController';
import { unitKerjaController } from '../controllers/admin/unitKerjaController';
import { fileManagerController } from '../controllers/admin/fileManagerController';
import { requireAdmin, requireSuperAdmin, requireSuperAdminOrDinas } from '../middleware/requireAdmin';

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

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, getUploadDir());
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});

const diskUpload = multer({
  storage: diskStorage,
  limits: { fileSize: 1 * 1024 * 1024 } // 1MB
});

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 } // 1MB
});

// 1. Public Admin Auth Routes
router.get('/login', authController.showLogin);
router.post('/login', authController.login);
router.get('/logout', authController.logout);

// 2. Protected Admin Routes (Require Admin Authentication)
router.use(requireAdmin);

// Klarifikasi Absensi
router.get('/klarifikasi', klarifikasiController.show);
router.post('/klarifikasi/:id/approve', klarifikasiController.approve);
router.post('/klarifikasi/:id/reject', klarifikasiController.reject);
router.post('/klarifikasi/:id/delete', klarifikasiController.delete);

// Upload Rekap Absensi (SUPER_ADMIN & ADMIN_DINAS Only)
router.get('/upload-absensi', requireSuperAdminOrDinas, uploadAbsensiController.show);
router.post('/upload-absensi', requireSuperAdminOrDinas, diskUpload.array('excelFiles', 60), uploadAbsensiController.processUpload);

// Ekinerja Review
// ⚠️ Export routes MUST be before :id routes, otherwise Express treats "export" as :id value
router.get('/ekinerja-review/export/excel', ekinerjaReviewController.exportExcel);
router.get('/ekinerja-review/export/pdf', ekinerjaReviewController.exportPdf);
router.get('/ekinerja-review', ekinerjaReviewController.show);
router.post('/ekinerja-review/:id/review', ekinerjaReviewController.review);
router.post('/ekinerja-review/:id/score', ekinerjaReviewController.review);
router.post('/ekinerja-review/:id/delete', ekinerjaReviewController.deleteReview);

// Bulk Download seluruh berkas fisik uploads dalam satu file .tar.gz
router.get('/backup/uploads-zip', (req, res) => {
  const uploadsDir = path.resolve(process.cwd(), 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    return res.status(404).send('Folder uploads belum ada.');
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const archiveName = `simpeg-backup-uploads-${dateStr}.tar.gz`;

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);

  const { spawn } = require('child_process');
  const tar = spawn('tar', ['-czf', '-', '-C', uploadsDir, '.']);

  tar.stdout.pipe(res);
  tar.stderr.on('data', (data: any) => console.error(`[Backup Tar Error]: ${data}`));
  tar.on('close', (code: any) => {
    if (code !== 0) console.warn(`Tar process exited with code ${code}`);
  });
});

// Master Data Pegawai Import (Excel / CSV)
router.get('/employees/template', employeeController.downloadTemplate);
router.post('/employees/import', memoryUpload.single('employeeFile'), employeeController.importExcel);

// 3. Super Admin Only Protected Routes
// Master Data Pegawai CRUD
router.get('/pegawai', requireSuperAdmin, pegawaiAdminController.show);
router.post('/pegawai/create', requireSuperAdmin, pegawaiAdminController.create);
router.post('/pegawai/:id/update', requireSuperAdmin, pegawaiAdminController.update);
router.post('/pegawai/:id/toggle', requireSuperAdmin, pegawaiAdminController.toggleActive);
router.post('/pegawai/:id/delete', requireSuperAdmin, pegawaiAdminController.delete);

// CMS Config
router.get('/cms', requireSuperAdmin, cmsController.show);
router.post('/cms', requireSuperAdmin, cmsController.update);
router.post('/cms/maintenance', requireSuperAdmin, cmsController.updateMaintenance);

// User Management
router.get('/users', requireSuperAdmin, usersController.show);
router.post('/users/create', requireSuperAdmin, usersController.create);
router.post('/users/:id/update', requireSuperAdmin, usersController.updateUser);
router.post('/users/:id/toggle', requireSuperAdmin, usersController.toggleActive);
router.post('/users/:id/delete', requireSuperAdmin, usersController.deleteUser);

// Data Unit Kerja / Sekolah (SUPER_ADMIN only)
router.get('/unit-kerja', requireSuperAdmin, unitKerjaController.show);
router.post('/unit-kerja/create', requireSuperAdmin, unitKerjaController.create);
router.post('/unit-kerja/:id/update', requireSuperAdmin, unitKerjaController.update);
router.post('/unit-kerja/:id/delete', requireSuperAdmin, unitKerjaController.delete);

// Manajemen Berkas Upload (SUPER_ADMIN only)
router.get('/files', requireSuperAdmin, fileManagerController.show);
router.post('/files/upload', requireSuperAdmin, diskUpload.array('files', 50), fileManagerController.uploadFile);
router.post('/files/rename', requireSuperAdmin, fileManagerController.renameFile);
router.post('/files/delete', requireSuperAdmin, fileManagerController.deleteFile);
router.post('/files/bulk-delete', requireSuperAdmin, fileManagerController.bulkDeleteFiles);
router.get('/files/download-all', requireSuperAdmin, fileManagerController.downloadAll);
router.get('/files/download-month', requireSuperAdmin, fileManagerController.downloadByMonth);
router.post('/files/download-selected', requireSuperAdmin, fileManagerController.downloadSelected);
router.post('/files/standardize-names', requireSuperAdmin, fileManagerController.standardizeNames);

export default router;
