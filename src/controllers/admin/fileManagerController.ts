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
  relatedId?: string;
  url: string;
}

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

export const fileManagerController = {
  /**
   * GET /admin/files
   * List all uploaded files with rich metadata and filters
   */
  async show(req: Request, res: Response) {
    try {
      const uploadsDir = getUploadsDirectory();
      const rawEntries = fs.readdirSync(uploadsDir);

      // Fetch DB metadata for association
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

      const BULAN_NAMES = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

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

        // Check if matches E-Kinerja
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
          relatedId = matchedEkinerja.id;
        } else {
          // Check if matches Clarification
          const matchedClar = clarifications.find(c => c.fileUrl && c.fileUrl.includes(entry));
          if (matchedClar) {
            kategori = 'klarifikasi';
            badgeColor = 'bg-indigo-50 text-indigo-700 border-indigo-200';
            kategoriLabel = 'Klarifikasi Absen';
            pegawaiNama = matchedClar.employee?.nama;
            unitNama = matchedClar.employee?.unit?.namaUnit;
            periode = matchedClar.tanggalAbsen;
            relatedId = matchedClar.id;
          } else if (ext === '.xlsx' || ext === '.xls' || ext === '.csv' || entry.toLowerCase().includes('rekap')) {
            kategori = 'absensi';
            badgeColor = 'bg-teal-50 text-teal-700 border-teal-200';
            kategoriLabel = 'Rekap Absensi / Excel';
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
          relatedId,
          url: `/uploads/${entry}`
        });
      }

      // Sort by modified time descending (newest first)
      fileItems.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // Calculate overview stats
      const totalFiles = fileItems.length;
      const totalSizeBytes = fileItems.reduce((acc, f) => acc + f.sizeBytes, 0);
      const totalSizeFormatted = formatBytes(totalSizeBytes);
      const countEkinerja = fileItems.filter(f => f.kategori === 'ekinerja').length;
      const countKlarifikasi = fileItems.filter(f => f.kategori === 'klarifikasi').length;
      const countAbsensi = fileItems.filter(f => f.kategori === 'absensi').length;

      // Filter params
      const search = (req.query.search as string || '').trim().toLowerCase();
      const filterKategori = (req.query.kategori as string || 'all').toLowerCase();
      const filterBulan = req.query.bulan ? parseInt(req.query.bulan as string, 10) : 0;
      const filterTahun = req.query.tahun ? parseInt(req.query.tahun as string, 10) : 0;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = 20;

      let filtered = fileItems;

      if (filterKategori && filterKategori !== 'all') {
        filtered = filtered.filter(f => f.kategori === filterKategori);
      }

      if (search) {
        filtered = filtered.filter(f =>
          f.filename.toLowerCase().includes(search) ||
          f.originalName.toLowerCase().includes(search) ||
          (f.pegawaiNama && f.pegawaiNama.toLowerCase().includes(search)) ||
          (f.unitNama && f.unitNama.toLowerCase().includes(search))
        );
      }

      if (filterBulan > 0 || filterTahun > 0) {
        filtered = filtered.filter(f => {
          const fileDate = new Date(f.mtime);
          const matchMonth = filterBulan > 0 ? (fileDate.getMonth() + 1 === filterBulan) : true;
          const matchYear = filterTahun > 0 ? (fileDate.getFullYear() === filterTahun) : true;
          return matchMonth && matchYear;
        });
      }

      // Pagination
      const totalFiltered = filtered.length;
      const totalPages = Math.ceil(totalFiltered / limit) || 1;
      const startIndex = (page - 1) * limit;
      const paginatedFiles = filtered.slice(startIndex, startIndex + limit);

      res.render('admin/files', {
        title: 'Manajemen Berkas Upload',
        page: 'admin-files',
        user: (req as any).session?.user,
        toast: (req as any).session?.toast || null,
        files: paginatedFiles,
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
          search,
          kategori: filterKategori,
          bulan: filterBulan,
          tahun: filterTahun
        }
      });

      // Clear toast after render
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

      if (uploadedList.length === 0) {
        (req as any).session.toast = { type: 'error', message: 'Silakan pilih berkas yang ingin diunggah!' };
        return res.redirect('/admin/files');
      }

      (req as any).session.toast = {
        type: 'success',
        message: `Berhasil mengunggah ${uploadedList.length} berkas fisik ke server!`
      };
      return res.redirect('/admin/files');
    } catch (error) {
      console.error('[FileManager] Upload error:', error);
      (req as any).session.toast = { type: 'error', message: 'Gagal mengunggah berkas.' };
      return res.redirect('/admin/files');
    }
  },

  /**
   * POST /admin/files/rename
   * Rename a physical file and update database reference if applicable
   */
  async renameFile(req: Request, res: Response) {
    try {
      const { oldFilename, newFilename } = req.body;
      if (!oldFilename || !newFilename) {
        (req as any).session.toast = { type: 'error', message: 'Nama berkas lama dan baru harus diisi!' };
        return res.redirect('/admin/files');
      }

      const uploadsDir = getUploadsDirectory();
      const oldPath = path.join(uploadsDir, path.basename(oldFilename));

      if (!fs.existsSync(oldPath)) {
        (req as any).session.toast = { type: 'error', message: 'Berkas asli tidak ditemukan di server!' };
        return res.redirect('/admin/files');
      }

      // Preserve original extension if omitted
      const oldExt = path.extname(oldFilename);
      let targetName = path.basename(newFilename).replace(/\s+/g, '_');
      if (!targetName.toLowerCase().endsWith(oldExt.toLowerCase())) {
        targetName += oldExt;
      }

      const newPath = path.join(uploadsDir, targetName);

      if (fs.existsSync(newPath) && targetName !== oldFilename) {
        (req as any).session.toast = { type: 'error', message: 'Nama berkas baru sudah digunakan oleh berkas lain!' };
        return res.redirect('/admin/files');
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
      return res.redirect('/admin/files');
    } catch (error) {
      console.error('[FileManager] Rename error:', error);
      (req as any).session.toast = { type: 'error', message: 'Gagal mengubah nama berkas.' };
      return res.redirect('/admin/files');
    }
  },

  /**
   * POST /admin/files/delete
   * Delete a single physical file from disk and nullify database references
   */
  async deleteFile(req: Request, res: Response) {
    try {
      const { filename } = req.body;
      if (!filename) {
        (req as any).session.toast = { type: 'error', message: 'Nama berkas tidak valid!' };
        return res.redirect('/admin/files');
      }

      const uploadsDir = getUploadsDirectory();
      const filePath = path.join(uploadsDir, path.basename(filename));

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Nullify references in DB
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
      return res.redirect('/admin/files');
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
        return res.redirect('/admin/files');
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
      return res.redirect('/admin/files');
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
      const uploadsDir = getUploadsDirectory();
      const dateStr = new Date().toISOString().slice(0, 10);
      const archiveName = `simpeg-semua-berkas-${dateStr}.tar.gz`;

      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);

      const tar = spawn('tar', ['-czf', '-', '-C', uploadsDir, '.']);
      tar.stdout.pipe(res);
      tar.stderr.on('data', d => console.error('[Tar Download All Error]:', d.toString()));
      tar.on('close', code => {
        if (code !== 0) console.warn('[Tar Download All] process exited with code:', code);
      });
    } catch (error) {
      console.error('[FileManager] Download all error:', error);
      res.status(500).send('Gagal membuat arsip unduhan.');
    }
  },

  /**
   * GET /admin/files/download-month
   * Stream files for a specific month/year as .tar.gz
   */
  async downloadByMonth(req: Request, res: Response) {
    try {
      const bulan = parseInt(req.query.bulan as string, 10);
      const tahun = parseInt(req.query.tahun as string, 10);

      if (!bulan || !tahun) {
        return res.status(400).send('Bulan dan Tahun harus disertakan!');
      }

      const uploadsDir = getUploadsDirectory();
      const rawEntries = fs.readdirSync(uploadsDir);

      // Find files matching this month and year from disk mtime
      const matchedFiles: string[] = [];
      for (const entry of rawEntries) {
        if (entry.startsWith('.') || entry === '.gitkeep') continue;
        const fullPath = path.join(uploadsDir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) continue;
          const d = new Date(stat.mtime);
          if (d.getMonth() + 1 === bulan && d.getFullYear() === tahun) {
            matchedFiles.push(entry);
          }
        } catch {}
      }

      if (matchedFiles.length === 0) {
        (req as any).session.toast = {
          type: 'error',
          message: `Tidak ada berkas yang ditemukan pada periode Bulan ${bulan} Tahun ${tahun}!`
        };
        return res.redirect('/admin/files');
      }

      const archiveName = `simpeg-berkas-${tahun}-${bulan < 10 ? '0' + bulan : bulan}.tar.gz`;
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);

      const tar = spawn('tar', ['-czf', '-', '-C', uploadsDir, ...matchedFiles]);
      tar.stdout.pipe(res);
      tar.stderr.on('data', d => console.error('[Tar Download Month Error]:', d.toString()));
    } catch (error) {
      console.error('[FileManager] Download by month error:', error);
      res.status(500).send('Gagal mengunduh berkas periode.');
    }
  },

  /**
   * POST /admin/files/download-selected
   * Stream selected files list as .tar.gz
   */
  async downloadSelected(req: Request, res: Response) {
    try {
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
        return res.redirect('/admin/files');
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
