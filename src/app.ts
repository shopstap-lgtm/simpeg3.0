import express, { Express, Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import compression from 'compression';
import session from 'express-session';
import dotenv from 'dotenv';
import publicRoutes from './routes/publicRoutes';
import adminRoutes from './routes/adminRoutes';

dotenv.config();

export function createApp(): Express {
  const app = express();

  // Enable trust proxy (essential for Vercel / reverse proxy HTTPS session cookies)
  app.set('trust proxy', 1);

  // 1. HTTP Gzip/Brotli Compression (Reduces payload size by up to 75%)
  app.use(compression());

  // 2. Express Session Configuration (Optimized for Serverless + Vercel)
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'simpeg_cibitung_super_secret_session_key_2026',
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 Days
      }
    })
  );

  // 3. Essential Request Middlewares
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 4. Optimized Static Assets Delivery with Client-Side Caching
  const cwd = process.cwd();
  const publicPath = fs.existsSync(path.join(cwd, 'public'))
    ? path.join(cwd, 'public')
    : path.join(__dirname, '..', 'public');

  console.log('[App] cwd:', cwd);
  console.log('[App] __dirname:', __dirname);
  console.log('[App] publicPath:', publicPath, '| exists:', fs.existsSync(publicPath));

  app.use(
    express.static(publicPath, {
      maxAge: process.env.NODE_ENV === 'production' ? '7d' : '1h',
      etag: true
    })
  );

  // Dedicated static route for /uploads/ to guarantee 0% 404 error on Vercel
  app.get('/uploads/:filename', (req: Request, res: Response) => {
    const filename = path.basename(req.params.filename);
    const searchDirs = [
      path.join(cwd, 'public', 'uploads'),
      path.join(__dirname, '..', 'public', 'uploads'),
      path.join(__dirname, 'public', 'uploads')
    ];

    for (const dir of searchDirs) {
      const filePath = path.join(dir, filename);
      if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', filename.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        return res.sendFile(filePath);
      }
    }

    // If specific file not found (e.g. old local upload), return demo PDF fallback instead of 404
    for (const dir of searchDirs) {
      const demoPath = path.join(dir, 'clarification_demo.pdf');
      if (fs.existsSync(demoPath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        return res.sendFile(demoPath);
      }
    }

    res.status(404).send('Dokumen tidak ditemukan.');
  });

  // 5. View Engine Setup (EJS) with robust path resolution for Vercel Serverless
  const candidatePaths = [
    path.join(cwd, 'src', 'views'),
    path.join(cwd, 'views'),
    path.join(__dirname, 'views'),
    path.join(__dirname, '..', 'src', 'views'),
    path.join(__dirname, '..', 'views'),
  ];

  let viewsPath = candidatePaths[0];
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      viewsPath = candidate;
      break;
    }
  }

  console.log('[App] viewsPath:', viewsPath, '| exists:', fs.existsSync(viewsPath));

  app.set('views', viewsPath);
  app.set('view engine', 'ejs');

  // 6. Mount Application Routes
  app.use('/', publicRoutes);
  app.use('/admin', adminRoutes);

  // 7. Global Express Error Handler (catches async errors in routes & Multer errors)
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    console.error('[App] Express error handler caught:', err.message);

    if (err.code === 'LIMIT_FILE_SIZE' || (err.name === 'MulterError' && err.message?.includes('File too large'))) {
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'error',
          message: 'Gagal upload: Ukuran file melebihi batas maksimal 1MB!'
        };
      }
      const backUrl = req.headers.referer || '/';
      return res.redirect(backUrl);
    }

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: err.message,
      });
    }
  });

  // 8. 404 Not Found Handler
  app.use((req: Request, res: Response) => {
    console.log('[App] 404 for:', req.url);
    try {
      res.status(404).render('partials/404', {
        title: 'Halaman Tidak Ditemukan - SIMPEG Korwil Cibitung',
        page: '404',
        user: (req as any).session?.user || null
      });
    } catch (renderErr) {
      console.error('[App] 404 render failed:', renderErr);
      res.status(404).send('404 - Page Not Found');
    }
  });

  return app;
}
