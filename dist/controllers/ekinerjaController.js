"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ekinerjaController = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
exports.ekinerjaController = {
    show: async (req, res) => {
        try {
            const cms = await prisma_1.default.cmsConfig.findUnique({ where: { id: 'cms-main' } });
            const activeDefaultMonth = cms?.selectedMonthEkinerja || cms?.selectedMonth || 7;
            const activeDefaultYear = cms?.selectedYear || 2026;
            const bulan = parseInt(req.query.bulan) || activeDefaultMonth;
            const tahun = parseInt(req.query.tahun) || activeDefaultYear;
            const selectedUnit = req.query.unit || 'unit-all';
            const search = req.query.search || '';
            // Pagination setup (default 25 rows)
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limitQuery = req.query.limit;
            const limit = limitQuery === 'all' ? 999999 : (parseInt(limitQuery) || 25);
            const whereEmp = { aktif: true };
            if (selectedUnit && selectedUnit !== 'unit-all') {
                whereEmp.unitId = selectedUnit;
            }
            if (search) {
                whereEmp.OR = [
                    { nama: { contains: search } },
                    { nip: { contains: search } }
                ];
            }
            const [allUnits, totalFilteredEmployees, allActiveEmployees, employees, reports] = await Promise.all([
                prisma_1.default.unit.findMany({ orderBy: { namaUnit: 'asc' } }),
                prisma_1.default.employee.count({ where: whereEmp }),
                prisma_1.default.employee.findMany({
                    where: { aktif: true },
                    include: { unit: true },
                    orderBy: { nama: 'asc' }
                }),
                prisma_1.default.employee.findMany({
                    where: whereEmp,
                    include: { unit: true },
                    orderBy: [
                        { unit: { namaUnit: 'asc' } },
                        { nama: 'asc' }
                    ],
                    skip: limit === 999999 ? 0 : (page - 1) * limit,
                    take: limit
                }),
                prisma_1.default.ekinerjaReport.findMany({
                    where: { bulan, tahun }
                })
            ]);
            const reportsMap = new Map();
            reports.forEach(r => reportsMap.set(r.employeeId, r));
            const list = employees.map(emp => {
                const report = reportsMap.get(emp.id);
                const canUpload = !report || report.statusReview === 'REJECTED';
                return {
                    employee: {
                        id: emp.id,
                        nip: emp.nip,
                        nama: emp.nama,
                        jabatan: emp.jabatan || 'Guru',
                        statusKepegawaian: emp.statusKepegawaian,
                        unitId: emp.unitId,
                        unitNama: emp.unit.namaUnit
                    },
                    report: report ? {
                        id: report.id,
                        employeeId: report.employeeId,
                        bulan: report.bulan,
                        tahun: report.tahun,
                        fileHarianUrl: report.fileHarianUrl,
                        fileHarianName: report.fileHarianName,
                        fileBulananUrl: report.fileBulananUrl,
                        fileBulananName: report.fileBulananName,
                        nilaiHarian: report.nilaiHarian,
                        nilaiBulanan: report.nilaiBulanan,
                        statusReview: report.statusReview,
                        catatanAdmin: report.catatanAdmin,
                        reviewedBy: report.reviewedBy,
                        reviewedAt: report.reviewedAt
                    } : undefined,
                    canUpload
                };
            });
            const units = [
                { id: 'unit-all', namaUnit: 'Semua Unit Kerja' },
                ...allUnits
            ];
            const toast = req.session?.toast || null;
            if (req.session) {
                delete req.session.toast;
            }
            const totalPages = limit === 999999 ? 1 : (Math.ceil(totalFilteredEmployees / limit) || 1);
            const pagination = {
                page,
                limit: limitQuery === 'all' ? 'all' : limit,
                totalItems: totalFilteredEmployees,
                totalPages,
                from: totalFilteredEmployees === 0 ? 0 : ((page - 1) * (limit === 999999 ? totalFilteredEmployees : limit)) + 1,
                to: limit === 999999 ? totalFilteredEmployees : Math.min(page * limit, totalFilteredEmployees)
            };
            res.render('ekinerja', {
                title: 'Laporan E-Kinerja Pegawai - Korwil Cibitung',
                page: 'ekinerja',
                list,
                units,
                employees: allActiveEmployees.map(e => ({
                    id: e.id,
                    nip: e.nip,
                    nama: e.nama,
                    statusKepegawaian: e.statusKepegawaian,
                    unitId: e.unitId,
                    unitNama: e.unit.namaUnit
                })),
                bulan,
                tahun,
                activeDefaultMonth,
                activeDefaultYear,
                selectedUnit,
                search,
                pagination,
                toast,
                user: req.session?.user || null
            });
        }
        catch (error) {
            console.error('Error in ekinerjaController.show:', error);
            res.status(500).send('Terjadi kesalahan saat memuat data e-kinerja.');
        }
    },
    submitLaporan: async (req, res) => {
        try {
            const { employeeId, bulan, tahun } = req.body;
            const files = req.files;
            if (!employeeId || !bulan || !tahun) {
                if (req.session) {
                    req.session.toast = {
                        type: 'warning',
                        message: 'Silakan pilih pegawai dan periode laporan.'
                    };
                }
                return res.redirect('/ekinerja');
            }
            const b = parseInt(bulan);
            const t = parseInt(tahun);
            const fileHarian = files?.fileHarian?.[0];
            const fileBulanan = files?.fileBulanan?.[0];
            if (!fileHarian && !fileBulanan) {
                if (req.session) {
                    req.session.toast = {
                        type: 'warning',
                        message: 'Mohon lampirkan setidaknya salah satu berkas laporan (Harian atau Bulanan).'
                    };
                }
                return res.redirect('/ekinerja');
            }
            const fileHarianUrl = fileHarian ? `/uploads/${fileHarian.filename}` : undefined;
            const fileHarianName = fileHarian ? fileHarian.originalname : undefined;
            const fileBulananUrl = fileBulanan ? `/uploads/${fileBulanan.filename}` : undefined;
            const fileBulananName = fileBulanan ? fileBulanan.originalname : undefined;
            await prisma_1.default.ekinerjaReport.upsert({
                where: {
                    employeeId_bulan_tahun: {
                        employeeId,
                        bulan: b,
                        tahun: t
                    }
                },
                update: {
                    fileHarianUrl: fileHarianUrl || undefined,
                    fileHarianName: fileHarianName || undefined,
                    fileBulananUrl: fileBulananUrl || undefined,
                    fileBulananName: fileBulananName || undefined,
                    statusReview: 'PENDING',
                    catatanAdmin: null,
                    reviewedBy: null,
                    reviewedAt: null
                },
                create: {
                    employeeId,
                    bulan: b,
                    tahun: t,
                    fileHarianUrl: fileHarianUrl || '/uploads/ekinerja_harian_demo.pdf',
                    fileHarianName: fileHarianName || 'Laporan_Harian.pdf',
                    fileBulananUrl: fileBulananUrl || '/uploads/ekinerja_bulanan_demo.pdf',
                    fileBulananName: fileBulananName || 'Laporan_Bulanan.pdf',
                    statusReview: 'PENDING'
                }
            });
            if (req.session) {
                req.session.toast = {
                    type: 'success',
                    message: 'Laporan E-Kinerja berhasil diunggah dan sedang menunggu review verifikator.'
                };
            }
            res.redirect(`/ekinerja?bulan=${b}&tahun=${t}`);
        }
        catch (error) {
            console.error('Error in submitLaporan:', error);
            if (req.session) {
                req.session.toast = {
                    type: 'danger',
                    message: 'Gagal mengunggah laporan. Silakan coba kembali.'
                };
            }
            res.redirect('/ekinerja');
        }
    }
};
