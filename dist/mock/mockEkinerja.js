"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mockEkinerjaList = void 0;
const mockEmployees_1 = require("./mockEmployees");
exports.mockEkinerjaList = [
    {
        id: 'ek-001',
        employeeId: 'emp-002',
        employee: mockEmployees_1.mockEmployees[1], // Hj. Siti Rohmah
        bulan: 7,
        tahun: 2026,
        fileHarianUrl: '/mock-files/Laporan_Harian_SitiRohmah_Jul2026.pdf',
        fileHarianName: 'Laporan_Harian_SitiRohmah_Jul2026.pdf',
        fileBulananUrl: '/mock-files/Laporan_Bulanan_SitiRohmah_Jul2026.pdf',
        fileBulananName: 'Laporan_Bulanan_SitiRohmah_Jul2026.pdf',
        nilaiHarian: 94.5,
        nilaiBulanan: 96.0,
        statusReview: 'APPROVED',
        catatanAdmin: 'Laporan manajerial kepala sekolah sangat lengkap dan tepat waktu.',
        reviewedBy: 'Super Admin',
        reviewedAt: '2026-07-28 11:20',
        submittedAt: '2026-07-25 15:40'
    },
    {
        id: 'ek-002',
        employeeId: 'emp-003',
        employee: mockEmployees_1.mockEmployees[2], // Bambang Irawan
        bulan: 7,
        tahun: 2026,
        fileHarianUrl: '/mock-files/Laporan_Harian_Bambang_Jul2026.pdf',
        fileHarianName: 'Laporan_Harian_Bambang_Jul2026.pdf',
        fileBulananUrl: '/mock-files/Laporan_Bulanan_Bambang_Jul2026.pdf',
        fileBulananName: 'Laporan_Bulanan_Bambang_Jul2026.pdf',
        statusReview: 'PENDING',
        submittedAt: '2026-07-26 09:15'
    },
    {
        id: 'ek-003',
        employeeId: 'emp-004',
        employee: mockEmployees_1.mockEmployees[3], // Nurul Hidayati
        bulan: 7,
        tahun: 2026,
        fileHarianUrl: '/mock-files/Laporan_Harian_Nurul_Jul2026.pdf',
        fileHarianName: 'Laporan_Harian_Nurul_Jul2026.pdf',
        fileBulananUrl: '/mock-files/Laporan_Bulanan_Nurul_Jul2026.pdf',
        fileBulananName: 'Laporan_Bulanan_Nurul_Jul2026.pdf',
        statusReview: 'PENDING',
        submittedAt: '2026-07-26 11:00'
    },
    {
        id: 'ek-004',
        employeeId: 'emp-005',
        employee: mockEmployees_1.mockEmployees[4], // Rian Prasetyo
        bulan: 7,
        tahun: 2026,
        statusReview: 'NOT_SUBMITTED'
    },
    {
        id: 'ek-005',
        employeeId: 'emp-008',
        employee: mockEmployees_1.mockEmployees[7], // Dewi Lestari
        bulan: 7,
        tahun: 2026,
        fileHarianUrl: '/mock-files/Laporan_Harian_Dewi_Jul2026.pdf',
        fileHarianName: 'Laporan_Harian_Dewi_Jul2026.pdf',
        fileBulananUrl: '/mock-files/Laporan_Bulanan_Dewi_Jul2026.pdf',
        fileBulananName: 'Laporan_Bulanan_Dewi_Jul2026.pdf',
        nilaiHarian: 60.0,
        nilaiBulanan: 55.0,
        statusReview: 'REJECTED',
        catatanAdmin: 'Laporan bulanan belum memuat tanda tangan Kepala Sekolah dan lembar kerja minggu ke-3 kosong.',
        reviewedBy: 'Admin Korwil',
        reviewedAt: '2026-07-27 14:30',
        submittedAt: '2026-07-25 10:00'
    }
];
