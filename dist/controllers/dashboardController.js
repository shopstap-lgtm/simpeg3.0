"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardController = void 0;
const statsService_1 = require("../services/statsService");
const prisma_1 = __importDefault(require("../lib/prisma"));
exports.dashboardController = {
    show: async (req, res) => {
        try {
            const selectedUnit = req.query.unit || 'unit-all';
            const [cms, allUnits] = await Promise.all([
                prisma_1.default.cmsConfig.findUnique({ where: { id: 'cms-main' } }),
                prisma_1.default.unit.findMany({ orderBy: { namaUnit: 'asc' } })
            ]);
            const activeBulan = cms?.selectedMonth || 7;
            const activeTahun = cms?.selectedYear || 2026;
            const stats = await (0, statsService_1.getDashboardStatsFromDB)(selectedUnit, activeBulan, activeTahun);
            const units = [
                { id: 'unit-all', namaUnit: 'Semua Unit Kerja' },
                ...allUnits
            ];
            res.render('dashboard', {
                title: 'Dashboard Kepegawaian - Korwil Cibitung',
                page: 'dashboard',
                stats,
                units,
                selectedUnit,
                cms: cms || {
                    heroBadge: 'Portal Resmi Korwil',
                    heroTitle: 'Sistem Informasi Manajemen Pegawai',
                    heroSubtitle: 'Wilayah Pendidikan Kecamatan Cibitung',
                    pengumumanText: 'Batas akhir laporan e-kinerja tanggal 25 setiap bulannya.',
                    selectedMonth: 7,
                    selectedMonthEkinerja: 7,
                    selectedYear: 2026
                },
                user: req.session?.user || null
            });
        }
        catch (error) {
            console.error('Error rendering dashboard:', error);
            res.status(500).send('Terjadi kesalahan internal pada server.');
        }
    }
};
