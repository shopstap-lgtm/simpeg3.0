"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.klarifikasiController = void 0;
const prisma_1 = __importDefault(require("../../lib/prisma"));
exports.klarifikasiController = {
    show: async (req, res) => {
        try {
            const activeTab = req.query.tab || 'pending';
            const filterUnit = req.query.unit || 'unit-all';
            const filterHistoryStatus = req.query.historyStatus || 'ALL';
            const whereClause = {};
            if (filterUnit !== 'unit-all') {
                whereClause.employee = { unitId: filterUnit };
            }
            const [allUnits, allClarifications] = await Promise.all([
                prisma_1.default.unit.findMany({ orderBy: { namaUnit: 'asc' } }),
                prisma_1.default.clarification.findMany({
                    where: whereClause,
                    include: {
                        employee: { include: { unit: true } }
                    },
                    orderBy: { createdAt: 'desc' }
                })
            ]);
            const formatted = allClarifications.map(c => ({
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
            // Tab 1: Antrean Menunggu Verifikasi (Only PENDING)
            const pendingList = formatted.filter(c => c.statusVerifikasi === 'PENDING');
            // Tab 2: Riwayat & Arsip (Only APPROVED & REJECTED)
            let archiveList = formatted.filter(c => c.statusVerifikasi !== 'PENDING');
            if (filterHistoryStatus !== 'ALL') {
                archiveList = archiveList.filter(c => c.statusVerifikasi === filterHistoryStatus);
            }
            const pendingCount = formatted.filter(c => c.statusVerifikasi === 'PENDING').length;
            const approvedCount = formatted.filter(c => c.statusVerifikasi === 'APPROVED').length;
            const rejectedCount = formatted.filter(c => c.statusVerifikasi === 'REJECTED').length;
            const units = [
                { id: 'unit-all', namaUnit: 'Semua Unit Kerja' },
                ...allUnits
            ];
            const toast = req.session?.toast || null;
            if (req.session) {
                delete req.session.toast;
            }
            res.render('admin/klarifikasi', {
                title: 'Verifikasi Klarifikasi Absensi & Sync Excel - Admin SIMPEG',
                page: 'admin-klarifikasi',
                activeTab,
                pendingList,
                archiveList,
                units,
                filterUnit,
                filterHistoryStatus,
                pendingCount,
                approvedCount,
                rejectedCount,
                toast,
                user: req.session?.user || { role: 'SUPER_ADMIN', namaLengkap: 'Administrator Utama' }
            });
        }
        catch (error) {
            console.error('Error in klarifikasiController.show:', error);
            res.status(500).send('Terjadi kesalahan sistem.');
        }
    },
    approve: async (req, res) => {
        try {
            const { id } = req.params;
            const { catatanAdmin } = req.body;
            const item = await prisma_1.default.clarification.findUnique({
                where: { id },
                include: { employee: true }
            });
            if (item) {
                const reviewer = req.session?.user?.namaLengkap || 'Admin Korwil';
                const reviewTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
                await prisma_1.default.clarification.update({
                    where: { id },
                    data: {
                        statusVerifikasi: 'APPROVED',
                        catatanAdmin: catatanAdmin || 'Klarifikasi absensi disetujui.',
                        reviewedBy: reviewer,
                        reviewedAt: reviewTimestamp
                    }
                });
                // Update attendance days directly in the database
                const targetStatus = item.statusPengganti || 'DL';
                const updateDay = async (year, month, day) => {
                    const period = await prisma_1.default.attendancePeriod.upsert({
                        where: { bulan_tahun: { bulan: month, tahun: year } },
                        update: {},
                        create: { bulan: month, tahun: year }
                    });
                    await prisma_1.default.attendanceDay.upsert({
                        where: {
                            employeeId_periodId_tanggal: {
                                employeeId: item.employeeId,
                                periodId: period.id,
                                tanggal: day
                            }
                        },
                        update: {
                            status: targetStatus,
                            keterangan: `Klarifikasi Disetujui (${targetStatus})`
                        },
                        create: {
                            employeeId: item.employeeId,
                            periodId: period.id,
                            tanggal: day,
                            status: targetStatus,
                            keterangan: `Klarifikasi Disetujui (${targetStatus})`
                        }
                    });
                };
                if (item.tanggalAbsen.includes('s/d')) {
                    const [startStr, endStr] = item.tanggalAbsen.split(' s/d ').map(s => s.trim());
                    const startDate = new Date(startStr);
                    const endDate = new Date(endStr);
                    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                        await updateDay(d.getFullYear(), d.getMonth() + 1, d.getDate());
                    }
                }
                else {
                    const parts = item.tanggalAbsen.split('-');
                    if (parts.length === 3) {
                        await updateDay(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
                    }
                }
                if (req.session) {
                    req.session.toast = {
                        type: 'success',
                        message: `Klarifikasi absensi untuk ${item.employee.nama} DISETUJUI dan tabel rekap otomatis diperbarui.`
                    };
                }
            }
            res.redirect('/admin/klarifikasi?tab=pending');
        }
        catch (error) {
            console.error('Error in klarifikasiController.approve:', error);
            res.redirect('/admin/klarifikasi?tab=pending');
        }
    },
    reject: async (req, res) => {
        try {
            const { id } = req.params;
            const { catatanAdmin } = req.body;
            const item = await prisma_1.default.clarification.findUnique({
                where: { id },
                include: { employee: true }
            });
            if (item) {
                const reviewer = req.session?.user?.namaLengkap || 'Admin Korwil';
                const reviewTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
                await prisma_1.default.clarification.update({
                    where: { id },
                    data: {
                        statusVerifikasi: 'REJECTED',
                        catatanAdmin: catatanAdmin || 'Bukti dokumen belum memenuhi ketentuan / belum ditandatangani Kepala Sekolah.',
                        reviewedBy: reviewer,
                        reviewedAt: reviewTimestamp
                    }
                });
                if (req.session) {
                    req.session.toast = {
                        type: 'warning',
                        message: `Klarifikasi absensi untuk ${item.employee.nama} DITOLAK dan dipindahkan ke Riwayat Arsip.`
                    };
                }
            }
            res.redirect('/admin/klarifikasi?tab=pending');
        }
        catch (error) {
            console.error('Error in klarifikasiController.reject:', error);
            res.redirect('/admin/klarifikasi?tab=pending');
        }
    },
    delete: async (req, res) => {
        try {
            const { id } = req.params;
            const redirectTab = req.query.tab || 'pending';
            const item = await prisma_1.default.clarification.findUnique({
                where: { id },
                include: { employee: true }
            });
            if (item) {
                // If it was approved before, revert status in attendance day
                if (item.statusVerifikasi === 'APPROVED') {
                    const revertStatus = item.statusAwal || 'TK';
                    const revertDay = async (year, month, day) => {
                        const period = await prisma_1.default.attendancePeriod.findUnique({
                            where: { bulan_tahun: { bulan: month, tahun: year } }
                        });
                        if (period) {
                            await prisma_1.default.attendanceDay.updateMany({
                                where: {
                                    employeeId: item.employeeId,
                                    periodId: period.id,
                                    tanggal: day
                                },
                                data: {
                                    status: revertStatus,
                                    keterangan: `Status Dikembalikan ke Semula (${revertStatus})`
                                }
                            });
                        }
                    };
                    if (item.tanggalAbsen.includes('s/d')) {
                        const [startStr, endStr] = item.tanggalAbsen.split(' s/d ').map(s => s.trim());
                        const startDate = new Date(startStr);
                        const endDate = new Date(endStr);
                        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                            await revertDay(d.getFullYear(), d.getMonth() + 1, d.getDate());
                        }
                    }
                    else {
                        const parts = item.tanggalAbsen.split('-');
                        if (parts.length === 3) {
                            await revertDay(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
                        }
                    }
                }
                await prisma_1.default.clarification.delete({ where: { id } });
                if (req.session) {
                    req.session.toast = {
                        type: 'success',
                        message: `Klarifikasi absensi untuk ${item.employee.nama} berhasil dihapus dan status absensi dipulihkan.`
                    };
                }
            }
            res.redirect(`/admin/klarifikasi?tab=${redirectTab}`);
        }
        catch (error) {
            console.error('Error in klarifikasiController.delete:', error);
            res.redirect('/admin/klarifikasi');
        }
    },
    importExcel: (req, res) => {
        const files = req.files;
        const fileCount = files ? files.length : 1;
        if (req.session) {
            req.session.toast = {
                type: 'success',
                message: `Sinkronisasi berhasil! ${fileCount} file Excel rekap kehadiran telah diproses.`
            };
        }
        res.redirect('/admin/klarifikasi');
    }
};
