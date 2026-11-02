import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

const BULAN_NAMES = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const JENIS_CUTI_LIST = [
  'Cuti Tahunan',
  'Cuti Sakit',
  'Cuti Melahirkan',
  'Cuti Haji',
  'Cuti Alasan Penting',
  'Cuti Besar',
  'Cuti Lainnya'
];

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

const safeDeleteLocalFile = (fileUrl: string | null | undefined) => {
  if (!fileUrl) return;
  try {
    const filename = path.basename(fileUrl);
    const localPath = path.join(process.cwd(), 'public', 'uploads', filename);
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }
  } catch (err) {
    console.error('[cutiAdminController] Gagal menghapus file fisik:', err);
  }
};

const buildRedirectUrl = (req: Request) => {
  const unit = (req.query.unit as string) || (req.body?.filterUnit as string) || '';
  const bulan = (req.query.bulan as string) || (req.body?.filterBulan as string) || '';
  const tahun = (req.query.tahun as string) || (req.body?.filterTahun as string) || '';
  const jenisCuti = (req.query.jenisCuti as string) || (req.body?.filterJenisCuti as string) || '';
  const search = (req.query.search as string) || (req.body?.filterSearch as string) || '';

  const params = new URLSearchParams();
  if (unit && unit !== 'unit-all') params.set('unit', unit);
  if (bulan && bulan !== 'all') params.set('bulan', bulan);
  if (tahun && tahun !== 'all') params.set('tahun', tahun);
  if (jenisCuti && jenisCuti !== 'ALL') params.set('jenisCuti', jenisCuti);
  if (search) params.set('search', search);

  const qs = params.toString();
  return `/admin/cuti${qs ? '?' + qs : ''}`;
};

