"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authController = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = __importDefault(require("../../lib/prisma"));
exports.authController = {
    showLogin: (req, res) => {
        const user = req.session?.user;
        if (user) {
            return res.redirect('/admin/klarifikasi');
        }
        const error = req.session?.loginError || null;
        if (req.session) {
            delete req.session.loginError;
        }
        res.render('admin/login', {
            title: 'Masuk Admin Portal - SIMPEG Korwil Cibitung',
            page: 'admin-login',
            error
        });
    },
    login: async (req, res) => {
        try {
            const { username, email, password } = req.body;
            const userIdentifier = (username || email || '').trim();
            if (!userIdentifier || !password) {
                if (req.session) {
                    req.session.loginError = 'Username dan kata sandi wajib diisi.';
                }
                return res.redirect('/admin/login');
            }
            const admin = await prisma_1.default.adminUser.findFirst({
                where: {
                    OR: [
                        { username: userIdentifier },
                        { email: userIdentifier }
                    ]
                }
            });
            if (!admin) {
                if (req.session) {
                    req.session.loginError = 'Username atau kata sandi tidak valid.';
                }
                return res.redirect('/admin/login');
            }
            if (!admin.isActive) {
                if (req.session) {
                    req.session.loginError = 'Akun Anda dinonaktifkan oleh Super Admin. Silakan hubungi koordinator.';
                }
                return res.redirect('/admin/login');
            }
            const isPasswordValid = await bcryptjs_1.default.compare(password, admin.passwordHash);
            if (!isPasswordValid) {
                if (req.session) {
                    req.session.loginError = 'Username atau kata sandi tidak valid.';
                }
                return res.redirect('/admin/login');
            }
            // Update last login timestamp
            await prisma_1.default.adminUser.update({
                where: { id: admin.id },
                data: { lastLogin: new Date().toISOString().replace('T', ' ').substring(0, 16) }
            });
            if (req.session) {
                req.session.user = {
                    id: admin.id,
                    username: admin.username,
                    email: admin.email,
                    namaLengkap: admin.namaLengkap,
                    role: admin.role
                };
                req.session.toast = {
                    type: 'success',
                    message: `Selamat datang kembali, ${admin.namaLengkap}!`
                };
            }
            res.redirect('/admin/klarifikasi');
        }
        catch (error) {
            console.error('Login error:', error);
            if (req.session) {
                req.session.loginError = 'Terjadi kesalahan sistem saat proses login.';
            }
            res.redirect('/admin/login');
        }
    },
    logout: (req, res) => {
        if (req.session) {
            delete req.session.user;
        }
        res.redirect('/admin/login');
    }
};
