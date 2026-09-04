import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import prisma from '../../lib/prisma';

const MONTH_MAP: Record<string, number> = {
  januari: 1, jan: 1, january: 1,
  februari: 2, feb: 2, pebruari: 2, february: 2,
  maret: 3, mar: 3, march: 3,
  april: 4, apr: 4,
  mei: 5, may: 5,
  juni: 6, jun: 6, june: 6,
  juli: 7, jul: 7, july: 7,
  agustus: 8, agu: 8, ags: 8, aug: 8, august: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, oct: 10, october: 10,
  november: 11, nopember: 11, nov: 11,
  desember: 12, dec: 12, december: 12
};

// Helper function to extract date from inside Excel sheet content (e.g. Row 2: "DATA PER-03 Agustus 2026")
function extractDateFromExcel(rawRows: any[][]): { day: number; month: number; year: number; raw?: string } | null {
  if (!rawRows || rawRows.length === 0) return null;

  // Primary Strategy: Scan top 10 rows for 'DATA PER...' text (Indonesian months or numeric)
  for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
    const row = rawRows[r];
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      if (!cell) continue;
      const str = String(cell).trim();

      // Match 'DATA PER-03 Agustus 2026', 'DATA PER 3 AGUSTUS 2026', 'DATA PER: 03-Agustus-2026', 'DATA PER TANGGAL 03 AGUSTUS 2026'
      const matchText = str.match(/DATA\s*PER(?:[-:\s]|TANGGAL)*\s*(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})/i);
      if (matchText) {
        const day = parseInt(matchText[1], 10);
        const mStr = matchText[2].toLowerCase();
        const year = parseInt(matchText[3], 10);
        const month = MONTH_MAP[mStr];
        if (month && day >= 1 && day <= 31 && year >= 2020 && year <= 2099) {
          return { day, month, year, raw: str };
        }
      }

      // Match 'DATA PER-03-08-2026' or 'DATA PER-03/08/2026'
      const matchNum = str.match(/DATA\s*PER(?:[-:\s]|TANGGAL)*\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/i);
      if (matchNum) {
        const day = parseInt(matchNum[1], 10);
        const month = parseInt(matchNum[2], 10);
        const year = parseInt(matchNum[3], 10);
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2020 && year <= 2099) {
          return { day, month, year, raw: str };
        }
      }

      // General fallback in cell: '03 Agustus 2026'
      const matchGeneral = str.match(/(?:^|\b)(\d{1,2})\s+(januari|februari|pebruari|maret|april|mei|juni|juli|agustus|september|oktober|november|nopember|desember)\s+(\d{4})\b/i);
      if (matchGeneral) {
        const day = parseInt(matchGeneral[1], 10);
        const mStr = matchGeneral[2].toLowerCase();
        const year = parseInt(matchGeneral[3], 10);
        const month = MONTH_MAP[mStr];
        if (month && day >= 1 && day <= 31 && year >= 2020 && year <= 2099) {
          return { day, month, year, raw: str };
        }
      }
    }
  }

  // Secondary Strategy: Scan first 30 rows for timestamp cell format e.g. '2026-08-03 06:24:43'
  for (let r = 0; r < Math.min(rawRows.length, 30); r++) {
    const row = rawRows[r];
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      if (!cell) continue;
      const str = String(cell).trim();
      const matchDate = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+\d{2}:\d{2}(?::\d{2})?)?$/);
      if (matchDate) {
        const year = parseInt(matchDate[1], 10);
        const month = parseInt(matchDate[2], 10);
        const day = parseInt(matchDate[3], 10);
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2020 && year <= 2099) {
          return { day, month, year, raw: str };
        }
      }
    }
  }

  return null;
}

