export interface CmsConfig {
  id: string;
  heroBadge: string;
  heroTitle: string;
  heroSubtitle: string;
  pengumumanText: string;
  selectedMonth: number;
  selectedMonthEkinerja: number;
  selectedYear: number;
  updatedAt: string;
}

export let mockCmsConfig: CmsConfig = {
  id: 'cms-main',
  heroBadge: '✨ SISTEM INFORMASI KEPEGAWAIAN 2.0',
  heroTitle: 'Portal Monitoring Presensi & Kinerja Pegawai',
  heroSubtitle: 'Kantor Koordinator Wilayah Bidang Pendidikan Kecamatan Cibitung, Kabupaten Bekasi',
  pengumumanText: '📢 PERHATIAN: Batas akhir upload Laporan E-Kinerja Harian dan Bulanan periode Juli 2026 adalah tanggal 5 Agustus 2026 pukul 23:59 WIB. Pastikan dokumen telah ditandatangani Kepala Sekolah.',
  selectedMonth: 7,
  selectedMonthEkinerja: 7,
  selectedYear: 2026,
  updatedAt: '2026-07-26 08:00'
};
