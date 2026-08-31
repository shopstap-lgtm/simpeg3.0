import dotenv from 'dotenv';
import { createApp } from './app';

dotenv.config();

const DEFAULT_PORT = parseInt(process.env.PORT || '3000', 10);
const app = createApp();

if (process.env.NODE_ENV !== 'test') {
  const startServer = (port: number) => {
    const server = app.listen(port, () => {
      console.log(`=====================================================`);
      console.log(`🚀 SIMPEG Korwil Cibitung 2.0 Backend Berjalan`);
      console.log(`📍 URL: http://localhost:${port}`);
      console.log(`📊 Mode: Database Asli (SQLite / Prisma ORM)`);
      console.log(`=====================================================`);
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`⚠️ Port ${port} sedang digunakan, mencoba port ${port + 1}...`);
        startServer(port + 1);
      } else {
        console.error('Server error:', err);
      }
    });
  };

  startServer(DEFAULT_PORT);
}
