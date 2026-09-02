import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import * as XLSX from 'xlsx';

const BULAN_NAMES = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

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
      const tab = (req.query.tab as string) || 'pending';
      const { nilaiHarian, nilaiBulanan, statusReview, catatanAdmin } = req.body;

      console.log('[EkinerjaReview] Received review submission:', { id, tab, statusReview, nilaiHarian, nilaiBulanan, catatanAdmin });

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
          catatanAdmin: catatanAdmin || (isApproved ? 'Dokumen laporan kinerja telah disetujui.' : 'Berkas laporan belum lengkap / perlu diperbaiki.'),
          reviewedBy: reviewer,
          reviewedAt: reviewTimestamp
        },
        include: { employee: true }
      });

      console.log('[EkinerjaReview] Update success for:', updated.employee.nama, 'Status:', updated.statusReview);

      if ((req as any).session) {
        (req as any).session.toast = {
          type: isApproved ? 'success' : 'warning',
          message: `Laporan kinerja ${updated.employee.nama} berhasil ${isApproved ? 'disetujui dan dinilai' : 'ditolak'}.`
        };
        return (req as any).session.save((saveErr: any) => {
          if (saveErr) console.error('[EkinerjaReview] Session save error:', saveErr);
          return res.redirect(`/admin/ekinerja-review?tab=${isApproved ? 'history' : 'history'}`);
        });
      }

      res.redirect('/admin/ekinerja-review?tab=history');
    } catch (error) {
      console.error('Error in ekinerjaReviewController.review:', error);
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'danger',
          message: 'Terjadi kesalahan saat memproses review laporan.'
        };
        return (req as any).session.save(() => res.redirect('/admin/ekinerja-review?tab=pending'));
      }
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
          message: `Laporan E-Kinerja pegawai ${deleted.employee.nama} telah dihapus.`
        };
        return (req as any).session.save(() => res.redirect(`/admin/ekinerja-review?tab=${tab}`));
      }

      res.redirect(`/admin/ekinerja-review?tab=${tab}`);
    } catch (error) {
      console.error('Error in ekinerjaReviewController.deleteReview:', error);
      res.redirect('/admin/ekinerja-review');
    }
  },

  exportExcel: async (req: Request, res: Response) => {
    try {
      const bulan = parseInt(req.query.bulan as string) || new Date().getMonth() + 1;
      const tahun = parseInt(req.query.tahun as string) || new Date().getFullYear();
      const filterUnit = (req.query.unit as string) || 'unit-all';

      // Only allow SUPER_ADMIN and ADMIN_KORWIL
      const userRole = (req as any).session?.user?.role;
      if (userRole === 'ADMIN_DINAS') {
        return res.status(403).send('Akses ditolak.');
      }

      const whereClause: any = {};
      if (filterUnit !== 'unit-all') {
        whereClause.employee = { unitId: filterUnit };
      }

      // Fetch all employees + their reports for the month
      const [allEmployees, reports] = await Promise.all([
        prisma.employee.findMany({
          where: { aktif: true, ...(filterUnit !== 'unit-all' ? { unitId: filterUnit } : {}) },
          include: { unit: true },
          orderBy: [{ unit: { namaUnit: 'asc' } }, { nama: 'asc' }]
        }),
        prisma.ekinerjaReport.findMany({
          where: { bulan, tahun, ...(filterUnit !== 'unit-all' ? { employee: { unitId: filterUnit } } : {}) },
          include: { employee: { include: { unit: true } } }
        })
      ]);

      const reportsMap = new Map<string, any>();
      reports.forEach(r => reportsMap.set(r.employeeId, r));

      const rows = allEmployees.map((emp, idx) => {
        const report = reportsMap.get(emp.id);
        const status = !report ? 'Belum Upload' :
          report.statusReview === 'APPROVED' ? 'Disetujui' :
          report.statusReview === 'REJECTED' ? 'Ditolak' : 'Menunggu Review';
        return {
          'No': idx + 1,
          'NIP': emp.nip,
          'Nama Pegawai': emp.nama,
          'Jabatan': emp.jabatan || 'Guru',
          'Unit Kerja / Sekolah': emp.unit.namaUnit,
          'Status Kepegawaian': emp.statusKepegawaian,
          'Laporan Harian': report?.fileHarianName || '-',
          'Laporan Bulanan': report?.fileBulananName || '-',
          'Nilai Harian': report?.nilaiHarian !== null && report?.nilaiHarian !== undefined ? report.nilaiHarian : '-',
          'Nilai Bulanan': report?.nilaiBulanan !== null && report?.nilaiBulanan !== undefined ? report.nilaiBulanan : '-',
          'Status Review': status,
          'Catatan Admin': report?.catatanAdmin || '-',
          'Diverifikasi Oleh': report?.reviewedBy || '-',
          'Tanggal Review': report?.reviewedAt || '-'
        };
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);

      // Set column widths
      ws['!cols'] = [
        { wch: 5 }, { wch: 22 }, { wch: 35 }, { wch: 20 }, { wch: 35 },
        { wch: 18 }, { wch: 30 }, { wch: 30 }, { wch: 14 }, { wch: 14 },
        { wch: 18 }, { wch: 35 }, { wch: 25 }, { wch: 20 }
      ];

      XLSX.utils.book_append_sheet(wb, ws, `E-Kinerja ${BULAN_NAMES[bulan]} ${tahun}`);

      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
      const filename = `Laporan_EKinerja_${BULAN_NAMES[bulan]}_${tahun}.xlsx`;

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);
    } catch (error) {
      console.error('Error in exportExcel:', error);
      res.status(500).send('Gagal mengekspor data.');
    }
  },

  exportPdf: async (req: Request, res: Response) => {
    try {
      const bulan = parseInt(req.query.bulan as string) || new Date().getMonth() + 1;
      const tahun = parseInt(req.query.tahun as string) || new Date().getFullYear();
      const filterUnit = (req.query.unit as string) || 'unit-all';

      // Only allow SUPER_ADMIN and ADMIN_KORWIL
      const userRole = (req as any).session?.user?.role;
      if (userRole === 'ADMIN_DINAS') {
        return res.status(403).send('Akses ditolak.');
      }

      const [allEmployees, reports, units] = await Promise.all([
        prisma.employee.findMany({
          where: { aktif: true, ...(filterUnit !== 'unit-all' ? { unitId: filterUnit } : {}) },
          include: { unit: true },
          orderBy: [{ unit: { namaUnit: 'asc' } }, { nama: 'asc' }]
        }),
        prisma.ekinerjaReport.findMany({
          where: { bulan, tahun, ...(filterUnit !== 'unit-all' ? { employee: { unitId: filterUnit } } : {}) },
          include: { employee: true }
        }),
        prisma.unit.findMany({ orderBy: { namaUnit: 'asc' } })
      ]);

      const reportsMap = new Map<string, any>();
      reports.forEach(r => reportsMap.set(r.employeeId, r));

      const unitLabel = filterUnit === 'unit-all' ? 'Semua Unit Kerja' :
        units.find(u => u.id === filterUnit)?.namaUnit || '-';

      const rows = allEmployees.map((emp, idx) => {
        const report = reportsMap.get(emp.id);
        const status = !report ? 'Belum Upload' :
          report.statusReview === 'APPROVED' ? 'Disetujui' :
          report.statusReview === 'REJECTED' ? 'Ditolak' : 'Menunggu';
        const statusColor = !report ? '#94a3b8' :
          report.statusReview === 'APPROVED' ? '#16a34a' :
          report.statusReview === 'REJECTED' ? '#dc2626' : '#d97706';
        return { idx: idx + 1, emp, report, status, statusColor };
      });

      const printedAt = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' });

      const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>Laporan E-Kinerja ${BULAN_NAMES[bulan]} ${tahun}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #1e293b; background: #fff; }
  @page { size: A4 landscape; margin: 10mm 12mm; }
  .header { text-align: center; margin-bottom: 10px; border-bottom: 2px solid #1e3a5f; padding-bottom: 8px; }
  .header h1 { font-size: 14px; font-weight: bold; color: #1e3a5f; }
  .header p { font-size: 10px; color: #475569; margin-top: 2px; }
  .meta { display: flex; justify-content: space-between; font-size: 9px; color: #64748b; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1e3a5f; color: white; padding: 5px 6px; text-align: left; font-size: 9px; }
  td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; font-size: 9px; }
  tr:nth-child(even) td { background: #f8fafc; }
  .status { font-weight: bold; font-size: 8px; padding: 2px 5px; border-radius: 4px; display: inline-block; }
  .footer { margin-top: 14px; font-size: 8px; color: #94a3b8; text-align: center; }
  .summary { display: flex; gap: 12px; margin-bottom: 8px; font-size: 9px; }
  .summary-box { padding: 4px 8px; border-radius: 4px; border: 1px solid #e2e8f0; }
  @media print {
    .no-print { display: none !important; }
    body { background: white; }
  }
</style>
</head>
<body>
<div class="no-print" style="position:fixed;top:12px;right:14px;z-index:999;">
  <button onclick="window.print()" style="background:#1e3a5f;color:white;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:11px;font-weight:bold;">🖨 Cetak / Save PDF</button>
  <button onclick="window.close()" style="background:#64748b;color:white;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:11px;margin-left:6px;">✕ Tutup</button>
</div>
<div class="header">
  <h1>LAPORAN E-KINERJA PEGAWAI</h1>
  <p>Korwil Pendidikan Kecamatan Cibitung &nbsp;|&nbsp; Periode: ${BULAN_NAMES[bulan]} ${tahun} &nbsp;|&nbsp; Unit: ${unitLabel}</p>
</div>
<div class="meta">
  <span>Total Pegawai: <b>${rows.length}</b></span>
  <span>Dicetak: ${printedAt}</span>
</div>
<table>
  <thead>
    <tr>
      <th style="width:28px;">No</th>
      <th style="width:110px;">NIP</th>
      <th style="width:170px;">Nama Pegawai</th>
      <th style="width:160px;">Unit Kerja / Sekolah</th>
      <th style="width:100px;">Status Kepegawaian</th>
      <th style="width:50px;">Nilai Harian</th>
      <th style="width:50px;">Nilai Bulanan</th>
      <th style="width:70px;">Status Review</th>
      <th>Catatan Admin</th>
    </tr>
  </thead>
  <tbody>
    ${rows.map(r => `
    <tr>
      <td style="text-align:center;">${r.idx}</td>
      <td style="font-family:monospace;">${r.emp.nip}</td>
      <td><b>${r.emp.nama}</b></td>
      <td>${r.emp.unit.namaUnit}</td>
      <td>${r.emp.statusKepegawaian}</td>
      <td style="text-align:center;">${r.report?.nilaiHarian !== null && r.report?.nilaiHarian !== undefined ? r.report.nilaiHarian : '-'}</td>
      <td style="text-align:center;">${r.report?.nilaiBulanan !== null && r.report?.nilaiBulanan !== undefined ? r.report.nilaiBulanan : '-'}</td>
      <td><span class="status" style="color:${r.statusColor};border:1px solid ${r.statusColor};">${r.status}</span></td>
      <td>${r.report?.catatanAdmin || '-'}</td>
    </tr>`).join('')}
  </tbody>
</table>
<div class="footer">
  Dokumen ini digenerate otomatis oleh Sistem SIMPEG Korwil Cibitung &mdash; ${printedAt}
</div>
<script>
  // Auto-show print dialog on load if query includes autoprint
  window.onload = function() {
    if (new URLSearchParams(window.location.search).get('autoprint') === '1') {
      setTimeout(() => window.print(), 500);
    }
  };
</script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error) {
      console.error('Error in exportPdf:', error);
      res.status(500).send('Gagal memuat halaman cetak.');
    }
  }
};

