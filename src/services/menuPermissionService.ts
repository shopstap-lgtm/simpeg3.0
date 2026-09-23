import prisma from '../lib/prisma';

export interface AdminMenuItem {
  id: string;
  label: string;
  route: string;
  icon: string;
  group: 'operasional' | 'master';
  defaultRoles: string[];
}

export const ADMIN_MENU_CONFIG: AdminMenuItem[] = [
  { 
    id: 'klarifikasi', 
    label: 'Klarifikasi Absensi', 
    route: '/admin/klarifikasi', 
    icon: 'check-square', 
    group: 'operasional', 
    defaultRoles: ['SUPER_ADMIN', 'ADMIN_KORWIL', 'ADMIN_DINAS'] 
  },
  { 
    id: 'ekinerja', 
    label: 'Review E-Kinerja', 
    route: '/admin/ekinerja-review', 
    icon: 'file-check-2', 
    group: 'operasional', 
    defaultRoles: ['SUPER_ADMIN', 'ADMIN_KORWIL'] 
  },
  { 
    id: 'upload_absensi', 
    label: 'Upload Rekap Absensi', 
    route: '/admin/upload-absensi', 
    icon: 'file-spreadsheet', 
    group: 'operasional', 
    defaultRoles: ['SUPER_ADMIN', 'ADMIN_DINAS'] 
  },
  { 
    id: 'ncr_gaji', 
    label: 'Kelola NCR Gaji', 
    route: '/admin/ncr-gaji', 
    icon: 'banknote', 
    group: 'operasional', 
    defaultRoles: ['SUPER_ADMIN', 'ADMIN_KORWIL'] 
  },
  { 
    id: 'forms', 
    label: 'Form Builder', 
    route: '/admin/forms', 
    icon: 'form-input', 
    group: 'operasional', 
    defaultRoles: ['SUPER_ADMIN', 'ADMIN_KORWIL'] 
  },
  { 
    id: 'pegawai', 
    label: 'Data Pegawai', 
    route: '/admin/pegawai', 
    icon: 'contact', 
    group: 'master', 
    defaultRoles: ['SUPER_ADMIN'] 
  },
  { 
    id: 'unit_kerja', 
    label: 'Data Unit Kerja', 
    route: '/admin/unit-kerja', 
    icon: 'building-2', 
    group: 'master', 
    defaultRoles: ['SUPER_ADMIN'] 
  },
  { 
    id: 'cms', 
    label: 'CMS Dashboard', 
    route: '/admin/cms', 
    icon: 'sliders', 
    group: 'master', 
    defaultRoles: ['SUPER_ADMIN'] 
  },
  { 
    id: 'users', 
    label: 'Kelola Admin & Hak Akses', 
    route: '/admin/users', 
    icon: 'users', 
    group: 'master', 
    defaultRoles: ['SUPER_ADMIN'] 
  },
  { 
    id: 'files', 
    label: 'Manajemen Berkas', 
    route: '/admin/files', 
    icon: 'folder-archive', 
    group: 'master', 
    defaultRoles: ['SUPER_ADMIN'] 
  }
];

export const ALL_ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN_KORWIL', 'ADMIN_DINAS'] as const;
export type AdminRole = typeof ALL_ADMIN_ROLES[number];

export function getDefaultMenuPermissions(): Record<string, string[]> {
  const result: Record<string, string[]> = {
    SUPER_ADMIN: [],
    ADMIN_KORWIL: [],
    ADMIN_DINAS: []
  };

  for (const item of ADMIN_MENU_CONFIG) {
    for (const role of item.defaultRoles) {
      if (!result[role]) result[role] = [];
      result[role].push(item.id);
    }
  }

  return result;
}

export async function getMenuPermissions(): Promise<Record<string, string[]>> {
  try {
    const cms = await prisma.cmsConfig.findUnique({
      where: { id: 'cms-main' },
      select: { roleMenuPermissions: true }
    });

    if (cms?.roleMenuPermissions && cms.roleMenuPermissions.trim() !== '' && cms.roleMenuPermissions !== '{}') {
      const parsed = JSON.parse(cms.roleMenuPermissions);
      // Ensure all standard roles exist
      const defaults = getDefaultMenuPermissions();
      const combined: Record<string, string[]> = {
        SUPER_ADMIN: Array.isArray(parsed.SUPER_ADMIN) ? parsed.SUPER_ADMIN : defaults.SUPER_ADMIN,
        ADMIN_KORWIL: Array.isArray(parsed.ADMIN_KORWIL) ? parsed.ADMIN_KORWIL : defaults.ADMIN_KORWIL,
        ADMIN_DINAS: Array.isArray(parsed.ADMIN_DINAS) ? parsed.ADMIN_DINAS : defaults.ADMIN_DINAS
      };

      // Critical safety guard: SUPER_ADMIN MUST always have 'users'
      if (!combined.SUPER_ADMIN.includes('users')) {
        combined.SUPER_ADMIN.push('users');
      }

      return combined;
    }
  } catch (error) {
    console.error('Error reading roleMenuPermissions from DB, falling back to defaults:', error);
  }

  return getDefaultMenuPermissions();
}

export async function saveMenuPermissions(newPermissions: Record<string, string[]>): Promise<void> {
  // Enforce SUPER_ADMIN must have 'users' to prevent lockout
  if (!newPermissions.SUPER_ADMIN) newPermissions.SUPER_ADMIN = [];
  if (!newPermissions.SUPER_ADMIN.includes('users')) {
    newPermissions.SUPER_ADMIN.push('users');
  }

  await prisma.cmsConfig.upsert({
    where: { id: 'cms-main' },
    update: {
      roleMenuPermissions: JSON.stringify(newPermissions)
    },
    create: {
      id: 'cms-main',
      roleMenuPermissions: JSON.stringify(newPermissions)
    }
  });
}

export function canRoleAccessMenu(
  permissions: Record<string, string[]>, 
  userRole: string | undefined, 
  menuId: string
): boolean {
  if (!userRole) return false;
  // If role is SUPER_ADMIN and looking at 'users', always true
  if (userRole === 'SUPER_ADMIN' && menuId === 'users') return true;

  const allowedMenus = permissions[userRole] || [];
  return allowedMenus.includes(menuId);
}
