import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import { holidayService } from '../../services/holidayService';

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

export const formatTanggalCutiRapi = (tglMulai: string, tglSelesai: string): string => {
  if (!tglMulai) return '-';
  const MONTHS_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const MONTHS_FULL = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  const sParts = tglMulai.split('-');
  if (sParts.length !== 3) return tglMulai;
  const sY = parseInt(sParts[0], 10);
  const sM = parseInt(sParts[1], 10);
  const sD = parseInt(sParts[2], 10);

  if (!tglSelesai || tglMulai === tglSelesai) {
    return `${sD} ${MONTHS_FULL[sM]} ${sY}`;
  }

  const eParts = tglSelesai.split('-');
  if (eParts.length !== 3) return `${tglMulai} s/d ${tglSelesai}`;
  const eY = parseInt(eParts[0], 10);
  const eM = parseInt(eParts[1], 10);
  const eD = parseInt(eParts[2], 10);

  if (sY === eY && sM === eM) {
    return `${sD} - ${eD} ${MONTHS_FULL[sM]} ${sY}`;
  }
  if (sY === eY) {
    return `${sD} ${MONTHS_SHORT[sM]} - ${eD} ${MONTHS_SHORT[eM]} ${sY}`;
  }
  return `${sD} ${MONTHS_SHORT[sM]} ${sY} - ${eD} ${MONTHS_SHORT[eM]} ${eY}`;
};

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

/**
 * Otomatis ubah status absensi pegawai pada tanggal cuti menjadi 'CT' (Cuti)
 * ketika surat cuti telah diupload oleh admin.
 */
