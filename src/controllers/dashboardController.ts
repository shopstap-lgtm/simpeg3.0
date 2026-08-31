import { Request, Response } from 'express';
import { getDashboardStatsFromDB } from '../services/statsService';
import prisma from '../lib/prisma';

export const dashboardController = {
  show: async (req: Request, res: Response) => {
    console.log('[Dashboard] show handler triggered. query:', req.query);
    try {
      const selectedUnit = (req.query.unit as string) || 'unit-all';
      console.log('[Dashboard] Fetching cmsConfig and units from Prisma...');
      
      const [cms, allUnits] = await Promise.all([
        prisma.cmsConfig.findUnique({ where: { id: 'cms-main' } }).catch(err => {
          console.error('[Dashboard] Error querying cmsConfig:', err);
          return null;
        }),
        prisma.unit.findMany({ orderBy: { namaUnit: 'asc' } }).catch(err => {
          console.error('[Dashboard] Error querying units:', err);
          return [];
        })
      ]);

      console.log('[Dashboard] DB query completed. Units count:', allUnits.length);

      const activeBulan = cms?.selectedMonth || 7;
      const activeTahun = cms?.selectedYear || 2026;

      console.log('[Dashboard] Fetching stats for unit:', selectedUnit, 'month:', activeBulan, 'year:', activeTahun);
      const stats = await getDashboardStatsFromDB(selectedUnit, activeBulan, activeTahun);
      console.log('[Dashboard] Stats computed successfully. Rendering view...');

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
