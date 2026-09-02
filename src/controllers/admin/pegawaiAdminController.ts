import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

export const pegawaiAdminController = {
  show: async (req: Request, res: Response) => {
    try {
      const selectedUnit = (req.query.unit as string) || 'unit-all';
      const selectedStatus = (req.query.status as string) || 'ALL';
      const search = (req.query.search as string) || '';

      // Pagination setup (default 25 rows)
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limitQuery = req.query.limit as string;
      const limit = limitQuery === 'all' ? 999999 : (parseInt(limitQuery) || 25);

      const whereClause: any = {};

      if (selectedUnit !== 'unit-all') {
        whereClause.unitId = selectedUnit;
      }

      if (selectedStatus !== 'ALL') {
        whereClause.statusKepegawaian = selectedStatus;
      }

      if (search.trim() !== '') {
        const q = search.trim();
        whereClause.OR = [
          { nama: { contains: q, mode: 'insensitive' } },
          { nip: { contains: q, mode: 'insensitive' } },
          { jabatan: { contains: q, mode: 'insensitive' } }
        ];
      }

      const [allUnits, totalFilteredEmployees, employees, totalAll, countPns, countPppk, countPppkPw, countOs] = await Promise.all([
        prisma.unit.findMany({ orderBy: { namaUnit: 'asc' } }),
        prisma.employee.count({ where: whereClause }),
        prisma.employee.findMany({
          where: whereClause,
          include: { unit: true },
          orderBy: [
            { unit: { namaUnit: 'asc' } },
            { nama: 'asc' }
          ],
          skip: limit === 999999 ? 0 : (page - 1) * limit,
          take: limit
        }),
        prisma.employee.count(),
        prisma.employee.count({ where: { statusKepegawaian: 'PNS' } }),
        prisma.employee.count({ where: { statusKepegawaian: 'PPPK' } }),
        prisma.employee.count({ where: { statusKepegawaian: 'PPPK_PW' } }),
        prisma.employee.count({ where: { statusKepegawaian: 'OUTSOURCING' } })
      ]);

      const units = [
        { id: 'unit-all', namaUnit: 'Semua Unit Kerja' },
        ...allUnits
      ];

      const toast = (req as any).session?.toast || null;
      if ((req as any).session) {
        delete (req as any).session.toast;
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
        user: (req as any).session?.user || { role: 'SUPER_ADMIN', namaLengkap: 'Administrator Utama' }
      });
    } catch (error) {
      console.error('Error in pegawaiAdminController.show:', error);
      res.status(500).send('Terjadi kesalahan saat memuat data pegawai.');
    }
  },

  create: async (req: Request, res: Response) => {
    try {
      const { nip, nama, jabatan, unitId, statusKepegawaian, aktif } = req.body;

      if (!nip || !nama || !unitId) {
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'warning',
            message: 'NIP, Nama Pegawai, dan Unit Kerja wajib diisi.'
          };
        }
        return res.redirect('/admin/pegawai');
      }

      const cleanNip = nip.trim();
      const existing = await prisma.employee.findUnique({
        where: { nip: cleanNip }
      });

      if (existing) {
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'warning',
            message: `Pegawai dengan NIP ${cleanNip} sudah terdaftar (${existing.nama}).`
          };
        }
        return res.redirect('/admin/pegawai');
      }

      const newEmp = await prisma.employee.create({
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
      const cms = await prisma.cmsConfig.findUnique({ where: { id: 'cms-main' } });
      const activeBulan = cms?.selectedMonth || 7;
      const activeTahun = cms?.selectedYear || 2026;

      const period = await prisma.attendancePeriod.upsert({
        where: { bulan_tahun: { bulan: activeBulan, tahun: activeTahun } },
        update: {},
        create: { bulan: activeBulan, tahun: activeTahun }
      });

      const totalDays = new Date(activeTahun, activeBulan, 0).getDate();
      for (let day = 1; day <= totalDays; day++) {
        const date = new Date(activeTahun, activeBulan - 1, day);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;

        await prisma.attendanceDay.create({
          data: {
            employeeId: newEmp.id,
            periodId: period.id,
            tanggal: day,
            status: isWeekend ? 'LIBUR' : 'HADIR',
            keterangan: isWeekend ? 'Akhir Pekan' : null
          }
        });
      }

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Pegawai '${newEmp.nama}' berhasil ditambahkan ke ${newEmp.unit.namaUnit}.`
        };
      }

      res.redirect('/admin/pegawai');
    } catch (error: any) {
      console.error('Error creating employee:', error);
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'danger',
          message: `Gagal menambah pegawai: ${error.message}`
        };
      }
      res.redirect('/admin/pegawai');
    }
  },

  update: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { nip, nama, jabatan, unitId, statusKepegawaian, aktif } = req.body;

      const cleanNip = nip ? nip.trim() : undefined;

      // Check if NIP is taken by another employee
      if (cleanNip) {
        const existing = await prisma.employee.findUnique({
          where: { nip: cleanNip }
        });
        if (existing && existing.id !== id) {
          if ((req as any).session) {
            (req as any).session.toast = {
              type: 'warning',
              message: `NIP ${cleanNip} sudah digunakan oleh pegawai lain (${existing.nama}).`
            };
          }
          return res.redirect('/admin/pegawai');
        }
      }

      const updated = await prisma.employee.update({
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

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Data pegawai '${updated.nama}' berhasil diperbarui.`
        };
      }

      res.redirect('/admin/pegawai');
    } catch (error: any) {
      console.error('Error updating employee:', error);
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'danger',
          message: `Gagal memperbarui data: ${error.message}`
        };
      }
      res.redirect('/admin/pegawai');
    }
  },

  toggleActive: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const emp = await prisma.employee.findUnique({ where: { id } });

      if (emp) {
        const updated = await prisma.employee.update({
          where: { id },
          data: { aktif: !emp.aktif }
        });

        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'success',
            message: `Status pegawai ${updated.nama} berhasil diubah menjadi ${updated.aktif ? 'Aktif' : 'Non-Aktif'}.`
          };
        }
      }

      res.redirect('/admin/pegawai');
    } catch (error) {
      console.error('Error in toggleActive employee:', error);
      res.redirect('/admin/pegawai');
    }
  },

  delete: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const deleted = await prisma.employee.delete({
        where: { id }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'warning',
          message: `Data pegawai '${deleted.nama}' (NIP: ${deleted.nip}) telah dihapus dari sistem.`
        };
      }

      res.redirect('/admin/pegawai');
    } catch (error: any) {
      console.error('Error deleting employee:', error);
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'danger',
          message: `Gagal menghapus pegawai: ${error.message}`
        };
      }
      res.redirect('/admin/pegawai');
    }
  }
};
