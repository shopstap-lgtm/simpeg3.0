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
          { nama: { contains: search, mode: 'insensitive' } },
          { nip: { contains: search } }
        ];
      }

      const [allUnits, totalFilteredEmployees, allActiveEmployees, filteredEmployeeIds, employees, reports] = await Promise.all([
        prisma.unit.findMany({ orderBy: { namaUnit: 'asc' } }),
        prisma.employee.count({ where: whereEmp }),
        prisma.employee.findMany({
          where: { aktif: true },
          include: { unit: true },
          orderBy: { nama: 'asc' }
        }),
        prisma.employee.findMany({
          where: whereEmp,
          select: { id: true }
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

      const filteredIdSet = new Set(filteredEmployeeIds.map(e => e.id));

      // Calculate global stats across ALL employees in scope (not just current page pagination):
      let countApproved = 0;
      let countPending = 0;

      reports.forEach(r => {
        if (filteredIdSet.has(r.employeeId)) {
          if (r.statusReview === 'APPROVED') countApproved++;
          else if (r.statusReview === 'PENDING') countPending++;
        }
      });

      const countBelumKirim = Math.max(0, totalFilteredEmployees - countApproved - countPending);

      const stats = {
        total: totalFilteredEmployees,
        approved: countApproved,
        pending: countPending,
        belumKirim: countBelumKirim
      };

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
        stats,
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

      const MAX_SIZE = 1 * 1024 * 1024; // 1MB
      if ((fileHarian && fileHarian.size > MAX_SIZE) || (fileBulanan && fileBulanan.size > MAX_SIZE)) {
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'error',
            message: 'Ukuran file laporan melebihi batas maksimal 1MB!'
          };
        }
        return res.redirect('/ekinerja');
      }

      // Fetch employee + unit info for filename generation
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        include: { unit: true }
      });

      if (!employee) {
        if ((req as any).session) {
          (req as any).session.toast = { type: 'warning', message: 'Data pegawai tidak ditemukan.' };
        }
        return res.redirect('/ekinerja');
      }

      // Import storage helpers
      const { uploadToStorage, generateEkinerjaFilename, deleteFileFromStorage } = await import('../lib/supabase');
      const folder = `${t}/${b < 10 ? '0' + b : b}`; // e.g. "2026/07"

      // Cek apakah sudah ada laporan sebelumnya untuk membersihkan file lama saat revisi
      const existingReport = await prisma.ekinerjaReport.findUnique({
        where: {
          employeeId_bulan_tahun: {
            employeeId,
            bulan: b,
            tahun: t
          }
        }
      });

      let fileHarianUrl: string | undefined;
      let fileHarianName: string | undefined;
      let fileBulananUrl: string | undefined;
      let fileBulananName: string | undefined;

      if (fileHarian) {
        const ext = fileHarian.originalname.includes('.') 
          ? '.' + fileHarian.originalname.split('.').pop()!.toLowerCase() 
          : '.pdf';
        const autoName = generateEkinerjaFilename(b, t, employee.unit.namaUnit, employee.nama, 'Harian', ext);
        
        const result = await uploadToStorage('ekinerja', fileHarian.buffer, fileHarian.mimetype, folder, autoName);
        if (result) {
          fileHarianUrl = result.url;
          fileHarianName = autoName;
        } else {
          // Fallback to Base64 if Supabase upload fails
          console.warn('[Upload] Supabase upload failed, falling back to Base64 for fileHarian');
          fileHarianUrl = `data:${fileHarian.mimetype};base64,${fileHarian.buffer.toString('base64')}`;
          fileHarianName = fileHarian.originalname;
        }
      }

      if (fileBulanan) {
        const ext = fileBulanan.originalname.includes('.')
          ? '.' + fileBulanan.originalname.split('.').pop()!.toLowerCase()
          : '.pdf';
        const autoName = generateEkinerjaFilename(b, t, employee.unit.namaUnit, employee.nama, 'Bulanan', ext);
        
        const result = await uploadToStorage('ekinerja', fileBulanan.buffer, fileBulanan.mimetype, folder, autoName);
        if (result) {
          fileBulananUrl = result.url;
          fileBulananName = autoName;
        } else {
          console.warn('[Upload] Supabase upload failed, falling back to Base64 for fileBulanan');
          fileBulananUrl = `data:${fileBulanan.mimetype};base64,${fileBulanan.buffer.toString('base64')}`;
          fileBulananName = fileBulanan.originalname;
        }
      }

      // Bersihkan berkas fisik lama yang digantikan agar tidak menjadi sampah
      if (fileHarianUrl && existingReport?.fileHarianUrl && existingReport.fileHarianUrl !== fileHarianUrl) {
        await deleteFileFromStorage(existingReport.fileHarianUrl);
      }
      if (fileBulananUrl && existingReport?.fileBulananUrl && existingReport.fileBulananUrl !== fileBulananUrl) {
        await deleteFileFromStorage(existingReport.fileBulananUrl);
      }

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