const syncAttendanceCuti = async (cutiItem: {
  employeeId: string;
  tanggalMulai: string;
  tanggalSelesai: string;
  jenisCuti: string;
}) => {
  try {
    if (!cutiItem.tanggalMulai) return;
    const start = new Date(cutiItem.tanggalMulai);
    const end = cutiItem.tanggalSelesai ? new Date(cutiItem.tanggalSelesai) : new Date(cutiItem.tanggalMulai);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return;

    const startDate = start <= end ? start : end;
    const endDate = start <= end ? end : start;

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const yr = d.getFullYear();
      const mo = d.getMonth() + 1;
      const dt = d.getDate();
      const dayOfWeek = d.getDay();

      // Skip akhir pekan (Minggu = 0, Sabtu = 6) dan Hari Libur Nasional
      if (dayOfWeek === 0 || dayOfWeek === 6 || holidayService.isHoliday(yr, mo, dt)) {
        continue;
      }

      // Upsert AttendancePeriod untuk bulan & tahun bersangkutan
      const period = await prisma.attendancePeriod.upsert({
        where: { bulan_tahun: { bulan: mo, tahun: yr } },
        update: {},
        create: { bulan: mo, tahun: yr }
      });

      // Upsert AttendanceDay menjadi status 'CT'
      await prisma.attendanceDay.upsert({
        where: {
          employeeId_periodId_tanggal: {
            employeeId: cutiItem.employeeId,
            periodId: period.id,
            tanggal: dt
          }
        },
        update: {
          status: 'CT',
          keterangan: `${cutiItem.jenisCuti} (Surat Terbit)`
        },
        create: {
          employeeId: cutiItem.employeeId,
          periodId: period.id,
          tanggal: dt,
          status: 'CT',
          keterangan: `${cutiItem.jenisCuti} (Surat Terbit)`
        }
      });
    }
  } catch (err) {
    console.error('[syncAttendanceCuti] Gagal sinkronisasi status absensi ke CT:', err);
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

      // Ambil data unit, cuti, dan pegawai aktif
      const [allUnits, allActiveEmployees, cutiRecords] = await Promise.all([
        prisma.unit.findMany({
          orderBy: { namaUnit: 'asc' },
          select: { id: true, namaUnit: true }
        }),
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
        tanggalRapi: formatTanggalCutiRapi(c.tanggalMulai, c.tanggalSelesai),
        jumlahHari: (c as any).jumlahHari || 1,
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
        jumlahHari,
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

      // Hitung atau parsing hari cuti
      let parsedHari = parseInt(jumlahHari, 10);
      if (isNaN(parsedHari) || parsedHari <= 0) {
        if (tglMulai && tglSelesai) {
          const d1 = new Date(tglMulai);
          const d2 = new Date(tglSelesai);
          const diff = Math.abs(d2.getTime() - d1.getTime());
          parsedHari = Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)) + 1);
        } else {
          parsedHari = 1;
        }
      }

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
          jumlahHari: parsedHari,
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

      // Jika surat cuti langsung diunggah saat create, otomatis ubah status absensi menjadi 'CT'
      if (file) {
        await syncAttendanceCuti({
          employeeId: targetEmpId,
          tanggalMulai: tglMulai,
          tanggalSelesai: tglSelesai,
          jenisCuti: jenisCuti || 'Cuti Tahunan'
        });
      }

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Data cuti (${parsedHari} hari) untuk ${newCuti.employee.nama} berhasil ditambahkan.${file ? ' Surat cuti tersimpan dan status absensi otomatis menjadi CT.' : ''}`
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
        jumlahHari,
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

      let parsedHari = parseInt(jumlahHari, 10);
      if (isNaN(parsedHari) || parsedHari <= 0) {
        parsedHari = (existing as any).jumlahHari || 1;
      }

      const updateData: any = {
        bulan: parseInt(bulan, 10) || existing.bulan,
        tahun: parseInt(tahun, 10) || existing.tahun,
        tanggalMulai: tglMulai,
        tanggalSelesai: tglSelesai,
        tanggalCuti: formattedTanggalCuti,
        jumlahHari: parsedHari,
        jenisCuti: jenisCuti || existing.jenisCuti,
        alasan: alasan !== undefined ? alasan.trim() : existing.alasan,
        catatanAdmin: catatanAdmin !== undefined ? catatanAdmin.trim() : existing.catatanAdmin
      };

      const file = req.file;
      if (file) {
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

      // Jika surat cuti diupload atau memang sudah ada surat cuti, sinkronkan absensi ke CT
      if (file || existing.fileSuratUrl) {
        await syncAttendanceCuti({
          employeeId: existing.employeeId,
          tanggalMulai: tglMulai,
          tanggalSelesai: tglSelesai,
          jenisCuti: jenisCuti || existing.jenisCuti
        });
      }

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Data cuti untuk ${existing.employee.nama} berhasil diperbarui.${file ? ' Berkas surat diperbarui dan absensi disinkronkan ke CT.' : ''}`
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

      const updatedCuti = await prisma.cuti.update({
        where: { id },
        data: {
          fileSuratUrl: `/uploads/${file.filename}`,
          fileSuratName: file.originalname,
          statusSurat: 'TERBIT',
          uploadedBy: user?.namaLengkap || 'Admin',
          uploadedAt: new Date()
        }
      });

      // Otomatis ubah status absensi pegawai pada tanggal cutinya menjadi CT (Cuti)
      await syncAttendanceCuti({
        employeeId: existing.employeeId,
        tanggalMulai: existing.tanggalMulai,
        tanggalSelesai: existing.tanggalSelesai,
        jenisCuti: existing.jenisCuti
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Surat cuti untuk ${existing.employee.nama} berhasil diunggah. Status absensi pada tanggal cuti otomatis disesuaikan menjadi CT.`
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

  // 5. Hapus Data Cuti Satuan
  delete: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

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

      if (existing.fileSuratUrl) {
        safeDeleteLocalFile(existing.fileSuratUrl);
      }

      await prisma.cuti.delete({ where: { id } });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Data cuti untuk ${existing.employee.nama} berhasil dihapus.`
        };
      }

      res.redirect(buildRedirectUrl(req));
    } catch (error: any) {
      console.error('Error in cutiAdminController.delete:', error);
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'error',
          message: error.message || 'Gagal menghapus data cuti.'
        };
      }
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

      const recordsToDelete = await prisma.cuti.findMany({
        where: { id: { in: ids } },
        select: { id: true, fileSuratUrl: true }
      });

      recordsToDelete.forEach(r => {
        if (r.fileSuratUrl) {
          safeDeleteLocalFile(r.fileSuratUrl);
        }
      });

      const deleteResult = await prisma.cuti.deleteMany({
        where: { id: { in: ids } }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Berhasil menghapus ${deleteResult.count} data cuti terpilih beserta berkas lampirannya.`
        };
      }

      res.redirect(buildRedirectUrl(req));
    } catch (error: any) {
      console.error('Error in cutiAdminController.bulkDelete:', error);
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'error',
          message: error.message || 'Gagal menghapus massal data cuti.'
        };
      }
      res.redirect(buildRedirectUrl(req));
    }
  },

  // 7. Export Rekap Cuti ke Excel (.xlsx)
  exportExcel: async (req: Request, res: Response) => {
    try {
      const filterUnit = (req.query.unit as string) || 'unit-all';
      const filterBulan = (req.query.bulan as string) || 'all';
      const filterTahun = (req.query.tahun as string) || 'all';
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
        'Tanggal Cuti': formatTanggalCutiRapi(c.tanggalMulai, c.tanggalSelesai),
        'Lama Cuti (Hari)': (c as any).jumlahHari || 1,
        'Bulan': BULAN_NAMES[c.bulan] || c.bulan,
        'Tahun': c.tahun,
        'Alasan / Keterangan': c.alasan || '-',
        'Status Surat Cuti': c.fileSuratUrl ? 'Surat Terbit (Diunggah)' : 'Menunggu Surat',
        'Nama Berkas Surat': c.fileSuratName || '-',
        'Petugas Upload': c.uploadedBy || '-',
        'Waktu Input': formatWIB(c.createdAt)
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);

      ws['!cols'] = [
        { wch: 5 },  // No
        { wch: 22 }, // NIP
        { wch: 30 }, // Nama Pegawai
        { wch: 30 }, // Unit Kerja
        { wch: 18 }, // Jenis Cuti
        { wch: 26 }, // Tanggal Cuti
        { wch: 16 }, // Lama Cuti
        { wch: 14 }, // Bulan
        { wch: 8 },  // Tahun
        { wch: 30 }, // Alasan
        { wch: 24 }, // Status Surat
        { wch: 25 }, // Nama Berkas
        { wch: 20 }, // Petugas
        { wch: 18 }  // Waktu Input
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'Rekap_Cuti');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const filename = `REKAP_CUTI_PEGAWAI_${new Date().toISOString().slice(0, 10)}.xlsx`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buffer);
    } catch (error: any) {
      console.error('Error in cutiAdminController.exportExcel:', error);
      res.status(500).send('Gagal mengekspor data cuti ke Excel.');
    }
  }
};
