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
      const { 
        heroBadge, 
        heroTitle, 
        heroSubtitle, 
        pengumumanText, 
        selectedMonth, 
        selectedMonthEkinerja, 
        selectedYear,
        ekinerjaFilterStatus,
        ekinerjaFilterKepegawaian
      } = req.body;

      let kepegawaianStr = 'PNS,PPPK,PPPK_PW';
      if (Array.isArray(ekinerjaFilterKepegawaian)) {
        kepegawaianStr = ekinerjaFilterKepegawaian.join(',');
      } else if (typeof ekinerjaFilterKepegawaian === 'string' && ekinerjaFilterKepegawaian.trim()) {
        kepegawaianStr = ekinerjaFilterKepegawaian.trim();
      }

      const validStatuses = ['ALL', 'BELUM_KIRIM', 'APPROVED', 'PENDING'];
      const statusToSave = validStatuses.includes(ekinerjaFilterStatus) ? ekinerjaFilterStatus : 'ALL';

      await prisma.cmsConfig.upsert({
        where: { id: 'cms-main' },
        update: {
          heroBadge: heroBadge || undefined,
          heroTitle: heroTitle || undefined,
          heroSubtitle: heroSubtitle || undefined,
          pengumumanText: pengumumanText || undefined,
          selectedMonth: parseInt(selectedMonth) || 7,
          selectedMonthEkinerja: parseInt(selectedMonthEkinerja) || 7,
          selectedYear: parseInt(selectedYear) || 2026,
          ekinerjaFilterStatus: statusToSave,
          ekinerjaFilterKepegawaian: kepegawaianStr
        },
        create: {
          id: 'cms-main',
          heroBadge: heroBadge || 'Portal Resmi Korwil',
          heroTitle: heroTitle || 'Sistem Informasi Manajemen Pegawai',
          heroSubtitle: heroSubtitle || 'Wilayah Pendidikan Kecamatan Cibitung',
          pengumumanText: pengumumanText || '',
          selectedMonth: parseInt(selectedMonth) || 7,
          selectedMonthEkinerja: parseInt(selectedMonthEkinerja) || 7,
          selectedYear: parseInt(selectedYear) || 2026,
          ekinerjaFilterStatus: statusToSave,
          ekinerjaFilterKepegawaian: kepegawaianStr
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
  },

  updateMaintenance: async (req: Request, res: Response) => {
    try {
      const {
        maintenanceDashboard,
        maintenanceAbsensi,
        maintenanceEkinerja,
        maintenanceKlarifikasi,
        maintenanceTitle,
        maintenanceMessage
      } = req.body;

      const isDashboard = maintenanceDashboard === 'true' || maintenanceDashboard === 'on' || maintenanceDashboard === '1' || maintenanceDashboard === true;
      const isAbsensi = maintenanceAbsensi === 'true' || maintenanceAbsensi === 'on' || maintenanceAbsensi === '1' || maintenanceAbsensi === true;
      const isEkinerja = maintenanceEkinerja === 'true' || maintenanceEkinerja === 'on' || maintenanceEkinerja === '1' || maintenanceEkinerja === true;
      const isKlarifikasi = maintenanceKlarifikasi === 'true' || maintenanceKlarifikasi === 'on' || maintenanceKlarifikasi === '1' || maintenanceKlarifikasi === true;

      await prisma.cmsConfig.upsert({
        where: { id: 'cms-main' },
        update: {
          maintenanceDashboard: isDashboard,
          maintenanceAbsensi: isAbsensi,
          maintenanceEkinerja: isEkinerja,
          maintenanceKlarifikasi: isKlarifikasi,
          maintenanceTitle: maintenanceTitle || 'Sedang Dalam Pemeliharaan',
          maintenanceMessage: maintenanceMessage || undefined
        },
        create: {
          id: 'cms-main',
          maintenanceDashboard: isDashboard,
          maintenanceAbsensi: isAbsensi,
          maintenanceEkinerja: isEkinerja,
          maintenanceKlarifikasi: isKlarifikasi,
          maintenanceTitle: maintenanceTitle || 'Sedang Dalam Pemeliharaan',
          maintenanceMessage: maintenanceMessage || 'Halaman ini sedang dalam proses pemeliharaan dan pembaruan data berkala oleh tim admin Korwil Cibitung. Mohon kembali beberapa saat lagi.'
        }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: 'Status Buka/Tutup halaman publik (Maintenance Mode) berhasil diperbarui.'
        };
      }

      res.redirect('/admin/cms');
    } catch (error) {
      console.error('Error in cmsController.updateMaintenance:', error);
      res.redirect('/admin/cms');
    }
  },

  updateKlarifikasiPolicy: async (req: Request, res: Response) => {
    try {
      const {
        klarifikasiNlEnabled,
        klarifikasiNlMode,
        klarifikasiNlDates,
        klarifikasiPcEnabled,
        klarifikasiPcMode,
        klarifikasiPcDates
      } = req.body;

      const isNlEnabled = klarifikasiNlEnabled === 'true' || klarifikasiNlEnabled === 'on' || klarifikasiNlEnabled === true;
      let finalNlDates = 'ALL';
      if (klarifikasiNlMode === 'CUSTOM') {
        if (Array.isArray(klarifikasiNlDates)) {
          finalNlDates = klarifikasiNlDates.join(',');
        } else if (typeof klarifikasiNlDates === 'string') {
          finalNlDates = klarifikasiNlDates.trim() || 'ALL';
        }
      }

      const isPcEnabled = klarifikasiPcEnabled === 'true' || klarifikasiPcEnabled === 'on' || klarifikasiPcEnabled === true;
      let finalPcDates = 'ALL';
      if (klarifikasiPcMode === 'CUSTOM') {
        if (Array.isArray(klarifikasiPcDates)) {
          finalPcDates = klarifikasiPcDates.join(',');
        } else if (typeof klarifikasiPcDates === 'string') {
          finalPcDates = klarifikasiPcDates.trim() || 'ALL';
        }
      }

      await prisma.cmsConfig.upsert({
        where: { id: 'cms-main' },
        update: {
          klarifikasiNlEnabled: isNlEnabled,
          klarifikasiNlDates: finalNlDates,
          klarifikasiPcEnabled: isPcEnabled,
          klarifikasiPcDates: finalPcDates
        },
        create: {
          id: 'cms-main',
          klarifikasiNlEnabled: isNlEnabled,
          klarifikasiNlDates: finalNlDates,
          klarifikasiPcEnabled: isPcEnabled,
          klarifikasiPcDates: finalPcDates
        }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: 'Kebijakan buka/tutup klarifikasi absensi (NL & PC) berhasil diperbarui.'
        };
      }

      res.redirect('/admin/cms');
    } catch (error) {
      console.error('Error in cmsController.updateKlarifikasiPolicy:', error);
      res.redirect('/admin/cms');
    }
  }
};
