import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

export const smartSheetController = {
  // 1. List all SmartSheets
  index: async (req: Request, res: Response) => {
    try {
      const sheets = await prisma.smartSheet.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { rows: true }
          }
        }
      });
      const user = (req as any).session?.user;
      res.render('admin/smart-sheets/index', {
        title: 'Smart Sheets - SIMPEG Cibitung',
        page: 'admin-smart-sheets',
        user,
        isSuperAdmin: user?.role === 'SUPER_ADMIN',
        sheets,
        toast: (req as any).session?.toast || null
      });
    } catch (error) {
      console.error(error);
      res.status(500).send('Error loading smart sheets');
    }
  },

  // 2. Create new SmartSheet (Returns JSON with new slug)
  create: async (req: Request, res: Response) => {
    try {
      const user = (req as any).session?.user;
      if (user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ success: false, message: 'Hanya Super Admin yang dapat membuat spreadsheet.' });
      }

      const { title, description } = req.body;
      const slug = (title || 'spreadsheet').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
      
      const newSheet = await prisma.smartSheet.create({
        data: {
          title: title || 'Spreadsheet Baru',
          description: description || '',
          slug,
          columns: [
            { id: 'col_' + Date.now(), name: 'Kolom Baru', type: 'text', width: 180, isLocked: false, isMasked: false, isCredential: false, requiresAuth: false }
          ],
          createdBy: user?.namaLengkap || 'Super Admin'
        }
      });

      // Buat 30 baris awal kosong
      const initialRows = Array.from({ length: 30 }).map((_, i) => ({
        sheetId: newSheet.id,
        rowIndex: i,
        data: {}
      }));
      await prisma.smartSheetRow.createMany({ data: initialRows });

      res.json({ success: true, slug: newSheet.slug });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // 3. Delete SmartSheet
  delete: async (req: Request, res: Response) => {
    try {
      const user = (req as any).session?.user;
      if (user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ success: false, message: 'Hanya Super Admin yang dapat menghapus spreadsheet.' });
      }

      await prisma.smartSheet.delete({
        where: { id: req.params.id }
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // 4. View Grid UI
  viewGrid: async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;

      // Redirect fallback jika slug lama dibuka agar link tetap bekerja
      if (slug === 'fdfsdfs-1791517564941') {
        const isPublic = req.originalUrl.startsWith('/smart-sheet/');
        const targetPath = isPublic 
          ? `/smart-sheet/data-tte-kec-cibitung-1791517564941` 
          : `/admin/smart-sheets/data-tte-kec-cibitung-1791517564941`;
        return res.redirect(301, targetPath);
      }

      const sheet = await prisma.smartSheet.findUnique({
        where: { slug },
        include: {
          rows: {
            orderBy: { rowIndex: 'asc' }
          }
        }
      });

      if (!sheet) return res.status(404).send('Spreadsheet tidak ditemukan');

      // Default Sort: Jika ada kolom unit kerja, urutkan berdasarkan Unit Kerja dulu, lalu Pegawai
      const columns = (sheet.columns as any[]) || [];
      const unitCol = columns.find(c => c.id === 'c_unit' || (c.name && c.name.toLowerCase().includes('unit')));
      const pegawaiCol = columns.find(c => c.id === 'c_nama' || (c.name && (c.name.toLowerCase().includes('nama') || c.name.toLowerCase().includes('pegawai'))));

      if (unitCol) {
        sheet.rows.sort((a, b) => {
          const dataA = (a.data as any) || {};
          const dataB = (b.data as any) || {};
          const uA = (dataA[unitCol.id] || '').toString().trim().toLowerCase();
          const uB = (dataB[unitCol.id] || '').toString().trim().toLowerCase();
          const comp = uA.localeCompare(uB, 'id', { numeric: true });
          if (comp !== 0) return comp;
          if (pegawaiCol) {
            const pA = (dataA[pegawaiCol.id] || '').toString().trim().toLowerCase();
            const pB = (dataB[pegawaiCol.id] || '').toString().trim().toLowerCase();
            return pA.localeCompare(pB, 'id', { numeric: true });
          }
          return 0;
        });
      }

      const user = (req as any).session?.user;
      const isSuperAdmin = user?.role === 'SUPER_ADMIN';

      res.render('admin/smart-sheets/grid', { 
        title: sheet.title + ' - Spreadsheet',
        sheet, 
        isSuperAdmin,
        user: user || null
      });
    } catch (error) {
      console.error(error);
      res.status(500).send('Error loading grid');
    }
  },

  // 5. Save Grid Data (Realtime / Autosave Support)
  saveGrid: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { title, description, columns, rows, isFullSync } = req.body;
      const user = (req as any).session?.user;
      const isSuperAdmin = user?.role === 'SUPER_ADMIN';

      const existingSheet = await prisma.smartSheet.findUnique({
        where: { id },
        include: { rows: true }
      });
      if (!existingSheet) {
        return res.status(404).json({ success: false, message: 'Spreadsheet tidak ditemukan' });
      }

      // HANYA SUPER ADMIN yang diizinkan mengubah metadata & struktur kolom
      if (isSuperAdmin && (isFullSync || columns)) {
        const updateSheetData: any = {};
        if (title !== undefined && title.trim()) updateSheetData.title = title.trim();
        if (description !== undefined) updateSheetData.description = typeof description === 'string' ? description.trim() : '';
        if (columns && Array.isArray(columns)) updateSheetData.columns = columns;

        if (Object.keys(updateSheetData).length > 0) {
          await prisma.smartSheet.update({
            where: { id },
            data: updateSheetData
          });
        }
      }

      // Identifikasi kolom yang dikunci (locked)
      const existingColumns = (existingSheet.columns as any[]) || [];
      const lockedColIds = new Set(
        existingColumns.filter(c => c.isLocked).map(c => c.id)
      );

      // Pembaruan baris data dengan Diffing (hanya simpan baris yang benar-benar berubah)
      if (rows && Array.isArray(rows)) {
        const oldRowMap = new Map<string, any>();
        existingSheet.rows.forEach(r => oldRowMap.set(r.id, r));

        const queries: any[] = [];

        // Jika Super Admin melakukan Full Sync (misal hapus baris), hapus baris yang dihilangkan dari database
        if (isSuperAdmin && isFullSync) {
          const incomingIds = new Set(
            rows
              .filter(r => r.id && !r.id.startsWith('new_') && !r.id.startsWith('local_') && !r.id.startsWith('cuid_'))
              .map(r => r.id)
          );
          const toDeleteRowIds = existingSheet.rows
            .filter(r => !incomingIds.has(r.id))
            .map(r => r.id);

          if (toDeleteRowIds.length > 0) {
            queries.push(
              prisma.smartSheetRow.deleteMany({
                where: { id: { in: toDeleteRowIds } }
              })
            );
          }
        }

        for (const r of rows) {
          let rowData = r.data || {};
          const oldRow = r.id ? oldRowMap.get(r.id) : null;

          // Jika BUKAN Super Admin, lindungi kolom yang terkunci dari manipulasi
          if (!isSuperAdmin && oldRow) {
            const oldData = (oldRow.data as any) || {};
            lockedColIds.forEach(colId => {
              if (oldData[colId] !== undefined) {
                rowData[colId] = oldData[colId];
              }
            });
          }

          if (r.id && !r.id.startsWith('new_') && !r.id.startsWith('cuid_') && r.id.length > 20) {
            if (oldRow) {
              const dataChanged = JSON.stringify(rowData) !== JSON.stringify(oldRow.data);
              const indexChanged = r.rowIndex !== undefined && r.rowIndex !== oldRow.rowIndex;
              if (!dataChanged && !indexChanged) {
                continue; // Baris ini tidak berubah sama sekali, lewati!
              }
            }

            const updatedByName = user?.namaLengkap || (isSuperAdmin ? 'Super Admin' : 'Publik');
            const targetRowIndex = r.rowIndex !== undefined ? r.rowIndex : (oldRow?.rowIndex || 0);

            if (isSuperAdmin && isFullSync) {
              // Jika Super Admin melakukan full sync (hapus kolom atau reset urutan), update utuh
              queries.push(
                prisma.smartSheetRow.update({
                  where: { id: r.id },
                  data: { 
                    data: rowData, 
                    rowIndex: targetRowIndex,
                    lastUpdatedAt: new Date(),
                    lastUpdatedBy: updatedByName
                  }
                })
              );
            } else {
              // ATOMIC POSTGRESQL JSONB MERGE:
              // Shallow merge atomik di level engine database ("data" = "data"::jsonb || $jsonDelta::jsonb)
              // Menjamin 100% tidak ada kolom yang saling menimpa jika dua orang mengedit baris yang sama berbarengan!
              const jsonDelta = JSON.stringify(rowData);
              queries.push(
                prisma.$executeRaw`
                  UPDATE "SmartSheetRow"
                  SET "data" = "data"::jsonb || ${jsonDelta}::jsonb,
                      "rowIndex" = ${targetRowIndex},
                      "lastUpdatedAt" = NOW(),
                      "lastUpdatedBy" = ${updatedByName}
                  WHERE "id" = ${r.id}
                `
              );
            }
          } else if (isSuperAdmin || (r.data && Object.keys(r.data).some(k => r.data[k]))) {
            // Tambah baris baru jika Super Admin atau jika publik mengisi baris baru yang memiliki data
            queries.push(
              prisma.smartSheetRow.create({
                data: {
                  sheetId: id,
                  rowIndex: r.rowIndex !== undefined ? r.rowIndex : 0,
                  data: rowData,
                  lastUpdatedBy: user?.namaLengkap || (isSuperAdmin ? 'Super Admin' : 'Publik')
                }
              })
            );
          }
        }

        if (queries.length > 0) {
          await prisma.$transaction(queries);
        }
      }

      res.json({ success: true, message: 'Data berhasil disimpan' });
    } catch (error: any) {
      console.error('[smartSheetController.saveGrid] Error:', error);
      res.status(500).json({ success: false, message: error.message || 'Gagal menyimpan data' });
    }
  },

  // 6. Upload Berkas ke Sel (Cell File Upload)
  uploadCellFile: async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Tidak ada berkas yang dipilih' });
      }

      const fileUrl = `/uploads/${req.file.filename}`;
      const fileName = req.file.originalname;

      res.json({
        success: true,
        fileUrl,
        fileName
      });
    } catch (error: any) {
      console.error('[smartSheetController.uploadCellFile] Error:', error);
      res.status(500).json({ success: false, message: 'Gagal mengunggah berkas' });
    }
  },

  // 7. Import Pegawai / Unit Kerja dari Database Internal
  importData: async (req: Request, res: Response) => {
    try {
      const user = (req as any).session?.user;
      if (user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ success: false, message: 'Hanya Super Admin yang diizinkan melakukan import data.' });
      }

      const { id } = req.params;
      const { source, mode, selectedFields } = req.body; // source: 'PEGAWAI' | 'UNIT', mode: 'append' | 'replace'

      const sheet = await prisma.smartSheet.findUnique({
        where: { id },
        include: { rows: true }
      });
      if (!sheet) return res.status(404).json({ success: false, message: 'Spreadsheet tidak ditemukan' });

      let currentColumns = (sheet.columns as any[]) || [];

      // Jika spreadsheet masih berupa sheet default (hanya 1 kolom bernama "Kolom Baru") dan belum ada baris atau mode replace:
      if (currentColumns.length === 1 && currentColumns[0].name === 'Kolom Baru' && (mode === 'replace' || sheet.rows.length === 0)) {
        currentColumns = [];
      }

      let importedRows: any[] = [];

      if (source === 'PEGAWAI') {
        const PEGAWAI_FIELD_MAP: Record<string, { colId: string; name: string; type: string; width: number; getValue: (emp: any) => string }> = {
          nip: { colId: 'c_nip', name: 'NIP / Identitas', type: 'nip', width: 200, getValue: emp => emp.nip || '' },
          nama: { colId: 'c_nama', name: 'Nama Pegawai', type: 'text', width: 220, getValue: emp => emp.nama || '' },
          unit: { colId: 'c_unit', name: 'Unit Kerja', type: 'text', width: 220, getValue: emp => emp.unit?.namaUnit || '-' },
          jabatan: { colId: 'c_jabatan', name: 'Jabatan', type: 'text', width: 170, getValue: emp => emp.jabatan || '-' },
          statusKepegawaian: { colId: 'c_status_pegawai', name: 'Status Kepegawaian', type: 'text', width: 160, getValue: emp => emp.statusKepegawaian || '-' },
          nik: { colId: 'c_nik', name: 'NIK', type: 'text', width: 180, getValue: emp => emp.nik || '-' },
          noHp: { colId: 'c_no_hp', name: 'No HP / WhatsApp', type: 'text', width: 160, getValue: emp => emp.noHp || '-' },
          npwp: { colId: 'c_npwp', name: 'NPWP', type: 'text', width: 180, getValue: emp => emp.npwp || '-' }
        };

        const activeFieldKeys: string[] = (Array.isArray(selectedFields) && selectedFields.length > 0)
          ? selectedFields.filter(f => PEGAWAI_FIELD_MAP[f])
          : ['nip', 'nama', 'unit', 'jabatan', 'statusKepegawaian'];

        if (activeFieldKeys.length === 0) {
          return res.status(400).json({ success: false, message: 'Pilih minimal 1 atribut kolom pegawai' });
        }

        const employees = await prisma.employee.findMany({
          where: { aktif: true },
          include: { unit: true }
        });

        // Urutkan default: Unit Kerja (A-Z) dulu, kemudian Nama Pegawai (A-Z)
        employees.sort((a, b) => {
          const uA = (a.unit?.namaUnit || '').trim().toLowerCase();
          const uB = (b.unit?.namaUnit || '').trim().toLowerCase();
          const comp = uA.localeCompare(uB, 'id', { numeric: true });
          if (comp !== 0) return comp;
          return (a.nama || '').trim().toLowerCase().localeCompare((b.nama || '').trim().toLowerCase(), 'id', { numeric: true });
        });

        // Tambahkan kolom yang dipilih jika belum ada di spreadsheet
        for (const fKey of activeFieldKeys) {
          const conf = PEGAWAI_FIELD_MAP[fKey];
          const exists = currentColumns.some(c => c.id === conf.colId || (fKey === 'nip' && c.type === 'nip'));
          if (!exists) {
            currentColumns.push({
              id: conf.colId,
              name: conf.name,
              type: conf.type,
              width: conf.width,
              options: [],
              isLocked: true,
              isCredential: false,
              requiresAuth: false,
              isMasked: false,
              isHidden: false,
              isFrozen: false
            });
          }
        }

        importedRows = employees.map(emp => {
          const rowData: Record<string, any> = {};
          for (const fKey of activeFieldKeys) {
            const conf = PEGAWAI_FIELD_MAP[fKey];
            rowData[conf.colId] = conf.getValue(emp);
          }
          return rowData;
        });

      } else if (source === 'UNIT') {
        const UNIT_FIELD_MAP: Record<string, { colId: string; name: string; type: string; width: number; isLocked: boolean; getValue: (u: any) => string }> = {
          namaUnit: { colId: 'c_unit', name: 'Nama Unit Kerja / Sekolah', type: 'text', width: 250, isLocked: true, getValue: u => u.namaUnit || '' },
          jenjang: { colId: 'c_jenjang', name: 'Jenjang', type: 'text', width: 110, isLocked: true, getValue: u => u.jenjang || '-' },
          kategori: { colId: 'c_kategori', name: 'Kategori', type: 'text', width: 120, isLocked: true, getValue: u => u.kategori || '-' },
          kepalaSekolah: { colId: 'c_kepsek', name: 'Kepala Sekolah', type: 'text', width: 200, isLocked: false, getValue: u => u.kepalaSekolah || '-' },
          kontakKepalaSekolah: { colId: 'c_kontak_kepsek', name: 'Kontak Kepala Sekolah', type: 'text', width: 170, isLocked: false, getValue: u => u.kontakKepalaSekolah || '-' },
          operatorSekolah: { colId: 'c_operator', name: 'Operator Sekolah', type: 'text', width: 190, isLocked: false, getValue: u => u.operatorSekolah || '-' },
          kontakOperator: { colId: 'c_kontak_operator', name: 'Kontak Operator', type: 'text', width: 170, isLocked: false, getValue: u => u.kontakOperator || '-' }
        };

        const activeFieldKeys: string[] = (Array.isArray(selectedFields) && selectedFields.length > 0)
          ? selectedFields.filter(f => UNIT_FIELD_MAP[f])
          : ['namaUnit', 'jenjang', 'kategori', 'kepalaSekolah'];

        if (activeFieldKeys.length === 0) {
          return res.status(400).json({ success: false, message: 'Pilih minimal 1 atribut kolom unit kerja' });
        }

        const units = await prisma.unit.findMany({
          orderBy: { namaUnit: 'asc' }
        });

        for (const fKey of activeFieldKeys) {
          const conf = UNIT_FIELD_MAP[fKey];
          const exists = currentColumns.some(c => c.id === conf.colId);
          if (!exists) {
            currentColumns.push({
              id: conf.colId,
              name: conf.name,
              type: conf.type,
              width: conf.width,
              options: [],
              isLocked: conf.isLocked,
              isCredential: false,
              requiresAuth: false,
              isMasked: false,
              isHidden: false,
              isFrozen: false
            });
          }
        }

        importedRows = units.map(u => {
          const rowData: Record<string, any> = {};
          for (const fKey of activeFieldKeys) {
            const conf = UNIT_FIELD_MAP[fKey];
            rowData[conf.colId] = conf.getValue(u);
          }
          return rowData;
        });
      } else {
        return res.status(400).json({ success: false, message: 'Sumber data import tidak valid' });
      }

      // Hapus baris lama jika mode replace
      if (mode === 'replace') {
        await prisma.smartSheetRow.deleteMany({ where: { sheetId: id } });
      }

      const startIndex = mode === 'replace' ? 0 : sheet.rows.length;
      const rowsToCreate = importedRows.map((data, idx) => ({
        sheetId: id,
        rowIndex: startIndex + idx,
        data,
        lastUpdatedBy: user?.namaLengkap || 'Super Admin'
      }));

      await prisma.$transaction([
        prisma.smartSheet.update({
          where: { id },
          data: { columns: currentColumns }
        }),
        prisma.smartSheetRow.createMany({ data: rowsToCreate })
      ]);

      res.json({
        success: true,
        count: rowsToCreate.length,
        message: `Berhasil mengimpor ${rowsToCreate.length} data.`
      });
    } catch (error: any) {
      console.error('[smartSheetController.importData] Error:', error);
      res.status(500).json({ success: false, message: error.message || 'Gagal import data' });
    }
  },

  // 7. Export SmartSheet to Excel (.xlsx) for Admin
  exportXlsx: async (req: Request, res: Response) => {
    try {
      const user = (req as any).session?.user;
      if (user?.role !== 'SUPER_ADMIN') {
        return res.status(403).send('Akses ditolak: Hanya Super Admin yang dapat mendownload tabel spreadsheet.');
      }

      const { id } = req.params;
      const sheet = await prisma.smartSheet.findFirst({
        where: {
          OR: [
            { id },
            { slug: id }
          ]
        },
        include: {
          rows: {
            orderBy: { rowIndex: 'asc' }
          }
        }
      });

      if (!sheet) {
        return res.status(404).send('Spreadsheet tidak ditemukan');
      }

      const columns = ((sheet.columns as any[]) || []).filter(c => c && c.id);

      // Default Sort: Jika ada kolom unit kerja, urutkan sama seperti di grid view
      const unitCol = columns.find(c => c.id === 'c_unit' || (c.name && c.name.toLowerCase().includes('unit')));
      const pegawaiCol = columns.find(c => c.id === 'c_nama' || (c.name && (c.name.toLowerCase().includes('nama') || c.name.toLowerCase().includes('pegawai'))));

      if (unitCol) {
        sheet.rows.sort((a, b) => {
          const dataA = (a.data as any) || {};
          const dataB = (b.data as any) || {};
          const uA = (dataA[unitCol.id] || '').toString().trim().toLowerCase();
          const uB = (dataB[unitCol.id] || '').toString().trim().toLowerCase();
          const comp = uA.localeCompare(uB, 'id', { numeric: true });
          if (comp !== 0) return comp;
          if (pegawaiCol) {
            const pA = (dataA[pegawaiCol.id] || '').toString().trim().toLowerCase();
            const pB = (dataB[pegawaiCol.id] || '').toString().trim().toLowerCase();
            return pA.localeCompare(pB, 'id', { numeric: true });
          }
          return 0;
        });
      }

      // Baris Header: No, [Nama Kolom...]
      const headerRow = ['No', ...columns.map(c => c.name || 'Kolom')];

      // Data Baris
      const rowsData = sheet.rows.map((row, idx) => {
        const d = (row.data as any) || {};
        return [
          idx + 1,
          ...columns.map(c => {
            const val = d[c.id];
            if (val === undefined || val === null) return '';
            return String(val);
          })
        ];
      });

      const aoa = [headerRow, ...rowsData];
      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // Otomatis hitung lebar kolom
      const colWidths = [
        { wch: 6 }, // Kolom No
        ...columns.map((c, colIdx) => {
          let maxLen = (c.name || '').length;
          for (const r of rowsData) {
            const cellLen = String(r[colIdx + 1] || '').length;
            if (cellLen > maxLen) maxLen = cellLen;
          }
          return { wch: Math.min(Math.max(maxLen + 4, 14), 60) };
        })
      ];
      ws['!cols'] = colWidths;

      const wb = XLSX.utils.book_new();
      const safeSheetTitle = (sheet.title || 'Data').substring(0, 31).replace(/[:\\\/\?\*\[\]]/g, '_');
      XLSX.utils.book_append_sheet(wb, ws, safeSheetTitle);

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const safeFilename = (sheet.title || 'smart_sheet')
        .trim()
        .replace(/[^a-zA-Z0-9_\-]/g, '_')
        .replace(/_+/g, '_');

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.xlsx"`);
      res.send(buffer);
    } catch (error: any) {
      console.error('[smartSheetController.exportXlsx] Error:', error);
      res.status(500).send('Gagal mengekspor data ke Excel');
    }
  },

  // 8. List Versions
  listVersions: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const sheet = await prisma.smartSheet.findFirst({
        where: { OR: [{ id }, { slug: id }] },
        select: { id: true, title: true, slug: true }
      });
      if (!sheet) return res.status(404).json({ success: false, message: 'Spreadsheet tidak ditemukan' });

      const versions: any[] = [];
      const backupDir = '/var/backups/smart-sheets';

      // 1. Ambil dari file backup server jika ada
      if (fs.existsSync(backupDir)) {
        const files = fs.readdirSync(backupDir).filter(f => f.startsWith(`sheet_${sheet.slug}_`) && f.endsWith('.json'));
        for (const file of files) {
          try {
            const fPath = path.join(backupDir, file);
            const stat = fs.statSync(fPath);
            const parts = file.replace(`sheet_${sheet.slug}_`, '').replace('.json', '').split('_');
            const datePart = parts[0];
            const timePart = parts[1] || '0000';
            const formattedTime = `${timePart.substring(0, 2)}:${timePart.substring(2, 4)}`;

            versions.push({
              id: 'file_' + file,
              type: 'file',
              filename: file,
              label: `Snapshot Jam ${formattedTime} WIB`,
              description: `Cadangan Otomatis (${datePart} • ${(stat.size / 1024).toFixed(0)} KB)`,
              createdBy: 'Sistem (Server Auto-Backup)',
              createdAt: stat.mtime.toISOString(),
              size: stat.size
            });
          } catch (e) {}
        }
      }

      // 2. Ambil dari database SmartSheetVersion
      try {
        const dbVersions = await prisma.smartSheetVersion.findMany({
          where: { sheetId: sheet.id },
          select: {
            id: true,
            label: true,
            description: true,
            rowCount: true,
            createdBy: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' },
          take: 60
        });

        dbVersions.forEach(v => {
          versions.push({
            id: v.id,
            type: 'db',
            label: v.label,
            description: v.description,
            rowCount: v.rowCount,
            createdBy: v.createdBy,
            createdAt: v.createdAt.toISOString()
          });
        });
      } catch (e) {}

      // Urutkan dari yang terbaru
      versions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      res.json({ success: true, versions });
    } catch (error: any) {
      console.error('[smartSheetController.listVersions] Error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // 9. Get Single Version Detail (Full Snapshot for Preview)
  getVersionDetail: async (req: Request, res: Response) => {
    try {
      const { id, versionId } = req.params;
      if (versionId.startsWith('file_')) {
        const filename = versionId.replace('file_', '');
        const fPath = path.join('/var/backups/smart-sheets', filename);
        if (!fs.existsSync(fPath)) {
          return res.status(404).json({ success: false, message: 'File backup tidak ditemukan' });
        }
        const fileContent = JSON.parse(fs.readFileSync(fPath, 'utf8'));
        return res.json({
          success: true,
          version: {
            id: versionId,
            label: filename,
            createdAt: fileContent.savedAt,
            columnsSnapshot: fileContent.columns,
            rowsSnapshot: fileContent.rows
          }
        });
      }

      const version = await prisma.smartSheetVersion.findUnique({
        where: { id: versionId }
      });
      if (!version) return res.status(404).json({ success: false, message: 'Versi tidak ditemukan' });

      res.json({ success: true, version });
    } catch (error: any) {
      console.error('[smartSheetController.getVersionDetail] Error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // 10. Create Manual Version Snapshot
  createVersion: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { label } = req.body;
      const user = (req as any).session?.user;

      const sheet = await prisma.smartSheet.findFirst({
        where: { OR: [{ id }, { slug: id }] },
        include: { rows: { orderBy: { rowIndex: 'asc' } } }
      });
      if (!sheet) return res.status(404).json({ success: false, message: 'Spreadsheet tidak ditemukan' });

      let filledCount = 0;
      sheet.rows.forEach(r => {
        const d = (r.data as any) || {};
        if (Object.values(d).some(v => v !== null && v !== undefined && String(v).trim() !== '' && String(v).trim() !== '- Kosong -')) {
          filledCount++;
        }
      });

      const now = new Date();
      const versionLabel = label || `Snapshot Manual (${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })})`;
      const version = await prisma.smartSheetVersion.create({
        data: {
          sheetId: sheet.id,
          label: versionLabel,
          description: `${sheet.rows.length.toLocaleString('id-ID')} baris • ${filledCount.toLocaleString('id-ID')} terisi`,
          rowCount: sheet.rows.length,
          columnsSnapshot: sheet.columns as any,
          rowsSnapshot: sheet.rows.map(r => ({ id: r.id, rowIndex: r.rowIndex, data: r.data })),
          createdBy: user?.namaLengkap || 'Super Admin'
        }
      });

      // Simpan juga ke file backup
      try {
        const backupDir = '/var/backups/smart-sheets';
        if (fs.existsSync(backupDir)) {
          const pad = (n: number) => String(n).padStart(2, '0');
          const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
          const filepath = path.join(backupDir, `sheet_${sheet.slug}_manual_${timestamp}.json`);
          fs.writeFileSync(filepath, JSON.stringify({
            sheetId: sheet.id,
            title: sheet.title,
            slug: sheet.slug,
            savedAt: now.toISOString(),
            rowCount: sheet.rows.length,
            columns: sheet.columns,
            rows: sheet.rows
          }, null, 2), 'utf8');
        }
      } catch (e) {}

      res.json({ success: true, version });
    } catch (error: any) {
      console.error('[smartSheetController.createVersion] Error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // 11. Restore Version (Pulihkan Spreadsheet ke Versi Tertentu)
  restoreVersion: async (req: Request, res: Response) => {
    try {
      const { id, versionId } = req.params;
      const user = (req as any).session?.user;
      if (user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ success: false, message: 'Hanya Super Admin yang diizinkan memulihkan versi' });
      }

      const sheet = await prisma.smartSheet.findFirst({
        where: { OR: [{ id }, { slug: id }] },
        include: { rows: { orderBy: { rowIndex: 'asc' } } }
      });
      if (!sheet) return res.status(404).json({ success: false, message: 'Spreadsheet tidak ditemukan' });

      let targetColumns: any[] = [];
      let targetRows: any[] = [];
      let versionLabel = '';

      if (versionId.startsWith('file_')) {
        const filename = versionId.replace('file_', '');
        const fPath = path.join('/var/backups/smart-sheets', filename);
        if (!fs.existsSync(fPath)) {
          return res.status(404).json({ success: false, message: 'File backup tidak ditemukan' });
        }
        const fileContent = JSON.parse(fs.readFileSync(fPath, 'utf8'));
        targetColumns = fileContent.columns || [];
        targetRows = fileContent.rows || [];
        versionLabel = filename;
      } else {
        const targetVersion = await prisma.smartSheetVersion.findUnique({
          where: { id: versionId }
        });
        if (!targetVersion) return res.status(404).json({ success: false, message: 'Versi target tidak ditemukan' });
        targetColumns = targetVersion.columnsSnapshot as any[];
        targetRows = targetVersion.rowsSnapshot as any[];
        versionLabel = targetVersion.label || targetVersion.createdAt.toISOString();
      }

      // 1. Simpan safety snapshot sebelum ditimpa
      const now = new Date();
      try {
        await prisma.smartSheetVersion.create({
          data: {
            sheetId: sheet.id,
            label: `Sebelum Pemulihan (${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })})`,
            description: `Disimpan otomatis sebelum memulihkan ke "${versionLabel}"`,
            rowCount: sheet.rows.length,
            columnsSnapshot: sheet.columns as any,
            rowsSnapshot: sheet.rows.map(r => ({ id: r.id, rowIndex: r.rowIndex, data: r.data })),
            createdBy: 'Sistem (Safety Backup)'
          }
        });
      } catch (e) {}

      // 2. Pulihkan columns dan rows
      await prisma.$transaction([
        prisma.smartSheet.update({
          where: { id: sheet.id },
          data: { columns: targetColumns }
        }),
        prisma.smartSheetRow.deleteMany({
          where: { sheetId: sheet.id }
        }),
        prisma.smartSheetRow.createMany({
          data: targetRows.map(r => ({
            sheetId: sheet.id,
            rowIndex: r.rowIndex !== undefined ? r.rowIndex : 0,
            data: r.data || {},
            lastUpdatedBy: `Dipulihkan oleh ${user?.namaLengkap || 'Super Admin'}`
          }))
        })
      ]);

      res.json({
        success: true,
        message: `Berhasil memulihkan ke versi "${versionLabel}"`
      });
    } catch (error: any) {
      console.error('[smartSheetController.restoreVersion] Error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
};
