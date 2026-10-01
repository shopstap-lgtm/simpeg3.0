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
    const uploadedFiles: Express.Multer.File[] = [];
    if (req.files) {
      if (Array.isArray(req.files)) {
        uploadedFiles.push(...req.files);
      } else {
        const filesObj = req.files as { [fieldname: string]: Express.Multer.File[] };
        if (filesObj.files) uploadedFiles.push(...filesObj.files);
        if (filesObj.file) uploadedFiles.push(...filesObj.file);
      }
    } else if (req.file) {
      uploadedFiles.push(req.file);
    }

    const { bulan, tahun } = req.body;

    if (uploadedFiles.length === 0) {
      (req as any).session.toast = {
        type: 'error',
        message: 'Silakan pilih setidaknya 1 berkas PDF Master NCR Gaji yang akan diunggah (maksimal 5 berkas).'
      };
      return res.redirect('/admin/ncr-gaji');
    }

    if (uploadedFiles.length > 5) {
      for (const f of uploadedFiles) {
        try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (e) {}
      }
      (req as any).session.toast = {
        type: 'error',
        message: 'Maksimal 5 berkas PDF yang dapat diunggah sekaligus.'
      };
      return res.redirect('/admin/ncr-gaji');
    }

    const bulanNum = parseInt(bulan, 10);
    const tahunNum = parseInt(tahun, 10);

    if (!bulanNum || bulanNum < 1 || bulanNum > 12 || !tahunNum || tahunNum < 2000) {
      // Clean up uploaded files
      for (const f of uploadedFiles) {
        try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (e) {}
      }
      (req as any).session.toast = {
        type: 'error',
        message: 'Bulan atau tahun periode NCR tidak valid.'
      };
      return res.redirect('/admin/ncr-gaji');
    }

    try {
      const adminName = (req as any).session?.user?.namaLengkap || 'Admin Korwil';

      const filePayload = uploadedFiles.map(f => ({
        filePath: f.path,
        fileName: f.originalname
      }));

      const result = await ncrPdfService.processMasterNcrPdf({
        files: filePayload,
        bulan: bulanNum,
        tahun: tahunNum,
        uploadedBy: adminName
      });

      // Safely delete raw uploaded master files since filtered version is saved
      for (const f of uploadedFiles) {
        try {
          if (fs.existsSync(f.path)) {
            fs.unlinkSync(f.path);
          }
        } catch (err) {
          console.warn('[ncrAdminController] Could not remove temp uploaded file:', err);
        }
      }

      const namaBulan = MONTH_NAMES[bulanNum] || `Bulan ${bulanNum}`;
      (req as any).session.toast = {
        type: 'success',
        message: `Berhasil memproses NCR Gaji ${namaBulan} ${tahunNum}! Menyimpan ${result.totalFilteredPages} halaman sekolah Cibitung dari total ${result.totalOriginalPages} halaman (${result.discardedPagesCount} halaman kecamatan lain dibuang). Terindeks ${result.totalEmployeesMatched} pegawai dari ${uploadedFiles.length} berkas PDF.`
      };

      res.redirect('/admin/ncr-gaji');
    } catch (error: any) {
      console.error('[ncrAdminController.uploadMaster] Error processing PDF:', error);

      // Clean up uploaded files
      for (const f of uploadedFiles) {
        try {
          if (fs.existsSync(f.path)) {
            fs.unlinkSync(f.path);
          }
        } catch (e) { /* ignore */ }
      }

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
  },

  updateNpwp: async (req: Request, res: Response) => {
    const { employeePageId, npwp } = req.body;

    if (!employeePageId) {
      return res.status(400).json({ success: false, message: 'ID halaman slip pegawai wajib disertakan.' });
    }

    try {
      const rawVal = (npwp || '').trim();
      let formattedNpwp: string | null = null;
      let npwpFirst4: string | null = null;

      if (rawVal) {
        const digits = rawVal.replace(/\D/g, '');
        if (digits.length !== 4 && digits.length !== 15 && digits.length !== 16) {
          return res.status(400).json({
            success: false,
            message: 'Nomor NPWP harus berupa 4 digit awal (PIN slip) atau 15/16 digit NPWP lengkap.'
          });
        }

        if (digits.length === 4) {
          npwpFirst4 = digits;
          formattedNpwp = `${digits}•••• (4 Digit Awal)`;
        } else if (digits.length === 15) {
          formattedNpwp = `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}.${digits.slice(8, 9)}-${digits.slice(9, 12)}.${digits.slice(12, 15)}`;
          npwpFirst4 = digits.slice(0, 4);
        } else {
          formattedNpwp = `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}.${digits.slice(8, 9)}-${digits.slice(9, 12)}.${digits.slice(12, 16)}`;
          npwpFirst4 = digits.slice(0, 4);
        }
      }

      // 1. Update NcrEmployeePage
      const pageRecord = await prisma.ncrEmployeePage.findUnique({
        where: { id: employeePageId }
      });

      if (!pageRecord) {
        return res.status(404).json({ success: false, message: 'Data slip pegawai tidak ditemukan.' });
      }

      const updatedPage = await prisma.ncrEmployeePage.update({
        where: { id: employeePageId },
        data: {
          npwp: formattedNpwp,
          npwpLast4: npwpFirst4
        }
      });

      // 2. Sync to Master Employee table (safe updateMany)
      if (updatedPage.employeeId && formattedNpwp) {
        await prisma.employee.updateMany({
          where: { id: updatedPage.employeeId },
          data: { npwp: formattedNpwp }
        });
      }
      if (updatedPage.nip && formattedNpwp) {
        await prisma.employee.updateMany({
          where: { nip: updatedPage.nip },
          data: { npwp: formattedNpwp }
        });
      }

      // 3. Sync to other periods with the same NIP for consistency
      if (updatedPage.nip) {
        await prisma.ncrEmployeePage.updateMany({
          where: { nip: updatedPage.nip },
          data: {
            npwp: formattedNpwp,
            npwpLast4: npwpFirst4
          }
        });
      }

      return res.json({
        success: true,
        message: formattedNpwp 
          ? `NPWP/PIN pegawai '${updatedPage.nama}' berhasil disimpan (${formattedNpwp}). Kode verifikasi slip: ${npwpFirst4}••••.`
          : `NPWP pegawai '${updatedPage.nama}' berhasil dikosongkan.`,
        npwp: formattedNpwp || '-',
        npwpFirst4: npwpFirst4 || '-',
        npwpLast4: npwpFirst4 || '-'
      });
    } catch (error: any) {
      console.error('[ncrAdminController.updateNpwp] Error:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Gagal memperbarui data NPWP pegawai.'
      });
    }
  }
};
