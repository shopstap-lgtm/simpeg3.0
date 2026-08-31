export type AdminRole = 'SUPER_ADMIN' | 'ADMIN_KORWIL' | 'ADMIN_DINAS';

export interface AdminUser {
  id: string;
  username: string;
  email?: string;
  namaLengkap: string;
  role: AdminRole;
  isActive: boolean;
  lastLogin?: string;
  createdAt: string;
}

export let mockAdmins: AdminUser[] = [
  {
    id: 'usr-001',
    username: 'superadmin',
    email: 'superadmin.cibitung@disdik.bekasikab.go.id',
    namaLengkap: 'Administrator Utama Korwil',
    role: 'SUPER_ADMIN',
    isActive: true,
    lastLogin: '2026-07-26 08:30',
    createdAt: '2025-01-01'
  },
  {
    id: 'usr-002',
    username: 'adminkorwil',
    email: 'admin.korwil@disdik.bekasikab.go.id',
    namaLengkap: 'Staf Kepegawaian Korwil',
    role: 'ADMIN_KORWIL',
    isActive: true,
    lastLogin: '2026-07-25 16:45',
    createdAt: '2025-01-10'
  },
  {
    id: 'usr-003',
    username: 'admindinas',
    email: 'admin.dinas@disdik.bekasikab.go.id',
    namaLengkap: 'Pengawas Dinas Pendidikan Kab. Bekasi',
    role: 'ADMIN_DINAS',
    isActive: true,
    lastLogin: '2026-07-25 11:10',
    createdAt: '2025-02-01'
  }
];
