"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.employeeController = void 0;
const employeeImportService_1 = require("../../services/employeeImportService");
exports.employeeController = {
    // Download clean Excel template with sample data
    downloadTemplate: (req, res) => {
        try {
            const buffer = (0, employeeImportService_1.generateEmployeeExcelTemplate)();
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="Template_Import_Pegawai_SIMPEG_Cibitung.xlsx"');
            res.send(buffer);
        }
        catch (error) {
            console.error('Error generating employee template:', error);
            res.status(500).send('Gagal mengunduh template Excel.');
        }
    },
    // Process uploaded Excel / CSV file
    importExcel: async (req, res) => {
        try {
            const file = req.file;
            const redirectUrl = req.body.redirectUrl || '/admin/users';
            if (!file || !file.buffer) {
                if (req.session) {
                    req.session.toast = {
                        type: 'warning',
                        message: 'Silakan pilih file Excel (.xlsx / .xls / .csv) terlebih dahulu.'
                    };
                }
                return res.redirect(redirectUrl);
            }
            const result = await (0, employeeImportService_1.importEmployeesFromExcel)(file.buffer);
            if (result.success && result.totalProcessed > 0) {
                if (req.session) {
                    req.session.toast = {
                        type: 'success',
                        message: `Import Berhasil! ${result.totalProcessed} data pegawai diproses (${result.totalCreated} baru, ${result.totalUpdated} diperbarui).`
                    };
                }
            }
            else if (result.errors.length > 0) {
                if (req.session) {
                    req.session.toast = {
                        type: 'warning',
                        message: `Import selesai dengan catatan: ${result.errors[0]}`
                    };
                }
            }
            else {
                if (req.session) {
                    req.session.toast = {
                        type: 'warning',
                        message: 'Tidak ada data pegawai yang valid untuk diimpor.'
                    };
                }
            }
            res.redirect(redirectUrl);
        }
        catch (error) {
            console.error('Error importing employee Excel:', error);
            if (req.session) {
                req.session.toast = {
                    type: 'danger',
                    message: `Gagal memproses import data pegawai: ${error.message}`
                };
            }
            res.redirect('/admin/users');
        }
    }
};
