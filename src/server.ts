import http from 'http';
import dotenv from 'dotenv';
import { Server as SocketIOServer } from 'socket.io';
import { createApp } from './app';
import { initSmartSheetSocket } from './sockets/smartSheetSocket';

dotenv.config();

const DEFAULT_PORT = parseInt(process.env.PORT || '3000', 10);
const app = createApp();

if (process.env.NODE_ENV !== 'test') {
  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // Inisialisasi WebSocket khusus Smart Sheets
  initSmartSheetSocket(io);

  const startServer = (port: number) => {
    server.listen(port, () => {
      console.log(`=====================================================`);
      console.log(`🚀 SIMPEG Korwil Cibitung 2.0 Backend Berjalan`);
      console.log(`📍 URL: http://localhost:${port}`);
      console.log(`📊 Mode: Database Asli (SQLite / Prisma ORM)`);
      console.log(`⚡ WebSocket: Smart Sheet Realtime Aktif`);
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

