import { Request, Response } from 'express';
import prisma from '../lib/prisma';

export const ekinerjaController = {
  show: async (req: Request, res: Response) => {
    try {
      const cms = await prisma.cmsConfig.findUnique({ where: { id: 'cms-main' } });
      const activeDefaultMonth = cms?.selectedMonthEkinerja || cms?.selectedMonth || 7;
      const activeDefaultYear = cms?.selectedYear || 2026;

      const bulan = parseInt(req.query.bulan as string) || activeDefaultMonth;
      const tahun = parseInt(req.query.tahun as string) || activeDefaultYear;
      const selectedUnit = (req.query.unit as string) || 'unit-all';
      const search = (req.query.search as string) || '';

      // Pagination setup (default 25 rows)
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limitQuery = req.query.limit as string;
      const limit = limitQuery === 'all' ? 999999 : (parseInt(limitQuery) || 25);

      const whereEmp: any = { aktif: true };
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
        prisma.unit.findMany({ orderBy: { namaUnit: 'asc' } }),
        prisma.employee.count({ where: whereEmp }),
        prisma.employee.findMany({
          where: { aktif: true },
          include: { unit: true },
          orderBy: { nama: 'asc' }
        }),
        prisma.employee.findMany({
          where: whereEmp,
          include: { unit: true },
          orderBy: [
            { unit: { namaUnit: 'asc' } },
            { nama: 'asc' }
          ],
          skip: limit === 999999 ? 0 : (page - 1) * limit,
          take: limit
        }),
        prisma.ekinerjaReport.findMany({
          where: { bulan, tahun }
        })
      ]);

      const reportsMap = new Map<string, any>();
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
        user: (req as any).session?.user || null
      });
    } catch (error) {
      console.error('Error in ekinerjaController.show:', error);
      res.status(500).send('Terjadi kesalahan saat memuat data e-kinerja.');
    }
  },

  submitLaporan: async (req: Request, res: Response) => {
    try {
      const { employeeId, bulan, tahun } = req.body;
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };

      if (!employeeId || !bulan || !tahun) {
        if ((req as any).session) {
          (req as any).session.toast = {
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
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'warning',
            message: 'Mohon lampirkan setidaknya salah satu berkas laporan (Harian atau Bulanan).'
          };
        }
        return res.redirect('/ekinerja');
      }

      const fileHarianUrl = fileHarian
        ? `data:${fileHarian.mimetype || 'application/pdf'};base64,${fileHarian.buffer.toString('base64')}`
        : undefined;
      const fileHarianName = fileHarian ? fileHarian.originalname : undefined;
      const fileBulananUrl = fileBulanan
        ? `data:${fileBulanan.mimetype || 'application/pdf'};base64,${fileBulanan.buffer.toString('base64')}`
        : undefined;
      const fileBulananName = fileBulanan ? fileBulanan.originalname : undefined;

      await prisma.ekinerjaReport.upsert({
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

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: 'Laporan E-Kinerja berhasil diunggah dan sedang menunggu review verifikator.'
        };
      }

      res.redirect(`/ekinerja?bulan=${b}&tahun=${t}`);
    } catch (error: any) {
      console.error('Error in submitLaporan:', error);
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'danger',
          message: 'Gagal mengunggah laporan. Silakan coba kembali.'
        };
      }
      res.redirect('/ekinerja');
    }
  }
};
