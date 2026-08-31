import express, { Express, Request, Response } from 'express';
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

  // 1. HTTP Gzip/Brotli Compression (Reduces payload size by up to 75%)
  app.use(compression());

  // 2. Express Session Configuration
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'simpeg_cibitung_super_secret_session_key_2026',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 1 Day
      }
    })
  );

  // 3. Essential Request Middlewares
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 4. Optimized Static Assets Delivery with Client-Side Caching
  const publicPath = fs.existsSync(path.join(process.cwd(), 'public'))
    ? path.join(process.cwd(), 'public')
    : path.join(__dirname, '..', 'public');

  app.use(
    express.static(publicPath, {
      maxAge: process.env.NODE_ENV === 'production' ? '7d' : '1h',
      etag: true
    })
  );

  // 5. View Engine Setup (EJS) with robust path resolution for Vercel Serverless
  let viewsPath = path.join(process.cwd(), 'src', 'views');
  if (!fs.existsSync(viewsPath)) {
    if (fs.existsSync(path.join(process.cwd(), 'views'))) {
      viewsPath = path.join(process.cwd(), 'views');
    } else if (fs.existsSync(path.join(__dirname, 'views'))) {
      viewsPath = path.join(__dirname, 'views');
    } else if (fs.existsSync(path.join(__dirname, '..', 'src', 'views'))) {
      viewsPath = path.join(__dirname, '..', 'src', 'views');
    }
  }

  app.set('views', viewsPath);
  app.set('view engine', 'ejs');

  // 6. Mount Application Routes
  app.use('/', publicRoutes);
  app.use('/admin', adminRoutes);

  // 7. 404 Not Found Handler
  app.use((req: Request, res: Response) => {
    res.status(404).render('partials/404', {
      title: 'Halaman Tidak Ditemukan - SIMPEG Korwil Cibitung',
      page: '404',
      user: (req as any).session?.user || null
    });
  });

  return app;
}
