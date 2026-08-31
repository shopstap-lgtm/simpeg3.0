import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../../lib/prisma';

export const usersController = {
  show: async (req: Request, res: Response) => {
    try {
      const [admins, totalEmployees, totalUnits] = await Promise.all([
        prisma.adminUser.findMany({ orderBy: { createdAt: 'asc' } }),
        prisma.employee.count(),
        prisma.unit.count()
      ]);

      const formatted = admins.map(a => ({
        id: a.id,
        username: a.username,
        email: a.email || undefined,
        namaLengkap: a.namaLengkap,
        role: a.role,
        isActive: a.isActive,
        createdAt: a.createdAt.toISOString().split('T')[0],
        lastLogin: a.lastLogin
      }));

      const toast = (req as any).session?.toast || null;
      if ((req as any).session) {
        delete (req as any).session.toast;
      }

      res.render('admin/users', {
        title: 'Kelola Akun Admin & Master Pegawai - SIMPEG Korwil Cibitung',
        page: 'admin-users',
        admins: formatted,
        totalEmployees,
        totalUnits,
        toast,
        user: (req as any).session?.user || { role: 'SUPER_ADMIN', namaLengkap: 'Administrator Utama' }
      });
    } catch (error) {
      console.error('Error in usersController.show:', error);
      res.status(500).send('Terjadi kesalahan sistem.');
    }
  },

  create: async (req: Request, res: Response) => {
    try {
      const { username, email, namaLengkap, password, role } = req.body;

      if (!username || username.trim() === '') {
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'warning',
            message: 'Username wajib diisi.'
          };
        }
        return res.redirect('/admin/users');
      }

      const existing = await prisma.adminUser.findUnique({
        where: { username: username.trim() }
      });

      if (existing) {
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'warning',
            message: `Username '${username}' sudah digunakan.`
          };
        }
        return res.redirect('/admin/users');
      }

      const rawPassword = password && password.trim() !== '' ? password.trim() : 'admin123';
      const passwordHash = await bcrypt.hash(rawPassword, 10);

      await prisma.adminUser.create({
        data: {
          username: username.trim(),
          email: email && email.trim() !== '' ? email.trim() : null,
          namaLengkap: namaLengkap && namaLengkap.trim() !== '' ? namaLengkap.trim() : username.trim(),
          passwordHash,
          role: role || 'ADMIN_KORWIL',
          isActive: true
        }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Akun admin '${username}' berhasil dibuat.`
        };
      }

      res.redirect('/admin/users');
    } catch (error) {
      console.error('Error in usersController.create:', error);
      res.redirect('/admin/users');
    }
  },

  updateUser: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { username, namaLengkap, email, role, password } = req.body;

      const dataToUpdate: any = {};
      if (namaLengkap !== undefined) dataToUpdate.namaLengkap = namaLengkap.trim();
      if (email !== undefined) dataToUpdate.email = email.trim() !== '' ? email.trim() : null;
      if (role) dataToUpdate.role = role;

      if (username && username.trim() !== '') {
        const cleanUsername = username.trim();
        const existing = await prisma.adminUser.findUnique({ where: { username: cleanUsername } });
        if (existing && existing.id !== id) {
          if ((req as any).session) {
            (req as any).session.toast = {
              type: 'warning',
              message: `Username '${cleanUsername}' sudah digunakan oleh akun lain.`
            };
          }
          return res.redirect('/admin/users');
        }
        dataToUpdate.username = cleanUsername;
      }

      if (password && password.trim() !== '') {
        dataToUpdate.passwordHash = await bcrypt.hash(password.trim(), 10);
      }

      const updated = await prisma.adminUser.update({
        where: { id },
        data: dataToUpdate
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Data akun '${updated.username}' berhasil diperbarui.`
        };
        if ((req as any).session.user && (req as any).session.user.id === id) {
          (req as any).session.user.namaLengkap = updated.namaLengkap;
          (req as any).session.user.role = updated.role;
        }
      }

      res.redirect('/admin/users');
    } catch (error: any) {
      console.error('Error in usersController.updateUser:', error);
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'danger',
          message: `Gagal memperbarui akun: ${error.message}`
        };
      }
      res.redirect('/admin/users');
    }
  },

  toggleActive: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const admin = await prisma.adminUser.findUnique({ where: { id } });

      if (admin) {
        const updated = await prisma.adminUser.update({
          where: { id },
          data: { isActive: !admin.isActive }
        });

        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'success',
            message: `Status akun ${updated.username} berhasil diubah menjadi ${updated.isActive ? 'Aktif' : 'Non-Aktif'}.`
          };
        }
      }

      res.redirect('/admin/users');
    } catch (error) {
      console.error('Error in usersController.toggleActive:', error);
      res.redirect('/admin/users');
    }
  },

  deleteUser: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const currentUser = (req as any).session?.user;

      if (currentUser && currentUser.id === id) {
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'warning',
            message: 'Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.'
          };
        }
        return res.redirect('/admin/users');
      }

      const deleted = await prisma.adminUser.delete({ where: { id } });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'warning',
          message: `Akun admin ${deleted.username} telah dihapus dari sistem.`
        };
      }

      res.redirect('/admin/users');
    } catch (error) {
      console.error('Error in usersController.deleteUser:', error);
      res.redirect('/admin/users');
    }
  }
};
