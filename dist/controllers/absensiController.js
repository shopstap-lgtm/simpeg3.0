"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.absensiController = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
exports.absensiController = {
    show: async (req, res) => {
        try {
            const cms = await prisma_1.default.cmsConfig.findUnique({ where: { id: 'cms-main' } });
            const activeDefaultMonth = cms?.selectedMonth || 7;
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
            const [allUnits, totalFilteredEmployees, allActiveEmployees, employees, period, clarifications] = await Promise.all([
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
                prisma_1.default.attendancePeriod.findUnique({
                    where: { bulan_tahun: { bulan, tahun } },
                    include: { attendanceDays: true }
                }),
                prisma_1.default.clarification.findMany({
                    include: { employee: { include: { unit: true } } },
                    orderBy: { createdAt: 'desc' }
                })
            ]);
            const daysInMonth = new Date(tahun, bulan, 0).getDate();
            // Build recap per employee
            const recap = employees.map(emp => {
                const empDaysMap = new Map();
                if (period) {
                    period.attendanceDays
                        .filter(d => d.employeeId === emp.id)
                        .forEach(d => empDaysMap.set(d.tanggal, d));
                }
                // Active clarifications for this employee
                const empClarifications = clarifications.filter(c => c.employeeId === emp.id);
                const days = [];
                let hadirCount = 0;
                let tkCount = 0;
                let dlCount = 0;
                let dlKuningCount = 0;
                let tlCount = 0;
                let pcCount = 0;
                let stCount = 0;
                let ctCount = 0;
                let totalEfektif = 0;
                for (let day = 1; day <= 31; day++) {
                    if (day > daysInMonth) {
                        days.push({ tanggal: day, status: 'EMPTY', keterangan: null, clarificationStatus: null, clarificationNote: null });
                        continue;
                    }
                    const date = new Date(tahun, bulan - 1, day);
                    const dayOfWeek = date.getDay();
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                    let status = 'EMPTY';
                    let keterangan = null;
                    if (empDaysMap.has(day)) {
                        const existing = empDaysMap.get(day);
                        status = existing.status;
                        keterangan = existing.keterangan;
                    }
                    else if (isWeekend) {
                        status = 'LIBUR';
                        keterangan = 'Akhir Pekan';
                    }
                    else {
                        status = 'EMPTY';
                        keterangan = 'Belum Ada Data Presensi';
                    }
                    // Find clarification status for this date
                    const dateStr = `${tahun}-${String(bulan).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    let clarificationStatus = null;
                    let clarificationNote = null;
                    for (const c of empClarifications) {
                        if (c.statusVerifikasi === 'PENDING' || c.statusVerifikasi === 'REJECTED') {
                            if (c.tanggalAbsen.includes(' s/d ')) {
                                const [startStr, endStr] = c.tanggalAbsen.split(' s/d ').map(s => s.trim());
                                if (dateStr >= startStr && dateStr <= endStr) {
                                    clarificationStatus = c.statusVerifikasi;
                                    clarificationNote = c.catatanAdmin || (c.statusVerifikasi === 'PENDING' ? 'Sedang dalam review verifikasi' : 'Ditolak');
                                    break;
                                }
                            }
                            else if (c.tanggalAbsen === dateStr) {
                                clarificationStatus = c.statusVerifikasi;
                                clarificationNote = c.catatanAdmin || (c.statusVerifikasi === 'PENDING' ? 'Sedang dalam review verifikasi' : 'Ditolak');
                                break;
                            }
                        }
                    }
                    if (!isWeekend && status !== 'EMPTY') {
                        totalEfektif++;
                        if (status === 'HADIR')
                            hadirCount++;
                        else if (status === 'TK')
                            tkCount++;
                        else if (status === 'DL')
                            dlCount++;
                        else if (status === 'DL_KUNING')
                            dlKuningCount++;
                        else if (status === 'TL')
                            tlCount++;
                        else if (status === 'PC')
                            pcCount++;
                        else if (status === 'ST')
                            stCount++;
                        else if (status === 'CT')
                            ctCount++;
                    }
                    days.push({
                        tanggal: day,
                        status,
                        keterangan,
                        clarificationStatus,
                        clarificationNote
                    });
                }
                // Percentage computation (TK is absence, everything else counts as present)
                const totalPresent = totalEfektif - tkCount;
                const persentase = totalEfektif > 0 ? Math.round((totalPresent / totalEfektif) * 100) : 100;
                return {
                    employee: {
                        id: emp.id,
                        nip: emp.nip,
                        nama: emp.nama,
                        jabatan: emp.jabatan || 'Guru',
                        statusKepegawaian: emp.statusKepegawaian,
                        unitNama: emp.unit?.namaUnit || '-'
                    },
                    days,
                    summary: {
                        hadir: hadirCount,
                        tk: tkCount,
                        dl: dlCount,
                        dlKuning: dlKuningCount,
                        tl: tlCount,
                        pc: pcCount,
                        st: stCount,
                        ct: ctCount,
                        totalEfektif,
                        persentase
                    }
                };
            });
            const formattedClarifications = clarifications.map(c => ({
                id: c.id,
                employeeId: c.employeeId,
                employeeName: c.employee.nama,
                employeeNip: c.employee.nip,
                unitNama: c.employee.unit.namaUnit,
                tanggalAbsen: c.tanggalAbsen,
                statusAwal: c.statusAwal,
                statusPengganti: c.statusPengganti,
                alasan: c.alasan,
                fileUrl: c.fileUrl,
                fileName: c.fileName,
                statusVerifikasi: c.statusVerifikasi,
                catatanAdmin: c.catatanAdmin,
                reviewedBy: c.reviewedBy,
                reviewedAt: c.reviewedAt,
                createdAt: c.createdAt.toISOString().replace('T', ' ').substring(0, 16)
            }));
            const isDefaultPeriod = (bulan === activeDefaultMonth && tahun === activeDefaultYear);
            res.render('absensi', {
                title: 'Rekap Absensi Pegawai - SIMPEG Korwil Cibitung',
                page: 'absensi',
                user: req.session?.user || null,
                recap,
                clarifications: formattedClarifications,
                units: allUnits,
                allActiveEmployees,
                selectedUnit,
                bulan,
                tahun,
                activeDefaultMonth,
                activeDefaultYear,
                daysInMonth,
                search,
                isDefaultPeriod,
                isAdmin: req.session?.user?.role === 'ADMIN' || req.session?.user?.role === 'SUPERADMIN',
                pagination: {
                    page,
                    limit: limitQuery === 'all' ? 'all' : limit,
                    totalItems: totalFilteredEmployees,
                    totalPages: limit === 999999 ? 1 : Math.ceil(totalFilteredEmployees / limit),
                    from: totalFilteredEmployees === 0 ? 0 : (page - 1) * limit + 1,
                    to: limit === 999999 ? totalFilteredEmployees : Math.min(page * limit, totalFilteredEmployees)
                }
            });
        }
        catch (error) {
            console.error('Error in absensiController.show:', error);
            res.status(500).render('partials/404', {
                title: 'Terjadi Kesalahan - SIMPEG Korwil Cibitung',
                page: '500',
                user: req.session?.user || null
            });
        }
    },
    directUpdate: async (req, res) => {
        try {
            const user = req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: 'Harus login terlebih dahulu' });
            }
            const { employeeId, tanggal, bulan, tahun, status, keterangan } = req.body;
            if (!employeeId || !tanggal || !bulan || !tahun || !status) {
                return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
            }
            const b = parseInt(bulan);
            const t = parseInt(tahun);
            const tgl = parseInt(tanggal);
            const period = await prisma_1.default.attendancePeriod.upsert({
                where: { bulan_tahun: { bulan: b, tahun: t } },
                update: {},
                create: { bulan: b, tahun: t }
            });
            if (status === 'EMPTY') {
                await prisma_1.default.attendanceDay.deleteMany({
                    where: {
                        employeeId,
                        periodId: period.id,
                        tanggal: tgl
                    }
                });
            }
            else {
                await prisma_1.default.attendanceDay.upsert({
                    where: {
                        employeeId_periodId_tanggal: {
                            employeeId,
                            periodId: period.id,
                            tanggal: tgl
                        }
                    },
                    update: {
                        status,
                        keterangan: keterangan || null
                    },
                    create: {
                        employeeId,
                        periodId: period.id,
                        tanggal: tgl,
                        status,
                        keterangan: keterangan || null
                    }
                });
            }
            if (req.session) {
                req.session.toast = {
                    type: 'success',
                    message: status === 'EMPTY'
                        ? `Status presensi tanggal ${tgl} berhasil dikosongkan.`
                        : `Status presensi tanggal ${tgl} berhasil diubah menjadi ${status === 'LIBUR' ? 'Libur (L)' : status}.`
                };
            }
            res.redirect(`/absensi?bulan=${b}&tahun=${t}`);
        }
        catch (error) {
            console.error('Error in absensiController.directUpdate:', error);
            res.redirect('/absensi');
        }
    },
    bulkDateUpdate: async (req, res) => {
        try {
            const user = req.session?.user;
            if (!user) {
                return res.status(401).json({ success: false, message: 'Harus login terlebih dahulu' });
            }
            if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN_DINAS') {
                if (req.session) {
                    req.session.toast = {
                        type: 'danger',
                        message: 'Akses Ditolak: Fitur ubah status vertikal massal hanya untuk Super Admin dan Admin Dinas.'
                    };
                }
                return res.redirect('/absensi');
            }
            const { tanggal, bulan, tahun, status, keterangan } = req.body;
            if (!tanggal || !bulan || !tahun || !status) {
                return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
            }
            const b = parseInt(bulan);
            const t = parseInt(tahun);
            const tgl = parseInt(tanggal);
            const period = await prisma_1.default.attendancePeriod.upsert({
                where: { bulan_tahun: { bulan: b, tahun: t } },
                update: {},
                create: { bulan: b, tahun: t }
            });
            const activeEmployees = await prisma_1.default.employee.findMany({
                where: { aktif: true },
                select: { id: true }
            });
            if (status === 'EMPTY') {
                await prisma_1.default.attendanceDay.deleteMany({
                    where: {
                        periodId: period.id,
                        tanggal: tgl
                    }
                });
            }
            else {
                const updates = activeEmployees.map(emp => prisma_1.default.attendanceDay.upsert({
                    where: {
                        employeeId_periodId_tanggal: {
                            employeeId: emp.id,
                            periodId: period.id,
                            tanggal: tgl
                        }
                    },
                    update: {
                        status,
                        keterangan: keterangan || null
                    },
                    create: {
                        employeeId: emp.id,
                        periodId: period.id,
                        tanggal: tgl,
                        status,
                        keterangan: keterangan || null
                    }
                }));
                await prisma_1.default.$transaction(updates);
            }
            if (req.session) {
                req.session.toast = {
                    type: 'success',
                    message: status === 'EMPTY'
                        ? `Presensi tanggal ${tgl} untuk seluruh pegawai (${activeEmployees.length} orang) berhasil dikosongkan.`
                        : `Presensi tanggal ${tgl} untuk seluruh pegawai (${activeEmployees.length} orang) berhasil diubah menjadi ${status === 'LIBUR' ? 'Libur (L)' : status}.`
                };
            }
            res.redirect(`/absensi?bulan=${b}&tahun=${t}`);
        }
        catch (error) {
            console.error('Error in absensiController.bulkDateUpdate:', error);
            if (req.session) {
                req.session.toast = {
                    type: 'danger',
                    message: 'Gagal memperbarui status presensi massal: ' + (error.message || 'Terjadi kesalahan sistem')
                };
            }
            res.redirect('/absensi');
        }
    },
    submitKlarifikasi: async (req, res) => {
        try {
            let { employeeId, tanggalAbsen, tanggalMulai, tanggalSelesai, isRentang, statusAwal, statusPengganti, alasan } = req.body;
            const file = req.file;
            if (isRentang === 'true' || isRentang === true) {
                if (tanggalMulai && tanggalSelesai) {
                    tanggalAbsen = `${tanggalMulai} s/d ${tanggalSelesai}`;
                }
            }
            if (!employeeId || !tanggalAbsen || !alasan) {
                if (req.session) {
                    req.session.toast = {
                        type: 'warning',
                        message: 'Silakan lengkapi tanggal dan alasan klarifikasi.'
                    };
                }
                return res.redirect('/absensi');
            }
            const fileUrl = file ? `/uploads/${file.filename}` : '/uploads/clarification_demo.pdf';
            const fileName = file ? file.originalname : 'Surat_Keterangan.pdf';
            await prisma_1.default.clarification.create({
                data: {
                    employeeId,
                    tanggalAbsen,
                    statusAwal: statusAwal || 'TK',
                    statusPengganti: statusPengganti || 'DL',
                    alasan,
                    fileUrl,
                    fileName,
                    statusVerifikasi: 'PENDING'
                }
            });
            if (req.session) {
                req.session.toast = {
                    type: 'success',
                    message: 'Permohonan klarifikasi berhasil diajukan dan sedang menunggu review admin.'
                };
            }
            res.redirect('/absensi');
        }
        catch (error) {
            console.error('Error in submitKlarifikasi:', error);
            if (req.session) {
                req.session.toast = {
                    type: 'danger',
                    message: 'Gagal mengajukan klarifikasi. Silakan coba kembali.'
                };
            }
            res.redirect('/absensi');
        }
    }
};