// Helper function to extract date from filename format: Export_eabsensi_DDMMYYYY_HHMMSS (Fallback)
function extractDateFromFilename(filename: string): { day: number; month: number; year: number } | null {
  // Primary Pattern: Export_eabsensi_13082026_131053 (DDMMYYYY)
  const match1 = filename.match(/Export_eabsensi_(\d{2})(\d{2})(\d{4})/i);
  if (match1) {
    return {
      day: parseInt(match1[1], 10),
      month: parseInt(match1[2], 10),
      year: parseInt(match1[3], 10)
    };
  }

  // Fallback Pattern 1: DDMMYYYY in filename
  const match2 = filename.match(/(?:^|[^0-9])(\d{2})(\d{2})(\d{4})(?:[^0-9]|$)/);
  if (match2) {
    const day = parseInt(match2[1], 10);
    const month = parseInt(match2[2], 10);
    const year = parseInt(match2[3], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2020 && year <= 2099) {
      return { day, month, year };
    }
  }

  // Fallback Pattern 2: YYYY-MM-DD or YYYYMMDD
  const match3 = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
  if (match3) {
    const year = parseInt(match3[1], 10);
    const month = parseInt(match3[2], 10);
    const day = parseInt(match3[3], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return { day, month, year };
    }
  }

  return null;
}

// Helper to map status from "Verifikasi SKPD" column
function mapSkpdStatus(rawStatus: any): string {
  if (!rawStatus) return 'HADIR';
  const s = String(rawStatus).trim().toUpperCase();

  // NL = Hadir Normal
  if (s === 'NL' || s === 'NORMAL' || s === 'HADIR' || s === 'H' || s.includes('NORMAL')) {
    return 'HADIR';
  }
  // DL = DL Biru (Dinas Luar Sesuai)
  if (s === 'DL' || s === 'DINAS LUAR' || s === 'DINAS_LUAR' || s === 'DL BIRU') {
    return 'DL';
  }
  // DL-K = DL Kuning (Dinas Luar Belum Sesuai)
  if (s === 'DL-K' || s === 'DLK' || s === 'DL KUNING' || s === 'DL_KUNING' || s.includes('KUNING')) {
    return 'DL_KUNING';
  }
  // TK = Tanpa Keterangan / Alpha
  if (s === 'TK' || s === 'A' || s === 'ALPHA' || s === 'ALPA' || s.includes('TANPA KETERANGAN') || s.includes('ALPHA')) {
    return 'TK';
  }
  // TL = Terlambat
  if (s === 'TL' || s.includes('TERLAMBAT')) {
    return 'TL';
  }
  // PC = Pulang Cepat
  if (s === 'PC' || s.includes('PULANG CEPAT')) {
    return 'PC';
  }
  // ST = Sakit
  if (s === 'ST' || s === 'S' || s.includes('SAKIT')) {
    return 'ST';
  }
  // CT = Cuti
  if (s === 'CT' || s === 'C' || s.includes('CUTI')) {
    return 'CT';
  }
  // LIBUR = Hari Libur
  if (s === 'LIBUR' || s.includes('LIBUR')) {
    return 'LIBUR';
  }

  // Default fallback
  return 'HADIR';
}

