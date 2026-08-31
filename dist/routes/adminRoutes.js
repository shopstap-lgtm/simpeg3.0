"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const authController_1 = require("../controllers/admin/authController");
const klarifikasiController_1 = require("../controllers/admin/klarifikasiController");
const ekinerjaReviewController_1 = require("../controllers/admin/ekinerjaReviewController");
const cmsController_1 = require("../controllers/admin/cmsController");
const usersController_1 = require("../controllers/admin/usersController");
const pegawaiAdminController_1 = require("../controllers/admin/pegawaiAdminController");
const employeeController_1 = require("../controllers/admin/employeeController");
const uploadAbsensiController_1 = require("../controllers/admin/uploadAbsensiController");
const requireAdmin_1 = require("../middleware/requireAdmin");
const router = (0, express_1.Router)();
const diskStorage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
    }
});
const diskUpload = (0, multer_1.default)({
    storage: diskStorage,
    limits: { fileSize: 15 * 1024 * 1024 }
});
const memoryUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }
});
// 1. Public Admin Auth Routes
router.get('/login', authController_1.authController.showLogin);
router.post('/login', authController_1.authController.login);
router.get('/logout', authController_1.authController.logout);
// 2. Protected Admin Routes (Require Admin Authentication)
router.use(requireAdmin_1.requireAdmin);
// Klarifikasi Absensi
router.get('/klarifikasi', klarifikasiController_1.klarifikasiController.show);
router.post('/klarifikasi/:id/approve', klarifikasiController_1.klarifikasiController.approve);
router.post('/klarifikasi/:id/reject', klarifikasiController_1.klarifikasiController.reject);
router.post('/klarifikasi/:id/delete', klarifikasiController_1.klarifikasiController.delete);
// Upload Rekap Absensi (SUPER_ADMIN & ADMIN_DINAS Only)
router.get('/upload-absensi', requireAdmin_1.requireSuperAdminOrDinas, uploadAbsensiController_1.uploadAbsensiController.show);
router.post('/upload-absensi', requireAdmin_1.requireSuperAdminOrDinas, diskUpload.array('excelFiles', 40), uploadAbsensiController_1.uploadAbsensiController.processUpload);
// Ekinerja Review
router.get('/ekinerja-review', ekinerjaReviewController_1.ekinerjaReviewController.show);
router.post('/ekinerja-review/:id/review', ekinerjaReviewController_1.ekinerjaReviewController.review);
router.post('/ekinerja-review/:id/score', ekinerjaReviewController_1.ekinerjaReviewController.review);
router.post('/ekinerja-review/:id/delete', ekinerjaReviewController_1.ekinerjaReviewController.deleteReview);
// Master Data Pegawai Import (Excel / CSV)
router.get('/employees/template', employeeController_1.employeeController.downloadTemplate);
router.post('/employees/import', memoryUpload.single('employeeFile'), employeeController_1.employeeController.importExcel);
// 3. Super Admin Only Protected Routes
// Master Data Pegawai CRUD
router.get('/pegawai', requireAdmin_1.requireSuperAdmin, pegawaiAdminController_1.pegawaiAdminController.show);
router.post('/pegawai/create', requireAdmin_1.requireSuperAdmin, pegawaiAdminController_1.pegawaiAdminController.create);
router.post('/pegawai/:id/update', requireAdmin_1.requireSuperAdmin, pegawaiAdminController_1.pegawaiAdminController.update);
router.post('/pegawai/:id/toggle', requireAdmin_1.requireSuperAdmin, pegawaiAdminController_1.pegawaiAdminController.toggleActive);
router.post('/pegawai/:id/delete', requireAdmin_1.requireSuperAdmin, pegawaiAdminController_1.pegawaiAdminController.delete);
// CMS Config
router.get('/cms', requireAdmin_1.requireSuperAdmin, cmsController_1.cmsController.show);
router.post('/cms', requireAdmin_1.requireSuperAdmin, cmsController_1.cmsController.update);
// User Management
router.get('/users', requireAdmin_1.requireSuperAdmin, usersController_1.usersController.show);
router.post('/users/create', requireAdmin_1.requireSuperAdmin, usersController_1.usersController.create);
router.post('/users/:id/update', requireAdmin_1.requireSuperAdmin, usersController_1.usersController.updateUser);
router.post('/users/:id/toggle', requireAdmin_1.requireSuperAdmin, usersController_1.usersController.toggleActive);
router.post('/users/:id/delete', requireAdmin_1.requireSuperAdmin, usersController_1.usersController.deleteUser);
exports.default = router;
