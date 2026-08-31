"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pegawaiAdminController = void 0;
const prisma_1 = __importDefault(require("../../lib/prisma"));
exports.pegawaiAdminController = {
    show: async (req, res) => {
        try {
            const selectedUnit = req.query.unit || 'unit-all';
            const selectedStatus = req.query.status || 'ALL';
            const search = req.query.search || '';
            // Pagination setup (default 25 rows)
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limitQuery = req.query.limit;
            const limit = limitQuery === 'all' ? 999999 : (parseInt(limitQuery) || 25);
            const whereClause = {};
            if (selectedUnit !== 'unit-all') {
                whereClause.unitId = selectedUnit;
            }
            if (selectedStatus !== 'ALL') {
                whereClause.statusKepegawaian = selectedStatus;
            }
            if (search.trim() !== '') {
                whereClause.OR = [
                    { nama: { contains: search } },
                    { nip: { contains: search } },
                    { jabatan: { contains: search } }
                ];
            }
            const [allUnits, totalFilteredEmployees, employees, totalAll, countPns, countPppk, countPppkPw, countOs] = await Promise.all([
                prisma_1.default.unit.findMany({ orderBy: { namaUnit: 'asc' } }),
                prisma_1.default.employee.count({ where: whereClause }),
                prisma_1.default.employee.findMany({
                    where: whereClause,
                    include: { unit: true },
                    orderBy: [
                        { unit: { namaUnit: 'asc' } },
                        { nama: 'asc' }
                    ],
                    skip: limit === 999999 ? 0 : (page - 1) * limit,
                    take: limit
                }),
                prisma_1.default.employee.count(),
                prisma_1.default.employee.count({ where: { statusKepegawaian: 'PNS' } }),
                prisma_1.default.employee.count({ where: { statusKepegawaian: 'PPPK' } }),
                prisma_1.default.employee.count({ where: { statusKepegawaian: 'PPPK_PW' } }),
                prisma_1.default.employee.count({ where: { statusKepegawaian: 'OUTSOURCING' } })
            ]);
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
            res.render('admin/pegawai', {
                title: 'Master Data Pegawai - Super Admin SIMPEG',
                page: 'admin-pegawai',
                employees: employees.map(e => ({
                    id: e.id,
                    nip: e.nip,
                    nama: e.nama,
                    jabatan: e.jabatan || 'Guru',
                    statusKepegawaian: e.statusKepegawaian,
                    unitId: e.unitId,
                    unitNama: e.unit.namaUnit,
                    aktif: e.aktif
                })),
                units,
                allUnits,
                selectedUnit,
                selectedStatus,
                search,
                totalAll,
                countPns,
                countPppk,
                countPppkPw,
                countOs,
                pagination,
                toast,
                user: req.session?.user || { role: 'SUPER_ADMIN', namaLengkap: 'Administrator Utama' }
            });
        }
        catch (error) {
            console.error('Error in pegawaiAdminController.show:', error);
            res.status(500).send('Terjadi kesalahan saat memuat data pegawai.');
        }
    },
    create: async (req, res) => {
        try {
            const { nip, nama, jabatan, unitId, statusKepegawaian, aktif } = req.body;
            if (!nip || !nama || !unitId) {
                if (req.session) {
                    req.session.toast = {
                        type: 'warning',
                        message: 'NIP, Nama Pegawai, dan Unit Kerja wajib diisi.'
                    };
                }
                return res.redirect('/admin/pegawai');
            }
            const cleanNip = nip.trim();
            const existing = await prisma_1.default.employee.findUnique({
                where: { nip: cleanNip }
            });
            if (existing) {
                if (req.session) {
                    req.session.toast = {
                        type: 'warning',
                        message: `Pegawai dengan NIP ${cleanNip} sudah terdaftar (${existing.nama}).`
                    };
                }
                return res.redirect('/admin/pegawai');
            }
            const newEmp = await prisma_1.default.employee.create({
                data: {
                    nip: cleanNip,
                    nama: nama.trim(),
                    jabatan: jabatan && jabatan.trim() !== '' ? jabatan.trim() : 'Guru',
                    unitId,
                    statusKepegawaian: statusKepegawaian || 'PNS',
                    aktif: aktif === 'true' || aktif === true || aktif === 'on' || aktif === undefined
                },
                include: { unit: true }
            });
            // Seed baseline attendance days for current active month
            const cms = await prisma_1.default.cmsConfig.findUnique({ where: { id: 'cms-main' } });
            const activeBulan = cms?.selectedMonth || 7;
            const activeTahun = cms?.selectedYear || 2026;
            const period = await prisma_1.default.attendancePeriod.upsert({
                where: { bulan_tahun: { bulan: activeBulan, tahun: activeTahun } },
                update: {},
                create: { bulan: activeBulan, tahun: activeTahun }
            });
            const totalDays = new Date(activeTahun, activeBulan, 0).getDate();
            for (let day = 1; day <= totalDays; day++) {
                const date = new Date(activeTahun, activeBulan - 1, day);
                const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                await prisma_1.default.attendanceDay.create({
                    data: {
                        employeeId: newEmp.id,
                        periodId: period.id,
                        tanggal: day,
                        status: isWeekend ? 'LIBUR' : 'HADIR',
                        keterangan: isWeekend ? 'Akhir Pekan' : null
                    }
                });
            }
            if (req.session) {
                req.session.toast = {
                    type: 'success',
                    message: `Pegawai '${newEmp.nama}' berhasil ditambahkan ke ${newEmp.unit.namaUnit}.`
                };
            }
            res.redirect('/admin/pegawai');
        }
        catch (error) {
            console.error('Error creating employee:', error);
            if (req.session) {
                req.session.toast = {
                    type: 'danger',
                    message: `Gagal menambah pegawai: ${error.message}`
                };
            }
            res.redirect('/admin/pegawai');
        }
    },
    update: async (req, res) => {
        try {
            const { id } = req.params;
            const { nip, nama, jabatan, unitId, statusKepegawaian, aktif } = req.body;
            const cleanNip = nip ? nip.trim() : undefined;
            // Check if NIP is taken by another employee
            if (cleanNip) {
                const existing = await prisma_1.default.employee.findUnique({
                    where: { nip: cleanNip }
                });
                if (existing && existing.id !== id) {
                    if (req.session) {
                        req.session.toast = {
                            type: 'warning',
                            message: `NIP ${cleanNip} sudah digunakan oleh pegawai lain (${existing.nama}).`
                        };
                    }
                    return res.redirect('/admin/pegawai');
                }
            }
            const updated = await prisma_1.default.employee.update({
                where: { id },
                data: {
                    nip: cleanNip,
                    nama: nama ? nama.trim() : undefined,
                    jabatan: jabatan !== undefined ? jabatan.trim() : undefined,
                    unitId: unitId || undefined,
                    statusKepegawaian: statusKepegawaian || undefined,
                    aktif: aktif === 'true' || aktif === true || aktif === 'on'
                },
                include: { unit: true }
            });
            if (req.session) {
                req.session.toast = {
                    type: 'success',
                    message: `Data pegawai '${updated.nama}' berhasil diperbarui.`
                };
            }
            res.redirect('/admin/pegawai');
        }
        catch (error) {
            console.error('Error updating employee:', error);
            if (req.session) {
                req.session.toast = {
                    type: 'danger',
                    message: `Gagal memperbarui data: ${error.message}`
                };
            }
            res.redirect('/admin/pegawai');
        }
    },
    toggleActive: async (req, res) => {
        try {
            const { id } = req.params;
            const emp = await prisma_1.default.employee.findUnique({ where: { id } });
            if (emp) {
                const updated = await prisma_1.default.employee.update({
                    where: { id },
                    data: { aktif: !emp.aktif }
                });
                if (req.session) {
                    req.session.toast = {
                        type: 'success',
                        message: `Status pegawai ${updated.nama} berhasil diubah menjadi ${updated.aktif ? 'Aktif' : 'Non-Aktif'}.`
                    };
                }
            }
            res.redirect('/admin/pegawai');
        }
        catch (error) {
            console.error('Error in toggleActive employee:', error);
            res.redirect('/admin/pegawai');
        }
    },
    delete: async (req, res) => {
        try {
            const { id } = req.params;
            const deleted = await prisma_1.default.employee.delete({
                where: { id }
            });
            if (req.session) {
                req.session.toast = {
                    type: 'warning',
                    message: `Data pegawai '${deleted.nama}' (NIP: ${deleted.nip}) telah dihapus dari sistem.`
                };
            }
            res.redirect('/admin/pegawai');
        }
        catch (error) {
            console.error('Error deleting employee:', error);
            if (req.session) {
                req.session.toast = {
                    type: 'danger',
                    message: `Gagal menghapus pegawai: ${error.message}`
                };
            }
            res.redirect('/admin/pegawai');
        }
    }
};
