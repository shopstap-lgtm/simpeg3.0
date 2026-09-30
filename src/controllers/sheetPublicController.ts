import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import prisma from '../lib/prisma';

export const sheetPublicController = {
  // 1. Render Public Sheet View
  show: async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const sheet = await prisma.dataSheet.findUnique({
        where: { slug },
        include: {
          rows: {
            orderBy: { rowIndex: 'asc' }
          }
        }
      });

      if (!sheet) {
        return res.status(404).render('partials/404', {
          title: 'Spreadsheet Tidak Ditemukan',
          message: 'Tautan spreadsheet yang Anda tuju tidak ditemukan atau sudah dihapus.'
        });
      }

      // Check if session has any unlocked rows for this sheet
      const sessionUnlocked = (req as any).session?.unlockedSheetRows?.[sheet.id] || null;

      // Filter out columns hidden by admin
      const allCols = (sheet.columns as any[]) || [];
      const publicCols = allCols.filter(c => !c.hidden);
      const hiddenKeys = new Set(allCols.filter(c => !!c.hidden).map(c => (c.key || '').toLowerCase()));

      const isNipExplicitlyHidden = hiddenKeys.has('nip') || hiddenKeys.has('identifier');
      const isNamaExplicitlyHidden = hiddenKeys.has('nama') || hiddenKeys.has('label');
      const isUnitExplicitlyHidden = hiddenKeys.has('unitkerja') || hiddenKeys.has('sublabel') || hiddenKeys.has('namaunit');

      // Sanitize rows so hidden column data is not exposed to public
      const sanitizedRows = sheet.rows.map(r => {
        let rawData: any = r.data;
        if (typeof rawData === 'string') {
          try { rawData = JSON.parse(rawData); } catch (e) { rawData = {}; }
        }
        rawData = (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) ? rawData : {};
        const safeData: Record<string, any> = {};
        for (const col of publicCols) {
          if (rawData[col.key] !== undefined) {
            safeData[col.key] = rawData[col.key];
          }
        }
        return {
          id: r.id,
          rowIndex: r.rowIndex,
          entityType: r.entityType,
          entityId: r.entityId,
          label: isNamaExplicitlyHidden ? '-' : r.label,
          identifier: isNipExplicitlyHidden ? '-' : r.identifier,
          subLabel: isUnitExplicitlyHidden ? '-' : r.subLabel,
          lastUpdatedAt: r.lastUpdatedAt,
          data: safeData
        };
      });

      // Stats
      const totalRows = sheet.rows.length;
      let filledRowsCount = 0;

      for (const r of sanitizedRows) {
        const rowData = (r.data as Record<string, any>) || {};
        const hasValues = publicCols.some(c => rowData[c.key] !== undefined && rowData[c.key] !== '' && rowData[c.key] !== null);
        if (hasValues) filledRowsCount++;
      }

      res.render('sheets/view', {
        title: `${sheet.title} - SIMPEG Cibitung`,
        sheet,
        columns: publicCols,
        rows: sanitizedRows,
        unlockedRowId: sessionUnlocked,
        stats: {
          totalRows,
          filledRowsCount,
          emptyRowsCount: totalRows - filledRowsCount,
          fillPercentage: totalRows > 0 ? Math.round((filledRowsCount / totalRows) * 100) : 0
        }
      });
    } catch (error) {
      console.error('[sheetPublicController.show] Error:', error);
      res.status(500).render('partials/404', {
        title: 'Terjadi Kesalahan',
        message: 'Gagal memuat data spreadsheet.'
      });
    }
  },

  // 2. Verify NIP to unlock row editing (PROTECTED_NIP mode)
  verifyNip: async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const { nip, pin } = req.body;

      if (!nip || !nip.trim()) {
        return res.status(400).json({ success: false, message: 'NIP / Kode Identitas wajib diisi.' });
      }

      const cleanNip = nip.trim();

      const sheet = await prisma.dataSheet.findUnique({
        where: { slug }
      });

      if (!sheet) {
        return res.status(404).json({ success: false, message: 'Spreadsheet tidak ditemukan.' });
      }

      if (sheet.status === 'CLOSED') {
        return res.status(403).json({ success: false, message: 'Pengisian spreadsheet ini sudah DITUTUP oleh admin.' });
      }

      // Find row in this sheet matching the NIP
      const row = await prisma.dataSheetRow.findFirst({
        where: {
          sheetId: sheet.id,
          identifier: cleanNip
        }
      });

      if (!row) {
        return res.status(404).json({
          success: false,
          message: `Baris data untuk NIP/Identitas '${cleanNip}' tidak ditemukan pada spreadsheet ini.`
        });
      }

      // Optional PIN verification if enabled
      if (sheet.requirePin) {
        if (!pin || !pin.trim()) {
          return res.status(400).json({ success: false, message: 'PIN verifikasi (4 digit) wajib diisi.' });
        }
        // Verify PIN against employee's recorded NPWP 4 digits or PIN
        const emp = await prisma.employee.findFirst({
          where: { nip: cleanNip }
        });
        const expectedPin = emp?.npwp ? emp.npwp.replace(/\D/g, '').slice(0, 4) : null;
        if (expectedPin && pin.trim() !== expectedPin) {
          return res.status(401).json({ success: false, message: 'PIN verifikasi yang Anda masukkan tidak cocok.' });
        }
      }

      // Store in session
      if (!(req as any).session.unlockedSheetRows) {
        (req as any).session.unlockedSheetRows = {};
      }
      (req as any).session.unlockedSheetRows[sheet.id] = row.id;

      return res.json({
        success: true,
        message: `Kredensial terverifikasi! Anda dapat mengedit baris atas nama '${row.label || cleanNip}'.`,
        rowId: row.id,
        label: row.label,
        identifier: row.identifier
      });
    } catch (error: any) {
      console.error('[sheetPublicController.verifyNip] Error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Gagal memverifikasi kredensial.' });
    }
  },

  // 3. Save single row (AJAX)
  saveRow: async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const { rowId, data, nip } = req.body;

      if (!rowId) {
        return res.status(400).json({ success: false, message: 'ID baris wajib disertakan.' });
      }

      const sheet = await prisma.dataSheet.findUnique({
        where: { slug }
      });

      if (!sheet) {
        return res.status(404).json({ success: false, message: 'Spreadsheet tidak ditemukan.' });
      }

      if (sheet.status === 'CLOSED') {
        return res.status(403).json({ success: false, message: 'Pengisian spreadsheet ini sudah DITUTUP oleh admin.' });
      }

      // Security check based on accessMode
      if (sheet.accessMode === 'PROTECTED_NIP') {
        const sessionUnlocked = (req as any).session?.unlockedSheetRows?.[sheet.id];
        // Must match either session unlocked row OR row with matching identifier
        const targetRow = await prisma.dataSheetRow.findUnique({ where: { id: rowId } });
        if (!targetRow || targetRow.sheetId !== sheet.id) {
          return res.status(404).json({ success: false, message: 'Baris data tidak valid.' });
        }

        const isAuthorized = sessionUnlocked === rowId || (nip && targetRow.identifier === nip.trim());
        if (!isAuthorized) {
          return res.status(403).json({
            success: false,
            message: 'Akses ditolak. Silakan buka kunci baris ini menggunakan kredensial NIP Anda terlebih dahulu.'
          });
        }
      } else if (sheet.accessMode === 'PUBLIC_VIEW') {
        return res.status(403).json({
          success: false,
          message: 'Spreadsheet ini dalam mode Hanya Lihat (Public View). Pengeditan tidak diizinkan.'
        });
      }

      const parsedData = typeof data === 'string' ? JSON.parse(data) : (data || {});

      const updated = await prisma.dataSheetRow.update({
        where: { id: rowId },
        data: {
          data: parsedData,
          lastUpdatedAt: new Date(),
          lastUpdatedBy: nip ? `NIP: ${nip}` : 'Pengisi Publik'
        }
      });

      return res.json({
        success: true,
        message: 'Perubahan berhasil disimpan!',
        row: updated
      });
    } catch (error: any) {
      console.error('[sheetPublicController.saveRow] Error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Gagal menyimpan perubahan baris.' });
    }
  },

  // 4. Bulk save (if allowed)
  bulkSave: async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const { rows } = req.body;

      const sheet = await prisma.dataSheet.findUnique({ where: { slug } });
      if (!sheet) return res.status(404).json({ success: false, message: 'Spreadsheet tidak ditemukan.' });
      if (sheet.status === 'CLOSED') return res.status(403).json({ success: false, message: 'Spreadsheet sudah ditutup.' });
      if (sheet.accessMode !== 'OPEN_EDIT') {
        return res.status(403).json({ success: false, message: 'Mode ini tidak mengizinkan pengisian massal terbuka.' });
      }

      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Data baris tidak valid.' });
      }

      await prisma.$transaction(async (tx) => {
        for (const item of rows) {
          if (item.id) {
            await tx.dataSheetRow.update({
              where: { id: item.id },
              data: {
                data: item.data || {},
                lastUpdatedAt: new Date(),
                lastUpdatedBy: 'Pengisi Publik'
              }
            });
          }
        }
      });

      return res.json({ success: true, message: 'Seluruh data berhasil disimpan!' });
    } catch (error: any) {
      console.error('[sheetPublicController.bulkSave] Error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Gagal menyimpan data.' });
    }
  },

  // 5. Export Excel (Public)
  exportXlsx: async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const sheet = await prisma.dataSheet.findUnique({
        where: { slug },
        include: {
          rows: { orderBy: { rowIndex: 'asc' } }
        }
      });

      if (!sheet) return res.status(404).send('Spreadsheet tidak ditemukan.');
      if (!sheet.allowPublicExport) return res.status(403).send('Unduhan Excel tidak diizinkan untuk sheet ini.');

      const allCols = ((sheet.columns as any[]) || []);
      const columns = allCols.filter((c: any) => !c.hidden);

      const hasDefinedNama = allCols.some((c: any) => (c.key || '').toLowerCase() === 'nama' || (c.label || '').toLowerCase().includes('nama'));
      const hasDefinedNip = allCols.some((c: any) => (c.key || '').toLowerCase() === 'nip' || (c.label || '').toLowerCase().includes('nip'));
      const hasDefinedUnit = allCols.some((c: any) => (c.key || '').toLowerCase() === 'unitkerja' || (c.key || '').toLowerCase() === 'namaunit' || (c.label || '').toLowerCase().includes('unit'));

      const excelRows: any[] = [];

      sheet.rows.forEach((r, idx) => {
        const rowData = (r.data as Record<string, any>) || {};
        const entry: Record<string, any> = { 'No': idx + 1 };

        // Fallback identity columns ONLY if sheet didn't define them as custom columns
        if (!hasDefinedNama && !hasDefinedNip && !hasDefinedUnit) {
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
        }

        columns.forEach(c => {
          let val = rowData[c.key];
          if (val === undefined || val === null) {
            if (c.key === 'nip') val = r.identifier || '';
            else if (c.key === 'nama') val = r.label || '';
            else if (c.key === 'unitKerja') val = r.subLabel || '';
          }
          if (c.type === 'checkbox') {
            entry[c.label] = val === true || val === 'true' ? 'YA' : 'TIDAK';
          } else {
            entry[c.label] = val !== undefined && val !== null ? val : '';
          }
        });

        excelRows.push(entry);
      });

      const worksheet = XLSX.utils.json_to_sheet(excelRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Rekap');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      const safeTitle = (sheet.title || 'Spreadsheet').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${safeTitle}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buffer);
    } catch (error) {
      console.error('[sheetPublicController.exportXlsx] Error:', error);
      res.status(500).send('Gagal mengekspor file Excel.');
    }
  }
};
