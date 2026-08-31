import { Request, Response } from 'express';
import { getDashboardStatsFromDB } from '../services/statsService';
import prisma from '../lib/prisma';

export const dashboardController = {
  show: async (req: Request, res: Response) => {
    try {
      const selectedUnit = (req.query.unit as string) || 'unit-all';
      
      const [cms, allUnits] = await Promise.all([
        prisma.cmsConfig.findUnique({ where: { id: 'cms-main' } }),
        prisma.unit.findMany({ orderBy: { namaUnit: 'asc' } })
      ]);

      const activeBulan = cms?.selectedMonth || 7;
      const activeTahun = cms?.selectedYear || 2026;

      const stats = await getDashboardStatsFromDB(selectedUnit, activeBulan, activeTahun);

      const units = [
        { id: 'unit-all', namaUnit: 'Semua Unit Kerja' },
        ...allUnits
      ];

      res.render('dashboard', {
        title: 'Dashboard Kepegawaian - Korwil Cibitung',
        page: 'dashboard',
        stats,
        units,
        selectedUnit,
        cms: cms || {
          heroBadge: 'Portal Resmi Korwil',
          heroTitle: 'Sistem Informasi Manajemen Pegawai',
          heroSubtitle: 'Wilayah Pendidikan Kecamatan Cibitung',
          pengumumanText: 'Batas akhir laporan e-kinerja tanggal 25 setiap bulannya.',
          selectedMonth: 7,
          selectedMonthEkinerja: 7,
          selectedYear: 2026
        },
        user: (req as any).session?.user || null
      });
    } catch (error) {
      console.error('Error rendering dashboard:', error);
      res.status(500).send('Terjadi kesalahan internal pada server.');
    }
  }
};
