import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { prisma } from '../../lib/prisma';

export interface FileItem {
  filename: string;
  originalName: string;
  sizeBytes: number;
  sizeFormatted: string;
  mtime: Date;
  ext: string;
  kategori: 'ekinerja' | 'klarifikasi' | 'absensi' | 'lainnya';
  badgeColor: string;
  kategoriLabel: string;
  pegawaiNama?: string;
  unitNama?: string;
  periode?: string;
  bulanPengajuan: number;
  tahunPengajuan: number;
  bulanPengajuanLabel: string;
  relatedId?: string;
  url: string;
}

const BULAN_NAMES = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getUploadsDirectory(): string {
  const dir = path.resolve(process.cwd(), 'public', 'uploads');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Scan uploads directory and enrich each file with database submission metadata
 */
async function getAllEnrichedFiles(): Promise<FileItem[]> {
  const uploadsDir = getUploadsDirectory();
  const rawEntries = fs.readdirSync(uploadsDir);

  // Fetch DB records for metadata correlation
  const [ekinerjaReports, clarifications] = await Promise.all([
    prisma.ekinerjaReport.findMany({
      include: {
        employee: {
          include: { unit: true }
        }
      }
    }),
    prisma.clarification.findMany({
      include: {
        employee: {
          include: { unit: true }
        }
      }
    })
  ]);

  const fileItems: FileItem[] = [];

  for (const entry of rawEntries) {
    if (entry.startsWith('.') || entry === '.gitkeep') continue;
    const fullPath = path.join(uploadsDir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
      if (stat.isDirectory()) continue;
    } catch {
      continue;
    }

    const ext = path.extname(entry).toLowerCase();
    let kategori: 'ekinerja' | 'klarifikasi' | 'absensi' | 'lainnya' = 'lainnya';
    let badgeColor = 'bg-slate-100 text-slate-700 border-slate-200';
    let kategoriLabel = 'Lainnya';
    let pegawaiNama: string | undefined;
    let unitNama: string | undefined;
    let periode: string | undefined;
    let relatedId: string | undefined;

    let bulanPengajuan = 0;
    let tahunPengajuan = 0;
    let bulanPengajuanLabel = '-';

    // 1. Check if matching EkinerjaReport
    const matchedEkinerja = ekinerjaReports.find(
      r => (r.fileHarianUrl && r.fileHarianUrl.includes(entry)) ||
           (r.fileBulananUrl && r.fileBulananUrl.includes(entry))
    );

    if (matchedEkinerja) {
      kategori = 'ekinerja';
      badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      const isHarian = matchedEkinerja.fileHarianUrl?.includes(entry);
      kategoriLabel = isHarian ? 'E-Kinerja (Harian)' : 'E-Kinerja (Bulanan)';
      pegawaiNama = matchedEkinerja.employee?.nama;
      unitNama = matchedEkinerja.employee?.unit?.namaUnit;
      periode = `${BULAN_NAMES[matchedEkinerja.bulan] || matchedEkinerja.bulan} ${matchedEkinerja.tahun}`;
      bulanPengajuan = matchedEkinerja.bulan;
      tahunPengajuan = matchedEkinerja.tahun;
      bulanPengajuanLabel = `${BULAN_NAMES[matchedEkinerja.bulan] || matchedEkinerja.bulan} ${matchedEkinerja.tahun}`;
      relatedId = matchedEkinerja.id;
    } else {
      // 2. Check if matching Clarification
      const matchedClar = clarifications.find(c => c.fileUrl && c.fileUrl.includes(entry));
      if (matchedClar) {
        kategori = 'klarifikasi';
        badgeColor = 'bg-indigo-50 text-indigo-700 border-indigo-200';
        kategoriLabel = 'Klarifikasi Absen';
        pegawaiNama = matchedClar.employee?.nama;
        unitNama = matchedClar.employee?.unit?.namaUnit;
        periode = matchedClar.tanggalAbsen;
        relatedId = matchedClar.id;

        // Parse bulan & tahun diajukan dari tanggalAbsen (e.g. "2026-08-03" or "2026-08-03 s/d ...")
        const dateMatch = matchedClar.tanggalAbsen.match(/(\d{4})[-/](\d{1,2})/);
        if (dateMatch) {
          tahunPengajuan = parseInt(dateMatch[1], 10);
          bulanPengajuan = parseInt(dateMatch[2], 10);
        } else {
          const altMatch = matchedClar.tanggalAbsen.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
          if (altMatch) {
            bulanPengajuan = parseInt(altMatch[2], 10);
            tahunPengajuan = parseInt(altMatch[3], 10);
          } else {
            const fDate = new Date(stat.mtime);
            bulanPengajuan = fDate.getMonth() + 1;
            tahunPengajuan = fDate.getFullYear();
          }
        }
        bulanPengajuanLabel = `${BULAN_NAMES[bulanPengajuan] || bulanPengajuan} ${tahunPengajuan}`;
      } else if (ext === '.xlsx' || ext === '.xls' || ext === '.csv' || entry.toLowerCase().includes('rekap')) {
        kategori = 'absensi';
        badgeColor = 'bg-teal-50 text-teal-700 border-teal-200';
        kategoriLabel = 'Rekap Absensi / Excel';

        const fDate = new Date(stat.mtime);
        bulanPengajuan = fDate.getMonth() + 1;
        tahunPengajuan = fDate.getFullYear();
        bulanPengajuanLabel = `${BULAN_NAMES[bulanPengajuan]} ${tahunPengajuan}`;
      } else {
        const fDate = new Date(stat.mtime);
        bulanPengajuan = fDate.getMonth() + 1;
        tahunPengajuan = fDate.getFullYear();
        bulanPengajuanLabel = `${BULAN_NAMES[bulanPengajuan]} ${tahunPengajuan}`;
      }
    }

    // Clean user-friendly display name
    let originalName = entry;
    if (/^\d{13}-\d+-/.test(entry)) {
      originalName = entry.replace(/^\d{13}-\d+-/, '');
    } else if (/^\d{13}-/.test(entry)) {
      originalName = entry.replace(/^\d{13}-/, '');
    }

    fileItems.push({
      filename: entry,
      originalName,
      sizeBytes: stat.size,
      sizeFormatted: formatBytes(stat.size),
      mtime: stat.mtime,
      ext,
      kategori,
      badgeColor,
      kategoriLabel,
      pegawaiNama,
      unitNama,
      periode,
      bulanPengajuan,
      tahunPengajuan,
      bulanPengajuanLabel,
      relatedId,
      url: `/uploads/${entry}`
    });
  }

  // Sort by newest modified time
  fileItems.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return fileItems;
}

export const fileManagerController = {
  /**
   * GET /admin/files
   * List uploaded files with separated window tabs and submission month filtering
   */
  async show(req: Request, res: Response) {
    try {
      const fileItems = await getAllEnrichedFiles();

      // Overall stats
      const totalFiles = fileItems.length;
      const totalSizeBytes = fileItems.reduce((acc, f) => acc + f.sizeBytes, 0);
      const totalSizeFormatted = formatBytes(totalSizeBytes);
      const countEkinerja = fileItems.filter(f => f.kategori === 'ekinerja').length;
      const countKlarifikasi = fileItems.filter(f => f.kategori === 'klarifikasi').length;
      const countAbsensi = fileItems.filter(f => f.kategori === 'absensi').length;

      // Query params
      const activeTab = (req.query.tab as string || 'ekinerja').toLowerCase(); // 'ekinerja' | 'klarifikasi' | 'absensi' | 'all'
      const search = (req.query.search as string || '').trim().toLowerCase();
      const filterBulan = req.query.bulan ? parseInt(req.query.bulan as string, 10) : 0;
      const filterTahun = req.query.tahun ? parseInt(req.query.tahun as string, 10) : 0;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = 20;

      // 1. Filter by Window Tab
      let filtered = fileItems;
      if (activeTab === 'ekinerja') {
        filtered = filtered.filter(f => f.kategori === 'ekinerja');
      } else if (activeTab === 'klarifikasi') {
        filtered = filtered.filter(f => f.kategori === 'klarifikasi');
      } else if (activeTab === 'absensi') {
        filtered = filtered.filter(f => f.kategori === 'absensi');
      }

      // 2. Filter by Search Query
      if (search) {
        filtered = filtered.filter(f =>
          f.filename.toLowerCase().includes(search) ||
          f.originalName.toLowerCase().includes(search) ||
          (f.pegawaiNama && f.pegawaiNama.toLowerCase().includes(search)) ||
          (f.unitNama && f.unitNama.toLowerCase().includes(search))
        );
      }

      // 3. Filter by BULAN & TAHUN YANG DIAJUKAN (Submission Period)
      if (filterBulan > 0 || filterTahun > 0) {
        filtered = filtered.filter(f => {
          const matchMonth = filterBulan > 0 ? (f.bulanPengajuan === filterBulan) : true;
          const matchYear = filterTahun > 0 ? (f.tahunPengajuan === filterTahun) : true;
          return matchMonth && matchYear;
        });
      }

      // Pagination
      const totalFiltered = filtered.length;
      const totalPages = Math.ceil(totalFiltered / limit) || 1;
      const startIndex = (page - 1) * limit;
      const paginatedFiles = filtered.slice(startIndex, startIndex + limit);

      // Current Tab metadata
      let tabTitle = 'Berkas Laporan E-Kinerja';
      let tabDescription = 'Kelola seluruh dokumen PDF laporan kinerja pegawai (Harian & Bulanan) yang telah diajukan.';
      if (activeTab === 'klarifikasi') {
        tabTitle = 'Berkas Bukti Klarifikasi Absensi';
        tabDescription = 'Kelola dokumen surat keterangan, surat tugas, atau cuti yang diajukan untuk perbaikan presensi.';
      } else if (activeTab === 'absensi') {
        tabTitle = 'Berkas Rekap Absensi (Excel / CSV)';
        tabDescription = 'Kelola berkas spreadsheet rekap absensi mesin dan template impor master data.';
      } else if (activeTab === 'all') {
        tabTitle = 'Semua Berkas Terunggah';
        tabDescription = 'Pusat arsip lengkap seluruh berkas fisik dari semua kategori di server VPS.';
      }

      res.render('admin/files', {
        title: 'Manajemen Berkas Upload',
        page: 'admin-files',
        user: (req as any).session?.user,
        toast: (req as any).session?.toast || null,
        files: paginatedFiles,
        activeTab,
        tabTitle,
        tabDescription,
        stats: {
          totalFiles,
          totalSizeFormatted,
          countEkinerja,
          countKlarifikasi,
          countAbsensi
        },
        pagination: {
          currentPage: page,
          totalPages,
          totalRecords: totalFiltered,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        },
        filters: {
          tab: activeTab,
          search,
          bulan: filterBulan,
          tahun: filterTahun
        }
      });

      if ((req as any).session) {
        delete (req as any).session.toast;
      }
    } catch (error) {
      console.error('[FileManager] Error showing files:', error);
      res.status(500).send('Terjadi kesalahan saat memuat berkas.');
    }
  },

  /**
   * POST /admin/files/upload
   * Super Admin manual file upload
   */
  async uploadFile(req: Request, res: Response) {
    try {
      const files = req.files as Express.Multer.File[];
      const singleFile = req.file;
      const uploadedList = files || (singleFile ? [singleFile] : []);
      const activeTab = (req.body.activeTab as string) || 'ekinerja';

      if (uploadedList.length === 0) {
        (req as any).session.toast = { type: 'error', message: 'Silakan pilih berkas yang ingin diunggah!' };
        return res.redirect(`/admin/files?tab=${activeTab}`);
      }

      (req as any).session.toast = {
        type: 'success',
        message: `Berhasil mengunggah ${uploadedList.length} berkas fisik ke server!`
      };
      return res.redirect(`/admin/files?tab=${activeTab}`);
    } catch (error) {
      console.error('[FileManager] Upload error:', error);
      (req as any).session.toast = { type: 'error', message: 'Gagal mengunggah berkas.' };
      return res.redirect('/admin/files');
    }
  },

  /**
   * POST /admin/files/rename
   * Rename a physical file and update database reference
   */
  async renameFile(req: Request, res: Response) {
    try {
      const { oldFilename, newFilename, activeTab } = req.body;
      const tabParam = activeTab ? `?tab=${activeTab}` : '';

      if (!oldFilename || !newFilename) {
        (req as any).session.toast = { type: 'error', message: 'Nama berkas lama dan baru harus diisi!' };
        return res.redirect(`/admin/files${tabParam}`);
      }

      const uploadsDir = getUploadsDirectory();
      const oldPath = path.join(uploadsDir, path.basename(oldFilename));

      if (!fs.existsSync(oldPath)) {
        (req as any).session.toast = { type: 'error', message: 'Berkas asli tidak ditemukan di server!' };
        return res.redirect(`/admin/files${tabParam}`);
      }

      const oldExt = path.extname(oldFilename);
      let targetName = path.basename(newFilename).replace(/\s+/g, '_');
      if (!targetName.toLowerCase().endsWith(oldExt.toLowerCase())) {
        targetName += oldExt;
      }

      const newPath = path.join(uploadsDir, targetName);

      if (fs.existsSync(newPath) && targetName !== oldFilename) {
        (req as any).session.toast = { type: 'error', message: 'Nama berkas baru sudah digunakan oleh berkas lain!' };
        return res.redirect(`/admin/files${tabParam}`);
      }

      // Rename on disk
      fs.renameSync(oldPath, newPath);

      // Update in database if matched
      const oldUrl = `/uploads/${oldFilename}`;
      const newUrl = `/uploads/${targetName}`;

      await Promise.all([
        prisma.ekinerjaReport.updateMany({
          where: { fileHarianUrl: oldUrl },
          data: { fileHarianUrl: newUrl, fileHarianName: targetName }
        }),
        prisma.ekinerjaReport.updateMany({
          where: { fileBulananUrl: oldUrl },
          data: { fileBulananUrl: newUrl, fileBulananName: targetName }
        }),
        prisma.clarification.updateMany({
          where: { fileUrl: oldUrl },
          data: { fileUrl: newUrl, fileName: targetName }
        })
      ]);

      (req as any).session.toast = {
        type: 'success',
        message: `Nama berkas berhasil diubah menjadi "${targetName}"!`
      };
      return res.redirect(`/admin/files${tabParam}`);
    } catch (error) {
      console.error('[FileManager] Rename error:', error);
      (req as any).session.toast = { type: 'error', message: 'Gagal mengubah nama berkas.' };
      return res.redirect('/admin/files');
    }
  },

  /**
   * POST /admin/files/delete
   * Delete a single physical file and nullify DB references
   */
  async deleteFile(req: Request, res: Response) {
    try {
      const { filename, activeTab } = req.body;
      const tabParam = activeTab ? `?tab=${activeTab}` : '';

      if (!filename) {
        (req as any).session.toast = { type: 'error', message: 'Nama berkas tidak valid!' };
        return res.redirect(`/admin/files${tabParam}`);
      }

      const uploadsDir = getUploadsDirectory();
      const filePath = path.join(uploadsDir, path.basename(filename));

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      const targetUrl = `/uploads/${filename}`;
      await Promise.all([
        prisma.ekinerjaReport.updateMany({
          where: { fileHarianUrl: targetUrl },
          data: { fileHarianUrl: null, fileHarianName: null }
        }),
        prisma.ekinerjaReport.updateMany({
          where: { fileBulananUrl: targetUrl },
          data: { fileBulananUrl: null, fileBulananName: null }
        }),
        prisma.clarification.updateMany({
          where: { fileUrl: targetUrl },
          data: { fileUrl: '', fileName: '' }
        })
      ]);

      (req as any).session.toast = {
        type: 'success',
        message: `Berkas "${filename}" berhasil dihapus dari server!`
      };
      return res.redirect(`/admin/files${tabParam}`);
    } catch (error) {
      console.error('[FileManager] Delete error:', error);
      (req as any).session.toast = { type: 'error', message: 'Gagal menghapus berkas.' };
      return res.redirect('/admin/files');
    }
  },

  /**
   * POST /admin/files/bulk-delete
   * Delete multiple selected physical files
   */
  async bulkDeleteFiles(req: Request, res: Response) {
    try {
      const activeTab = (req.body.activeTab as string) || 'ekinerja';
      const tabParam = `?tab=${activeTab}`;

      let filenames: string[] = [];
      if (Array.isArray(req.body.filenames)) {
        filenames = req.body.filenames;
      } else if (typeof req.body.filenames === 'string') {
        try {
          filenames = JSON.parse(req.body.filenames);
        } catch {
          filenames = req.body.filenames.split(',').map((s: string) => s.trim());
        }
      }

      if (!filenames || filenames.length === 0) {
        (req as any).session.toast = { type: 'error', message: 'Tidak ada berkas yang dipilih untuk dihapus!' };
        return res.redirect(`/admin/files${tabParam}`);
      }

      const uploadsDir = getUploadsDirectory();
      let deletedCount = 0;

      for (const fn of filenames) {
        const cleanName = path.basename(fn);
        const filePath = path.join(uploadsDir, cleanName);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }

        const targetUrl = `/uploads/${cleanName}`;
        await Promise.all([
          prisma.ekinerjaReport.updateMany({
            where: { fileHarianUrl: targetUrl },
            data: { fileHarianUrl: null, fileHarianName: null }
          }),
          prisma.ekinerjaReport.updateMany({
            where: { fileBulananUrl: targetUrl },
            data: { fileBulananUrl: null, fileBulananName: null }
          }),
          prisma.clarification.updateMany({
            where: { fileUrl: targetUrl },
            data: { fileUrl: '', fileName: '' }
          })
        ]);
      }

      (req as any).session.toast = {
        type: 'success',
        message: `Berhasil menghapus ${deletedCount} berkas dari server!`
      };
      return res.redirect(`/admin/files${tabParam}`);
    } catch (error) {
      console.error('[FileManager] Bulk delete error:', error);
      (req as any).session.toast = { type: 'error', message: 'Gagal menghapus berkas terpilih.' };
      return res.redirect('/admin/files');
    }
  },

  /**
   * GET /admin/files/download-all
   * Stream entire uploads directory as a compressed archive (.tar.gz)
   */
  async downloadAll(req: Request, res: Response) {
    try {
      const activeTab = (req.query.tab as string || 'all').toLowerCase();
      const allFiles = await getAllEnrichedFiles();

      let targetFiles: string[] = [];
      if (activeTab === 'ekinerja') {
        targetFiles = allFiles.filter(f => f.kategori === 'ekinerja').map(f => f.filename);
      } else if (activeTab === 'klarifikasi') {
        targetFiles = allFiles.filter(f => f.kategori === 'klarifikasi').map(f => f.filename);
      } else if (activeTab === 'absensi') {
        targetFiles = allFiles.filter(f => f.kategori === 'absensi').map(f => f.filename);
      } else {
        targetFiles = allFiles.map(f => f.filename);
      }

      if (targetFiles.length === 0) {
        (req as any).session.toast = { type: 'error', message: 'Tidak ada berkas yang tersedia untuk diunduh!' };
        return res.redirect(`/admin/files?tab=${activeTab}`);
      }

      const uploadsDir = getUploadsDirectory();
      const dateStr = new Date().toISOString().slice(0, 10);
      const prefix = activeTab === 'all' ? 'semua-berkas' : `berkas-${activeTab}`;
      const archiveName = `simpeg-${prefix}-${dateStr}.tar.gz`;

      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);

      const tar = spawn('tar', ['-czf', '-', '-C', uploadsDir, ...targetFiles]);
      tar.stdout.pipe(res);
      tar.stderr.on('data', d => console.error('[Tar Download All Error]:', d.toString()));
    } catch (error) {
      console.error('[FileManager] Download all error:', error);
      res.status(500).send('Gagal membuat arsip unduhan.');
    }
  },

  /**
   * GET /admin/files/download-month
   * Stream files for a specific SUBMISSION MONTH & YEAR (Bulan yang diajukan) as .tar.gz
   */
  async downloadByMonth(req: Request, res: Response) {
    try {
      const bulan = parseInt(req.query.bulan as string, 10);
      const tahun = parseInt(req.query.tahun as string, 10);
      const activeTab = (req.query.tab as string || 'all').toLowerCase();

      if (!bulan || !tahun) {
        return res.status(400).send('Bulan dan Tahun pengajuan harus disertakan!');
      }

      const allFiles = await getAllEnrichedFiles();

      // Filter by category and SUBMISSION MONTH & YEAR
      const matchedFiles: string[] = allFiles.filter(f => {
        const matchCategory = (activeTab === 'all') || (f.kategori === activeTab);
        const matchPeriod = (f.bulanPengajuan === bulan) && (f.tahunPengajuan === tahun);
        return matchCategory && matchPeriod;
      }).map(f => f.filename);

      if (matchedFiles.length === 0) {
        (req as any).session.toast = {
          type: 'error',
          message: `Tidak ada berkas yang diajukan pada periode ${BULAN_NAMES[bulan] || bulan} ${tahun}!`
        };
        return res.redirect(`/admin/files?tab=${activeTab}&bulan=${bulan}&tahun=${tahun}`);
      }

      const uploadsDir = getUploadsDirectory();
      const prefix = activeTab === 'all' ? 'berkas' : `berkas-${activeTab}`;
      const archiveName = `simpeg-${prefix}-${tahun}-${bulan < 10 ? '0' + bulan : bulan}.tar.gz`;

      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);

      const tar = spawn('tar', ['-czf', '-', '-C', uploadsDir, ...matchedFiles]);
      tar.stdout.pipe(res);
      tar.stderr.on('data', d => console.error('[Tar Download Month Error]:', d.toString()));
    } catch (error) {
      console.error('[FileManager] Download by month error:', error);
      res.status(500).send('Gagal mengunduh berkas periode pengajuan.');
    }
  },

  /**
   * POST /admin/files/download-selected
   * Stream selected files list as .tar.gz
   */
  async downloadSelected(req: Request, res: Response) {
    try {
      const activeTab = (req.body.activeTab as string) || 'all';
      let filenames: string[] = [];
      if (Array.isArray(req.body.filenames)) {
        filenames = req.body.filenames;
      } else if (typeof req.body.filenames === 'string') {
        try {
          filenames = JSON.parse(req.body.filenames);
        } catch {
          filenames = req.body.filenames.split(',').map((s: string) => s.trim());
        }
      }

      const validFiles: string[] = [];
      const uploadsDir = getUploadsDirectory();

      for (const fn of filenames) {
        const clean = path.basename(fn);
        if (fs.existsSync(path.join(uploadsDir, clean))) {
          validFiles.push(clean);
        }
      }

      if (validFiles.length === 0) {
        (req as any).session.toast = { type: 'error', message: 'Pilih minimal satu berkas valid untuk diunduh!' };
        return res.redirect(`/admin/files?tab=${activeTab}`);
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const archiveName = `simpeg-berkas-terpilih-${dateStr}.tar.gz`;

      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);

      const tar = spawn('tar', ['-czf', '-', '-C', uploadsDir, ...validFiles]);
      tar.stdout.pipe(res);
      tar.stderr.on('data', d => console.error('[Tar Download Selected Error]:', d.toString()));
    } catch (error) {
      console.error('[FileManager] Download selected error:', error);
      res.status(500).send('Gagal mengunduh berkas terpilih.');
    }
  }
};
