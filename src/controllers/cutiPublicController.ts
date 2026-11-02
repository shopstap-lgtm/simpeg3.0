import { Request, Response } from 'express';
import prisma from '../lib/prisma';

const BULAN_NAMES = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export const cutiPublicController = {
  show: async (req: Request, res: Response) => {
    try {
      const cms = await prisma.cmsConfig.findUnique({ where: { id: 'cms-main' } });
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;

      const rawNip = (req.query.nip as string) || '';
      const cleanNip = rawNip.replace(/\s+/g, '').trim();

      const filterBulan = (req.query.bulan as string) || 'all';
      const filterTahun = (req.query.tahun as string) || String(currentYear);

      let employee: any = null;
      let cutiList: any[] = [];
      let employeeNotFound = false;
      let stats = {
        total: 0,
        tahunan: 0,
        sakit: 0,
        melahirkan: 0,
        haji: 0,
        lainnya: 0,
        suratTerbit: 0,
        suratMenunggu: 0
      };

      if (cleanNip) {
        // Cari pegawai aktif berdasarkan NIP
        employee = await prisma.employee.findFirst({
          where: {
            nip: cleanNip,
            aktif: true
          },
          include: {
            unit: true
          }
        });

        if (!employee) {
          employeeNotFound = true;
        } else {
          // Ambil daftar riwayat cuti pegawai
          const whereClause: any = {
            employeeId: employee.id
          };

          if (filterBulan !== 'all' && !isNaN(parseInt(filterBulan, 10))) {
            whereClause.bulan = parseInt(filterBulan, 10);
          }

          if (filterTahun !== 'all' && !isNaN(parseInt(filterTahun, 10))) {
            whereClause.tahun = parseInt(filterTahun, 10);
          }

          cutiList = await prisma.cuti.findMany({
            where: whereClause,
            orderBy: [
              { tahun: 'desc' },
              { bulan: 'desc' },
              { createdAt: 'desc' }
            ]
          });

          // Hitung statistik untuk tahun yang dipilih (atau seluruh riwayat jika tahun all)
          const allRecordsForStats = await prisma.cuti.findMany({
            where: {
              employeeId: employee.id,
              ...(filterTahun !== 'all' && !isNaN(parseInt(filterTahun, 10)) ? { tahun: parseInt(filterTahun, 10) } : {})
            }
          });

          stats.total = allRecordsForStats.length;
          allRecordsForStats.forEach(item => {
            const jc = (item.jenisCuti || '').toLowerCase();
            if (jc.includes('tahunan')) stats.tahunan++;
            else if (jc.includes('sakit')) stats.sakit++;
            else if (jc.includes('melahirkan')) stats.melahirkan++;
            else if (jc.includes('haji')) stats.haji++;
            else stats.lainnya++;

            if (item.fileSuratUrl || item.statusSurat === 'TERBIT') {
              stats.suratTerbit++;
            } else {
              stats.suratMenunggu++;
            }
          });
        }
      }

      // Ambil daftar tahun unik yang pernah ada cuti untuk dropdown
      const availableYears = [currentYear, currentYear - 1, currentYear - 2];

      return res.render('cuti', {
        page: 'cuti',
        title: 'Rekap Cuti Pegawai - SIMPEG Korwil Cibitung',
        nipQuery: cleanNip,
        employee,
        cutiList,
        stats,
        employeeNotFound,
        filterBulan,
        filterTahun,
        availableYears,
        BULAN_NAMES,
        cmsConfig: cms,
        user: (req as any).session?.user || null
      });
    } catch (error) {
      console.error('[cutiPublicController.show] Error:', error);
      return res.status(500).render('error', {
        title: 'Terjadi Kesalahan',
        message: 'Gagal memuat halaman rekap cuti.',
        error: process.env.NODE_ENV === 'development' ? error : {}
      });
    }
  }
};

