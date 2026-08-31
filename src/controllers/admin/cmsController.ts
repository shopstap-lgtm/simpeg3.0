import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

export const cmsController = {
  show: async (req: Request, res: Response) => {
    try {
      const cms = await prisma.cmsConfig.upsert({
        where: { id: 'cms-main' },
        update: {},
        create: {
          id: 'cms-main',
          heroBadge: 'Portal Resmi Korwil',
          heroTitle: 'Sistem Informasi Manajemen Pegawai',
          heroSubtitle: 'Wilayah Pendidikan Kecamatan Cibitung - Transparan, Akuntabel, dan Terintegrasi',
          pengumumanText: 'Batas akhir pengunggahan dokumen laporan E-Kinerja dan Klarifikasi Presensi untuk periode bulan berjalan adalah setiap tanggal 25 pukul 23:59 WIB.',
          selectedMonth: 7,
          selectedMonthEkinerja: 7,
          selectedYear: 2026
        }
      });

      const toast = (req as any).session?.toast || null;
      if ((req as any).session) {
        delete (req as any).session.toast;
      }

      res.render('admin/cms', {
        title: 'Pengaturan CMS Portal - Admin SIMPEG',
        page: 'admin-cms',
        cms,
        toast,
        user: (req as any).session?.user || { role: 'SUPER_ADMIN', namaLengkap: 'Administrator Utama' }
      });
    } catch (error) {
      console.error('Error in cmsController.show:', error);
      res.status(500).send('Terjadi kesalahan sistem.');
    }
  },

  update: async (req: Request, res: Response) => {
    try {
      const { heroBadge, heroTitle, heroSubtitle, pengumumanText, selectedMonth, selectedMonthEkinerja, selectedYear } = req.body;

      await prisma.cmsConfig.upsert({
        where: { id: 'cms-main' },
        update: {
          heroBadge: heroBadge || undefined,
          heroTitle: heroTitle || undefined,
          heroSubtitle: heroSubtitle || undefined,
          pengumumanText: pengumumanText || undefined,
          selectedMonth: parseInt(selectedMonth) || 7,
          selectedMonthEkinerja: parseInt(selectedMonthEkinerja) || 7,
          selectedYear: parseInt(selectedYear) || 2026
        },
        create: {
          id: 'cms-main',
          heroBadge: heroBadge || 'Portal Resmi Korwil',
          heroTitle: heroTitle || 'Sistem Informasi Manajemen Pegawai',
          heroSubtitle: heroSubtitle || 'Wilayah Pendidikan Kecamatan Cibitung',
          pengumumanText: pengumumanText || '',
          selectedMonth: parseInt(selectedMonth) || 7,
          selectedMonthEkinerja: parseInt(selectedMonthEkinerja) || 7,
          selectedYear: parseInt(selectedYear) || 2026
        }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: 'Pengaturan tampilan CMS Dashboard berhasil diperbarui.'
        };
      }

      res.redirect('/admin/cms');
    } catch (error) {
      console.error('Error in cmsController.update:', error);
      res.redirect('/admin/cms');
    }
  }
};
