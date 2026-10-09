import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

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
      const { title, description, columns, rows } = req.body;
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
      if (isSuperAdmin) {
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

        // Jika Super Admin menghapus baris, hapus baris yang dihilangkan dari database
        if (isSuperAdmin) {
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

            queries.push(
              prisma.smartSheetRow.update({
                where: { id: r.id },
                data: { 
                  data: rowData, 
                  rowIndex: r.rowIndex !== undefined ? r.rowIndex : 0,
                  lastUpdatedAt: new Date(),
                  lastUpdatedBy: user?.namaLengkap || (isSuperAdmin ? 'Super Admin' : 'Publik')
                }
              })
            );
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
  }
};
