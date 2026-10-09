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
          columns: [],
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
      const { source, mode } = req.body; // source: 'PEGAWAI' | 'UNIT', mode: 'append' | 'replace'

      const sheet = await prisma.smartSheet.findUnique({
        where: { id },
        include: { rows: true }
      });
      if (!sheet) return res.status(404).json({ success: false, message: 'Spreadsheet tidak ditemukan' });

      let currentColumns = (sheet.columns as any[]) || [];
      let importedRows: any[] = [];

      if (source === 'PEGAWAI') {
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

        // Pastikan kolom NIP, Nama, Unit, Jabatan tersedia
        const hasNip = currentColumns.some(c => c.id === 'c_nip' || c.type === 'nip');
        const hasNama = currentColumns.some(c => c.id === 'c_nama');
        const hasUnit = currentColumns.some(c => c.id === 'c_unit');
        const hasJabatan = currentColumns.some(c => c.id === 'c_jabatan');

        if (!hasNip) currentColumns.unshift({ id: 'c_nip', name: 'NIP / Identitas', type: 'nip', width: 200, isLocked: true });
        if (!hasNama) currentColumns.push({ id: 'c_nama', name: 'Nama Pegawai', type: 'text', width: 220, isLocked: true });
        if (!hasUnit) currentColumns.push({ id: 'c_unit', name: 'Unit Kerja', type: 'text', width: 200, isLocked: true });
        if (!hasJabatan) currentColumns.push({ id: 'c_jabatan', name: 'Jabatan', type: 'text', width: 160, isLocked: true });

        importedRows = employees.map(emp => ({
          c_nip: emp.nip,
          c_nama: emp.nama,
          c_unit: emp.unit?.namaUnit || '-',
          c_jabatan: emp.jabatan || '-'
        }));
      } else if (source === 'UNIT') {
        const units = await prisma.unit.findMany({
          orderBy: { namaUnit: 'asc' }
        });

        const hasUnit = currentColumns.some(c => c.id === 'c_unit');
        const hasJenjang = currentColumns.some(c => c.id === 'c_jenjang');
        const hasKepsek = currentColumns.some(c => c.id === 'c_kepsek');

        if (!hasUnit) currentColumns.unshift({ id: 'c_unit', name: 'Nama Unit Kerja / Sekolah', type: 'text', width: 250, isLocked: true });
        if (!hasJenjang) currentColumns.push({ id: 'c_jenjang', name: 'Jenjang', type: 'text', width: 110, isLocked: true });
        if (!hasKepsek) currentColumns.push({ id: 'c_kepsek', name: 'Kepala Sekolah', type: 'text', width: 200, isLocked: false });

        importedRows = units.map(u => ({
          c_unit: u.namaUnit,
          c_jenjang: u.jenjang,
          c_kepsek: u.kepalaSekolah || '-'
        }));
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
