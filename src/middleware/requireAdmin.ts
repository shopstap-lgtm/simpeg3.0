import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).session?.user;
  if (!user) {
    if ((req as any).session) {
      (req as any).session.loginError = 'Silakan masuk terlebih dahulu untuk mengakses menu admin.';
    }
    return res.redirect('/admin/login');
  }

  // Populate badge notification counters for admin sidebar
  try {
    const [pendingClarificationsCount, pendingEkinerjaCount] = await Promise.all([
      prisma.clarification.count({ where: { statusVerifikasi: 'PENDING' } }),
      prisma.ekinerjaReport.count({ where: { statusReview: 'PENDING' } })
    ]);
    res.locals.pendingClarificationsCount = pendingClarificationsCount;
    res.locals.pendingEkinerjaCount = pendingEkinerjaCount;
  } catch (err) {
    res.locals.pendingClarificationsCount = 0;
    res.locals.pendingEkinerjaCount = 0;
  }

  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).session?.user;
  if (!user) {
    if ((req as any).session) {
      (req as any).session.loginError = 'Silakan masuk terlebih dahulu.';
    }
    return res.redirect('/admin/login');
  }

  if (user.role !== 'SUPER_ADMIN') {
    return res.status(403).render('partials/404', {
      title: 'Akses Ditolak (403) - SIMPEG Korwil Cibitung',
      page: '403',
      user
    });
  }

  next();
}

export function requireSuperAdminOrDinas(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).session?.user;
  if (!user) {
    if ((req as any).session) {
      (req as any).session.loginError = 'Silakan masuk terlebih dahulu.';
    }
    return res.redirect('/admin/login');
  }

  if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN_DINAS') {
    if ((req as any).session) {
      (req as any).session.toast = {
        type: 'danger',
        message: 'Akses Ditolak: Fitur Upload Rekap Absensi hanya dapat diakses oleh Super Admin dan Admin Dinas.'
      };
    }
    return res.redirect('/admin/klarifikasi');
  }

  next();
}
