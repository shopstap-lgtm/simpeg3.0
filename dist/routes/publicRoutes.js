"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const dashboardController_1 = require("../controllers/dashboardController");
const absensiController_1 = require("../controllers/absensiController");
const ekinerjaController_1 = require("../controllers/ekinerjaController");
const router = (0, express_1.Router)();
// Configure multer for disk storage
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
    }
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});
// Public Menus
router.get('/', dashboardController_1.dashboardController.show);
// Absensi & Klarifikasi
router.get('/absensi', absensiController_1.absensiController.show);
router.post('/absensi/klarifikasi', upload.single('file'), absensiController_1.absensiController.submitKlarifikasi);
router.post('/absensi/direct-update', absensiController_1.absensiController.directUpdate);
router.post('/absensi/bulk-date-update', absensiController_1.absensiController.bulkDateUpdate);
// Ekinerja
router.get('/ekinerja', ekinerjaController_1.ekinerjaController.show);
router.post('/ekinerja/submit', upload.fields([
    { name: 'fileHarian', maxCount: 1 },
    { name: 'fileBulanan', maxCount: 1 }
]), ekinerjaController_1.ekinerjaController.submitLaporan);
exports.default = router;
