export type ClarificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ClarificationItem {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNip: string;
  unitNama: string;
  tanggalAbsen: string;
  statusAwal: string;
  statusPengganti: string;
  alasan: string;
  fileUrl: string;
  fileName: string;
  statusVerifikasi: ClarificationStatus;
  catatanAdmin?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export const mockClarifications: ClarificationItem[] = [
  {
    id: 'clar-001',
    employeeId: 'emp-003',
    employeeName: 'Bambang Irawan, S.Pd.',
    employeeNip: '198811092014021003',
    unitNama: 'SDN Cibitung 01',
    tanggalAbsen: '2026-07-14 s/d 2026-07-15',
    statusAwal: 'TK',
    statusPengganti: 'DL',
    alasan: 'Mendampingi kontingen siswa pada lomba O2SN tingkat Kabupaten Bekasi di Cikarang Pusat selama 2 hari berturut-turut. Surat tugas resmi terlampir.',
    fileUrl: '/mock-files/Surat_Tugas_O2SN_Bambang.pdf',
    fileName: 'Surat_Tugas_O2SN_Bambang.pdf',
    statusVerifikasi: 'PENDING',
    createdAt: '2026-07-15 08:30'
  },
  {
    id: 'clar-002',
    employeeId: 'emp-008',
    employeeName: 'Dewi Lestari, S.Pd.',
    employeeNip: '199006242020122007',
    unitNama: 'SDN Cibitung 02',
    tanggalAbsen: '2026-07-09 s/d 2026-07-10',
    statusAwal: 'DL_KUNING',
    statusPengganti: 'DL',
    alasan: 'Upload pembaharuan Surat Tugas Dinas Luar Workshop Kurikulum yang telah ditandatangani basah oleh Kepala Sekolah.',
    fileUrl: '/mock-files/Surat_Tugas_Revisi_Dewi.pdf',
    fileName: 'Surat_Tugas_Revisi_Dewi.pdf',
    statusVerifikasi: 'PENDING',
    createdAt: '2026-07-11 10:15'
  },
  {
    id: 'clar-003',
    employeeId: 'emp-012',
    employeeName: 'Fajar Nugroho, S.Pd.',
    employeeNip: '199402032022211012',
    unitNama: 'SMPN 1 Cibitung',
    tanggalAbsen: '2026-07-06',
    statusAwal: 'TK',
    statusPengganti: 'ST',
    alasan: 'Sakit demam dan berobat ke Klinik Medika Cibitung.',
    fileUrl: '/mock-files/Surat_Dokter_Fajar.pdf',
    fileName: 'Surat_Dokter_Fajar.pdf',
    statusVerifikasi: 'APPROVED',
    catatanAdmin: 'Surat dokter valid dan telah diverifikasi dengan Kepala Sekolah.',
    reviewedBy: 'Super Admin',
    reviewedAt: '2026-07-08 14:00',
    createdAt: '2026-07-07 09:00'
  }
];
