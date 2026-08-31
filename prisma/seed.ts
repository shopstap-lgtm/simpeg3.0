import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding SIMPEG 2.0 Database...');

  // 1. Seed CMS Config
  await prisma.cmsConfig.upsert({
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
      selectedYear: 2026,
    },
  });

  // 2. Seed Admin Users (Using Bcrypt Hashed Passwords)
  const defaultPasswordHash = await bcrypt.hash('admin123', 10);

  const adminUsers = [
    {
      username: 'superadmin',
      namaLengkap: 'Administrator Utama SIMPEG',
      email: 'superadmin@cibitung.simpeg.id',
      passwordHash: defaultPasswordHash,
      role: 'SUPER_ADMIN',
      isActive: true,
    },
    {
      username: 'adminkorwil',
      namaLengkap: 'Admin Korwil Wilayah Cibitung',
      email: 'korwil@cibitung.simpeg.id',
      passwordHash: defaultPasswordHash,
      role: 'ADMIN_KORWIL',
      isActive: true,
    },
    {
      username: 'admindinas',
      namaLengkap: 'Admin Verifikator Dinas Pendidikan',
      email: 'dinas@cibitung.simpeg.id',
      passwordHash: defaultPasswordHash,
      role: 'ADMIN_DINAS',
      isActive: true,
    },
  ];

  for (const admin of adminUsers) {
    await prisma.adminUser.upsert({
      where: { username: admin.username },
      update: {
        namaLengkap: admin.namaLengkap,
        email: admin.email,
        role: admin.role,
        isActive: admin.isActive,
      },
      create: admin,
    });
  }

  // 3. Seed Units
  const unitsData = [
    { id: 'unit-01', namaUnit: 'SDN Cibitung 01' },
    { id: 'unit-02', namaUnit: 'SDN Cibitung 02' },
    { id: 'unit-03', namaUnit: 'SDN Wanasari 01' },
    { id: 'unit-04', namaUnit: 'SDN Wanajaya 02' },
    { id: 'unit-05', namaUnit: 'SMPN 1 Cibitung' },
    { id: 'unit-06', namaUnit: 'SMPN 2 Cibitung' },
    { id: 'unit-07', namaUnit: 'Kantor Korwil Cibitung' },
  ];

  for (const u of unitsData) {
    await prisma.unit.upsert({
      where: { id: u.id },
      update: { namaUnit: u.namaUnit },
      create: u,
    });
  }

  // 4. Seed Employees (Including Jabatan)
  const employeesData = [
    { id: 'emp-01', nip: '198503152010011012', nama: 'Ahmad Fauzi, S.Pd.', jabatan: 'Guru Kelas VI', statusKepegawaian: 'PNS', unitId: 'unit-01', aktif: true },
    { id: 'emp-02', nip: '199008222019032008', nama: 'Siti Nurhaliza, M.Pd.', jabatan: 'Guru Kelas III', statusKepegawaian: 'PPPK', unitId: 'unit-01', aktif: true },
    { id: 'emp-03', nip: '199512102022011005', nama: 'Budi Santoso, S.Kom.', jabatan: 'Tenaga Administrasi Sekolah', statusKepegawaian: 'PPPK_PW', unitId: 'unit-01', aktif: true },
    { id: 'emp-04', nip: '199804052023022003', nama: 'Dewi Lestari, S.Pd.', jabatan: 'Guru PJOK', statusKepegawaian: 'OUTSOURCING', unitId: 'unit-01', aktif: true },
    { id: 'emp-05', nip: '198207192008011004', nama: 'Drs. H. Mulyadi', jabatan: 'Kepala Sekolah', statusKepegawaian: 'PNS', unitId: 'unit-02', aktif: true },
    { id: 'emp-06', nip: '199201302020122011', nama: 'Rina Anggraini, S.Pd.', jabatan: 'Guru Kelas IV', statusKepegawaian: 'PPPK', unitId: 'unit-02', aktif: true },
    { id: 'emp-07', nip: '199406152021031002', nama: 'Eko Prasetyo, S.Pd.', jabatan: 'Guru PAI', statusKepegawaian: 'PPPK_PW', unitId: 'unit-02', aktif: true },
    { id: 'emp-08', nip: '198811252014022001', nama: 'Ratna Sari, M.Pd.', jabatan: 'Guru Bahasa Inggris', statusKepegawaian: 'PNS', unitId: 'unit-03', aktif: true },
    { id: 'emp-09', nip: '199305142019031007', nama: 'Hendra Wijaya, S.Pd.', jabatan: 'Guru Kelas V', statusKepegawaian: 'PPPK', unitId: 'unit-03', aktif: true },
    { id: 'emp-10', nip: '199709082022012004', nama: 'Nita Rahmawati, S.Pd.', jabatan: 'Tenaga Perpustakaan', statusKepegawaian: 'OUTSOURCING', unitId: 'unit-03', aktif: true },
    { id: 'emp-11', nip: '198002142006041009', nama: 'Bambang Supriyanto, S.Pd.', jabatan: 'Kepala Sekolah', statusKepegawaian: 'PNS', unitId: 'unit-04', aktif: true },
    { id: 'emp-12', nip: '199104182019032014', nama: 'Sri Wahyuni, S.Pd.', jabatan: 'Guru Kelas I', statusKepegawaian: 'PPPK', unitId: 'unit-04', aktif: true },
    { id: 'emp-13', nip: '198409122009021003', nama: 'Agus Setiawan, S.Pd.', jabatan: 'Guru Matematika', statusKepegawaian: 'PNS', unitId: 'unit-05', aktif: true },
    { id: 'emp-14', nip: '199211032020122009', nama: 'Maya Indah, S.Pd.', jabatan: 'Guru IPA', statusKepegawaian: 'PPPK', unitId: 'unit-05', aktif: true },
    { id: 'emp-15', nip: '197905202005011006', nama: 'Drs. Iwan Kurniawan', jabatan: 'Pengawas Sekolah / Korwil', statusKepegawaian: 'PNS', unitId: 'unit-07', aktif: true },
  ];

  for (const emp of employeesData) {
    await prisma.employee.upsert({
      where: { nip: emp.nip },
      update: {
        nama: emp.nama,
        jabatan: emp.jabatan,
        statusKepegawaian: emp.statusKepegawaian,
        unitId: emp.unitId,
        aktif: emp.aktif,
      },
      create: emp,
    });
  }

  // 5. Seed Attendance Period (Bulan 7 / 2026)
  const period = await prisma.attendancePeriod.upsert({
    where: { bulan_tahun: { bulan: 7, tahun: 2026 } },
    update: {},
    create: { bulan: 7, tahun: 2026 },
  });

  // Seed default attendance days for Bulan 7 (31 days)
  for (const emp of employeesData) {
    for (let day = 1; day <= 31; day++) {
      const date = new Date(2026, 6, day);
      const dayOfWeek = date.getDay();

      let status = 'HADIR';
      let keterangan: string | null = null;

      if (dayOfWeek === 0 || dayOfWeek === 6) {
        status = 'LIBUR';
        keterangan = 'Hari Libur Akhir Pekan';
      } else if (emp.id === 'emp-01' && day === 14) {
        status = 'TK';
        keterangan = 'Tanpa Keterangan';
      } else if (emp.id === 'emp-01' && day === 15) {
        status = 'DL_KUNING';
        keterangan = 'Dinas Luar (Surat Tugas Belum Sesuai)';
      } else if (emp.id === 'emp-02' && day === 10) {
        status = 'TL';
        keterangan = 'Terlambat 20 Menit';
      } else if (emp.id === 'emp-03' && day === 8) {
        status = 'PC';
        keterangan = 'Pulang Cepat (Izin Dinas)';
      } else if (emp.id === 'emp-04' && day === 12) {
        status = 'ST';
        keterangan = 'Sakit (Surat Dokter)';
      } else if (emp.id === 'emp-05' && day === 16) {
        status = 'CT';
        keterangan = 'Cuti Tahunan';
      }

      await prisma.attendanceDay.upsert({
        where: {
          employeeId_periodId_tanggal: {
            employeeId: emp.id,
            periodId: period.id,
            tanggal: day,
          },
        },
        update: {
          status,
          keterangan,
        },
        create: {
          employeeId: emp.id,
          periodId: period.id,
          tanggal: day,
          status,
          keterangan,
        },
      });
    }
  }

  // 6. Seed Clarifications
  await prisma.clarification.upsert({
    where: { id: 'clarif-01' },
    update: {},
    create: {
      id: 'clarif-01',
      employeeId: 'emp-01',
      tanggalAbsen: '2026-07-14',
      statusAwal: 'TK',
      statusPengganti: 'DL',
      alasan: 'Menghadiri Rapat Koordinasi Kurikulum Merdeka di Gedung Guru Kabupaten Bekasi.',
      fileUrl: '/uploads/clarification_demo.pdf',
      fileName: 'Surat_Tugas_Rakor_01.pdf',
      statusVerifikasi: 'PENDING',
    },
  });

  await prisma.clarification.upsert({
    where: { id: 'clarif-02' },
    update: {},
    create: {
      id: 'clarif-02',
      employeeId: 'emp-02',
      tanggalAbsen: '2026-07-09',
      statusAwal: 'TK',
      statusPengganti: 'DL',
      alasan: 'Mendampingi Lomba OSN Tingkat Kecamatan di SMPN 1 Cibitung.',
      fileUrl: '/uploads/clarification_demo.pdf',
      fileName: 'Surat_Tugas_OSN.pdf',
      statusVerifikasi: 'APPROVED',
      reviewedBy: 'Admin Korwil',
      reviewedAt: '2026-07-10 09:30',
      catatanAdmin: 'Surat tugas lengkap dan tervalidasi.',
    },
  });

  // 7. Seed E-Kinerja Reports
  await prisma.ekinerjaReport.upsert({
    where: {
      employeeId_bulan_tahun: {
        employeeId: 'emp-01',
        bulan: 7,
        tahun: 2026,
      },
    },
    update: {},
    create: {
      id: 'ek-01',
      employeeId: 'emp-01',
      bulan: 7,
      tahun: 2026,
      fileHarianUrl: '/uploads/ekinerja_harian_demo.pdf',
      fileHarianName: 'Laporan_Harian_Ahmad_Fauzi_Juli2026.pdf',
      fileBulananUrl: '/uploads/ekinerja_bulanan_demo.pdf',
      fileBulananName: 'Laporan_Bulanan_Ahmad_Fauzi_Juli2026.pdf',
      statusReview: 'PENDING',
    },
  });

  await prisma.ekinerjaReport.upsert({
    where: {
      employeeId_bulan_tahun: {
        employeeId: 'emp-02',
        bulan: 7,
        tahun: 2026,
      },
    },
    update: {},
    create: {
      id: 'ek-02',
      employeeId: 'emp-02',
      bulan: 7,
      tahun: 2026,
      fileHarianUrl: '/uploads/ekinerja_harian_demo.pdf',
      fileHarianName: 'Laporan_Harian_Siti_Juli2026.pdf',
      fileBulananUrl: '/uploads/ekinerja_bulanan_demo.pdf',
      fileBulananName: 'Laporan_Bulanan_Siti_Juli2026.pdf',
      nilaiHarian: 88.5,
      nilaiBulanan: 92.0,
      statusReview: 'APPROVED',
      catatanAdmin: 'Kinerja sangat baik, eviden kegiatan lengkap.',
      reviewedBy: 'Admin Korwil',
      reviewedAt: '2026-07-20 14:15',
    },
  });

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
