import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { formatTanggalCutiRapi } from './admin/cutiAdminController';

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

export const cutiPublicController = {
  show: async (req: Request, res: Response) => {
    try {
      const cms = await prisma.cmsConfig.findUnique({ where: { id: 'cms-main' } });
      const currentYear = new Date().getFullYear();

      const sessionUser = (req as any).session?.user;
      const isAdmin = !!sessionUser && (
        sessionUser.role === 'SUPER_ADMIN' ||
        sessionUser.role === 'ADMIN_DINAS' ||
        sessionUser.role === 'ADMIN_KORWIL'
      );

      const rawNip = (req.query.nip as string) || '';
      const cleanNip = rawNip.replace(/\s+/g, '').trim();

      const filterUnit = (req.query.unit as string) || 'unit-all';
      const filterBulan = (req.query.bulan as string) || 'all';
      const filterTahun = (req.query.tahun as string) || String(currentYear);
      const filterJenisCuti = (req.query.jenisCuti as string) || 'ALL';
      const search = ((req.query.search as string) || '').trim();

      let employee: any = null;
      let cutiList: any[] = [];
      let employeeNotFound = false;
      let units: any[] = [];
      let stats = {
        total: 0,
        tahunan: 0,
        sakit: 0,
        melahirkan: 0,
        haji: 0,
        lainnya: 0,
        suratTerbit: 0,
        suratMenunggu: 0
      };

      // 1. KASUS A: NIP dimasukkan (bisa dari pengunjung publik atau admin yang ingin cek pegawai tertentu)
      if (cleanNip) {
        employee = await prisma.employee.findFirst({
          where: {
            nip: cleanNip,
            aktif: true
          },
          include: {
            unit: true
          }
        });

        if (!employee) {
          employeeNotFound = true;
        } else {
          const whereClause: any = {
            employeeId: employee.id
          };

          if (filterBulan !== 'all' && !isNaN(parseInt(filterBulan, 10))) {
            whereClause.bulan = parseInt(filterBulan, 10);
          }

          if (filterTahun !== 'all' && !isNaN(parseInt(filterTahun, 10))) {
            whereClause.tahun = parseInt(filterTahun, 10);
          }

          if (filterJenisCuti !== 'ALL') {
            whereClause.jenisCuti = filterJenisCuti;
          }

          const rawCutiList = await prisma.cuti.findMany({
            where: whereClause,
            include: {
              employee: { include: { unit: true } }
            },
            orderBy: [
              { tahun: 'desc' },
              { bulan: 'desc' },
              { createdAt: 'desc' }
            ]
          });

          cutiList = rawCutiList.map(c => ({
            id: c.id,
            employeeId: c.employeeId,
            employeeName: c.employee?.nama || employee.nama || '-',
            employeeNip: c.employee?.nip || employee.nip || '-',
            unitNama: c.employee?.unit?.namaUnit || employee.unit?.namaUnit || '-',
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

          // Hitung statistik untuk pegawai ini
          const allRecordsForStats = await prisma.cuti.findMany({
            where: {
              employeeId: employee.id,
              ...(filterTahun !== 'all' && !isNaN(parseInt(filterTahun, 10)) ? { tahun: parseInt(filterTahun, 10) } : {})
            }
          });

          stats.total = allRecordsForStats.length;
          allRecordsForStats.forEach(item => {
            const jc = (item.jenisCuti || '').toLowerCase();
            if (jc.includes('tahunan')) stats.tahunan++;
            else if (jc.includes('sakit')) stats.sakit++;
            else if (jc.includes('melahirkan')) stats.melahirkan++;
            else if (jc.includes('haji')) stats.haji++;
            else stats.lainnya++;

            if (item.fileSuratUrl || item.statusSurat === 'TERBIT') {
              stats.suratTerbit++;
            } else {
              stats.suratMenunggu++;
            }
          });
        }
      } 
      // 2. KASUS B: NIP TIDAK dimasukkan TAPI yang membuka adalah ADMIN
      // Mekanisme seperti rekap absensi: Admin dapat melihat SEMUA pengajuan cuti pegawai
      else if (isAdmin) {
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

        const [allUnits, rawCutiList] = await Promise.all([
          prisma.unit.findMany({
            orderBy: { namaUnit: 'asc' },
            select: { id: true, namaUnit: true }
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

        units = [
          { id: 'unit-all', namaUnit: 'Semua Unit Kerja' },
          ...allUnits
        ];

        cutiList = rawCutiList.map(c => ({
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

        stats.total = cutiList.length;
        cutiList.forEach(item => {
          const jc = (item.jenisCuti || '').toLowerCase();
          if (jc.includes('tahunan')) stats.tahunan++;
          else if (jc.includes('sakit')) stats.sakit++;
          else if (jc.includes('melahirkan')) stats.melahirkan++;
          else if (jc.includes('haji')) stats.haji++;
          else stats.lainnya++;

          if (item.fileSuratUrl || item.statusSurat === 'TERBIT') {
            stats.suratTerbit++;
          } else {
            stats.suratMenunggu++;
          }
        });
      }

      // Ambil daftar tahun unik yang pernah ada cuti untuk dropdown
      const availableYears = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2];

      return res.render('cuti', {
        page: 'cuti',
        title: 'Rekap Cuti Pegawai - SIMPEG Korwil Cibitung',
        nipQuery: cleanNip,
        employee,
        cutiList,
        stats,
        employeeNotFound,
        filterUnit,
        filterBulan,
        filterTahun,
        filterJenisCuti,
        search,
        units,
        availableYears,
        BULAN_NAMES,
        JENIS_CUTI_LIST,
        cmsConfig: cms,
        isAdmin,
        user: sessionUser || null
      });
    } catch (error) {
      console.error('[cutiPublicController.show] Error:', error);
      return res.status(500).render('error', {
        title: 'Terjadi Kesalahan',
        message: 'Gagal memuat halaman rekap cuti.',
        error: process.env.NODE_ENV === 'development' ? error : {}
      });
    }
  }
};
