import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
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

function generateRenamedFilename(
  originalFilename: string,
  pattern: string | undefined,
  meta: { nip?: string | null; nama?: string | null; unitNama?: string | null }
): { physicalName: string; displayName: string } {
  const ext = path.extname(originalFilename);
  const baseName = path.basename(originalFilename, ext);

  if (!pattern || !pattern.trim()) {
    const safeBase = baseName.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 50) || 'BERKAS';
    const physical = `${Date.now()}_${safeBase}${ext}`;
    return { physicalName: physical, displayName: originalFilename };
  }

  const cleanNip = (meta.nip || 'NONIP').replace(/[^0-9]/g, '') || 'NONIP';
  const cleanNama = (meta.nama || 'ANONIM').toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_') || 'ANONIM';
  const cleanUnit = (meta.unitNama || 'NOUNIT').toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_') || 'NOUNIT';
  const dateStr = new Date().toISOString().split('T')[0];
  const cleanBaseName = baseName.replace(/[^a-zA-Z0-9-_]/g, '_') || 'BERKAS';

  let result = pattern
    .replace(/\{NIP\}/gi, cleanNip)
    .replace(/\{NAMA\}/gi, cleanNama)
    .replace(/\{SEKOLAH\}/gi, cleanUnit)
    .replace(/\{UNIT\}/gi, cleanUnit)
    .replace(/\{TANGGAL\}/gi, dateStr)
    .replace(/\{NAMA_FILE\}/gi, cleanBaseName);

  result = result.replace(/[^a-zA-Z0-9-_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!result) result = `BERKAS_${Date.now()}`;

  const displayName = `${result}${ext}`;
  const physicalName = `${Date.now()}_${result}${ext}`;

  return { physicalName, displayName };
}

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
        type: ['text', 'number', 'select', 'date', 'checkbox', 'currency', 'textarea', 'file'].includes(col.type) ? col.type : 'text',
        options: Array.isArray(col.options) ? col.options.filter(Boolean) : (typeof col.options === 'string' ? col.options.split(',').map((s: string) => s.trim()).filter(Boolean) : []),
        allowedExtensions: col.allowedExtensions ? String(col.allowedExtensions).trim() : (col.type === 'file' ? '.pdf,.jpg,.jpeg,.png' : undefined),
        maxFileSizeMb: col.maxFileSizeMb ? parseInt(col.maxFileSizeMb, 10) : (col.type === 'file' ? 10 : undefined),
        required: !!col.required,
        hidden: !!col.hidden,
        isProtected: !!col.isProtected,
        filterable: col.filterable !== undefined ? !!col.filterable : true,
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
        type: ['text', 'number', 'select', 'date', 'checkbox', 'currency', 'textarea', 'file'].includes(col.type) ? col.type : 'text',
        options: Array.isArray(col.options) ? col.options.filter(Boolean) : (typeof col.options === 'string' ? col.options.split(',').map((s: string) => s.trim()).filter(Boolean) : []),
        allowedExtensions: col.allowedExtensions ? String(col.allowedExtensions).trim() : (col.type === 'file' ? '.pdf,.jpg,.jpeg,.png' : undefined),
        maxFileSizeMb: col.maxFileSizeMb ? parseInt(col.maxFileSizeMb, 10) : (col.type === 'file' ? 10 : undefined),
        required: !!col.required,
        hidden: !!col.hidden,
        isProtected: !!col.isProtected,
        filterable: col.filterable !== undefined ? !!col.filterable : true,
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

        // 1. Resolve identity values from rowData or fallback to row columns
        const resolvedNip = (rowData.nip && String(rowData.nip).trim() !== '' && String(rowData.nip).trim() !== '-')
          ? String(rowData.nip).trim()
          : (r.identifier ? String(r.identifier).trim() : '-');

        const resolvedNama = (rowData.nama && String(rowData.nama).trim() !== '')
          ? String(rowData.nama).trim()
          : (r.label ? String(r.label).trim() : '-');

        const resolvedUnit = (rowData.unitKerja && String(rowData.unitKerja).trim() !== '')
          ? String(rowData.unitKerja).trim()
          : (r.subLabel ? String(r.subLabel).trim() : '-');

        // Check which identity columns are already present in dynamic columns
        const hasNipInCols = columns.some((c: any) => c.key === 'nip' || c.key === 'identifier' || (c.label || '').trim().toUpperCase() === 'NIP');
        const hasNamaInCols = columns.some((c: any) => c.key === 'nama' || c.key === 'label' || (c.label || '').toLowerCase().includes('nama'));
        const hasUnitInCols = columns.some((c: any) => c.key === 'unitKerja' || c.key === 'subLabel' || (c.label || '').toLowerCase().includes('unit'));

        if (sheet.targetType === 'UNIT') {
          if (!hasNamaInCols) entry['Nama Unit / Sekolah'] = resolvedNama;
          if (!hasNipInCols) entry['NPSN / Kode'] = resolvedNip;
        } else if (sheet.targetType === 'PEGAWAI') {
          if (!hasNipInCols) entry['NIP'] = resolvedNip;
          if (!hasNamaInCols) entry['Nama Pegawai'] = resolvedNama;
          if (!hasUnitInCols) entry['Unit Kerja'] = resolvedUnit;
        } else {
          if (!hasNamaInCols && !hasNipInCols) {
            entry['Identitas / Nama'] = resolvedNama !== '-' ? resolvedNama : resolvedNip;
          }
        }

        // Dynamic columns
        columns.forEach(c => {
          let val = rowData[c.key];

          // Automatic fallback if rowData has not synced identity keys
          const isValEmpty = val === undefined || val === null || String(val).trim() === '' || String(val).trim() === '-';
          if (isValEmpty) {
            if (c.key === 'nip' || c.key === 'identifier' || (c.label || '').trim().toUpperCase() === 'NIP') {
              val = resolvedNip;
            } else if (c.key === 'nama' || c.key === 'label' || (c.label || '').toLowerCase().includes('nama')) {
              val = resolvedNama;
            } else if (c.key === 'unitKerja' || c.key === 'subLabel') {
              val = resolvedUnit;
            }
          }

          if (c.type === 'checkbox') {
            entry[c.label] = val === true || val === 'true' ? 'YA' : 'TIDAK';
          } else if (c.type === 'file') {
            const fileUrl = typeof val === 'object' && val !== null ? val.url : (typeof val === 'string' ? val : '');
            if (fileUrl) {
              const fullUrl = fileUrl.startsWith('http') ? fileUrl : `${req.protocol}://${req.get('host')}${fileUrl}`;
              entry[c.label] = fullUrl;
            } else {
              entry[c.label] = '-';
            }
          } else {
            entry[c.label] = val !== undefined && val !== null ? String(val) : '';
          }
        });

        entry['Terakhir Diperbarui'] = r.lastUpdatedAt ? new Date(r.lastUpdatedAt).toLocaleString('id-ID') : '-';
        excelRows.push(entry);
      });

      const worksheet = XLSX.utils.json_to_sheet(excelRows);

      // Ensure long digit strings (NIP, NIK, NPSN) are explicitly treated as string in Excel
      if (worksheet['!ref']) {
        const range = XLSX.utils.decode_range(worksheet['!ref']);
        for (let R = range.s.r; R <= range.e.r; ++R) {
          for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = worksheet[cellRef];
            if (cell && cell.v !== undefined && cell.v !== null) {
              const strVal = String(cell.v).trim();
              if (/^\d{8,}$/.test(strVal)) {
                cell.t = 's';
                cell.v = strVal;
                cell.z = '@';
              }
            }
          }
        }
      }
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
      return res.redirect(req.headers.referer || '/admin/sheets');
    } catch (error) {
      console.error('[sheetAdminController.toggleStatus] Error:', error);
      return res.redirect(req.headers.referer || '/admin/sheets');
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
        type: ['text', 'number', 'select', 'date', 'checkbox', 'currency', 'textarea', 'file'].includes(type) ? type : 'text',
        options: Array.isArray(options) ? options.filter(Boolean) : (typeof options === 'string' ? options.split(',').map((s: string) => s.trim()).filter(Boolean) : []),
        allowedExtensions: req.body.allowedExtensions ? String(req.body.allowedExtensions).trim() : (type === 'file' ? '.pdf,.jpg,.jpeg,.png' : undefined),
        maxFileSizeMb: req.body.maxFileSizeMb ? parseInt(req.body.maxFileSizeMb, 10) : (type === 'file' ? 10 : undefined),
        renamePattern: req.body.renamePattern ? String(req.body.renamePattern).trim() : (type === 'file' ? '{NIP}_{NAMA}_{NAMA_FILE}' : undefined),
        placeholder: placeholder?.trim() || '',
        required: !!required,
        hidden: false,
        isProtected: !!req.body.isProtected,
        filterable: req.body.filterable !== undefined ? !!req.body.filterable : true,
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

      const sanitizedCols = columns.map((col: any) => ({
        ...col,
        hidden: !!col.hidden,
        isProtected: !!col.isProtected,
        filterable: col.filterable !== undefined ? !!col.filterable : true
      }));

      await prisma.dataSheet.update({
        where: { id },
        data: { columns: sanitizedCols }
      });

      res.json({ success: true, columns: sanitizedCols });
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

      let cols: any[] = Array.isArray(sheet.columns) ? [...(sheet.columns as any[])] : [];
      const hiddenSet = new Set(Array.isArray(hiddenKeys) ? hiddenKeys : []);

      // 1. Update hidden flag on regular custom columns
      cols = cols.map((col: any) => ({
        ...col,
        hidden: hiddenSet.has(col.key)
      }));

      // 2. Track identity fallback columns visibility in sheet.columns
      const identityDefinitions = [
        {
          key: 'identifier',
          label: sheet.targetType === 'PEGAWAI' ? 'NIP' : 'Kode Unit Kerja',
          type: 'text',
          aliases: ['identifier', 'nip']
        },
        {
          key: 'label',
          label: sheet.targetType === 'UNIT' ? 'Nama Unit Sekolah' : (sheet.targetType === 'PEGAWAI' ? 'Nama Pegawai' : 'Nama Lengkap'),
          type: 'text',
          aliases: ['label', 'nama']
        },
        {
          key: 'subLabel',
          label: sheet.targetType === 'PEGAWAI' ? 'Unit / Jabatan' : 'Status Unit (SD/Swasta)',
          type: 'text',
          aliases: ['subLabel', 'unitKerja', 'jabatan', 'kategori']
        }
      ];

      for (const ident of identityDefinitions) {
        const isHiddenInRequest = ident.aliases.some(a => hiddenSet.has(a));
        const existingIdx = cols.findIndex((c: any) => ident.aliases.includes(c.key));

        if (isHiddenInRequest) {
          if (existingIdx >= 0) {
            (cols[existingIdx] as any).hidden = true;
          } else {
            cols.push({
              key: ident.key,
              label: ident.label,
              type: ident.type,
              isProtected: true,
              hidden: true,
              isIdentity: true
            });
          }
        } else {
          if (existingIdx >= 0 && (cols[existingIdx] as any).isIdentity) {
            (cols[existingIdx] as any).hidden = false;
          }
        }
      }

      await prisma.dataSheet.update({
        where: { id },
        data: { columns: cols }
      });

      res.json({ success: true, columns: cols });
    } catch (error) {
      console.error('[sheetAdminController.updateColumnsVisibility] Error:', error);
      res.status(500).json({ success: false, message: 'Gagal memperbarui visibilitas kolom' });
    }
  },

  // 18. Upload Cell File (Admin)
  uploadCellFile: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { rowId, colKey } = req.body;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ success: false, message: 'Tidak ada berkas yang diunggah.' });
      }

      if (!rowId || !colKey) {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(400).json({ success: false, message: 'ID baris dan kolom wajib disertakan.' });
      }

      const sheet = await prisma.dataSheet.findUnique({ where: { id } });
      if (!sheet) {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(404).json({ success: false, message: 'Spreadsheet tidak ditemukan.' });
      }

      const cols = (sheet.columns as any[]) || [];
      const targetCol = cols.find((c: any) => c.key === colKey);
      if (!targetCol) {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(404).json({ success: false, message: 'Kolom tidak ditemukan pada spreadsheet ini.' });
      }

      // Validate extension
      const allowedExtensions = targetCol.allowedExtensions?.trim();
      if (allowedExtensions && allowedExtensions !== '*' && allowedExtensions !== '') {
        const ext = path.extname(file.originalname).toLowerCase();
        const allowedList = allowedExtensions.split(',').map((s: string) => {
          let str = s.trim().toLowerCase();
          return str.startsWith('.') ? str : `.${str}`;
        }).filter(Boolean);

        if (allowedList.length > 0 && !allowedList.includes(ext)) {
          if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
          return res.status(400).json({
            success: false,
            message: `Format berkas '${ext}' tidak diizinkan. Ketentuan format: ${allowedExtensions}`
          });
        }
      }

      // Validate max size
      const maxMb = targetCol.maxFileSizeMb ? parseInt(targetCol.maxFileSizeMb, 10) : 10;
      if (file.size > maxMb * 1024 * 1024) {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(400).json({
          success: false,
          message: `Ukuran berkas (${(file.size / (1024 * 1024)).toFixed(1)} MB) melebihi batas maksimal ${maxMb} MB.`
        });
      }

      const targetRow = await prisma.dataSheetRow.findUnique({ where: { id: rowId } });
      if (!targetRow || targetRow.sheetId !== sheet.id) {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(404).json({ success: false, message: 'Baris tidak ditemukan.' });
      }

      let rowData = (targetRow.data as Record<string, any>) || {};
      if (typeof rowData === 'string') {
        try { rowData = JSON.parse(rowData); } catch (e) { rowData = {}; }
      }

      // Handle Auto-Rename pattern if defined
      let finalFilename = file.filename;
      let finalDisplayName = file.originalname;

      const renameInfo = generateRenamedFilename(file.originalname, targetCol.renamePattern, {
        nip: targetRow.identifier,
        nama: targetRow.label,
        unitNama: targetRow.subLabel
      });

      if (targetCol.renamePattern && targetCol.renamePattern.trim()) {
        const newPath = path.join(path.dirname(file.path), renameInfo.physicalName);
        try {
          fs.renameSync(file.path, newPath);
          finalFilename = renameInfo.physicalName;
          finalDisplayName = renameInfo.displayName;
        } catch (renameErr) {
          console.warn('[sheetAdminController] Rename file error:', renameErr);
        }
      }

      const fileInfo = {
        url: `/uploads/${finalFilename}`,
        name: finalDisplayName,
        size: file.size,
        uploadedAt: new Date().toISOString()
      };

      rowData[colKey] = fileInfo;

      const updatedRow = await prisma.dataSheetRow.update({
        where: { id: rowId },
        data: {
          data: rowData,
          lastUpdatedAt: new Date(),
          lastUpdatedBy: (req as any).session?.user?.namaLengkap || 'Admin'
        }
      });

      return res.json({
        success: true,
        message: 'Berkas berhasil diunggah!',
        file: fileInfo,
        row: updatedRow
      });
    } catch (error: any) {
      console.error('[sheetAdminController.uploadCellFile] Error:', error);
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      return res.status(500).json({ success: false, message: error.message || 'Gagal mengunggah berkas.' });
    }
  }
};