export const uploadAbsensiController = {
  show: async (req: Request, res: Response) => {
    try {
      const user = (req as any).session?.user;

      const [totalEmployees, totalDays, periods, totalUnits] = await Promise.all([
        prisma.employee.count({ where: { aktif: true } }),
        prisma.attendanceDay.count(),
        prisma.attendancePeriod.findMany({
          orderBy: [
            { tahun: 'desc' },
            { bulan: 'desc' }
          ],
          include: {
            _count: {
              select: { attendanceDays: true }
            }
          },
          take: 12
        }),
        prisma.unit.count()
      ]);

      const bulanNames = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
      ];

      const formattedPeriods = periods.map((p: any) => ({
        id: p.id,
        bulan: p.bulan,
        tahun: p.tahun,
        namaBulan: bulanNames[p.bulan - 1] || `Bulan ${p.bulan}`,
        totalRecords: p._count?.attendanceDays || 0,
        createdAt: p.createdAt ? p.createdAt.toISOString().substring(0, 10) : '-'
      }));

      res.render('admin/upload-absensi', {
        title: 'Upload Rekap Absensi - Panel Admin SIMPEG',
        page: 'admin-upload-absensi',
        user,
        totalEmployees,
        totalDays,
        periods: formattedPeriods,
        totalUnits
      });
    } catch (error) {
      console.error('Error in uploadAbsensiController.show:', error);
      res.status(500).send('Terjadi kesalahan internal server.');
    }
  },

  processUpload: async (req: Request, res: Response) => {
    const uploadedFiles = req.files as Express.Multer.File[];
    const singleFile = req.file;
    const files: Express.Multer.File[] = uploadedFiles || (singleFile ? [singleFile] : []);

    if (!files || files.length === 0) {
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'warning',
          message: 'Peringatan: Tidak ada file Excel yang dipilih untuk diunggah.'
        };
      }
      return res.redirect('/admin/upload-absensi');
    }

    try {
      // 1. Fetch all active employees into a Map for fast lookup
      const employees = await prisma.employee.findMany({
        select: { id: true, nip: true, nama: true }
      });

      const employeeMap = new Map<string, { id: string; nama: string }>();
      for (const emp of employees) {
        // Clean NIP (digits only)
        const cleanNip = emp.nip.replace(/[^0-9]/g, '');
        if (cleanNip) {
          employeeMap.set(cleanNip, { id: emp.id, nama: emp.nama });
        }
        // Also map exact string
        employeeMap.set(emp.nip.trim(), { id: emp.id, nama: emp.nama });
      }

      let totalSyncedRows = 0;
      let totalFilesProcessed = 0;
      const processedDates: string[] = [];
      const errorFiles: string[] = [];

      // 2. Process each uploaded file
      for (const file of files) {
        try {
          // Read Excel Workbook first
          const workbook = XLSX.readFile(file.path);
          const firstSheetName = workbook.SheetNames[0];
          if (!firstSheetName) {
            errorFiles.push(`${file.originalname} (File kosong)`);
            continue;
          }

          const sheet = workbook.Sheets[firstSheetName];
          const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

          if (!rawRows || rawRows.length === 0) {
            errorFiles.push(`${file.originalname} (Tidak ada baris data)`);
            continue;
          }

          // Extract date from Excel content (Row 2 'DATA PER...' or check-in cell), fallback to filename
          const dateInfo = extractDateFromExcel(rawRows) || extractDateFromFilename(file.originalname);
          if (!dateInfo) {
            console.warn(`Could not extract date from Excel file: ${file.originalname}`);
            errorFiles.push(`${file.originalname} (Tanggal absensi tidak ditemukan di dalam isi file)`);
            continue;
          }

          const { day, month, year } = dateInfo;
          processedDates.push(`${day}/${month}/${year}`);

          // Find or create AttendancePeriod
          const period = await prisma.attendancePeriod.upsert({
            where: {
              bulan_tahun: {
                bulan: month,
                tahun: year
              }
            },
            update: {},
            create: {
              bulan: month,
              tahun: year
            }
          });

          // 3. Locate Header Row
          let headerRowIndex = -1;
          let nipColIndex = -1;
          let skpdColIndex = -1;

          for (let r = 0; r < Math.min(rawRows.length, 15); r++) {
            const row = rawRows[r];
            if (!Array.isArray(row)) continue;

            const nipIdx = row.findIndex(cell => {
              const str = String(cell).toLowerCase();
              return str.includes('nip') || str.includes('nomor induk');
            });

            const skpdIdx = row.findIndex(cell => {
              const str = String(cell).toLowerCase();
              return (
                str.includes('verifikasi skpd') ||
                str.includes('verifikasi_skpd') ||
                str.includes('verifikasi') ||
                str.includes('skpd')
              );
            });

            if (nipIdx !== -1) {
              headerRowIndex = r;
              nipColIndex = nipIdx;
              skpdColIndex = skpdIdx !== -1 ? skpdIdx : -1;
              break;
            }
          }

          if (headerRowIndex === -1 || nipColIndex === -1) {
            errorFiles.push(`${file.originalname} (Kolom NIP tidak ditemukan)`);
            continue;
          }

          // If SKPD column wasn't in the exact same header row, search secondary
          if (skpdColIndex === -1) {
            const headerRow = rawRows[headerRowIndex];
            skpdColIndex = headerRow.findIndex(cell => {
              const str = String(cell).toLowerCase();
              return str.includes('status') || str.includes('absen') || str.includes('keterangan');
            });
          }

          // 4. Process Data Rows
          let fileSyncedCount = 0;
          for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
            const row = rawRows[r];
            if (!Array.isArray(row) || row.length === 0) continue;

            const rawNip = String(row[nipColIndex] || '').trim();
            const cleanNip = rawNip.replace(/[^0-9]/g, '');

            if (!cleanNip || cleanNip.length < 5) continue; // Skip non-NIP rows

            const emp = employeeMap.get(cleanNip) || employeeMap.get(rawNip);
            if (!emp) continue; // Employee not found in DB

            const rawStatus = skpdColIndex !== -1 ? row[skpdColIndex] : 'NL';
            const mappedStatus = mapSkpdStatus(rawStatus);

            await prisma.attendanceDay.upsert({
              where: {
                employeeId_periodId_tanggal: {
                  employeeId: emp.id,
                  periodId: period.id,
                  tanggal: day
                }
              },
              update: {
                status: mappedStatus,
                keterangan: `Sinkronisasi Absen Bisma: ${file.originalname}`
              },
              create: {
                employeeId: emp.id,
                periodId: period.id,
                tanggal: day,
                status: mappedStatus,
                keterangan: `Sinkronisasi Absen Bisma: ${file.originalname}`
              }
            });

            fileSyncedCount++;
          }

          totalSyncedRows += fileSyncedCount;
          totalFilesProcessed++;
        } catch (fileErr) {
          console.error(`Error processing file ${file.originalname}:`, fileErr);
          errorFiles.push(`${file.originalname} (Gagal diproses)`);
        } finally {
          // Clean up temporary uploaded file from disk
          try {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
          } catch (unlinkErr) {
            console.warn(`Could not delete temp file ${file.path}:`, unlinkErr);
          }
        }
      }

      // 5. Toast Feedback to User
      if (totalFilesProcessed > 0) {
        const uniqueDates = Array.from(new Set(processedDates));
        let msg = `Sinkronisasi Berhasil! Sebanyak ${totalFilesProcessed} file Excel Absen Bisma telah diproses dengan total ${totalSyncedRows} data presensi pegawai berhasil diperbarui untuk tanggal [${uniqueDates.join(', ')}].`;
        if (errorFiles.length > 0) {
          msg += ` Catatan: ${errorFiles.length} file dilewati (${errorFiles.join(', ')}).`;
        }

        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'success',
            message: msg
          };
        }
      } else {
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'danger',
            message: `Gagal memproses file. Pastikan file Excel Absen Bisma memuat tanggal presensi di baris atas (misal: 'DATA PER-03 Agustus 2026') serta kolom 'NIP' dan 'Verifikasi SKPD'. ${errorFiles.join(', ')}`
          };
        }
      }

      res.redirect('/admin/upload-absensi');
    } catch (error) {
      console.error('Error in uploadAbsensiController.processUpload:', error);

      // Clean up files in case of major error
      for (const file of files) {
        try {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (_) {}
      }

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'danger',
          message: 'Terjadi kesalahan sistem saat memproses sinkronisasi data presensi.'
        };
      }
      res.redirect('/admin/upload-absensi');
    }
  },

  resetAttendance: async (req: Request, res: Response) => {
    try {
      const [deletedDays, deletedPeriods] = await Promise.all([
        prisma.attendanceDay.deleteMany(),
        prisma.attendancePeriod.deleteMany()
      ]);

      console.log(`[UploadAbsensi] Reset completed: deleted ${deletedDays.count} days, ${deletedPeriods.count} periods.`);

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Berhasil mengosongkan data presensi: Sebanyak ${deletedDays.count} record kehadiran dan ${deletedPeriods.count} periode telah dihapus (kembali ke 0 record).`
        };
      }

      res.redirect('/admin/upload-absensi');
    } catch (error) {
      console.error('Error in uploadAbsensiController.resetAttendance:', error);
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'danger',
          message: 'Gagal mengosongkan data presensi.'
        };
      }
      res.redirect('/admin/upload-absensi');
    }
  }
};
