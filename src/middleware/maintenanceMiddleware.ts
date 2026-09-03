import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';

export type MaintenanceTarget = 'dashboard' | 'absensi' | 'ekinerja' | 'klarifikasi';

export function checkMaintenance(target: MaintenanceTarget, pageName: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cms = await prisma.cmsConfig.findUnique({
        where: { id: 'cms-main' }
      });

      if (!cms) {
        return next();
      }

      let isClosed = false;
      if (target === 'dashboard') isClosed = !!cms.maintenanceDashboard;
      else if (target === 'absensi') isClosed = !!cms.maintenanceAbsensi;
      else if (target === 'ekinerja') isClosed = !!cms.maintenanceEkinerja;
      else if (target === 'klarifikasi') isClosed = !!cms.maintenanceKlarifikasi;

      if (!isClosed) {
        return next();
      }

      // Check if logged in as Admin / Super Admin
      const user = (req as any).session?.user;
      if (user) {
        // Admin gets preview access with an alert banner
        res.locals.isMaintenancePreview = true;
        res.locals.maintenancePage = pageName;
        res.locals.maintenanceMessage = cms.maintenanceMessage;
        return next();
      }

      // If public visitor submits POST (e.g. upload or submission)
      if (req.method === 'POST') {
        if (req.xhr || req.headers.accept?.includes('json')) {
          return res.status(503).json({
            success: false,
            message: cms.maintenanceMessage || 'Layanan sedang ditutup sementara untuk pemeliharaan sistem.'
          });
        }
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'error',
            message: cms.maintenanceMessage || 'Layanan sedang ditutup sementara untuk pemeliharaan sistem.'
          };
        }
        return res.redirect('back');
      }

      // For public GET requests: render maintenance page
      return res.status(503).render('maintenance', {
        title: `Pemeliharaan Sistem - ${pageName}`,
        pageName,
        currentPath: req.path,
        maintenanceTitle: cms.maintenanceTitle || 'Sedang Dalam Pemeliharaan',
        maintenanceMessage: cms.maintenanceMessage || 'Halaman ini sedang ditutup sementara untuk proses pemeliharaan data.'
      });
    } catch (err) {
      console.error('Error in checkMaintenance middleware:', err);
      return next();
    }
  };
}
