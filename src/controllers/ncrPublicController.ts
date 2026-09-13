import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { ncrPdfService } from '../services/ncrPdfService';

const MONTH_NAMES = [
  '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

function cleanDigits(val: string): string {
  return (val || '').replace(/\D/g, '');
}

export const ncrPublicController = {
  /**
   * Render public NCR Gaji portal
   */
  show: async (req: Request, res: Response) => {
    try {
      const [periods, cms] = await Promise.all([
        prisma.ncrPeriod.findMany({
          orderBy: [{ tahun: 'desc' }, { bulan: 'desc' }],
          select: {
            id: true,
            bulan: true,
            tahun: true,
            judul: true,
            totalEmployeesMatched: true,
            createdAt: true
          }
        }),
        prisma.cmsConfig.findUnique({ where: { id: 'cms-main' } })
      ]);

      const formattedPeriods = periods.map(p => ({
        id: p.id,
        bulan: p.bulan,
        tahun: p.tahun,
        namaBulan: MONTH_NAMES[p.bulan] || `Bulan ${p.bulan}`,
        judul: p.judul,
        totalEmployees: p.totalEmployeesMatched
      }));

      // Default to latest uploaded period if available
      const activePeriod = formattedPeriods[0] || null;

      res.render('ncr-gaji', {
        title: 'Unduh NCR Gaji Pegawai - SIMPEG Korwil Cibitung',
        page: 'ncr-gaji',
        periods: formattedPeriods,
        activePeriod,
        cms,
        currentYear: cms?.selectedYear || new Date().getFullYear(),
        currentMonth: cms?.selectedMonth || new Date().getMonth() + 1
      });
    } catch (error) {
      console.error('[ncrPublicController.show] Error:', error);
      res.status(500).send('Terjadi kesalahan saat memuat halaman NCR Gaji.');
    }
  },

  /**
   * Search active employees for autocomplete
   */
  searchEmployees: async (req: Request, res: Response) => {
    const q = (req.query.q as string || '').trim();
    if (q.length < 2) {
      return res.json({ success: true, employees: [] });
    }

    try {
      const employees = await prisma.employee.findMany({
        where: {
          OR: [
            { nama: { contains: q, mode: 'insensitive' } },
            { nip: { contains: q } }
          ]
        },
        take: 15,
        select: {
          id: true,
          nip: true,
          nama: true,
          unit: { select: { namaUnit: true } }
        },
        orderBy: { nama: 'asc' }
      });

      res.json({
        success: true,
        employees: employees.map(e => ({
          id: e.id,
          nip: e.nip,
          nama: e.nama,
          unitNama: e.unit?.namaUnit || 'Korwil Cibitung'
        }))
      });
    } catch (error) {
      console.error('[ncrPublicController.searchEmployees] Error:', error);
      res.status(500).json({ success: false, message: 'Gagal mencari data pegawai.' });
    }
  },

  /**
   * Check if employee's NCR slip is available in the selected period
   */
  checkEligibility: async (req: Request, res: Response) => {
    const { nip, periodId, bulan, tahun } = req.body;

    if (!nip) {
      return res.status(400).json({
        success: false,
        message: 'NIP pegawai wajib diisi.'
      });
    }

    const cleanNip = cleanDigits(nip);

    try {
      // Find period by ID or by bulan & tahun
      let targetPeriodId = periodId;
      if (!targetPeriodId && bulan && tahun) {
        const foundPeriod = await prisma.ncrPeriod.findUnique({
          where: { bulan_tahun: { bulan: parseInt(bulan, 10), tahun: parseInt(tahun, 10) } }
        });
        if (foundPeriod) {
          targetPeriodId = foundPeriod.id;
        } else {
          const bName = MONTH_NAMES[parseInt(bulan, 10)] || `Bulan ${bulan}`;
          return res.json({
            success: true,
            available: false,
            message: `Berkas NCR Gaji untuk periode ${bName} ${tahun} belum diunggah oleh Admin Korwil Cibitung.`
          });
        }
      }

      if (!targetPeriodId) {
        return res.status(400).json({
          success: false,
          message: 'Periode gaji (bulan dan tahun) wajib dipilih.'
        });
      }

      // Find employee page in this period
      const pageRecord = await prisma.ncrEmployeePage.findFirst({
        where: {
          ncrPeriodId: targetPeriodId,
          OR: [
            { nip: cleanNip },
            { nip: nip.trim() }
          ]
        },
        include: {
          ncrPeriod: true,
          employee: {
            select: { id: true, nama: true, nip: true, npwp: true, unit: { select: { namaUnit: true } } }
          }
        }
      });

      if (!pageRecord) {
        return res.json({
          success: true,
          available: false,
          message: `Data NCR Gaji untuk NIP ${nip} tidak ditemukan pada periode ini. Pastikan NIP yang dimasukkan benar dan Anda terdaftar di unit kerja wilayah Korwil Cibitung.`
        });
      }

      const hasRecordedNpwp = !!(pageRecord.npwpLast4 || pageRecord.npwp || pageRecord.employee?.npwp);

      res.json({
        success: true,
        available: true,
        slip: {
          id: pageRecord.id,
          periodId: pageRecord.ncrPeriodId,
          periodeJudul: pageRecord.ncrPeriod.judul,
          nama: pageRecord.nama,
          nip: pageRecord.nip,
          unitNama: pageRecord.unitNama || pageRecord.employee?.unit?.namaUnit || 'Korwil Cibitung',
          hasRecordedNpwp
        }
      });
    } catch (error) {
      console.error('[ncrPublicController.checkEligibility] Error:', error);
      res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem saat mengecek data NCR.' });
    }
  },

  /**
   * Verifies the first 4 digits of NPWP and streams the single-page slip PDF
   */
  downloadSlip: async (req: Request, res: Response) => {
    const { nip, periodId, bulan, tahun, npwpFirst4, npwpLast4 } = req.body;

    if (!nip) {
      return res.status(400).json({
        success: false,
        message: 'NIP pegawai wajib diisi.'
      });
    }

    const cleanNip = cleanDigits(nip);
    const inputFirst4 = cleanDigits(npwpFirst4 || npwpLast4 || '');

    if (!inputFirst4 || inputFirst4.length !== 4) {
      return res.status(400).json({
        success: false,
        message: 'Silakan masukkan tepat 4 digit awal NPWP Anda untuk verifikasi keamanan.'
      });
    }

    try {
      // Find period by ID or by bulan & tahun
      let targetPeriodId = periodId;
      if (!targetPeriodId && bulan && tahun) {
        const foundPeriod = await prisma.ncrPeriod.findUnique({
          where: { bulan_tahun: { bulan: parseInt(bulan, 10), tahun: parseInt(tahun, 10) } }
        });
        if (foundPeriod) {
          targetPeriodId = foundPeriod.id;
        } else {
          const bName = MONTH_NAMES[parseInt(bulan, 10)] || `Bulan ${bulan}`;
          return res.status(404).json({
            success: false,
            message: `Berkas NCR Gaji periode ${bName} ${tahun} belum diunggah oleh Admin Korwil Cibitung.`
          });
        }
      }

      if (!targetPeriodId) {
        return res.status(400).json({
          success: false,
          message: 'Periode gaji wajib dipilih.'
        });
      }

      const pageRecord = await prisma.ncrEmployeePage.findFirst({
        where: {
          ncrPeriodId: targetPeriodId,
          OR: [
            { nip: cleanNip },
            { nip: nip.trim() }
          ]
        },
        include: {
          ncrPeriod: true,
          employee: {
            select: { id: true, nama: true, nip: true, npwp: true }
          }
        }
      });

      if (!pageRecord) {
        return res.status(404).json({
          success: false,
          message: `Data slip gaji untuk NIP ${nip} tidak ditemukan pada periode tersebut.`
        });
      }

      // Determine expected first 4 digits of NPWP
      let expectedFirst4: string | null = null;
      if (pageRecord.npwp) {
        expectedFirst4 = cleanDigits(pageRecord.npwp).slice(0, 4);
      }
      if (!expectedFirst4 && pageRecord.employee?.npwp) {
        expectedFirst4 = cleanDigits(pageRecord.employee.npwp).slice(0, 4);
      }
      if (!expectedFirst4 && pageRecord.npwpLast4) {
        expectedFirst4 = pageRecord.npwpLast4;
      }

      // Security check: NPWP first 4 validation
      if (!expectedFirst4 || expectedFirst4 !== inputFirst4) {
        return res.status(403).json({
          success: false,
          message: '4 digit awal NPWP yang Anda masukkan tidak sesuai dengan data slip gaji.'
        });
      }

      // Extract the single-page slip PDF
      const slipBytes = await ncrPdfService.extractEmployeeSlipPdf(
        pageRecord.ncrPeriod.fileUrl,
        pageRecord.pageNumber
      );

      const bulanNama = MONTH_NAMES[pageRecord.ncrPeriod.bulan] || `Bulan_${pageRecord.ncrPeriod.bulan}`;
      const safeNip = cleanNip || pageRecord.nip;
      const downloadFileName = `NCR_Gaji_${bulanNama}_${pageRecord.ncrPeriod.tahun}_${safeNip}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${downloadFileName}"`);
      res.setHeader('Content-Length', slipBytes.length);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

      return res.send(Buffer.from(slipBytes));
    } catch (error: any) {
      console.error('[ncrPublicController.downloadSlip] Error:', error);
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: error.message || 'Gagal memproses pengunduhan berkas slip gaji.'
        });
      }
    }
  }
};
