import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../../lib/prisma';

export const authController = {
  showLogin: (req: Request, res: Response) => {
    const user = (req as any).session?.user;
    if (user) {
      return res.redirect('/admin/klarifikasi');
    }

    const error = (req as any).session?.loginError || null;
    if ((req as any).session) {
      delete (req as any).session.loginError;
    }

    res.render('admin/login', {
      title: 'Masuk Admin Portal - SIMPEG Korwil Cibitung',
      page: 'admin-login',
      error
    });
  },

  login: async (req: Request, res: Response) => {
    try {
      const { username, email, password } = req.body;
      const userIdentifier = (username || email || '').trim();

      if (!userIdentifier || !password) {
        if ((req as any).session) {
          (req as any).session.loginError = 'Username dan kata sandi wajib diisi.';
        }
        return res.redirect('/admin/login');
      }

      const admin = await prisma.adminUser.findFirst({
        where: {
          OR: [
            { username: userIdentifier },
            { email: userIdentifier }
          ]
        }
      });

      if (!admin) {
        if ((req as any).session) {
          (req as any).session.loginError = 'Username atau kata sandi tidak valid.';
        }
        return res.redirect('/admin/login');
      }

      if (!admin.isActive) {
        if ((req as any).session) {
          (req as any).session.loginError = 'Akun Anda dinonaktifkan oleh Super Admin. Silakan hubungi koordinator.';
        }
        return res.redirect('/admin/login');
      }

      const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);
      if (!isPasswordValid) {
        if ((req as any).session) {
          (req as any).session.loginError = 'Username atau kata sandi tidak valid.';
        }
        return res.redirect('/admin/login');
      }

      // Update last login timestamp
      await prisma.adminUser.update({
        where: { id: admin.id },
        data: { lastLogin: new Date().toISOString().replace('T', ' ').substring(0, 16) }
      });

      if ((req as any).session) {
        (req as any).session.user = {
          id: admin.id,
          username: admin.username,
          email: admin.email,
          namaLengkap: admin.namaLengkap,
          role: admin.role
        };
        (req as any).session.toast = {
          type: 'success',
          message: `Selamat datang kembali, ${admin.namaLengkap}!`
        };
      }

      res.redirect('/admin/klarifikasi');
    } catch (error) {
      console.error('Login error:', error);
      if ((req as any).session) {
        (req as any).session.loginError = 'Terjadi kesalahan sistem saat proses login.';
      }
      res.redirect('/admin/login');
    }
  },

  logout: (req: Request, res: Response) => {
    if ((req as any).session) {
      delete (req as any).session.user;
    }
    res.redirect('/admin/login');
  }
};
