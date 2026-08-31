"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadAbsensiController = void 0;
const fs_1 = __importDefault(require("fs"));
const XLSX = __importStar(require("xlsx"));
const prisma_1 = __importDefault(require("../../lib/prisma"));
// Helper function to extract date from filename format: Export_eabsensi_DDMMYYYY_HHMMSS
function extractDateFromFilename(filename) {
    // Primary Pattern: Export_eabsensi_13082026_131053 (DDMMYYYY)
    const match1 = filename.match(/Export_eabsensi_(\d{2})(\d{2})(\d{4})/i);
    if (match1) {
        return {
            day: parseInt(match1[1], 10),
            month: parseInt(match1[2], 10),
            year: parseInt(match1[3], 10)
        };
    }
    // Fallback Pattern 1: DDMMYYYY in filename
    const match2 = filename.match(/(?:^|[^0-9])(\d{2})(\d{2})(\d{4})(?:[^0-9]|$)/);
    if (match2) {
        const day = parseInt(match2[1], 10);
        const month = parseInt(match2[2], 10);
        const year = parseInt(match2[3], 10);
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2020 && year <= 2099) {
            return { day, month, year };
        }
    }
    // Fallback Pattern 2: YYYY-MM-DD or YYYYMMDD
    const match3 = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
    if (match3) {
        const year = parseInt(match3[1], 10);
        const month = parseInt(match3[2], 10);
        const day = parseInt(match3[3], 10);
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
            return { day, month, year };
        }
    }
    return null;
}
// Helper to map status from "Verifikasi SKPD" column
function mapSkpdStatus(rawStatus) {
    if (!rawStatus)
        return 'HADIR';
    const s = String(rawStatus).trim().toUpperCase();
    // NL = Hadir Normal
    if (s === 'NL' || s === 'NORMAL' || s === 'HADIR' || s === 'H' || s.includes('NORMAL')) {
        return 'HADIR';
    }
    // DL = DL Biru (Dinas Luar Sesuai)
    if (s === 'DL' || s === 'DINAS LUAR' || s === 'DINAS_LUAR' || s === 'DL BIRU') {
        return 'DL';
    }
    // DL-K = DL Kuning (Dinas Luar Belum Sesuai)
    if (s === 'DL-K' || s === 'DLK' || s === 'DL KUNING' || s === 'DL_KUNING' || s.includes('KUNING')) {
        return 'DL_KUNING';
    }
    // TK = Tanpa Keterangan / Alpha
    if (s === 'TK' || s === 'A' || s === 'ALPHA' || s === 'ALPA' || s.includes('TANPA KETERANGAN') || s.includes('ALPHA')) {
        return 'TK';
    }
    // TL = Terlambat
    if (s === 'TL' || s.includes('TERLAMBAT')) {
        return 'TL';
    }
    // PC = Pulang Cepat
    if (s === 'PC' || s.includes('PULANG CEPAT')) {
        return 'PC';
    }
    // ST = Sakit
    if (s === 'ST' || s === 'S' || s.includes('SAKIT')) {
        return 'ST';
    }
    // CT = Cuti
    if (s === 'CT' || s === 'C' || s.includes('CUTI')) {
        return 'CT';
    }
    // LIBUR = Hari Libur
    if (s === 'LIBUR' || s.includes('LIBUR')) {
        return 'LIBUR';
    }
    // Default fallback
    return 'HADIR';
}
exports.uploadAbsensiController = {
    show: async (req, res) => {
        try {
            const user = req.session?.user;
            const [totalEmployees, totalDays, periods, totalUnits] = await Promise.all([
                prisma_1.default.employee.count({ where: { aktif: true } }),
                prisma_1.default.attendanceDay.count(),
                prisma_1.default.attendancePeriod.findMany({
                    orderBy: [
                        { tahun: 'desc' },
                        { bulan: 'desc' }
                    ],
                    include: {
                        _count: {
                            select: { attendanceDays: true }
                        }
                    },
                    take: 12
                }),
                prisma_1.default.unit.count()
            ]);
            const bulanNames = [
                'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
            ];
            const formattedPeriods = periods.map((p) => ({
                id: p.id,
                bulan: p.bulan,
                tahun: p.tahun,
                namaBulan: bulanNames[p.bulan - 1] || `Bulan ${p.bulan}`,
                totalRecords: p._count?.attendanceDays || 0,
                createdAt: p.createdAt ? p.createdAt.toISOString().substring(0, 10) : '-'
            }));
            res.render('admin/upload-absensi', {
                title: 'Upload Rekap Absensi - Panel Admin SIMPEG',
                page: 'admin-upload-absensi',
                user,
                totalEmployees,
                totalDays,
                periods: formattedPeriods,
                totalUnits
            });
        }
        catch (error) {
            console.error('Error in uploadAbsensiController.show:', error);
            res.status(500).send('Terjadi kesalahan internal server.');
        }
    },
    processUpload: async (req, res) => {
        const uploadedFiles = req.files;
        const singleFile = req.file;
        const files = uploadedFiles || (singleFile ? [singleFile] : []);
        if (!files || files.length === 0) {
            if (req.session) {
                req.session.toast = {
                    type: 'warning',
                    message: 'Peringatan: Tidak ada file Excel yang dipilih untuk diunggah.'
                };
            }
            return res.redirect('/admin/upload-absensi');
        }
        try {
            // 1. Fetch all active employees into a Map for fast lookup
            const employees = await prisma_1.default.employee.findMany({
                select: { id: true, nip: true, nama: true }
            });
            const employeeMap = new Map();
            for (const emp of employees) {
                // Clean NIP (digits only)
                const cleanNip = emp.nip.replace(/[^0-9]/g, '');
                if (cleanNip) {
                    employeeMap.set(cleanNip, { id: emp.id, nama: emp.nama });
                }
                // Also map exact string
                employeeMap.set(emp.nip.trim(), { id: emp.id, nama: emp.nama });
            }
            let totalSyncedRows = 0;
            let totalFilesProcessed = 0;
            const processedDates = [];
            const errorFiles = [];
            // 2. Process each uploaded file
            for (const file of files) {
                try {
                    const dateInfo = extractDateFromFilename(file.originalname);
                    if (!dateInfo) {
                        console.warn(`Could not extract date from filename: ${file.originalname}`);
                        errorFiles.push(`${file.originalname} (Format tanggal tidak dikenali)`);
                        continue;
                    }
                    const { day, month, year } = dateInfo;
                    processedDates.push(`${day}/${month}/${year}`);
                    // Find or create AttendancePeriod
                    const period = await prisma_1.default.attendancePeriod.upsert({
                        where: {
                            bulan_tahun: {
                                bulan: month,
                                tahun: year
                            }
                        },
                        update: {},
                        create: {
                            bulan: month,
                            tahun: year
                        }
                    });
                    // Read Excel Workbook
                    const workbook = XLSX.readFile(file.path);
                    const firstSheetName = workbook.SheetNames[0];
                    if (!firstSheetName) {
                        errorFiles.push(`${file.originalname} (File kosong)`);
                        continue;
                    }
                    const sheet = workbook.Sheets[firstSheetName];
                    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                    if (!rawRows || rawRows.length === 0) {
                        errorFiles.push(`${file.originalname} (Tidak ada baris data)`);
                        continue;
                    }
                    // 3. Locate Header Row
                    let headerRowIndex = -1;
                    let nipColIndex = -1;
                    let skpdColIndex = -1;
                    for (let r = 0; r < Math.min(rawRows.length, 15); r++) {
                        const row = rawRows[r];
                        if (!Array.isArray(row))
                            continue;
                        const nipIdx = row.findIndex(cell => {
                            const str = String(cell).toLowerCase();
                            return str.includes('nip') || str.includes('nomor induk');
                        });
                        const skpdIdx = row.findIndex(cell => {
                            const str = String(cell).toLowerCase();
                            return (str.includes('verifikasi skpd') ||
                                str.includes('verifikasi_skpd') ||
                                str.includes('verifikasi') ||
                                str.includes('skpd'));
                        });
                        if (nipIdx !== -1) {
                            headerRowIndex = r;
                            nipColIndex = nipIdx;
                            skpdColIndex = skpdIdx !== -1 ? skpdIdx : -1;
                            break;
                        }
                    }
                    if (headerRowIndex === -1 || nipColIndex === -1) {
                        errorFiles.push(`${file.originalname} (Kolom NIP tidak ditemukan)`);
                        continue;
                    }
                    // If SKPD column wasn't in the exact same header row, search secondary
                    if (skpdColIndex === -1) {
                        const headerRow = rawRows[headerRowIndex];
                        skpdColIndex = headerRow.findIndex(cell => {
                            const str = String(cell).toLowerCase();
                            return str.includes('status') || str.includes('absen') || str.includes('keterangan');
                        });
                    }
                    // 4. Process Data Rows
                    let fileSyncedCount = 0;
                    for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
                        const row = rawRows[r];
                        if (!Array.isArray(row) || row.length === 0)
                            continue;
                        const rawNip = String(row[nipColIndex] || '').trim();
                        const cleanNip = rawNip.replace(/[^0-9]/g, '');
                        if (!cleanNip || cleanNip.length < 5)
                            continue; // Skip non-NIP rows
                        const emp = employeeMap.get(cleanNip) || employeeMap.get(rawNip);
                        if (!emp)
                            continue; // Employee not found in DB
                        const rawStatus = skpdColIndex !== -1 ? row[skpdColIndex] : 'NL';
                        const mappedStatus = mapSkpdStatus(rawStatus);
                        await prisma_1.default.attendanceDay.upsert({
                            where: {
                                employeeId_periodId_tanggal: {
                                    employeeId: emp.id,
                                    periodId: period.id,
                                    tanggal: day
                                }
                            },
                            update: {
                                status: mappedStatus,
                                keterangan: `Sinkronisasi SKPD: ${file.originalname}`
                            },
                            create: {
                                employeeId: emp.id,
                                periodId: period.id,
                                tanggal: day,
                                status: mappedStatus,
                                keterangan: `Sinkronisasi SKPD: ${file.originalname}`
                            }
                        });
                        fileSyncedCount++;
                    }
                    totalSyncedRows += fileSyncedCount;
                    totalFilesProcessed++;
                }
                catch (fileErr) {
                    console.error(`Error processing file ${file.originalname}:`, fileErr);
                    errorFiles.push(`${file.originalname} (Gagal diproses)`);
                }
                finally {
                    // Clean up temporary uploaded file from disk
                    try {
                        if (fs_1.default.existsSync(file.path)) {
                            fs_1.default.unlinkSync(file.path);
                        }
                    }
                    catch (unlinkErr) {
                        console.warn(`Could not delete temp file ${file.path}:`, unlinkErr);
                    }
                }
            }
            // 5. Toast Feedback to User
            if (totalFilesProcessed > 0) {
                let msg = `Sinkronisasi Berhasil! Sebanyak ${totalFilesProcessed} file Excel telah diproses dengan total ${totalSyncedRows} data presensi pegawai berhasil diperbarui untuk tanggal [${processedDates.join(', ')}].`;
                if (errorFiles.length > 0) {
                    msg += ` Catatan: ${errorFiles.length} file dilewati (${errorFiles.join(', ')}).`;
                }
                if (req.session) {
                    req.session.toast = {
                        type: 'success',
                        message: msg
                    };
                }
            }
            else {
                if (req.session) {
                    req.session.toast = {
                        type: 'danger',
                        message: `Gagal memproses file. Pastikan nama file mengikuti format 'Export_eabsensi_DDMMYYYY_HHMMSS' dan terdapat kolom 'NIP' serta 'Verifikasi SKPD'. ${errorFiles.join(', ')}`
                    };
                }
            }
            res.redirect('/admin/upload-absensi');
        }
        catch (error) {
            console.error('Error in uploadAbsensiController.processUpload:', error);
            // Clean up files in case of major error
            for (const file of files) {
                try {
                    if (fs_1.default.existsSync(file.path))
                        fs_1.default.unlinkSync(file.path);
                }
                catch (_) { }
            }
            if (req.session) {
                req.session.toast = {
                    type: 'danger',
                    message: 'Terjadi kesalahan sistem saat memproses sinkronisasi data presensi.'
                };
            }
            res.redirect('/admin/upload-absensi');
        }
    }
};