const parseIds = (bodyIds: any): string[] => {
  if (!bodyIds) return [];
  if (Array.isArray(bodyIds)) return bodyIds.filter(Boolean);
  if (typeof bodyIds === 'string') {
    try {
      const parsed = JSON.parse(bodyIds);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {}
    return bodyIds.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
};

export const cutiAdminController = {
  // 1. Tampilkan Halaman Rekap Cuti Admin
  show: async (req: Request, res: Response) => {
    try {
      const filterUnit = (req.query.unit as string) || 'unit-all';
      const filterBulan = (req.query.bulan as string) || 'all';
      const currentYear = new Date().getFullYear();
      const filterTahun = (req.query.tahun as string) || String(currentYear);
      const filterJenisCuti = (req.query.jenisCuti as string) || 'ALL';
      const search = ((req.query.search as string) || '').trim();

      const whereClause: any = {};

      if (filterUnit !== 'unit-all') {
        whereClause.employee = { ...whereClause.employee, unitId: filterUnit };
      }

      if (filterBulan !== 'all' && !isNaN(parseInt(filterBulan, 10))) {
        whereClause.bulan = parseInt(filterBulan, 10);
      }

      if (filterTahun !== 'all' && !isNaN(parseInt(filterTahun, 10))) {
        whereClause.tahun = parseInt(filterTahun, 10);
      }

      if (filterJenisCuti !== 'ALL') {
        whereClause.jenisCuti = filterJenisCuti;
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

      const [allUnits, allActiveEmployees, cutiRecords] = await Promise.all([
        prisma.unit.findMany({ orderBy: { namaUnit: 'asc' } }),
        prisma.employee.findMany({
          where: { aktif: true },
          include: { unit: true },
          orderBy: { nama: 'asc' }
        }),
        prisma.cuti.findMany({
          where: whereClause,
          include: {
            employee: { include: { unit: true } }
          },
          orderBy: [
            { tahun: 'desc' },
            { bulan: 'desc' },
            { createdAt: 'desc' }
          ]
        })
      ]);

      const formattedRecords = cutiRecords.map(c => ({
        id: c.id,
        employeeId: c.employeeId,
        employeeName: c.employee?.nama || '-',
        employeeNip: c.employee?.nip || '-',
        unitNama: c.employee?.unit?.namaUnit || '-',
        bulan: c.bulan,
        namaBulan: BULAN_NAMES[c.bulan] || `Bulan ${c.bulan}`,
        tahun: c.tahun,
        tanggalMulai: c.tanggalMulai,
        tanggalSelesai: c.tanggalSelesai,
        tanggalCuti: c.tanggalCuti,
        jenisCuti: c.jenisCuti,
        alasan: c.alasan || '-',
        fileSuratUrl: c.fileSuratUrl,
        fileSuratName: c.fileSuratName || 'Surat_Cuti.pdf',
        statusSurat: c.statusSurat,
        catatanAdmin: c.catatanAdmin || '-',
        uploadedBy: c.uploadedBy || 'Admin',
        uploadedAt: c.uploadedAt ? formatWIB(c.uploadedAt) : '-',
        createdAt: formatWIB(c.createdAt)
      }));

      // Counters & Stats
      const totalCount = formattedRecords.length;
      const cutiTahunanCount = formattedRecords.filter(c => c.jenisCuti === 'Cuti Tahunan').length;
      const cutiSakitCount = formattedRecords.filter(c => c.jenisCuti === 'Cuti Sakit').length;
      const cutiMelahirkanCount = formattedRecords.filter(c => c.jenisCuti === 'Cuti Melahirkan').length;
      const cutiHajiCount = formattedRecords.filter(c => c.jenisCuti === 'Cuti Haji').length;
      const suratTerbitCount = formattedRecords.filter(c => !!c.fileSuratUrl).length;
      const suratMenungguCount = formattedRecords.filter(c => !c.fileSuratUrl).length;

      const units = [
        { id: 'unit-all', namaUnit: 'Semua Unit Kerja' },
        ...allUnits
      ];

      const employeesData = allActiveEmployees.map(e => ({
        id: e.id,
        nip: e.nip,
        nama: e.nama,
        unitNama: e.unit?.namaUnit || '-'
      }));

      const toast = (req as any).session?.toast || null;
      if ((req as any).session) {
        delete (req as any).session.toast;
      }

      res.render('admin/cuti', {
        title: 'Rekapitulasi Cuti Pegawai - Admin SIMPEG',
        page: 'admin-cuti',
        cutiList: formattedRecords,
        units,
        employees: employeesData,
        filterUnit,
        filterBulan,
        filterTahun,
        filterJenisCuti,
        search,
        stats: {
          totalCount,
          cutiTahunanCount,
          cutiSakitCount,
          cutiMelahirkanCount,
          cutiHajiCount,
          suratTerbitCount,
          suratMenungguCount
        },
        BULAN_NAMES,
        JENIS_CUTI_LIST,
        toast,
        user: (req as any).session?.user || { role: 'SUPER_ADMIN', namaLengkap: 'Administrator' }
      });
    } catch (error: any) {
      console.error('Error in cutiAdminController.show:', error);
      res.status(500).send('Terjadi kesalahan sistem saat memuat data cuti.');
    }
  },

  // 2. Tambah Data Cuti Baru
  create: async (req: Request, res: Response) => {
    try {
      const user = (req as any).session?.user;
      const {
        employeeId,
        nip,
        bulan,
        tahun,
        tanggalMulai,
        tanggalSelesai,
        jenisCuti,
        alasan,
        catatanAdmin
      } = req.body;

      let targetEmpId = employeeId;
      if (!targetEmpId && nip) {
        const emp = await prisma.employee.findFirst({ where: { nip: nip.trim(), aktif: true } });
        if (emp) targetEmpId = emp.id;
      }

      if (!targetEmpId) {
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'error',
            message: 'Pegawai yang dipilih tidak valid atau NIP tidak ditemukan.'
          };
        }
        return res.redirect(buildRedirectUrl(req));
      }

      const tglMulai = (tanggalMulai || '').trim();
      const tglSelesai = (tanggalSelesai || tglMulai).trim();
      const formattedTanggalCuti = (tglMulai === tglSelesai || !tglSelesai)
        ? tglMulai
        : `${tglMulai} s/d ${tglSelesai}`;

      const numBulan = parseInt(bulan, 10) || (tglMulai ? new Date(tglMulai).getMonth() + 1 : new Date().getMonth() + 1);
      const numTahun = parseInt(tahun, 10) || (tglMulai ? new Date(tglMulai).getFullYear() : new Date().getFullYear());

      const file = req.file;
      const fileSuratUrl = file ? `/uploads/${file.filename}` : null;
      const fileSuratName = file ? file.originalname : null;
      const statusSurat = file ? 'TERBIT' : 'MENUNGGU';

      const newCuti = await prisma.cuti.create({
        data: {
          employeeId: targetEmpId,
          bulan: numBulan,
          tahun: numTahun,
          tanggalMulai: tglMulai,
          tanggalSelesai: tglSelesai,
          tanggalCuti: formattedTanggalCuti,
          jenisCuti: jenisCuti || 'Cuti Tahunan',
          alasan: alasan?.trim() || null,
          catatanAdmin: catatanAdmin?.trim() || null,
          fileSuratUrl,
          fileSuratName,
          statusSurat,
          uploadedBy: user?.namaLengkap || 'Admin',
          uploadedAt: file ? new Date() : null
        },
        include: { employee: true }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Data cuti untuk ${newCuti.employee.nama} berhasil ditambahkan.${file ? ' Surat cuti telah tersimpan.' : ''}`
        };
      }

      res.redirect(buildRedirectUrl(req));
    } catch (error: any) {
      console.error('Error in cutiAdminController.create:', error);
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'error',
          message: error.message || 'Gagal menambahkan data cuti.'
        };
      }
      res.redirect(buildRedirectUrl(req));
    }
  },

  // 3. Edit Data Cuti
  update: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const user = (req as any).session?.user;
      const {
        bulan,
        tahun,
        tanggalMulai,
        tanggalSelesai,
        jenisCuti,
        alasan,
        catatanAdmin
      } = req.body;

      const existing = await prisma.cuti.findUnique({
        where: { id },
        include: { employee: true }
      });

      if (!existing) {
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'error',
            message: 'Data cuti tidak ditemukan.'
          };
        }
        return res.redirect(buildRedirectUrl(req));
      }

      const tglMulai = (tanggalMulai || existing.tanggalMulai).trim();
      const tglSelesai = (tanggalSelesai || tglMulai).trim();
      const formattedTanggalCuti = (tglMulai === tglSelesai || !tglSelesai)
        ? tglMulai
        : `${tglMulai} s/d ${tglSelesai}`;

      const updateData: any = {
        bulan: parseInt(bulan, 10) || existing.bulan,
        tahun: parseInt(tahun, 10) || existing.tahun,
        tanggalMulai: tglMulai,
        tanggalSelesai: tglSelesai,
        tanggalCuti: formattedTanggalCuti,
        jenisCuti: jenisCuti || existing.jenisCuti,
        alasan: alasan !== undefined ? alasan.trim() : existing.alasan,
        catatanAdmin: catatanAdmin !== undefined ? catatanAdmin.trim() : existing.catatanAdmin
      };

      const file = req.file;
      if (file) {
        // Hapus file fisik lama jika ada
        if (existing.fileSuratUrl) {
          safeDeleteLocalFile(existing.fileSuratUrl);
        }
        updateData.fileSuratUrl = `/uploads/${file.filename}`;
        updateData.fileSuratName = file.originalname;
        updateData.statusSurat = 'TERBIT';
        updateData.uploadedBy = user?.namaLengkap || 'Admin';
        updateData.uploadedAt = new Date();
      }

      await prisma.cuti.update({
        where: { id },
        data: updateData
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Data cuti untuk ${existing.employee.nama} berhasil diperbarui.`
        };
      }

      res.redirect(buildRedirectUrl(req));
    } catch (error: any) {
      console.error('Error in cutiAdminController.update:', error);
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'error',
          message: error.message || 'Gagal memperbarui data cuti.'
        };
      }
      res.redirect(buildRedirectUrl(req));
    }
  },

  // 4. Quick Upload / Ganti Surat Cuti
  uploadSurat: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const user = (req as any).session?.user;
      const file = req.file;

      if (!file) {
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'warning',
            message: 'Silakan pilih berkas surat cuti untuk diunggah.'
          };
        }
        return res.redirect(buildRedirectUrl(req));
      }

      const existing = await prisma.cuti.findUnique({
        where: { id },
        include: { employee: true }
      });

      if (!existing) {
        safeDeleteLocalFile(`/uploads/${file.filename}`);
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'error',
            message: 'Data cuti tidak ditemukan.'
          };
        }
        return res.redirect(buildRedirectUrl(req));
      }

      if (existing.fileSuratUrl) {
        safeDeleteLocalFile(existing.fileSuratUrl);
      }

      await prisma.cuti.update({
        where: { id },
        data: {
          fileSuratUrl: `/uploads/${file.filename}`,
          fileSuratName: file.originalname,
          statusSurat: 'TERBIT',
          uploadedBy: user?.namaLengkap || 'Admin',
          uploadedAt: new Date()
        }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Surat cuti untuk ${existing.employee.nama} berhasil diunggah dan siap diunduh oleh pegawai.`
        };
      }

      res.redirect(buildRedirectUrl(req));
    } catch (error: any) {
      console.error('Error in cutiAdminController.uploadSurat:', error);
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'error',
          message: error.message || 'Gagal mengunggah berkas surat cuti.'
        };
      }
      res.redirect(buildRedirectUrl(req));
    }
  },

  // 5. Hapus 1 Data Cuti
  delete: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const item = await prisma.cuti.findUnique({
        where: { id },
        include: { employee: true }
      });

      if (item) {
        if (item.fileSuratUrl) {
          safeDeleteLocalFile(item.fileSuratUrl);
        }
        await prisma.cuti.delete({ where: { id } });

        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'success',
            message: `Data cuti untuk ${item.employee.nama} berhasil dihapus.`
          };
        }
      }

      res.redirect(buildRedirectUrl(req));
    } catch (error: any) {
      console.error('Error in cutiAdminController.delete:', error);
      res.redirect(buildRedirectUrl(req));
    }
  },

  // 6. Bulk Delete Data Cuti
  bulkDelete: async (req: Request, res: Response) => {
    try {
      const ids = parseIds(req.body.ids);

      if (ids.length === 0) {
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'warning',
            message: 'Tidak ada data cuti yang dipilih untuk dihapus.'
          };
        }
        return res.redirect(buildRedirectUrl(req));
      }

      const items = await prisma.cuti.findMany({
        where: { id: { in: ids } }
      });

      for (const it of items) {
        if (it.fileSuratUrl) {
          safeDeleteLocalFile(it.fileSuratUrl);
        }
      }

      const result = await prisma.cuti.deleteMany({
        where: { id: { in: ids } }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `${result.count} data cuti berhasil dihapus.`
        };
      }

      res.redirect(buildRedirectUrl(req));
    } catch (error: any) {
      console.error('Error in cutiAdminController.bulkDelete:', error);
      res.redirect(buildRedirectUrl(req));
    }
  },

  // 7. Export Excel (.xlsx)
  exportExcel: async (req: Request, res: Response) => {
    try {
      const filterUnit = (req.query.unit as string) || 'unit-all';
      const filterBulan = (req.query.bulan as string) || 'all';
      const filterTahun = (req.query.tahun as string) || String(new Date().getFullYear());
      const filterJenisCuti = (req.query.jenisCuti as string) || 'ALL';
      const search = ((req.query.search as string) || '').trim();

      const whereClause: any = {};
      if (filterUnit !== 'unit-all') {
        whereClause.employee = { ...whereClause.employee, unitId: filterUnit };
      }
      if (filterBulan !== 'all' && !isNaN(parseInt(filterBulan, 10))) {
        whereClause.bulan = parseInt(filterBulan, 10);
      }
      if (filterTahun !== 'all' && !isNaN(parseInt(filterTahun, 10))) {
        whereClause.tahun = parseInt(filterTahun, 10);
      }
      if (filterJenisCuti !== 'ALL') {
        whereClause.jenisCuti = filterJenisCuti;
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

      const cutiRecords = await prisma.cuti.findMany({
        where: whereClause,
        include: { employee: { include: { unit: true } } },
        orderBy: [{ tahun: 'desc' }, { bulan: 'desc' }, { createdAt: 'desc' }]
      });

      const excelData = cutiRecords.map((c, idx) => ({
        'No': idx + 1,
        'NIP': c.employee.nip,
        'Nama Pegawai': c.employee.nama,
        'Unit Kerja / Sekolah': c.employee.unit?.namaUnit || '-',
        'Jenis Cuti': c.jenisCuti,
        'Bulan': BULAN_NAMES[c.bulan] || c.bulan,
        'Tahun': c.tahun,
        'Tanggal Cuti': c.tanggalCuti,
        'Alasan / Keterangan': c.alasan || '-',
        'Status Surat Cuti': c.fileSuratUrl ? 'Surat Terbit (Diunggah)' : 'Menunggu Surat',
        'Nama Berkas Surat': c.fileSuratName || '-',
        'Petugas Upload': c.uploadedBy || '-',
        'Waktu Input': formatWIB(c.createdAt)
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);

      // Set column widths
      ws['!cols'] = [
        { wch: 5 },  // No
        { wch: 22 }, // NIP
        { wch: 30 }, // Nama Pegawai
        { wch: 30 }, // Unit Kerja
        { wch: 18 }, // Jenis Cuti
        { wch: 14 }, // Bulan
        { wch: 8 },  // Tahun
        { wch: 24 }, // Tanggal Cuti
        { wch: 30 }, // Alasan
        { wch: 24 }, // Status Surat
        { wch: 25 }, // Nama Berkas
        { wch: 18 }, // Petugas
        { wch: 18 }  // Waktu Input
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'Rekap Cuti');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const filename = `Rekap_Cuti_Pegawai_${filterTahun}_${Date.now()}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buffer);
    } catch (error: any) {
      console.error('Error in cutiAdminController.exportExcel:', error);
      res.status(500).send('Gagal mengunduh berkas Excel rekap cuti.');
    }
  }
};

