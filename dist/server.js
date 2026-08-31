"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const app_1 = require("./app");
dotenv_1.default.config();
const DEFAULT_PORT = parseInt(process.env.PORT || '3000', 10);
const app = (0, app_1.createApp)();
if (process.env.NODE_ENV !== 'test') {
    const startServer = (port) => {
        const server = app.listen(port, () => {
            console.log(`=====================================================`);
            console.log(`🚀 SIMPEG Korwil Cibitung 2.0 Backend Berjalan`);
            console.log(`📍 URL: http://localhost:${port}`);
            console.log(`📊 Mode: Database Asli (SQLite / Prisma ORM)`);
            console.log(`=====================================================`);
        });
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.warn(`⚠️ Port ${port} sedang digunakan, mencoba port ${port + 1}...`);
                startServer(port + 1);
            }
            else {
                console.error('Server error:', err);
            }
        });
    };
    startServer(DEFAULT_PORT);
}
