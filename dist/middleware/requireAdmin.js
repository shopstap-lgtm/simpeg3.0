"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdmin = requireAdmin;
exports.requireSuperAdmin = requireSuperAdmin;
exports.requireSuperAdminOrDinas = requireSuperAdminOrDinas;
function requireAdmin(req, res, next) {
    const user = req.session?.user;
    if (!user) {
        if (req.session) {
            req.session.loginError = 'Silakan masuk terlebih dahulu untuk mengakses menu admin.';
        }
        return res.redirect('/admin/login');
    }
    next();
}
function requireSuperAdmin(req, res, next) {
    const user = req.session?.user;
    if (!user) {
        if (req.session) {
            req.session.loginError = 'Silakan masuk terlebih dahulu.';
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
function requireSuperAdminOrDinas(req, res, next) {
    const user = req.session?.user;
    if (!user) {
        if (req.session) {
            req.session.loginError = 'Silakan masuk terlebih dahulu.';
        }
        return res.redirect('/admin/login');
    }
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN_DINAS') {
        if (req.session) {
            req.session.toast = {
                type: 'danger',
                message: 'Akses Ditolak: Fitur Upload Rekap Absensi hanya dapat diakses oleh Super Admin dan Admin Dinas.'
            };
        }
        return res.redirect('/admin/klarifikasi');
    }
    next();
}
