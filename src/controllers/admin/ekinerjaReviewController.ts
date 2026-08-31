import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

export const ekinerjaReviewController = {
  show: async (req: Request, res: Response) => {
    try {
      const activeTab = (req.query.tab as string) || 'pending';
      const filterUnit = (req.query.unit as string) || 'unit-all';

      const whereClause: any = {};
      if (filterUnit !== 'unit-all') {
        whereClause.employee = { unitId: filterUnit };
      }

      const [allUnits, allReports] = await Promise.all([
        prisma.unit.findMany({ orderBy: { namaUnit: 'asc' } }),
        prisma.ekinerjaReport.findMany({
          where: whereClause,
          include: {
            employee: { include: { unit: true } }
          },
          orderBy: { createdAt: 'desc' }
        })
      ]);

      const formatted = allReports.map(item => ({
        id: item.id,
        employeeId: item.employeeId,
        employee: {
          id: item.employee.id,
          nip: item.employee.nip,
          nama: item.employee.nama,
          statusKepegawaian: item.employee.statusKepegawaian,
          unitId: item.employee.unitId,
          unitNama: item.employee.unit.namaUnit
        },
        bulan: item.bulan,
        tahun: item.tahun,
        fileHarianUrl: item.fileHarianUrl,
        fileHarianName: item.fileHarianName,
        fileBulananUrl: item.fileBulananUrl,
        fileBulananName: item.fileBulananName,
        nilaiHarian: item.nilaiHarian !== null ? item.nilaiHarian : undefined,
        nilaiBulanan: item.nilaiBulanan !== null ? item.nilaiBulanan : undefined,
        statusReview: item.statusReview,
        catatanAdmin: item.catatanAdmin,
        reviewedBy: item.reviewedBy,
        reviewedAt: item.reviewedAt,
        submittedAt: item.createdAt.toISOString().replace('T', ' ').substring(0, 16)
      }));

      const pendingList = formatted.filter(item => item.statusReview === 'PENDING');
      const archiveList = formatted.filter(item => item.statusReview === 'APPROVED' || item.statusReview === 'REJECTED');

      const pendingCount = formatted.filter(c => c.statusReview === 'PENDING').length;
      const approvedCount = formatted.filter(c => c.statusReview === 'APPROVED').length;
      const rejectedCount = formatted.filter(c => c.statusReview === 'REJECTED').length;

      const units = [
        { id: 'unit-all', namaUnit: 'Semua Unit Kerja' },
        ...allUnits
      ];

      const toast = (req as any).session?.toast || null;
      if ((req as any).session) {
        delete (req as any).session.toast;
      }

      res.render('admin/ekinerja-review', {
        title: 'Review Laporan E-Kinerja Pegawai - Admin SIMPEG',
        page: 'admin-ekinerja',
        activeTab,
        pendingList,
        archiveList,
        units,
        filterUnit,
        pendingCount,
        approvedCount,
        rejectedCount,
        toast,
        user: (req as any).session?.user || { role: 'SUPER_ADMIN', namaLengkap: 'Administrator Utama' }
      });
    } catch (error) {
      console.error('Error in ekinerjaReviewController.show:', error);
      res.status(500).send('Terjadi kesalahan sistem.');
    }
  },

  review: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { nilaiHarian, nilaiBulanan, statusReview, catatanAdmin } = req.body;

      const isApproved = statusReview === 'APPROVED';
      const nHarian = isApproved && nilaiHarian !== undefined && nilaiHarian !== '' ? parseFloat(nilaiHarian) : null;
      const nBulanan = isApproved && nilaiBulanan !== undefined && nilaiBulanan !== '' ? parseFloat(nilaiBulanan) : null;

      const reviewer = (req as any).session?.user?.namaLengkap || 'Admin Korwil';
      const reviewTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);

      const updated = await prisma.ekinerjaReport.update({
        where: { id },
        data: {
          nilaiHarian: nHarian,
          nilaiBulanan: nBulanan,
          statusReview: isApproved ? 'APPROVED' : 'REJECTED',
          catatanAdmin: catatanAdmin || (isApproved ? 'Dokumen laporan disetujui.' : 'Berkas perlu diperbaiki.'),
          reviewedBy: reviewer,
          reviewedAt: reviewTimestamp
        },
        include: { employee: true }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: isApproved ? 'success' : 'warning',
          message: `Penilaian E-Kinerja untuk ${updated.employee.nama} telah disimpan (${isApproved ? 'Disetujui' : 'Ditolak'}).`
        };
      }

      res.redirect('/admin/ekinerja-review?tab=history');
    } catch (error) {
      console.error('Error in ekinerjaReviewController.review:', error);
      res.redirect('/admin/ekinerja-review?tab=pending');
    }
  },

  deleteReview: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const tab = req.query.tab as string || 'history';

      const deleted = await prisma.ekinerjaReport.delete({
        where: { id },
        include: { employee: true }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'warning',
          message: `Laporan E-Kinerja pegawai ${deleted.employee.nama} telah dihapus dari antrean/riwayat.`
        };
      }

      res.redirect(`/admin/ekinerja-review?tab=${tab}`);
    } catch (error) {
      console.error('Error in ekinerjaReviewController.deleteReview:', error);
      res.redirect('/admin/ekinerja-review');
    }
  }
};
