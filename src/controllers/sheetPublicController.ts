import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import prisma from '../lib/prisma';

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

      // Filter out columns hidden or deleted by admin
      const allCols = (sheet.columns as any[]) || [];
      const publicCols = allCols.filter(c => !c.hidden && !c.deleted && !c.isDeleted);
      const hiddenKeys = new Set(allCols.filter(c => !!c.hidden || !!c.deleted || !!c.isDeleted).map(c => (c.key || '').toLowerCase()));
      const deletedIdentityKeys = Array.from(new Set(allCols.filter(c => !!c.deleted || !!c.isDeleted).map(c => (c.key || '').toLowerCase())));

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
          if (rawData[col.key] !== undefined && rawData[col.key] !== null && rawData[col.key] !== '') {
            safeData[col.key] = rawData[col.key];
          } else {
            // Case-insensitive match or fallback from entity fields
            const lk = (col.key || '').toLowerCase();
            const matchedKey = Object.keys(rawData).find(k => k.toLowerCase() === lk);
            if (matchedKey && rawData[matchedKey] !== undefined && rawData[matchedKey] !== null && rawData[matchedKey] !== '') {
              safeData[col.key] = rawData[matchedKey];
            } else if ((lk === 'nama' || lk === 'label' || lk === 'namalengkap' || lk === 'namaunit') && r.label) {
              safeData[col.key] = r.label;
            } else if ((lk === 'nip' || lk === 'identifier' || lk === 'kode') && r.identifier) {
              safeData[col.key] = r.identifier;
            } else if ((lk === 'unitkerja' || lk === 'sublabel' || lk === 'unit' || lk === 'jabatan') && r.subLabel) {
              safeData[col.key] = r.subLabel;
            } else if (rawData[col.key] !== undefined) {
              safeData[col.key] = rawData[col.key];
            }
          }
        }
        // In PROTECTED_NIP mode: hide employee response data for rows not currently unlocked by session,
        // EXCEPT if the column is configured to show public values (col.showPublicValue === true)
        if (sheet.accessMode === 'PROTECTED_NIP' && r.id !== sessionUnlocked) {
          for (const col of publicCols) {
            const isProtectedCol = !!col.isProtected;
            const isIdentityCol = ['nama', 'label', 'namalengkap', 'namapegawai', 'nama_lengkap', 'nip', 'identifier', 'kode', 'unitkerja', 'sublabel', 'jabatan'].includes((col.key || '').toLowerCase());
            const isPublicValueAllowed = !!col.showPublicValue;
            if (!isProtectedCol && !isIdentityCol && !isPublicValueAllowed) {
              if (safeData[col.key] !== undefined && safeData[col.key] !== null && String(safeData[col.key]).trim() !== '' && String(safeData[col.key]).trim() !== '-') {
                safeData[col.key] = '__FILLED__';
              }
            }
          }
        }

        return {
          id: r.id,
          rowIndex: r.rowIndex,
          entityType: r.entityType,
          entityId: r.entityId,
          label: isNamaExplicitlyHidden ? '-' : (r.label || (safeData as any).nama || (safeData as any).label || (rawData as any).nama || '-'),
          identifier: isNipExplicitlyHidden ? '-' : (r.identifier || (safeData as any).nip || (safeData as any).identifier || (rawData as any).nip || '-'),
          subLabel: isUnitExplicitlyHidden ? '-' : (r.subLabel || (safeData as any).unitKerja || (safeData as any).subLabel || (rawData as any).unitKerja || '-'),
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
        isNipExplicitlyHidden,
        isNamaExplicitlyHidden,
        isUnitExplicitlyHidden,
        deletedIdentityKeys,
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

      let rowData = row.data;
      if (typeof rowData === 'string') {
        try { rowData = JSON.parse(rowData); } catch (e) { rowData = {}; }
      }

      return res.json({
        success: true,
        message: `Kredensial terverifikasi! Anda dapat mengedit baris atas nama '${row.label || cleanNip}'.`,
        rowId: row.id,
        label: row.label,
        identifier: row.identifier,
        data: rowData || {}
      });
    } catch (error: any) {
      console.error('[sheetPublicController.verifyNip] Error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Gagal memverifikasi kredensial.' });
    }
  },

  // 2b. Lock row session (timeout or manual logout)
  lockRow: async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const sheet = await prisma.dataSheet.findUnique({ where: { slug } });
      if (sheet && (req as any).session?.unlockedSheetRows) {
        delete (req as any).session.unlockedSheetRows[sheet.id];
      }
      return res.json({ success: true, message: 'Sesi pengisian berhasil dikunci kembali.' });
    } catch (error: any) {
      console.error('[sheetPublicController.lockRow] Error:', error);
      return res.status(500).json({ success: false, message: 'Gagal mengunci sesi.' });
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

      // Preserve protected column values from being overwritten by public users
      const sheetCols = (sheet.columns as any[]) || [];
      const protectedKeys = sheetCols.filter((c: any) => !!c.isProtected).map((c: any) => c.key);
      if (protectedKeys.length > 0) {
        const existingRow = await prisma.dataSheetRow.findUnique({ where: { id: rowId } });
        let existingData = existingRow?.data || {};
        if (typeof existingData === 'string') {
          try { existingData = JSON.parse(existingData); } catch (e) { existingData = {}; }
        }
        for (const pk of protectedKeys) {
          if (existingData && (existingData as any)[pk] !== undefined) {
            parsedData[pk] = (existingData as any)[pk];
          } else {
            delete parsedData[pk];
          }
        }
      }

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

  // 3b. Upload cell file (AJAX)
  uploadCellFile: async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const { rowId, colKey } = req.body;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ success: false, message: 'Tidak ada berkas yang diunggah.' });
      }

      if (!rowId || !colKey) {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(400).json({ success: false, message: 'ID baris dan kolom wajib disertakan.' });
      }

      const sheet = await prisma.dataSheet.findUnique({ where: { slug } });
      if (!sheet) {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(404).json({ success: false, message: 'Spreadsheet tidak ditemukan.' });
      }

      if (sheet.status === 'CLOSED') {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(403).json({ success: false, message: 'Pengisian spreadsheet ini sudah DITUTUP oleh admin.' });
      }

      const cols = (sheet.columns as any[]) || [];
      const targetCol = cols.find((c: any) => c.key === colKey);
      if (!targetCol) {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(404).json({ success: false, message: 'Kolom tidak ditemukan pada spreadsheet ini.' });
      }

      if (targetCol.isProtected) {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(403).json({ success: false, message: 'Kolom ini dilindungi dan hanya dapat diubah oleh Admin.' });
      }

      // Verify authorization
      if (sheet.accessMode === 'PROTECTED_NIP') {
        const sessionUnlocked = (req as any).session?.unlockedSheetRows?.[sheet.id];
        if (sessionUnlocked !== rowId) {
          if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
          return res.status(403).json({ success: false, message: 'Sesi Anda tidak valid atau telah terkunci. Buka kunci baris terlebih dahulu.' });
        }
      } else if (sheet.accessMode === 'PUBLIC_VIEW') {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(403).json({ success: false, message: 'Spreadsheet dalam mode Hanya Lihat.' });
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
          console.warn('[sheetPublicController] Rename file error:', renameErr);
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
          lastUpdatedBy: targetRow.label || targetRow.identifier || 'Pengisi Publik'
        }
      });

      return res.json({
        success: true,
        message: 'Berkas berhasil diunggah!',
        file: fileInfo,
        row: updatedRow
      });
    } catch (error: any) {
      console.error('[sheetPublicController.uploadCellFile] Error:', error);
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      return res.status(500).json({ success: false, message: error.message || 'Gagal mengunggah berkas.' });
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

      const sheetCols = (sheet.columns as any[]) || [];
      const protectedKeys = sheetCols.filter((c: any) => !!c.isProtected).map((c: any) => c.key);

      await prisma.$transaction(async (tx) => {
        for (const item of rows) {
          if (item.id) {
            let rowData = item.data || {};
            if (typeof rowData === 'string') {
              try { rowData = JSON.parse(rowData); } catch (e) { rowData = {}; }
            }

            if (protectedKeys.length > 0) {
              const existingRow = await tx.dataSheetRow.findUnique({ where: { id: item.id } });
              let existingData = existingRow?.data || {};
              if (typeof existingData === 'string') {
                try { existingData = JSON.parse(existingData); } catch (e) { existingData = {}; }
              }
              for (const pk of protectedKeys) {
                if (existingData && (existingData as any)[pk] !== undefined) {
                  rowData[pk] = (existingData as any)[pk];
                } else {
                  delete rowData[pk];
                }
              }
            }

            await tx.dataSheetRow.update({
              where: { id: item.id },
              data: {
                data: rowData,
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

      const excelRows: any[] = [];

      sheet.rows.forEach((r, idx) => {
        const rowData = (r.data as Record<string, any>) || {};
        const entry: Record<string, any> = { 'No': idx + 1 };

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

        // Check which identity columns are already present in the active columns list
        const hasNipInCols = columns.some((c: any) => c.key === 'nip' || c.key === 'identifier' || (c.label || '').trim().toUpperCase() === 'NIP');
        const hasNamaInCols = columns.some((c: any) => c.key === 'nama' || c.key === 'label' || (c.label || '').toLowerCase().includes('nama'));
        const hasUnitInCols = columns.some((c: any) => c.key === 'unitKerja' || c.key === 'subLabel' || (c.label || '').toLowerCase().includes('unit'));

        // Add identity columns if they are not already in dynamic columns:
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

        // 2. Dynamic columns
        columns.forEach(c => {
          let val = rowData[c.key];

          // Automatic fallback if cell value is missing, empty, or dash:
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

          const isProtectedCol = !!c.isProtected;
          const isIdentityCol = ['nama', 'label', 'namalengkap', 'namapegawai', 'nama_lengkap', 'nip', 'identifier', 'kode', 'unitkerja', 'sublabel', 'jabatan'].includes((c.key || '').toLowerCase());

          if (sheet.accessMode === 'PROTECTED_NIP' && !isProtectedCol && !isIdentityCol) {
            const isFilled = val !== undefined && val !== null && (typeof val === 'object' ? !!val.url : (String(val).trim() !== '' && String(val).trim() !== '-'));
            entry[c.label] = isFilled ? '✓ Terisi' : '-';
          } else if (c.type === 'checkbox') {
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
