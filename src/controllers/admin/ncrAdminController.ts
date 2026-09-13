import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../../lib/prisma';
import { ncrPdfService } from '../../services/ncrPdfService';

const MONTH_NAMES = [
  '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

export const ncrAdminController = {
  show: async (req: Request, res: Response) => {
    try {
      const [periods, totalEmployees, cms] = await Promise.all([
        prisma.ncrPeriod.findMany({
          orderBy: [{ tahun: 'desc' }, { bulan: 'desc' }],
          include: {
            _count: {
              select: { employeePages: true }
            }
          }
        }),
        prisma.employee.count(),
        prisma.cmsConfig.findUnique({ where: { id: 'cms-main' } })
      ]);

      const toast = (req as any).session?.toast || null;
      if ((req as any).session) {
        delete (req as any).session.toast;
      }

      // Compute statistics
      const totalPeriods = periods.length;
      const totalFilteredPages = periods.reduce((acc, p) => acc + p.totalFilteredPages, 0);
      const totalOriginalPages = periods.reduce((acc, p) => acc + p.totalOriginalPages, 0);
      const totalPagesSaved = totalOriginalPages - totalFilteredPages;

      const formattedPeriods = periods.map(p => ({
        id: p.id,
        bulan: p.bulan,
        tahun: p.tahun,
        namaBulan: MONTH_NAMES[p.bulan] || `Bulan ${p.bulan}`,
        judul: p.judul,
        fileName: p.fileName,
        fileUrl: p.fileUrl,
        totalOriginalPages: p.totalOriginalPages,
        totalFilteredPages: p.totalFilteredPages,
        totalEmployeesMatched: p.totalEmployeesMatched,
        discardedPages: p.totalOriginalPages - p.totalFilteredPages,
        uploadedBy: p.uploadedBy || 'Admin Korwil',
        createdAt: p.createdAt.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      }));

      res.render('admin/ncr-gaji', {
        title: 'Kelola NCR Gaji Pegawai - SIMPEG Korwil Cibitung',
        page: 'admin-ncr',
        periods: formattedPeriods,
        totalPeriods,
        totalEmployees,
        totalFilteredPages,
        totalPagesSaved,
        currentYear: cms?.selectedYear || new Date().getFullYear(),
        currentMonth: cms?.selectedMonth || new Date().getMonth() + 1,
        toast,
        user: (req as any).session?.user || { role: 'ADMIN_KORWIL', namaLengkap: 'Admin Korwil' }
      });
    } catch (error) {
      console.error('[ncrAdminController.show] Error:', error);
      res.status(500).send('Terjadi kesalahan saat memuat halaman NCR Gaji.');
    }
  },

  uploadMaster: async (req: Request, res: Response) => {
    const file = req.file;
    const { bulan, tahun } = req.body;

    if (!file) {
      (req as any).session.toast = {
        type: 'error',
        message: 'Silakan pilih berkas PDF Master NCR Gaji yang akan diunggah.'
      };
      return res.redirect('/admin/ncr-gaji');
    }

    const bulanNum = parseInt(bulan, 10);
    const tahunNum = parseInt(tahun, 10);

    if (!bulanNum || bulanNum < 1 || bulanNum > 12 || !tahunNum || tahunNum < 2000) {
      // Clean up uploaded file
      try { fs.unlinkSync(file.path); } catch (e) { /* ignore */ }
      (req as any).session.toast = {
        type: 'error',
        message: 'Bulan atau tahun periode NCR tidak valid.'
      };
      return res.redirect('/admin/ncr-gaji');
    }

    try {
      const adminName = (req as any).session?.user?.namaLengkap || 'Admin Korwil';

      const result = await ncrPdfService.processMasterNcrPdf({
        filePath: file.path,
        fileName: file.originalname,
        bulan: bulanNum,
        tahun: tahunNum,
        uploadedBy: adminName
      });

      // Safely delete raw uploaded master file since filtered version is saved
      try {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (err) {
        console.warn('[ncrAdminController] Could not remove temp uploaded file:', err);
      }

      const namaBulan = MONTH_NAMES[bulanNum] || `Bulan ${bulanNum}`;
      (req as any).session.toast = {
        type: 'success',
        message: `Berhasil memproses NCR Gaji ${namaBulan} ${tahunNum}! Menyimpan ${result.totalFilteredPages} halaman sekolah Cibitung dari total ${result.totalOriginalPages} halaman se-Kabupaten (${result.discardedPagesCount} halaman kecamatan lain dibuang). Terindeks ${result.totalEmployeesMatched} pegawai.`
      };

      res.redirect('/admin/ncr-gaji');
    } catch (error: any) {
      console.error('[ncrAdminController.uploadMaster] Error processing PDF:', error);

      // Clean up uploaded file
      try {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (e) { /* ignore */ }

      (req as any).session.toast = {
        type: 'error',
        message: error.message || 'Gagal memproses berkas PDF master NCR Gaji.'
      };
      res.redirect('/admin/ncr-gaji');
    }
  },

  detail: async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
      const period = await prisma.ncrPeriod.findUnique({
        where: { id },
        include: {
          employeePages: {
            orderBy: [{ pageNumber: 'asc' }, { nama: 'asc' }],
            include: {
              employee: {
                select: {
                  id: true,
                  nip: true,
                  nama: true,
                  npwp: true,
                  unit: { select: { namaUnit: true } }
                }
              }
            }
          }
        }
      });

      if (!period) {
        return res.status(404).json({ success: false, message: 'Periode NCR tidak ditemukan.' });
      }

      res.json({
        success: true,
        period: {
          id: period.id,
          bulan: period.bulan,
          tahun: period.tahun,
          namaBulan: MONTH_NAMES[period.bulan] || `Bulan ${period.bulan}`,
          judul: period.judul,
          fileName: period.fileName,
          fileUrl: period.fileUrl,
          totalOriginalPages: period.totalOriginalPages,
          totalFilteredPages: period.totalFilteredPages,
          totalEmployeesMatched: period.totalEmployeesMatched,
          uploadedBy: period.uploadedBy,
          createdAt: period.createdAt
        },
        pages: period.employeePages.map(p => {
          const rawNpwp = p.npwp || p.employee?.npwp;
          const first4 = rawNpwp ? rawNpwp.replace(/\D/g, '').slice(0, 4) : (p.npwpLast4 || '-');
          return {
            id: p.id,
            nip: p.nip,
            nama: p.nama,
            unitNama: p.unitNama || p.employee?.unit?.namaUnit || '-',
            pageNumber: p.pageNumber,
            npwp: rawNpwp || '-',
            npwpFirst4: first4,
            npwpLast4: first4
          };
        })
      });
    } catch (error) {
      console.error('[ncrAdminController.detail] Error:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil rincian data periode NCR.' });
    }
  },

  deletePeriod: async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
      const period = await prisma.ncrPeriod.findUnique({ where: { id } });
      if (!period) {
        (req as any).session.toast = {
          type: 'error',
          message: 'Periode NCR tidak ditemukan.'
        };
        return res.redirect('/admin/ncr-gaji');
      }

      // Remove physical file
      try {
        let fullPath = period.fileUrl;
        if (fullPath.startsWith('/uploads/')) {
          fullPath = path.join(process.cwd(), 'public', fullPath);
        }
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      } catch (err) {
        console.warn('[ncrAdminController.deletePeriod] Could not delete physical file:', err);
      }

      // Delete from database
      await prisma.ncrPeriod.delete({ where: { id } });

      (req as any).session.toast = {
        type: 'success',
        message: `Periode NCR Gaji ${MONTH_NAMES[period.bulan]} ${period.tahun} berhasil dihapus.`
      };
      res.redirect('/admin/ncr-gaji');
    } catch (error) {
      console.error('[ncrAdminController.deletePeriod] Error:', error);
      (req as any).session.toast = {
        type: 'error',
        message: 'Gagal menghapus periode NCR Gaji.'
      };
      res.redirect('/admin/ncr-gaji');
    }
  }
};
