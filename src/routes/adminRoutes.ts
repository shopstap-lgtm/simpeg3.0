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
import { ncrAdminController } from '../controllers/admin/ncrAdminController';
import { formController } from '../controllers/admin/formController';
import { sheetAdminController } from '../controllers/admin/sheetAdminController';
import { requireAdmin, requireSuperAdmin, requireSuperAdminOrDinas, requireNonDinas, requireMenuAccess } from '../middleware/requireAdmin';
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

const ncrDiskUpload = multer({
  storage: diskStorage,
  limits: { fileSize: 250 * 1024 * 1024 } // 250MB for master 1-Kabupaten PDF
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
// ⚠️ Export routes MUST be before :id routes
router.get('/klarifikasi/export/excel', klarifikasiController.exportExcel);
router.get('/klarifikasi/export/pdf', klarifikasiController.exportPdf);
router.get('/klarifikasi', klarifikasiController.show);
router.post('/klarifikasi/:id/approve', klarifikasiController.approve);
router.post('/klarifikasi/:id/reject', klarifikasiController.reject);
router.post('/klarifikasi/:id/delete', klarifikasiController.delete);

// Upload Rekap Absensi
router.get('/upload-absensi', requireMenuAccess('upload_absensi'), uploadAbsensiController.show);
router.post('/upload-absensi', requireMenuAccess('upload_absensi'), diskUpload.array('excelFiles', 60), uploadAbsensiController.processUpload);
router.post('/upload-absensi/reset', requireMenuAccess('upload_absensi'), uploadAbsensiController.resetAttendance);

// Ekinerja Review
// ⚠️ Export routes MUST be before :id routes, otherwise Express treats "export" as :id value
router.get('/ekinerja-review/export/excel', requireMenuAccess('ekinerja'), ekinerjaReviewController.exportExcel);
router.get('/ekinerja-review/export/pdf', requireMenuAccess('ekinerja'), ekinerjaReviewController.exportPdf);
router.get('/ekinerja-review', requireMenuAccess('ekinerja'), ekinerjaReviewController.show);
router.post('/ekinerja-review/:id/review', requireMenuAccess('ekinerja'), ekinerjaReviewController.review);
router.post('/ekinerja-review/:id/score', requireMenuAccess('ekinerja'), ekinerjaReviewController.review);
router.post('/ekinerja-review/:id/delete', requireMenuAccess('ekinerja'), ekinerjaReviewController.deleteReview);

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
router.get('/employees/template', requireMenuAccess('pegawai'), employeeController.downloadTemplate);
router.post('/employees/import', requireMenuAccess('pegawai'), memoryUpload.single('employeeFile'), employeeController.importExcel);

// 3. Dynamic Menu Protected Routes (Based on Menu Permissions Matrix)
// Master Data Pegawai CRUD
router.get('/pegawai', requireMenuAccess('pegawai'), pegawaiAdminController.show);
router.post('/pegawai/create', requireMenuAccess('pegawai'), pegawaiAdminController.create);
router.post('/pegawai/bulk-status', requireMenuAccess('pegawai'), pegawaiAdminController.bulkStatus);
router.post('/pegawai/bulk-delete', requireMenuAccess('pegawai'), pegawaiAdminController.bulkDelete);
router.post('/pegawai/:id/update', requireMenuAccess('pegawai'), pegawaiAdminController.update);
router.post('/pegawai/:id/toggle', requireMenuAccess('pegawai'), pegawaiAdminController.toggleActive);
router.post('/pegawai/:id/delete', requireMenuAccess('pegawai'), pegawaiAdminController.delete);

// CMS Config
router.get('/cms', requireMenuAccess('cms'), cmsController.show);
router.post('/cms', requireMenuAccess('cms'), cmsController.update);
router.post('/cms/maintenance', requireMenuAccess('cms'), cmsController.updateMaintenance);
router.post('/cms/klarifikasi-policy', requireMenuAccess('cms'), cmsController.updateKlarifikasiPolicy);

// User Management
router.get('/users', requireSuperAdmin, usersController.show);
router.post('/users/create', requireSuperAdmin, usersController.create);
router.post('/users/menu-permissions', requireSuperAdmin, usersController.updateMenuPermissions);
router.post('/users/menu-permissions/reset', requireSuperAdmin, usersController.resetMenuPermissions);
router.post('/users/:id/update', requireSuperAdmin, usersController.updateUser);
router.post('/users/:id/toggle', requireSuperAdmin, usersController.toggleActive);
router.post('/users/:id/delete', requireSuperAdmin, usersController.deleteUser);

// Data Unit Kerja / Sekolah
router.get('/unit-kerja', requireMenuAccess('unit_kerja'), unitKerjaController.show);
router.post('/unit-kerja/create', requireMenuAccess('unit_kerja'), unitKerjaController.create);
router.post('/unit-kerja/bulk-delete', requireMenuAccess('unit_kerja'), unitKerjaController.bulkDelete);
router.post('/unit-kerja/bulk-kategori', requireMenuAccess('unit_kerja'), unitKerjaController.bulkKategori);
router.post('/unit-kerja/:id/update', requireMenuAccess('unit_kerja'), unitKerjaController.update);
router.post('/unit-kerja/:id/delete', requireMenuAccess('unit_kerja'), unitKerjaController.delete);

// Manajemen Berkas Upload
router.get('/files', requireMenuAccess('files'), fileManagerController.show);
router.post('/files/upload', requireMenuAccess('files'), diskUpload.array('files', 50), fileManagerController.uploadFile);
router.post('/files/rename', requireMenuAccess('files'), fileManagerController.renameFile);
router.post('/files/delete', requireMenuAccess('files'), fileManagerController.deleteFile);
router.post('/files/bulk-delete', requireMenuAccess('files'), fileManagerController.bulkDeleteFiles);
router.get('/files/download-all', requireMenuAccess('files'), fileManagerController.downloadAll);
router.get('/files/download-month', requireMenuAccess('files'), fileManagerController.downloadByMonth);
router.post('/files/download-selected', requireMenuAccess('files'), fileManagerController.downloadSelected);
router.post('/files/standardize-names', requireMenuAccess('files'), fileManagerController.standardizeNames);

// 8. Kelola Master NCR Gaji
router.get('/ncr-gaji', requireMenuAccess('ncr_gaji'), ncrAdminController.show);
router.post('/ncr-gaji/upload', requireMenuAccess('ncr_gaji'), ncrDiskUpload.single('file'), ncrAdminController.uploadMaster);
router.get('/ncr-gaji/:id/detail', requireMenuAccess('ncr_gaji'), ncrAdminController.detail);
router.post('/ncr-gaji/update-npwp', requireMenuAccess('ncr_gaji'), ncrAdminController.updateNpwp);
router.post('/ncr-gaji/:id/delete', requireMenuAccess('ncr_gaji'), ncrAdminController.deletePeriod);

// 9. Kelola Formulir Dinamis (Form Builder)
router.get('/forms', requireMenuAccess('forms'), formController.list);
router.get('/forms/create', requireMenuAccess('forms'), formController.renderCreate);
router.post('/forms/create', requireMenuAccess('forms'), formController.create);
router.get('/forms/:id/edit', requireMenuAccess('forms'), formController.renderEdit);
router.post('/forms/:id/edit', requireMenuAccess('forms'), formController.update);
router.post('/forms/:id/toggle-status', requireMenuAccess('forms'), formController.toggleStatus);
router.post('/forms/:id/delete', requireMenuAccess('forms'), formController.delete);
router.get('/forms/:id/responses', requireMenuAccess('forms'), formController.responses);
router.post('/forms/:id/responses/:responseId/delete', requireMenuAccess('forms'), formController.deleteResponse);
router.get('/forms/:id/export-excel', requireMenuAccess('forms'), formController.exportExcel);

// 10. Kelola Spreadsheet Dinamis (Google Sheet Builder)
router.get('/sheets', requireMenuAccess('forms'), sheetAdminController.list);
router.get('/sheets/create', requireMenuAccess('forms'), sheetAdminController.renderCreate);
router.post('/sheets/create', requireMenuAccess('forms'), sheetAdminController.create);
router.get('/sheets/:id/edit', requireMenuAccess('forms'), sheetAdminController.renderEdit);
router.post('/sheets/:id/edit', requireMenuAccess('forms'), sheetAdminController.update);
router.get('/sheets/:id/manage', requireMenuAccess('forms'), sheetAdminController.manage);
router.post('/sheets/:id/rows', requireMenuAccess('forms'), sheetAdminController.addRow);
router.post('/sheets/:id/rows/:rowId', requireMenuAccess('forms'), sheetAdminController.saveRow);
router.post('/sheets/:id/rows/:rowId/delete', requireMenuAccess('forms'), sheetAdminController.deleteRow);
router.post('/sheets/:id/bulk-save', requireMenuAccess('forms'), sheetAdminController.bulkSave);
router.get('/sheets/:id/export', requireMenuAccess('forms'), sheetAdminController.exportXlsx);
router.post('/sheets/:id/toggle-status', requireMenuAccess('forms'), sheetAdminController.toggleStatus);
router.post('/sheets/:id/delete', requireMenuAccess('forms'), sheetAdminController.deleteSheet);
router.post('/sheets/:id/columns', requireMenuAccess('forms'), sheetAdminController.addColumn);
router.post('/sheets/:id/columns/:colKey/delete', requireMenuAccess('forms'), sheetAdminController.deleteColumn);
router.post('/sheets/:id/columns/update', requireMenuAccess('forms'), sheetAdminController.updateColumns);
router.post('/sheets/:id/columns/visibility', requireMenuAccess('forms'), sheetAdminController.updateColumnsVisibility);

// 11. Real-time Online Users Stats (Admin Only)
router.get('/api/online-users', requireAdmin, (_req, res) => {
  res.json({
    success: true,
    ...presenceService.getOnlineStats()
  });
});

export default router;
