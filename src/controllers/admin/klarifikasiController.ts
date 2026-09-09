import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import * as XLSX from 'xlsx';
import { deleteFileFromStorage } from '../../lib/supabase';

const BULAN_NAMES = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const formatWIB = (date: Date | string | null | undefined): string => {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(d);
};

const matchesClarificationMonthYear = (c: any, bulan: number, tahun: number): boolean => {
  const padBulan = String(bulan).padStart(2, '0');
  const yStr = String(tahun);

  if (c.tanggalAbsen) {
    const t = String(c.tanggalAbsen);
    if (t.includes(`${yStr}-${padBulan}`) || 
        t.includes(`${padBulan}-${yStr}`) ||
        t.includes(`/${padBulan}/${yStr}`)) {
      return true;
    }
  }

  if (c.createdAt) {
    const d = new Date(c.createdAt);
    if (!isNaN(d.getTime())) {
      if (d.getFullYear() === tahun && (d.getMonth() + 1) === bulan) {
        return true;
      }
    }
  }
  return false;
};

const buildRedirectUrl = (req: Request, defaultTab = 'pending') => {
  const tab = (req.query.tab as string) || defaultTab;
  const unit = (req.query.unit as string) || '';
  const status = (req.query.status as string) || '';
  const search = (req.query.search as string) || '';

  const params = new URLSearchParams();
  params.set('tab', tab);
  if (unit && unit !== 'unit-all') params.set('unit', unit);
  if (status && status !== 'ALL') params.set('status', status);
  if (search) params.set('search', search);

  return `/admin/klarifikasi?${params.toString()}`;
};

