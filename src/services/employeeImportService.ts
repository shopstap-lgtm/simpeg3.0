import * as XLSX from 'xlsx';
import prisma from '../lib/prisma';

export interface ImportEmployeeResult {
  success: boolean;
  totalProcessed: number;
  totalCreated: number;
  totalUpdated: number;
  errors: string[];
}

export function generateEmployeeExcelTemplate(): Buffer {
  const wb = XLSX.utils.book_new();

  const sampleData = [
    {
      'NIP (Wajib)': '198503152010011012',
      'Nama Lengkap (Wajib)': 'Ahmad Fauzi, S.Pd.',
      'Jabatan / Tugas (Wajib)': 'Guru Kelas VI',
      'Unit Kerja (Wajib)': 'SDN Cibitung 01',
      'Status Kepegawaian (PNS / PPPK / PPPK_PW / OUTSOURCING)': 'PNS',
      'Status Aktif (YA / TIDAK)': 'YA'
    },
    {
      'NIP (Wajib)': '199008222019032008',
      'Nama Lengkap (Wajib)': 'Siti Nurhaliza, M.Pd.',
      'Jabatan / Tugas (Wajib)': 'Guru Kelas III',
      'Unit Kerja (Wajib)': 'SDN Cibitung 01',
      'Status Kepegawaian (PNS / PPPK / PPPK_PW / OUTSOURCING)': 'PPPK',
      'Status Aktif (YA / TIDAK)': 'YA'
    },
    {
      'NIP (Wajib)': '199512102022011005',
      'Nama Lengkap (Wajib)': 'Budi Santoso, S.Kom.',
      'Jabatan / Tugas (Wajib)': 'Tenaga Administrasi Sekolah',
      'Unit Kerja (Wajib)': 'SMPN 1 Cibitung',
      'Status Kepegawaian (PNS / PPPK / PPPK_PW / OUTSOURCING)': 'PPPK_PW',
      'Status Aktif (YA / TIDAK)': 'YA'
    },
    {
      'NIP (Wajib)': '199804052023022003',
      'Nama Lengkap (Wajib)': 'Dewi Lestari, S.Pd.',
      'Jabatan / Tugas (Wajib)': 'Guru PJOK',
      'Unit Kerja (Wajib)': 'SMPN 1 Cibitung',
      'Status Kepegawaian (PNS / PPPK / PPPK_PW / OUTSOURCING)': 'OUTSOURCING',
      'Status Aktif (YA / TIDAK)': 'YA'
    }
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);

  // Set column widths
  ws['!cols'] = [
    { wch: 24 }, // NIP
    { wch: 32 }, // Nama
    { wch: 28 }, // Jabatan
    { wch: 28 }, // Unit
    { wch: 36 }, // Status
    { wch: 18 }  // Aktif
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Template Pegawai');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export async function importEmployeesFromExcel(fileBuffer: Buffer): Promise<ImportEmployeeResult> {
  const result: ImportEmployeeResult = {
    success: true,
    totalProcessed: 0,
    totalCreated: 0,
    totalUpdated: 0,
    errors: []
  };

  try {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      result.success = false;
      result.errors.push('File Excel kosong atau tidak memiliki data baris.');
      return result;
    }

    // Pre-fetch all units to avoid duplicate creations
    const existingUnits = await prisma.unit.findMany();
    const unitMap = new Map<string, string>();
    existingUnits.forEach(u => unitMap.set(u.namaUnit.trim().toLowerCase(), u.id));

    // Get active period
    const cms = await prisma.cmsConfig.findUnique({ where: { id: 'cms-main' } });
    const activeBulan = cms?.selectedMonth || 7;
    const activeTahun = cms?.selectedYear || 2026;
    const period = await prisma.attendancePeriod.upsert({
      where: { bulan_tahun: { bulan: activeBulan, tahun: activeTahun } },
      update: {},
      create: { bulan: activeBulan, tahun: activeTahun }
    });

    const daysInMonth = new Date(activeTahun, activeBulan, 0).getDate();

    for (let index = 0; index < rawRows.length; index++) {
      const row = rawRows[index];
      const rowNum = index + 2;

      let nip = '';
      let nama = '';
      let jabatan = 'Guru';
      let unitNama = '';
      let statusKepegawaian = 'PNS';
      let aktif = true;

      for (const [key, val] of Object.entries(row)) {
        const k = key.trim().toLowerCase();
        const v = String(val).trim();

        if (k.includes('nip')) {
          nip = v;
        } else if (k.includes('nama')) {
          nama = v;
        } else if (k.includes('jabat') || k.includes('tugas') || k.includes('posisi')) {
          jabatan = v;
        } else if (k.includes('unit') || k.includes('sekolah') || k.includes('instansi')) {
          unitNama = v;
        } else if (k.includes('status') && !k.includes('aktif')) {
          const upperV = v.toUpperCase();
          if (upperV.includes('PW') || upperV.includes('PARUH')) {
            statusKepegawaian = 'PPPK_PW';
          } else if (upperV.includes('PPPK') || upperV.includes('P3K')) {
            statusKepegawaian = 'PPPK';
          } else if (upperV.includes('OUT') || upperV.includes('OS') || upperV.includes('HONOR') || upperV.includes('KONTRAK')) {
            statusKepegawaian = 'OUTSOURCING';
          } else {
            statusKepegawaian = 'PNS';
          }
        } else if (k.includes('aktif')) {
          const upperV = v.toUpperCase();
          aktif = upperV === 'YA' || upperV === 'TRUE' || upperV === '1' || upperV === 'AKTIF' || upperV === '';
        }
      }

      if (!nip || !nama) {
        result.errors.push(`Baris ${rowNum}: NIP atau Nama Pegawai kosong, dilewati.`);
        continue;
      }

      if (!unitNama) {
        unitNama = 'Kantor Korwil Cibitung';
      }

      // Upsert Unit if not exists
      let unitId = unitMap.get(unitNama.toLowerCase());
      if (!unitId) {
        const createdUnit = await prisma.unit.create({
          data: { namaUnit: unitNama }
        });
        unitId = createdUnit.id;
        unitMap.set(unitNama.toLowerCase(), unitId);
      }

      // Check if employee exists by NIP
      const existingEmp = await prisma.employee.findUnique({
        where: { nip }
      });

      let empId = '';
      if (existingEmp) {
        await prisma.employee.update({
          where: { nip },
          data: {
            nama,
            jabatan: jabatan || existingEmp.jabatan || 'Guru',
            statusKepegawaian,
            unitId,
            aktif
          }
        });
        empId = existingEmp.id;
        result.totalUpdated++;
      } else {
        const newEmp = await prisma.employee.create({
          data: {
            nip,
            nama,
            jabatan: jabatan || 'Guru',
            statusKepegawaian,
            unitId,
            aktif
          }
        });
        empId = newEmp.id;
        result.totalCreated++;
      }

      // Seed baseline attendance days for current active month if not created yet
      const existingDaysCount = await prisma.attendanceDay.count({
        where: {
          employeeId: empId,
          periodId: period.id
        }
      });

      if (existingDaysCount === 0) {
        for (let day = 1; day <= daysInMonth; day++) {
          const date = new Date(activeTahun, activeBulan - 1, day);
          const dayOfWeek = date.getDay();
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

          await prisma.attendanceDay.create({
            data: {
              employeeId: empId,
              periodId: period.id,
              tanggal: day,
              status: isWeekend ? 'LIBUR' : 'HADIR',
              keterangan: isWeekend ? 'Akhir Pekan' : null
            }
          });
        }
      }

      result.totalProcessed++;
    }

    return result;
  } catch (error: any) {
    console.error('Error importing employees from Excel:', error);
    result.success = false;
    result.errors.push(`Gagal memproses file: ${error.message}`);
    return result;
  }
}
