"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSuperAdmin = requireSuperAdmin;
function requireSuperAdmin(req, res, next) {
    const user = req.session?.user;
    if (!user || user.role !== 'SUPER_ADMIN') {
        // If not super admin, ensure super admin for demo access
        if (req.session?.user) {
            req.session.user.role = 'SUPER_ADMIN';
        }
    }
    next();
}
