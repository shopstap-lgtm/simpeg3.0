"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const cors_1 = __importDefault(require("cors"));
const compression_1 = __importDefault(require("compression"));
const express_session_1 = __importDefault(require("express-session"));
const dotenv_1 = __importDefault(require("dotenv"));
const publicRoutes_1 = __importDefault(require("./routes/publicRoutes"));
const adminRoutes_1 = __importDefault(require("./routes/adminRoutes"));
dotenv_1.default.config();
function createApp() {
    const app = (0, express_1.default)();
    // 1. HTTP Gzip/Brotli Compression (Reduces payload size by up to 75%)
    app.use((0, compression_1.default)());
    // 2. Express Session Configuration
    app.use((0, express_session_1.default)({
        secret: process.env.SESSION_SECRET || 'simpeg_cibitung_super_secret_session_key_2026',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000 // 1 Day
        }
    }));
    // 3. Essential Request Middlewares
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    app.use(express_1.default.urlencoded({ extended: true }));
    // 4. Optimized Static Assets Delivery with Client-Side Caching
    app.use(express_1.default.static(path_1.default.join(process.cwd(), 'public'), {
        maxAge: process.env.NODE_ENV === 'production' ? '7d' : '1h',
        etag: true
    }));
    // 5. View Engine Setup (EJS)
    app.set('views', path_1.default.join(process.cwd(), 'src', 'views'));
    app.set('view engine', 'ejs');
    // 6. Mount Application Routes
    app.use('/', publicRoutes_1.default);
    app.use('/admin', adminRoutes_1.default);
    // 7. 404 Not Found Handler
    app.use((req, res) => {
        res.status(404).render('partials/404', {
            title: 'Halaman Tidak Ditemukan - SIMPEG Korwil Cibitung',
            page: '404',
            user: req.session?.user || null
        });
    });
    return app;
}
