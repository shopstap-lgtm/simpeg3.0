import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import prisma from '../../lib/prisma';

// Helper to generate URL-friendly slug
const generateSlug = (text: string) => {
  const base = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  const rand = Math.random().toString(36).substring(2, 6);
  return `${base || 'sheet'}-${rand}`;
};

export const sheetAdminController = {
  // 1. List all sheets
  list: async (req: Request, res: Response) => {
    try {
      const sheets = await prisma.dataSheet.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { rows: true }
          }
        }
      });

      const toast = (req as any).session?.toast || null;
      if ((req as any).session) {
        delete (req as any).session.toast;
      }

      res.render('admin/sheets/index', {
        title: 'Kelola Spreadsheet Dinamis - SIMPEG Cibitung',
        page: 'admin-sheets',
        user: (req as any).session?.user,
        sheets,
        toast
      });
    } catch (error) {
      console.error('[sheetAdminController.list] Error:', error);
      res.status(500).send('Terjadi kesalahan memuat daftar spreadsheet.');
    }
  },

  // 2. Render create sheet builder
  renderCreate: async (req: Request, res: Response) => {
    try {
      res.render('admin/sheets/builder', {
        title: 'Buat Spreadsheet Baru - SIMPEG Cibitung',
        page: 'admin-sheets',
        user: (req as any).session?.user,
        sheet: null,
        isEdit: false,
        toast: null
      });
    } catch (error) {
      console.error('[sheetAdminController.renderCreate] Error:', error);
      res.status(500).send('Internal Server Error');
    }
  },

  // 3. Process create sheet
  create: async (req: Request, res: Response) => {
    try {
      const {
        title,
        description,
        targetType,
        accessMode,
        status,
        allowBulkPaste,
        allowPublicExport,
        requirePin,
        columns: rawColumns,
        autoPrefill
      } = req.body;

      if (!title || !title.trim()) {
        if ((req as any).session) {
          (req as any).session.toast = { type: 'error', message: 'Judul spreadsheet wajib diisi.' };
        }
        return res.redirect('/admin/sheets/create');
      }

      let parsedColumns: any[] = [];
      try {
        parsedColumns = typeof rawColumns === 'string' ? JSON.parse(rawColumns) : rawColumns;
      } catch (err) {
        parsedColumns = [];
      }

      if (!Array.isArray(parsedColumns) || parsedColumns.length === 0) {
        if ((req as any).session) {
          (req as any).session.toast = { type: 'error', message: 'Minimal harus ada 1 kolom pada spreadsheet.' };
        }
        return res.redirect('/admin/sheets/create');
      }

      // Sanitize columns
      const sanitizedColumns = parsedColumns.map((col: any, index: number) => ({
        key: col.key || `col_${Date.now()}_${index}`,
        label: col.label?.trim() || `Kolom ${index + 1}`,
        type: ['text', 'number', 'select', 'date', 'checkbox', 'currency', 'textarea'].includes(col.type) ? col.type : 'text',
        options: Array.isArray(col.options) ? col.options.filter(Boolean) : (typeof col.options === 'string' ? col.options.split(',').map((s: string) => s.trim()).filter(Boolean) : []),
        required: !!col.required,
        hidden: !!col.hidden,
        placeholder: col.placeholder?.trim() || '',
        width: col.width ? parseInt(col.width, 10) : 170
      }));

      const slug = generateSlug(title);
      const isAutoPrefill = autoPrefill === 'true' || autoPrefill === true || autoPrefill === 'on';

      const sheet = await prisma.dataSheet.create({
        data: {
          slug,
          title: title.trim(),
          description: description?.trim() || null,
          targetType: ['UNIT', 'PEGAWAI', 'CUSTOM'].includes(targetType) ? targetType : 'CUSTOM',
          accessMode: ['PUBLIC_VIEW', 'PROTECTED_NIP', 'OPEN_EDIT'].includes(accessMode) ? accessMode : 'PUBLIC_VIEW',
          status: ['ACTIVE', 'CLOSED', 'DRAFT'].includes(status) ? status : 'ACTIVE',
          columns: sanitizedColumns,
          allowBulkPaste: allowBulkPaste === 'true' || allowBulkPaste === true || allowBulkPaste === 'on',
          allowPublicExport: allowPublicExport === 'true' || allowPublicExport === true || allowPublicExport === 'on',
          requirePin: requirePin === 'true' || requirePin === true || requirePin === 'on',
          createdBy: (req as any).session?.user?.namaLengkap || 'Administrator'
        }
      });

      // Auto-prefill rows if requested
      if (isAutoPrefill) {
        if (sheet.targetType === 'UNIT') {
          const units = await prisma.unit.findMany({
            orderBy: { namaUnit: 'asc' }
          });
          const rowsData = units.map((u: any, idx: number) => ({
            sheetId: sheet.id,
            rowIndex: idx + 1,
            entityType: 'UNIT',
            entityId: u.id,
            identifier: u.namaUnit,
            label: u.namaUnit,
            subLabel: `${u.jenjang || 'SD'} - ${u.kategori || 'NEGERI'}`,
            data: {
              namaUnit: u.namaUnit,
              jenjang: u.jenjang || 'SD',
              kategori: u.kategori || 'NEGERI',
              kepalaSekolah: u.kepalaSekolah || '',
              kontakKepalaSekolah: u.kontakKepalaSekolah || '',
              operatorSekolah: u.operatorSekolah || '',
              kontakOperator: u.kontakOperator || ''
            }
          }));
          if (rowsData.length > 0) {
            await prisma.dataSheetRow.createMany({ data: rowsData });
          }
        } else if (sheet.targetType === 'PEGAWAI') {
          const employees = await prisma.employee.findMany({
            where: { aktif: true },
            orderBy: { nama: 'asc' },
            include: { unit: true }
          });
          const rowsData = employees.map((emp: any, idx: number) => ({
            sheetId: sheet.id,
            rowIndex: idx + 1,
            entityType: 'PEGAWAI',
            entityId: emp.id,
            identifier: emp.nip,
            label: emp.nama,
            subLabel: `${emp.unit?.namaUnit || '-'} | ${emp.jabatan || '-'}`,
            data: {
              nip: emp.nip,
              nama: emp.nama,
              unitKerja: emp.unit?.namaUnit || '-',
              jabatan: emp.jabatan || '-',
              statusKepegawaian: emp.statusKepegawaian || 'PNS',
              nik: emp.nik || '',
              noHp: emp.noHp || '',
              npwp: emp.npwp || ''
            }
          }));
          if (rowsData.length > 0) {
            await prisma.dataSheetRow.createMany({ data: rowsData });
          }
        } else {
          // Custom: Create 5 initial blank rows
          const rowsData = Array.from({ length: 5 }).map((_, idx) => ({
            sheetId: sheet.id,
            rowIndex: idx + 1,
            entityType: 'CUSTOM',
            identifier: null,
            label: null,
            subLabel: null,
            data: {}
          }));
          await prisma.dataSheetRow.createMany({ data: rowsData });
        }
      }

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Spreadsheet '${sheet.title}' berhasil dibuat!`
        };
      }

      res.redirect(`/admin/sheets/${sheet.id}/manage`);
    } catch (error: any) {
      console.error('[sheetAdminController.create] Error:', error);
      if ((req as any).session) {
        (req as any).session.toast = { type: 'error', message: 'Gagal membuat spreadsheet: ' + error.message };
      }
      res.redirect('/admin/sheets/create');
    }
  },

  // 4. Render edit sheet
  renderEdit: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const sheet = await prisma.dataSheet.findUnique({
        where: { id },
        include: {
          _count: { select: { rows: true } }
        }
      });

      if (!sheet) {
        return res.status(404).send('Spreadsheet tidak ditemukan.');
      }

      res.render('admin/sheets/builder', {
        title: `Edit: ${sheet.title} - SIMPEG Cibitung`,
        page: 'admin-sheets',
        user: (req as any).session?.user,
        sheet,
        isEdit: true,
        toast: null
      });
    } catch (error) {
      console.error('[sheetAdminController.renderEdit] Error:', error);
      res.status(500).send('Internal Server Error');
    }
  },

  // 5. Process update sheet
  update: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const {
        title,
        description,
        targetType,
        accessMode,
        status,
        allowBulkPaste,
        allowPublicExport,
        requirePin,
        columns: rawColumns
      } = req.body;

      let parsedColumns: any[] = [];
      try {
        parsedColumns = typeof rawColumns === 'string' ? JSON.parse(rawColumns) : rawColumns;
      } catch (err) {
        parsedColumns = [];
      }

      if (!Array.isArray(parsedColumns) || parsedColumns.length === 0) {
        if ((req as any).session) {
          (req as any).session.toast = { type: 'error', message: 'Minimal harus ada 1 kolom pada spreadsheet.' };
        }
        return res.redirect(`/admin/sheets/${id}/edit`);
      }

      const sanitizedColumns = parsedColumns.map((col: any, index: number) => ({
        key: col.key || `col_${Date.now()}_${index}`,
        label: col.label?.trim() || `Kolom ${index + 1}`,
        type: ['text', 'number', 'select', 'date', 'checkbox', 'currency', 'textarea'].includes(col.type) ? col.type : 'text',
        options: Array.isArray(col.options) ? col.options.filter(Boolean) : (typeof col.options === 'string' ? col.options.split(',').map((s: string) => s.trim()).filter(Boolean) : []),
        required: !!col.required,
        hidden: !!col.hidden,
        placeholder: col.placeholder?.trim() || '',
        width: col.width ? parseInt(col.width, 10) : 170
      }));

      await prisma.dataSheet.update({
        where: { id },
        data: {
          title: title.trim(),
          description: description?.trim() || null,
          targetType: ['UNIT', 'PEGAWAI', 'CUSTOM'].includes(targetType) ? targetType : 'CUSTOM',
          accessMode: ['PUBLIC_VIEW', 'PROTECTED_NIP', 'OPEN_EDIT'].includes(accessMode) ? accessMode : 'PUBLIC_VIEW',
          status: ['ACTIVE', 'CLOSED', 'DRAFT'].includes(status) ? status : 'ACTIVE',
          columns: sanitizedColumns,
          allowBulkPaste: allowBulkPaste === 'true' || allowBulkPaste === true || allowBulkPaste === 'on',
          allowPublicExport: allowPublicExport === 'true' || allowPublicExport === true || allowPublicExport === 'on',
          requirePin: requirePin === 'true' || requirePin === true || requirePin === 'on'
        }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: 'Pengaturan spreadsheet berhasil diperbarui!'
        };
      }

      res.redirect(`/admin/sheets/${id}/manage`);
    } catch (error: any) {
      console.error('[sheetAdminController.update] Error:', error);
      if ((req as any).session) {
        (req as any).session.toast = { type: 'error', message: 'Gagal memperbarui spreadsheet: ' + error.message };
      }
      res.redirect(`/admin/sheets/${req.params.id}/edit`);
    }
  },

  // 6. Manage Grid view for admin
  manage: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const sheet = await prisma.dataSheet.findUnique({
        where: { id },
        include: {
          rows: {
            orderBy: { rowIndex: 'asc' }
          }
        }
      });

      if (!sheet) {
        return res.status(404).send('Spreadsheet tidak ditemukan.');
      }

      const toast = (req as any).session?.toast || null;
      if ((req as any).session) {
        delete (req as any).session.toast;
      }

      // Calculate progress stats
      const totalRows = sheet.rows.length;
      const cols = (sheet.columns as any[]) || [];
      let filledRowsCount = 0;

      for (const r of sheet.rows) {
        const rowData = (r.data as Record<string, any>) || {};
        const hasValues = cols.some(c => rowData[c.key] !== undefined && rowData[c.key] !== '' && rowData[c.key] !== null);
        if (hasValues) filledRowsCount++;
      }

      const fillPercentage = totalRows > 0 ? Math.round((filledRowsCount / totalRows) * 100) : 0;

      res.render('admin/sheets/manage', {
        title: `Kelola Sheet: ${sheet.title} - SIMPEG Cibitung`,
        page: 'admin-sheets',
        user: (req as any).session?.user,
        sheet,
        columns: cols,
        rows: sheet.rows,
        stats: {
          totalRows,
          filledRowsCount,
          emptyRowsCount: totalRows - filledRowsCount,
          fillPercentage
        },
        toast
      });
    } catch (error) {
      console.error('[sheetAdminController.manage] Error:', error);
      res.status(500).send('Terjadi kesalahan memuat grid spreadsheet.');
    }
  },

  // 7. Save single row data (AJAX)
  saveRow: async (req: Request, res: Response) => {
    try {
      const { id, rowId } = req.params;
      const { data, label, identifier, subLabel } = req.body;

      const updatePayload: any = {
        lastUpdatedAt: new Date(),
        lastUpdatedBy: (req as any).session?.user?.namaLengkap || 'Admin'
      };

      if (data !== undefined) updatePayload.data = typeof data === 'string' ? JSON.parse(data) : data;
      if (label !== undefined) updatePayload.label = label;
      if (identifier !== undefined) updatePayload.identifier = identifier;
      if (subLabel !== undefined) updatePayload.subLabel = subLabel;

      const updated = await prisma.dataSheetRow.update({
        where: { id: rowId },
        data: updatePayload
      });

      return res.json({ success: true, message: 'Baris berhasil disimpan', row: updated });
    } catch (error: any) {
      console.error('[sheetAdminController.saveRow] Error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Gagal menyimpan baris' });
    }
  },

  // 8. Add new row (AJAX)
  addRow: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { label, identifier, subLabel, data } = req.body;

      const maxRow = await prisma.dataSheetRow.findFirst({
        where: { sheetId: id },
        orderBy: { rowIndex: 'desc' },
        select: { rowIndex: true }
      });
      const nextIndex = (maxRow?.rowIndex || 0) + 1;

      const newRow = await prisma.dataSheetRow.create({
        data: {
          sheetId: id,
          rowIndex: nextIndex,
          entityType: 'CUSTOM',
          identifier: identifier?.trim() || null,
          label: label?.trim() || null,
          subLabel: subLabel?.trim() || null,
          data: data ? (typeof data === 'string' ? JSON.parse(data) : data) : {},
          lastUpdatedBy: (req as any).session?.user?.namaLengkap || 'Admin'
        }
      });

      return res.json({ success: true, message: 'Baris baru berhasil ditambahkan', row: newRow });
    } catch (error: any) {
      console.error('[sheetAdminController.addRow] Error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Gagal menambah baris' });
    }
  },

  // 9. Delete row (AJAX)
  deleteRow: async (req: Request, res: Response) => {
    try {
      const { id, rowId } = req.params;
      await prisma.dataSheetRow.delete({
        where: { id: rowId }
      });
      return res.json({ success: true, message: 'Baris berhasil dihapus' });
    } catch (error: any) {
      console.error('[sheetAdminController.deleteRow] Error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Gagal menghapus baris' });
    }
  },

  // 10. Bulk save (for paste from Excel & batch updates)
  bulkSave: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { rows } = req.body; // Array of { id?: string, rowIndex?: number, identifier?: string, label?: string, subLabel?: string, data: object }

      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Data baris tidak valid.' });
      }

      const updatedBy = (req as any).session?.user?.namaLengkap || 'Admin';

      await prisma.$transaction(async (tx) => {
        for (const item of rows) {
          if (item.id) {
            // Update existing row
            await tx.dataSheetRow.update({
              where: { id: item.id },
              data: {
                data: item.data || {},
                label: item.label !== undefined ? item.label : undefined,
                identifier: item.identifier !== undefined ? item.identifier : undefined,
                subLabel: item.subLabel !== undefined ? item.subLabel : undefined,
                lastUpdatedAt: new Date(),
                lastUpdatedBy: updatedBy
              }
            });
          } else {
            // Insert new row
            const nextIndex = item.rowIndex || Date.now();
            await tx.dataSheetRow.create({
              data: {
                sheetId: id,
                rowIndex: nextIndex,
                entityType: 'CUSTOM',
                identifier: item.identifier || null,
                label: item.label || null,
                subLabel: item.subLabel || null,
                data: item.data || {},
                lastUpdatedBy: updatedBy
              }
            });
          }
        }
      });

      return res.json({ success: true, message: `${rows.length} baris data berhasil disimpan massal!` });
    } catch (error: any) {
      console.error('[sheetAdminController.bulkSave] Error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Gagal menyimpan data massal' });
    }
  },

  // 11. Export Excel (.xlsx)
  exportXlsx: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const sheet = await prisma.dataSheet.findUnique({
        where: { id },
        include: {
          rows: { orderBy: { rowIndex: 'asc' } }
        }
      });

      if (!sheet) {
        return res.status(404).send('Spreadsheet tidak ditemukan.');
      }

      const columns = (sheet.columns as any[]) || [];
      const excelRows: any[] = [];

      sheet.rows.forEach((r, idx) => {
        const rowData = (r.data as Record<string, any>) || {};
        const entry: Record<string, any> = {
          'No': idx + 1
        };

        if (sheet.targetType === 'UNIT') {
          entry['Nama Unit / Sekolah'] = r.label || '-';
          entry['NPSN / Kode'] = r.identifier || '-';
        } else if (sheet.targetType === 'PEGAWAI') {
          entry['NIP'] = r.identifier || '-';
          entry['Nama Pegawai'] = r.label || '-';
          entry['Unit Kerja'] = r.subLabel || '-';
        } else {
          if (r.label || r.identifier) {
            entry['Identitas / Nama'] = r.label || r.identifier || '-';
          }
        }

        // Dynamic columns
        columns.forEach(c => {
          const val = rowData[c.key];
          if (c.type === 'checkbox') {
            entry[c.label] = val === true || val === 'true' ? 'YA' : 'TIDAK';
          } else {
            entry[c.label] = val !== undefined && val !== null ? val : '';
          }
        });

        entry['Terakhir Diperbarui'] = r.lastUpdatedAt ? new Date(r.lastUpdatedAt).toLocaleString('id-ID') : '-';
        excelRows.push(entry);
      });

      const worksheet = XLSX.utils.json_to_sheet(excelRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Rekap');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      const safeTitle = (sheet.title || 'Spreadsheet').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Rekap_${safeTitle}_${new Date().toISOString().slice(0, 10)}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buffer);
    } catch (error: any) {
      console.error('[sheetAdminController.exportXlsx] Error:', error);
      res.status(500).send('Gagal mengekspor data ke file Excel.');
    }
  },

  // 12. Toggle Status (ACTIVE / CLOSED)
  toggleStatus: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const current = await prisma.dataSheet.findUnique({ where: { id }, select: { status: true, title: true } });
      if (!current) return res.status(404).send('Spreadsheet tidak ditemukan.');

      const newStatus = current.status === 'ACTIVE' ? 'CLOSED' : 'ACTIVE';
      await prisma.dataSheet.update({
        where: { id },
        data: { status: newStatus }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Status spreadsheet '${current.title}' diubah menjadi: ${newStatus === 'ACTIVE' ? 'DIBUKA (AKTIF)' : 'DITUTUP'}`
        };
      }
      res.redirect('/admin/sheets');
    } catch (error) {
      console.error('[sheetAdminController.toggleStatus] Error:', error);
      res.redirect('/admin/sheets');
    }
  },

  // 13. Delete sheet
  deleteSheet: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deleted = await prisma.dataSheet.delete({
        where: { id }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Spreadsheet '${deleted.title}' berhasil dihapus beserta seluruh datanya.`
        };
      }
      res.redirect('/admin/sheets');
    } catch (error) {
      console.error('[sheetAdminController.deleteSheet] Error:', error);
      res.redirect('/admin/sheets');
    }
  },

  // 14. Add Column Directly from Spreadsheet
  addColumn: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { label, type, options, placeholder, required, width } = req.body;

      const sheet = await prisma.dataSheet.findUnique({ where: { id } });
      if (!sheet) return res.status(404).json({ success: false, message: 'Spreadsheet tidak ditemukan' });

      const cols = Array.isArray(sheet.columns) ? [...sheet.columns] : [];
      const newKey = `col_${Date.now()}_${cols.length + 1}`;
      const newCol = {
        key: newKey,
        label: label?.trim() || `Kolom ${cols.length + 1}`,
        type: ['text', 'number', 'select', 'date', 'checkbox', 'currency', 'textarea'].includes(type) ? type : 'text',
        options: Array.isArray(options) ? options.filter(Boolean) : (typeof options === 'string' ? options.split(',').map((s: string) => s.trim()).filter(Boolean) : []),
        placeholder: placeholder?.trim() || '',
        required: !!required,
        width: width ? parseInt(width, 10) : 170
      };

      cols.push(newCol);
      await prisma.dataSheet.update({
        where: { id },
        data: { columns: cols }
      });

      res.json({ success: true, column: newCol, columns: cols });
    } catch (error) {
      console.error('[sheetAdminController.addColumn] Error:', error);
      res.status(500).json({ success: false, message: 'Gagal menambah kolom' });
    }
  },

  // 15. Delete Column Directly from Spreadsheet
  deleteColumn: async (req: Request, res: Response) => {
    try {
      const { id, colKey } = req.params;
      const sheet = await prisma.dataSheet.findUnique({ where: { id } });
      if (!sheet) return res.status(404).json({ success: false, message: 'Spreadsheet tidak ditemukan' });

      let cols = Array.isArray(sheet.columns) ? [...sheet.columns] : [];
      if (cols.length <= 1) {
        return res.status(400).json({ success: false, message: 'Minimal harus ada 1 kolom pada spreadsheet.' });
      }

      cols = cols.filter((c: any) => c.key !== colKey);

      await prisma.dataSheet.update({
        where: { id },
        data: { columns: cols }
      });

      res.json({ success: true, columns: cols });
    } catch (error) {
      console.error('[sheetAdminController.deleteColumn] Error:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus kolom' });
    }
  },

  // 16. Update Columns Order / Metadata
  updateColumns: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { columns } = req.body;

      if (!Array.isArray(columns) || columns.length === 0) {
        return res.status(400).json({ success: false, message: 'Daftar kolom tidak valid' });
      }

      await prisma.dataSheet.update({
        where: { id },
        data: { columns }
      });

      res.json({ success: true, columns });
    } catch (error) {
      console.error('[sheetAdminController.updateColumns] Error:', error);
      res.status(500).json({ success: false, message: 'Gagal memperbarui kolom' });
    }
  },

  // 17. Update Column Visibility for Public View (Save hidden/visible state)
  updateColumnsVisibility: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { hiddenKeys } = req.body;

      const sheet = await prisma.dataSheet.findUnique({ where: { id } });
      if (!sheet) return res.status(404).json({ success: false, message: 'Spreadsheet tidak ditemukan' });

      const cols = Array.isArray(sheet.columns) ? [...sheet.columns] : [];
      const hiddenSet = new Set(Array.isArray(hiddenKeys) ? hiddenKeys : []);

      const updatedCols = cols.map((col: any) => ({
        ...col,
        hidden: hiddenSet.has(col.key)
      }));

      await prisma.dataSheet.update({
        where: { id },
        data: { columns: updatedCols }
      });

      res.json({ success: true, columns: updatedCols });
    } catch (error) {
      console.error('[sheetAdminController.updateColumnsVisibility] Error:', error);
      res.status(500).json({ success: false, message: 'Gagal memperbarui visibilitas kolom' });
    }
  }
};