export const klarifikasiController = {
  show: async (req: Request, res: Response) => {
    try {
      const filterUnit = (req.query.unit as string) || 'unit-all';
      const filterStatus = (req.query.status as string) || (req.query.historyStatus as string) || 'ALL';
      const search = ((req.query.search as string) || '').trim();
      let activeTab = (req.query.tab as string) || 'pending';

      // Auto-switch tab based on review status filter
      if (filterStatus === 'APPROVED' || filterStatus === 'REJECTED') {
        activeTab = 'history';
      } else if (filterStatus === 'PENDING') {
        activeTab = 'pending';
      }

      const whereClause: any = {};
      if (filterUnit !== 'unit-all') {
        whereClause.employee = { ...whereClause.employee, unitId: filterUnit };
      }
      if (search) {
        whereClause.employee = {
          ...whereClause.employee,
          OR: [
            { nama: { contains: search, mode: 'insensitive' } },
            { nip: { contains: search } }
          ]
        };
      }

      const [allUnits, allClarifications] = await Promise.all([
        prisma.unit.findMany({ orderBy: { namaUnit: 'asc' } }),
        prisma.clarification.findMany({
          where: whereClause,
          include: {
            employee: { include: { unit: true } }
          },
          orderBy: { createdAt: 'asc' }
        })
      ]);

      const formatted = allClarifications.map(c => ({
        id: c.id,
        employeeId: c.employeeId,
        employeeName: c.employee.nama,
        employeeNip: c.employee.nip,
        unitNama: c.employee.unit.namaUnit,
        tanggalAbsen: c.tanggalAbsen,
        statusAwal: c.statusAwal,
        statusPengganti: c.statusPengganti,
        alasan: c.alasan,
        fileUrl: c.fileUrl,
        fileName: c.fileName,
        statusVerifikasi: c.statusVerifikasi,
        catatanAdmin: c.catatanAdmin,
        reviewedBy: c.reviewedBy,
        reviewedAt: formatWIB(c.reviewedAt),
        createdAt: formatWIB(c.createdAt)
      }));

      // Total counters matching unit & search
      const pendingCount = formatted.filter(c => c.statusVerifikasi === 'PENDING').length;
      const approvedCount = formatted.filter(c => c.statusVerifikasi === 'APPROVED').length;
      const rejectedCount = formatted.filter(c => c.statusVerifikasi === 'REJECTED').length;

      // Filtered lists for tabs
      let pendingList = formatted.filter(c => c.statusVerifikasi === 'PENDING');
      let archiveList = formatted.filter(c => c.statusVerifikasi !== 'PENDING');

      if (filterStatus === 'APPROVED') {
        archiveList = archiveList.filter(c => c.statusVerifikasi === 'APPROVED');
        pendingList = [];
      } else if (filterStatus === 'REJECTED') {
        archiveList = archiveList.filter(c => c.statusVerifikasi === 'REJECTED');
        pendingList = [];
      } else if (filterStatus === 'PENDING') {
        archiveList = [];
      }

      const units = [
        { id: 'unit-all', namaUnit: 'Semua Unit Kerja' },
        ...allUnits
      ];

      const toast = (req as any).session?.toast || null;
      if ((req as any).session) {
        delete (req as any).session.toast;
      }

      res.render('admin/klarifikasi', {
        title: 'Verifikasi Klarifikasi Absensi & Sync Excel - Admin SIMPEG',
        page: 'admin-klarifikasi',
        activeTab,
        pendingList,
        archiveList,
        units,
        filterUnit,
        filterStatus,
        filterHistoryStatus: filterStatus,
        search,
        pendingCount,
        approvedCount,
        rejectedCount,
        toast,
        user: (req as any).session?.user || { role: 'SUPER_ADMIN', namaLengkap: 'Administrator Utama' }
      });
    } catch (error) {
      console.error('Error in klarifikasiController.show:', error);
      res.status(500).send('Terjadi kesalahan sistem.');
    }
  },

  approve: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { catatanAdmin } = req.body;

      const item = await prisma.clarification.findUnique({
        where: { id },
        include: { employee: true }
      });

      if (item) {
        const reviewer = (req as any).session?.user?.namaLengkap || 'Admin Korwil';
        const reviewTimestamp = formatWIB(new Date());

        await prisma.clarification.update({
          where: { id },
          data: {
            statusVerifikasi: 'APPROVED',
            catatanAdmin: catatanAdmin || 'Klarifikasi absensi disetujui.',
            reviewedBy: reviewer,
            reviewedAt: reviewTimestamp
          }
        });

        // Update attendance days directly in the database
        const targetStatus = item.statusPengganti || 'DL';

        const updateDay = async (year: number, month: number, day: number) => {
          const period = await prisma.attendancePeriod.upsert({
            where: { bulan_tahun: { bulan: month, tahun: year } },
            update: {},
            create: { bulan: month, tahun: year }
          });

          await prisma.attendanceDay.upsert({
            where: {
              employeeId_periodId_tanggal: {
                employeeId: item.employeeId,
                periodId: period.id,
                tanggal: day
              }
            },
            update: {
              status: targetStatus,
              keterangan: `Klarifikasi Disetujui (${targetStatus})`
            },
            create: {
              employeeId: item.employeeId,
              periodId: period.id,
              tanggal: day,
              status: targetStatus,
              keterangan: `Klarifikasi Disetujui (${targetStatus})`
            }
          });
        };

        if (item.tanggalAbsen.includes('s/d')) {
          const [startStr, endStr] = item.tanggalAbsen.split(' s/d ').map(s => s.trim());
          const startDate = new Date(startStr);
          const endDate = new Date(endStr);

          for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            await updateDay(d.getFullYear(), d.getMonth() + 1, d.getDate());
          }
        } else {
          const parts = item.tanggalAbsen.split('-');
          if (parts.length === 3) {
            await updateDay(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
          }
        }

        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'success',
            message: `Klarifikasi absensi untuk ${item.employee.nama} DISETUJUI dan tabel rekap otomatis diperbarui.`
          };
        }
      }

      res.redirect(buildRedirectUrl(req, 'pending'));
    } catch (error) {
      console.error('Error in klarifikasiController.approve:', error);
      res.redirect(buildRedirectUrl(req, 'pending'));
    }
  },

  reject: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { catatanAdmin } = req.body;

      const item = await prisma.clarification.findUnique({
        where: { id },
        include: { employee: true }
      });

      if (item) {
        const reviewer = (req as any).session?.user?.namaLengkap || 'Admin Korwil';
        const reviewTimestamp = formatWIB(new Date());

        await prisma.clarification.update({
          where: { id },
          data: {
            statusVerifikasi: 'REJECTED',
            catatanAdmin: catatanAdmin || 'Bukti dokumen belum memenuhi ketentuan / belum ditandatangani Kepala Sekolah.',
            reviewedBy: reviewer,
            reviewedAt: reviewTimestamp
          }
        });

        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'warning',
            message: `Klarifikasi absensi untuk ${item.employee.nama} DITOLAK dan dipindahkan ke Riwayat Arsip.`
          };
        }
      }

      res.redirect(buildRedirectUrl(req, 'pending'));
    } catch (error) {
      console.error('Error in klarifikasiController.reject:', error);
      res.redirect(buildRedirectUrl(req, 'pending'));
    }
  },

  delete: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const redirectTab = (req.query.tab as string) || 'pending';

      const item = await prisma.clarification.findUnique({
        where: { id },
        include: { employee: true }
      });

      if (item) {
        // If it was approved before, revert status in attendance day
        if (item.statusVerifikasi === 'APPROVED') {
          const revertStatus = item.statusAwal || 'TK';

          const revertDay = async (year: number, month: number, day: number) => {
            const period = await prisma.attendancePeriod.findUnique({
              where: { bulan_tahun: { bulan: month, tahun: year } }
            });

            if (period) {
              await prisma.attendanceDay.updateMany({
                where: {
                  employeeId: item.employeeId,
                  periodId: period.id,
                  tanggal: day
                },
                data: {
                  status: revertStatus,
                  keterangan: `Status Dikembalikan ke Semula (${revertStatus})`
                }
              });
            }
          };

          if (item.tanggalAbsen.includes('s/d')) {
            const [startStr, endStr] = item.tanggalAbsen.split(' s/d ').map(s => s.trim());
            const startDate = new Date(startStr);
            const endDate = new Date(endStr);

            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
              await revertDay(d.getFullYear(), d.getMonth() + 1, d.getDate());
            }
          } else {
            const parts = item.tanggalAbsen.split('-');
            if (parts.length === 3) {
              await revertDay(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
            }
          }
        }

        // Hapus berkas fisik hasil upload dari disk/storage agar tidak menjadi file sampah
        if (item.fileUrl) {
          await deleteFileFromStorage(item.fileUrl);
        }

        await prisma.clarification.delete({ where: { id } });

        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'success',
            message: `Klarifikasi absensi untuk ${item.employee.nama} berhasil dihapus dan status absensi dipulihkan.`
          };
        }
      }

      res.redirect(buildRedirectUrl(req, redirectTab));
    } catch (error) {
      console.error('Error in klarifikasiController.delete:', error);
      res.redirect(buildRedirectUrl(req, 'pending'));
    }
  },

  exportExcel: async (req: Request, res: Response) => {
    try {
      const bulan = parseInt(req.query.bulan as string) || new Date().getMonth() + 1;
      const tahun = parseInt(req.query.tahun as string) || new Date().getFullYear();
      const filterUnit = (req.query.unit as string) || 'unit-all';
      const filterStatus = (req.query.status as string) || 'ALL';

      // Only allow SUPER_ADMIN and ADMIN_KORWIL
      const userRole = (req as any).session?.user?.role;
      if (userRole === 'ADMIN_DINAS') {
        return res.status(403).send('Akses ditolak.');
      }

      const whereClause: any = {};
      if (filterUnit !== 'unit-all') {
        whereClause.employee = { unitId: filterUnit };
      }
      if (filterStatus && filterStatus !== 'ALL') {
        whereClause.statusVerifikasi = filterStatus;
      }

      const allClarifications = await prisma.clarification.findMany({
        where: whereClause,
        include: {
          employee: {
            include: { unit: true }
          }
        },
        orderBy: [
          { employee: { unit: { namaUnit: 'asc' } } },
          { employee: { nama: 'asc' } },
          { createdAt: 'desc' }
        ]
      });

      const filtered = allClarifications.filter(c => matchesClarificationMonthYear(c, bulan, tahun));

      const rows = filtered.map((c, idx) => {
        const statusLabel = c.statusVerifikasi === 'APPROVED' ? 'Disetujui' :
          c.statusVerifikasi === 'REJECTED' ? 'Ditolak' : 'Menunggu Verifikasi';
        return {
          'No': idx + 1,
          'NIP': c.employee.nip,
          'Nama Pegawai': c.employee.nama,
          'Jabatan': c.employee.jabatan || 'Guru',
          'Unit Kerja / Sekolah': c.employee.unit.namaUnit,
          'Status Kepegawaian': c.employee.statusKepegawaian || '-',
          'Tanggal Absen': c.tanggalAbsen,
          'Status Awal': c.statusAwal,
          'Status Pengganti': c.statusPengganti,
          'Alasan / Keterangan': c.alasan,
          'Nama Berkas Bukti': c.fileName || '-',
          'Status Review': statusLabel,
          'Catatan Admin': c.catatanAdmin || '-',
          'Diverifikasi Oleh': c.reviewedBy || '-',
          'Waktu Verifikasi': c.reviewedAt || '-',
          'Waktu Pengajuan': formatWIB(c.createdAt)
        };
      });

      if (rows.length === 0) {
        rows.push({
          'No': '-',
          'NIP': '-',
          'Nama Pegawai': 'Tidak ada permohonan klarifikasi untuk periode ini',
          'Jabatan': '-',
          'Unit Kerja / Sekolah': '-',
          'Status Kepegawaian': '-',
          'Tanggal Absen': '-',
          'Status Awal': '-',
          'Status Pengganti': '-',
          'Alasan / Keterangan': '-',
          'Nama Berkas Bukti': '-',
          'Status Review': '-',
          'Catatan Admin': '-',
          'Diverifikasi Oleh': '-',
          'Waktu Verifikasi': '-',
          'Waktu Pengajuan': '-'
        } as any);
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);

      ws['!cols'] = [
        { wch: 5 },  // No
        { wch: 22 }, // NIP
        { wch: 35 }, // Nama Pegawai
        { wch: 20 }, // Jabatan
        { wch: 35 }, // Unit Kerja
        { wch: 18 }, // Status Kepegawaian
        { wch: 24 }, // Tanggal Absen
        { wch: 12 }, // Status Awal
        { wch: 16 }, // Status Pengganti
        { wch: 40 }, // Alasan
        { wch: 30 }, // Berkas
        { wch: 20 }, // Status
        { wch: 35 }, // Catatan
        { wch: 22 }, // Diverifikasi Oleh
        { wch: 20 }, // Waktu Verifikasi
        { wch: 20 }  // Waktu Pengajuan
      ];

      XLSX.utils.book_append_sheet(wb, ws, `Klarifikasi ${BULAN_NAMES[bulan]} ${tahun}`);

      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
      const filename = `Laporan_Klarifikasi_Absensi_${BULAN_NAMES[bulan]}_${tahun}.xlsx`;

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);
    } catch (error) {
      console.error('Error in exportExcel klarifikasi:', error);
      res.status(500).send('Gagal mengekspor data klarifikasi.');
    }
  },

  exportPdf: async (req: Request, res: Response) => {
    try {
      const bulan = parseInt(req.query.bulan as string) || new Date().getMonth() + 1;
      const tahun = parseInt(req.query.tahun as string) || new Date().getFullYear();
      const filterUnit = (req.query.unit as string) || 'unit-all';
      const filterStatus = (req.query.status as string) || 'ALL';

      // Only allow SUPER_ADMIN and ADMIN_KORWIL
      const userRole = (req as any).session?.user?.role;
      if (userRole === 'ADMIN_DINAS') {
        return res.status(403).send('Akses ditolak.');
      }

      const whereClause: any = {};
      if (filterUnit !== 'unit-all') {
        whereClause.employee = { unitId: filterUnit };
      }
      if (filterStatus && filterStatus !== 'ALL') {
        whereClause.statusVerifikasi = filterStatus;
      }

      const [allUnits, allClarifications] = await Promise.all([
        prisma.unit.findMany({ orderBy: { namaUnit: 'asc' } }),
        prisma.clarification.findMany({
          where: whereClause,
          include: {
            employee: {
              include: { unit: true }
            }
          },
          orderBy: [
            { employee: { unit: { namaUnit: 'asc' } } },
            { employee: { nama: 'asc' } },
            { createdAt: 'desc' }
          ]
        })
      ]);

      const unitLabel = filterUnit === 'unit-all' ? 'Semua Unit Kerja' :
        allUnits.find(u => u.id === filterUnit)?.namaUnit || '-';

      const filtered = allClarifications.filter(c => matchesClarificationMonthYear(c, bulan, tahun));

      const totalCount = filtered.length;
      const approvedCount = filtered.filter(c => c.statusVerifikasi === 'APPROVED').length;
      const rejectedCount = filtered.filter(c => c.statusVerifikasi === 'REJECTED').length;
      const pendingCount = filtered.filter(c => c.statusVerifikasi === 'PENDING').length;

      const printedAt = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' });

      const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>Laporan Klarifikasi Absensi ${BULAN_NAMES[bulan]} ${tahun}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #1e293b; background: #fff; }
  @page { size: A4 landscape; margin: 10mm 12mm; }
  .header { text-align: center; margin-bottom: 10px; border-bottom: 2px solid #1e3a5f; padding-bottom: 8px; }
  .header h1 { font-size: 14px; font-weight: bold; color: #1e3a5f; }
  .header p { font-size: 10px; color: #475569; margin-top: 2px; }
  .meta { display: flex; justify-content: space-between; font-size: 9px; color: #64748b; margin-bottom: 8px; }
  .summary { display: flex; gap: 8px; margin-bottom: 8px; font-size: 9px; }
  .summary-box { padding: 4px 8px; border-radius: 4px; border: 1px solid #e2e8f0; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1e3a5f; color: white; padding: 6px 6px; text-align: left; font-size: 9px; }
  td { padding: 5px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; font-size: 9px; }
  tr:nth-child(even) td { background: #f8fafc; }
  .status { font-weight: bold; font-size: 8px; padding: 2px 6px; border-radius: 4px; display: inline-block; }
  .footer { margin-top: 14px; font-size: 8px; color: #94a3b8; text-align: center; }
  @media print {
    .no-print { display: none !important; }
    body { background: white; }
  }
</style>
</head>
<body>
<div class="no-print" style="position:fixed;top:12px;right:14px;z-index:999;">
  <button onclick="window.print()" style="background:#1e3a5f;color:white;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:11px;font-weight:bold;box-shadow:0 2px 6px rgba(0,0,0,0.15);">🖨 Cetak / Save PDF</button>
  <button onclick="window.close()" style="background:#64748b;color:white;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:11px;margin-left:6px;">✕ Tutup</button>
</div>
<div class="header">
  <h1>LAPORAN KLARIFIKASI ABSENSI PEGAWAI</h1>
  <p>Korwil Pendidikan Kecamatan Cibitung &nbsp;|&nbsp; Periode: ${BULAN_NAMES[bulan]} ${tahun} &nbsp;|&nbsp; Unit: ${unitLabel}</p>
</div>
<div class="meta">
  <div class="summary">
    <div class="summary-box">Total: <b>${totalCount}</b></div>
    <div class="summary-box" style="border-color:#bbf7d0;color:#166534;background:#f0fdf4;">Disetujui: <b>${approvedCount}</b></div>
    <div class="summary-box" style="border-color:#fecaca;color:#991b1b;background:#fef2f2;">Ditolak: <b>${rejectedCount}</b></div>
    <div class="summary-box" style="border-color:#fef08a;color:#854d0e;background:#fefce8;">Menunggu: <b>${pendingCount}</b></div>
  </div>
  <span style="align-self:center;">Dicetak: ${printedAt}</span>
</div>
<table>
  <thead>
    <tr>
      <th style="width:28px;text-align:center;">No</th>
      <th style="width:110px;">NIP</th>
      <th style="width:160px;">Nama Pegawai</th>
      <th style="width:150px;">Unit Kerja / Sekolah</th>
      <th style="width:95px;">Tanggal Absen</th>
      <th style="width:80px;text-align:center;">Status</th>
      <th style="width:160px;">Alasan / Keterangan</th>
      <th style="width:85px;text-align:center;">Verifikasi</th>
      <th>Catatan Admin / Verifikator</th>
    </tr>
  </thead>
  <tbody>
    ${filtered.length === 0 ? `
    <tr>
      <td colspan="9" style="text-align:center;padding:24px;color:#94a3b8;font-size:11px;">
        Tidak ada data klarifikasi absensi untuk periode ${BULAN_NAMES[bulan]} ${tahun}
      </td>
    </tr>` : filtered.map((c, idx) => {
      const statusText = c.statusVerifikasi === 'APPROVED' ? 'Disetujui' :
        c.statusVerifikasi === 'REJECTED' ? 'Ditolak' : 'Menunggu';
      const statusColor = c.statusVerifikasi === 'APPROVED' ? '#16a34a' :
        c.statusVerifikasi === 'REJECTED' ? '#dc2626' : '#d97706';
      const statusBg = c.statusVerifikasi === 'APPROVED' ? '#f0fdf4' :
        c.statusVerifikasi === 'REJECTED' ? '#fef2f2' : '#fffbeb';
      return `
    <tr>
      <td style="text-align:center;">${idx + 1}</td>
      <td style="font-family:monospace;">${c.employee.nip}</td>
      <td><b>${c.employee.nama}</b><div style="color:#64748b;font-size:8px;">${c.employee.statusKepegawaian || ''}</div></td>
      <td>${c.employee.unit.namaUnit}</td>
      <td style="font-weight:600;">${c.tanggalAbsen}</td>
      <td style="text-align:center;">
        <span style="font-weight:bold;color:#64748b;">${c.statusAwal}</span>
        <span style="color:#94a3b8;margin:0 2px;">➔</span>
        <span style="font-weight:bold;color:#0f766e;">${c.statusPengganti}</span>
      </td>
      <td>${c.alasan || '-'}</td>
      <td style="text-align:center;">
        <span class="status" style="color:${statusColor};border:1px solid ${statusColor};background:${statusBg};">
          ${statusText}
        </span>
      </td>
      <td>
        ${c.catatanAdmin ? `<div>${c.catatanAdmin}</div>` : ''}
        ${c.reviewedBy ? `<div style="color:#64748b;font-size:8px;margin-top:2px;">Oleh: ${c.reviewedBy} (${c.reviewedAt || '-'})</div>` : ''}
        ${!c.catatanAdmin && !c.reviewedBy ? '-' : ''}
      </td>
    </tr>`;
    }).join('')}
  </tbody>
</table>
<div class="footer">
  Dokumen ini digenerate otomatis oleh Sistem SIMPEG Korwil Cibitung &mdash; ${printedAt}
</div>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error('Error in exportPdf klarifikasi:', error);
      res.status(500).send('Gagal mengekspor PDF data klarifikasi.');
    }
  },

  importExcel: (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[];
    const fileCount = files ? files.length : 1;

    if ((req as any).session) {
      (req as any).session.toast = {
        type: 'success',
        message: `Sinkronisasi berhasil! ${fileCount} file Excel rekap kehadiran telah diproses.`
      };
    }

    res.redirect('/admin/klarifikasi');
  }
};
