import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import prisma from '../lib/prisma';
import { holidayService } from '../services/holidayService';

const BULAN_NAMES = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const buildAbsensiRedirectUrl = (req: Request, fallbackBulan?: number, fallbackTahun?: number) => {
  const unit = (req.body?.filterUnit || req.query?.unit || '') as string;
  const bulan = req.body?.filterBulan || req.body?.bulan || req.query?.bulan || fallbackBulan || '';
  const tahun = req.body?.filterTahun || req.body?.tahun || req.query?.tahun || fallbackTahun || '';
  const search = (req.body?.filterSearch || req.query?.search || '') as string;
  const page = (req.body?.filterPage || req.query?.page || '') as string;
  const nip = (req.body?.filterNip || req.body?.nip || req.query?.nip || '') as string;

  const params = new URLSearchParams();
  if (nip && nip.trim()) params.set('nip', nip.trim());
  if (unit && unit !== 'unit-all') params.set('unit', unit);
  if (bulan) params.set('bulan', String(bulan));
  if (tahun) params.set('tahun', String(tahun));
  if (search && search.trim()) params.set('search', search.trim());
  if (page && String(page) !== '1') params.set('page', String(page));

  const qs = params.toString();
  return qs ? `/absensi?${qs}` : '/absensi';
};

export const absensiController = {
  show: async (req: Request, res: Response) => {
    try {
      const cms = await prisma.cmsConfig.findUnique({ where: { id: 'cms-main' } });
      const activeDefaultMonth = cms?.selectedMonth || 7;
      const activeDefaultYear = cms?.selectedYear || 2026;

      const sessionUser = (req as any).session?.user || null;
      const isAdmin = !!sessionUser && (
        sessionUser.role === 'ADMIN' || 
        sessionUser.role === 'SUPERADMIN' || 
        sessionUser.role === 'SUPER_ADMIN' || 
        sessionUser.role === 'ADMIN_DINAS' ||
        sessionUser.role === 'ADMIN_SEKOLAH' ||
        sessionUser.role === 'ADMIN_KORWIL'
      );

      const bulan = parseInt(req.query.bulan as string) || activeDefaultMonth;
      const tahun = parseInt(req.query.tahun as string) || activeDefaultYear;
      const selectedUnit = (req.query.unit as string) || 'unit-all';
      const search = ((req.query.search as string) || '').trim();
      const rawNip = (req.query.nip as string) || '';
      const nipQuery = rawNip.replace(/\s+/g, '').trim();
      const isCekMandiri = req.query.cekMandiri === '1';

      // Pagination setup (default 25 rows)
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limitQuery = req.query.limit as string;
      const limit = limitQuery === 'all' ? 999999 : (parseInt(limitQuery) || 25);

      const whereEmp: any = { aktif: true };
      if (selectedUnit && selectedUnit !== 'unit-all') {
        whereEmp.unitId = selectedUnit;
      }
      if (nipQuery) {
        whereEmp.nip = nipQuery;
      } else if (search) {
        whereEmp.OR = [
          { nama: { contains: search, mode: 'insensitive' } },
          { nip: { contains: search } }
        ];
      }

      let employees: any[] = [];
      let totalFilteredEmployees = 0;
      let checkedEmployee: any = null;
      let nipNotFound = false;

      const [allUnits, allActiveEmployees, period] = await Promise.all([
        prisma.unit.findMany({ orderBy: { namaUnit: 'asc' } }),
        prisma.employee.findMany({
          where: { aktif: true },
          include: { unit: true },
          orderBy: { nama: 'asc' }
        }),
        prisma.attendancePeriod.findUnique({
          where: { bulan_tahun: { bulan, tahun } },
          include: { attendanceDays: true }
        })
      ]);

      // JIKA NIP DIISI (Opsi 1: Cek Mandiri Pegawai - berlaku baik untuk publik maupun admin yang sedang mencoba)
      const isCekPresensiClosed = !isAdmin && !!(cms as any)?.maintenanceCekPresensi;
      if (nipQuery && !isCekPresensiClosed) {
        const foundEmp = await prisma.employee.findFirst({
          where: { nip: nipQuery, aktif: true },
          include: { unit: true }
        });

        if (foundEmp) {
          checkedEmployee = foundEmp;
          employees = [foundEmp];
          totalFilteredEmployees = 1;
        } else {
          nipNotFound = true;
          employees = [];
          totalFilteredEmployees = 0;
        }
      } else if (!isAdmin || isCekMandiri) {
        // PUBLIK atau ADMIN MODE TRIAL: Belum memasukkan NIP -> tabel kosong demi privasi pegawai lain
        employees = [];
        totalFilteredEmployees = 0;
      } else {
        // ADMIN / SUPER ADMIN tanpa filter NIP khusus: Tampilkan seluruh pegawai dengan paginasi
        const [empCount, empList] = await Promise.all([
          prisma.employee.count({ where: whereEmp }),
          prisma.employee.findMany({
            where: whereEmp,
            include: { unit: true },
            orderBy: [
              { unit: { namaUnit: 'asc' } },
              { nama: 'asc' }
            ],
            skip: limit === 999999 ? 0 : (page - 1) * limit,
            take: limit
          })
        ]);
        totalFilteredEmployees = empCount;
        employees = empList;
      }

      // Ambil klarifikasi (hanya untuk pegawai bersangkutan jika ada pengecekan NIP)
      const clarifications = await prisma.clarification.findMany({
        where: checkedEmployee ? { employeeId: checkedEmployee.id } : (isAdmin ? undefined : { id: 'no-match' }),
        include: { employee: { include: { unit: true } } },
        orderBy: { createdAt: 'desc' }
      });

      const daysInMonth = new Date(tahun, bulan, 0).getDate();

      // OPTIMASI: Pre-group attendance days ke Map<employeeId, Map<tanggal, day>>
      const attendanceByEmp = new Map<string, Map<number, any>>();
      if (period) {
        for (const d of period.attendanceDays) {
          let m = attendanceByEmp.get(d.employeeId);
          if (!m) {
            m = new Map();
            attendanceByEmp.set(d.employeeId, m);
          }
          m.set(d.tanggal, d);
        }
      }

      // OPTIMASI: Pre-group klarifikasi ke Map<employeeId, Clarification[]>
      const clarificationsByEmp = new Map<string, any[]>();
      for (const c of clarifications) {
        let arr = clarificationsByEmp.get(c.employeeId);
        if (!arr) {
          arr = [];
          clarificationsByEmp.set(c.employeeId, arr);
        }
        arr.push(c);
      }

      // OPTIMASI: Precalculate metadata hari libur bulan ini 1 kali
      const holidaysMap = holidayService.getHolidaysForMonth(tahun, bulan);
      const daysMeta: { day: number; isWeekend: boolean; nationalHoliday: any }[] = [];
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(tahun, bulan - 1, day);
        const dayOfWeek = date.getDay();
        daysMeta.push({
          day,
          isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
          nationalHoliday: holidaysMap.get(day) || null
        });
      }

      // Build recap per employee (O(1) Map lookups per day)
      const recap = employees.map(emp => {
        const empDaysMap = attendanceByEmp.get(emp.id);
        const empClarifications = clarificationsByEmp.get(emp.id) || [];

        const days: any[] = [];
        let hadirCount = 0;
        let tkCount = 0;
        let dlCount = 0;
        let dlKuningCount = 0;
        let tlCount = 0;
        let pcCount = 0;
        let stCount = 0;
        let ctCount = 0;
        let totalEfektif = 0;

        for (const meta of daysMeta) {
          const day = meta.day;
          let status = 'EMPTY';
          let keterangan: string | null = null;

          if (empDaysMap && empDaysMap.has(day)) {
            const existing = empDaysMap.get(day);
            status = existing.status;
            keterangan = existing.keterangan;
          } else if (meta.nationalHoliday) {
            status = 'LIBUR';
            keterangan = `Libur Nasional: ${meta.nationalHoliday.name}`;
          } else if (meta.isWeekend) {
            status = 'LIBUR';
            keterangan = 'Akhir Pekan';
          } else {
            status = 'EMPTY';
            keterangan = 'Belum Ada Data Presensi';
          }

          // Find clarification status for this date
          const dateStr = `${tahun}-${String(bulan).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          let clarificationStatus: string | null = null;
          let clarificationNote: string | null = null;

          for (const c of empClarifications) {
            if (c.statusVerifikasi === 'PENDING' || c.statusVerifikasi === 'REJECTED') {
              if (c.tanggalAbsen.includes(' s/d ')) {
                const [startStr, endStr] = c.tanggalAbsen.split(' s/d ').map((s: string) => s.trim());
                if (dateStr >= startStr && dateStr <= endStr) {
                  clarificationStatus = c.statusVerifikasi;
                  clarificationNote = c.catatanAdmin || (c.statusVerifikasi === 'PENDING' ? 'Sedang dalam review verifikasi' : 'Ditolak');
                  break;
                }
              } else if (c.tanggalAbsen === dateStr) {
                clarificationStatus = c.statusVerifikasi;
                clarificationNote = c.catatanAdmin || (c.statusVerifikasi === 'PENDING' ? 'Sedang dalam review verifikasi' : 'Ditolak');
                break;
              }
            }
          }

          const isHolidayOrWeekend = meta.isWeekend || meta.nationalHoliday !== null;
          if (!isHolidayOrWeekend && status !== 'EMPTY') {
            totalEfektif++;
            if (status === 'HADIR') hadirCount++;
            else if (status === 'TK') tkCount++;
            else if (status === 'DL') dlCount++;
            else if (status === 'DL_KUNING') dlKuningCount++;
            else if (status === 'TL') tlCount++;
            else if (status === 'PC') pcCount++;
            else if (status === 'ST') stCount++;
            else if (status === 'CT') ctCount++;
          }

          days.push({
            tanggal: day,
            status,
            keterangan,
            clarificationStatus,
            clarificationNote
          });
        }

        // Perhitungan persentase kehadiran:
        const totalPresent = hadirCount + dlCount + dlKuningCount + tlCount + pcCount + stCount + ctCount;
        const persentase = totalEfektif > 0 ? Math.round((totalPresent / totalEfektif) * 100) : 0;

        return {
          employee: {
            id: emp.id,
            nip: emp.nip,
            nama: emp.nama,
            jabatan: emp.jabatan || 'Guru',
            statusKepegawaian: emp.statusKepegawaian,
            unitNama: emp.unit?.namaUnit || '-'
          },
          days,
          summary: {
            hadir: hadirCount,
            tk: tkCount,
            dl: dlCount,
            dlKuning: dlKuningCount,
            tl: tlCount,
            pc: pcCount,
            st: stCount,
            ct: ctCount,
            totalEfektif,
            persentase
          }
        };
      });

      const formattedClarifications = clarifications.map(c => ({
        id: c.id,
        employeeId: c.employeeId,
        employeeName: c.employee.nama,
        employeeNip: c.employee.nip,
        unitNama: c.employee.unit.namaUnit,
        tanggalAbsen: c.tanggalAbsen,
        statusAwal: c.statusAwal,
        statusPengganti: c.statusPengganti,
        alasan: c.alasan,
        fileUrl: c.fileUrl,
        fileName: c.fileName,
        statusVerifikasi: c.statusVerifikasi,
        catatanAdmin: c.catatanAdmin,
        reviewedBy: c.reviewedBy,
        reviewedAt: c.reviewedAt,
        createdAt: c.createdAt.toISOString().replace('T', ' ').substring(0, 16)
      }));

      const isDefaultPeriod = (bulan === activeDefaultMonth && tahun === activeDefaultYear);

      const units = [
        { id: 'unit-all', namaUnit: 'Semua Unit Kerja' },
        ...allUnits
      ];

      res.render('absensi', {
        title: 'Rekap Absensi Pegawai - SIMPEG Korwil Cibitung',
        page: 'absensi',
        user: sessionUser,
        recap,
        clarifications: formattedClarifications,
        units,
        allActiveEmployees,
        selectedUnit,
        bulan,
        tahun,
        activeDefaultMonth,
        activeDefaultYear,
        daysInMonth,
        search,
        nipQuery,
        nipNotFound,
        checkedEmployee,
        isCekMandiri,
        isDefaultPeriod,
        holidays: Object.fromEntries(holidayService.getHolidaysForMonth(tahun, bulan)),
        isAdmin,
        isSuperAdminOrDinas: isAdmin && (sessionUser?.role === 'SUPER_ADMIN' || sessionUser?.role === 'ADMIN_DINAS'),
        klarifikasiConfig: {
          month: (cms as any)?.klarifikasiMonth || cms?.selectedMonth || 7,
          nlEnabled: cms?.klarifikasiNlEnabled || false,
          nlDates: cms?.klarifikasiNlDates || 'ALL',
          pcEnabled: cms?.klarifikasiPcEnabled || false,
          pcDates: cms?.klarifikasiPcDates || 'ALL'
        },
        pagination: {
          page,
          limit: limitQuery === 'all' ? 'all' : limit,
          totalItems: totalFilteredEmployees,
          totalPages: limit === 999999 ? 1 : Math.max(1, Math.ceil(totalFilteredEmployees / limit)),
          from: totalFilteredEmployees === 0 ? 0 : (page - 1) * limit + 1,
          to: limit === 999999 ? totalFilteredEmployees : Math.min(page * limit, totalFilteredEmployees)
        },
        maintenanceCekPresensi: !!(cms as any)?.maintenanceCekPresensi,
        maintenanceTitle: (cms as any)?.maintenanceTitle || 'Sedang Dalam Pemeliharaan',
        maintenanceMessage: (cms as any)?.maintenanceMessage || 'Form cek presensi mandiri pegawai sedang dalam pemeliharaan berkala. Mohon kembali beberapa saat lagi.'
      });
    } catch (error: any) {
      console.error('Error in absensiController.show:', error);
      res.status(500).render('partials/404', {
        title: 'Terjadi Kesalahan - SIMPEG Korwil Cibitung',
        page: '500',
        user: (req as any).session?.user || null
      });
    }
  },

  directUpdate: async (req: Request, res: Response) => {
    try {
      const user = (req as any).session?.user;
      if (!user) {
        return res.status(401).json({ success: false, message: 'Harus login terlebih dahulu' });
      }

      const { employeeId, tanggal, bulan, tahun, status, keterangan } = req.body;
      if (!employeeId || !tanggal || !bulan || !tahun || !status) {
        return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
      }

      const b = parseInt(bulan);
      const t = parseInt(tahun);
      const tgl = parseInt(tanggal);

      const period = await prisma.attendancePeriod.upsert({
        where: { bulan_tahun: { bulan: b, tahun: t } },
        update: {},
        create: { bulan: b, tahun: t }
      });

      if (status === 'EMPTY') {
        await prisma.attendanceDay.deleteMany({
          where: {
            employeeId,
            periodId: period.id,
            tanggal: tgl
          }
        });
      } else {
        await prisma.attendanceDay.upsert({
          where: {
            employeeId_periodId_tanggal: {
              employeeId,
              periodId: period.id,
              tanggal: tgl
            }
          },
          update: {
            status,
            keterangan: keterangan || null
          },
          create: {
            employeeId,
            periodId: period.id,
            tanggal: tgl,
            status,
            keterangan: keterangan || null
          }
        });
      }

      const redirectUrl = buildAbsensiRedirectUrl(req, b, t);

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: status === 'EMPTY'
            ? `Status presensi tanggal ${tgl} berhasil dikosongkan.`
            : `Status presensi tanggal ${tgl} berhasil diubah menjadi ${status === 'LIBUR' ? 'Libur (L)' : status}.`
        };
        return (req as any).session.save(() => res.redirect(redirectUrl));
      }

      res.redirect(redirectUrl);
    } catch (error: any) {
      console.error('Error in absensiController.directUpdate:', error);
      res.redirect(buildAbsensiRedirectUrl(req));
    }
  },

  bulkDateUpdate: async (req: Request, res: Response) => {
    try {
      const user = (req as any).session?.user;
      if (!user) {
        return res.status(401).json({ success: false, message: 'Harus login terlebih dahulu' });
      }

      if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN_DINAS') {
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'danger',
            message: 'Akses Ditolak: Fitur ubah status vertikal massal hanya untuk Super Admin dan Admin Dinas.'
          };
        }
        return res.redirect('/absensi');
      }

      const { tanggal, bulan, tahun, status, keterangan } = req.body;
      if (!tanggal || !bulan || !tahun || !status) {
        return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
      }

      const b = parseInt(bulan);
      const t = parseInt(tahun);
      const tgl = parseInt(tanggal);

      const period = await prisma.attendancePeriod.upsert({
        where: { bulan_tahun: { bulan: b, tahun: t } },
        update: {},
        create: { bulan: b, tahun: t }
      });

      const activeEmployees = await prisma.employee.findMany({
        where: { aktif: true },
        select: { id: true }
      });

      if (status === 'EMPTY') {
        await prisma.attendanceDay.deleteMany({
          where: {
            periodId: period.id,
            tanggal: tgl
          }
        });
      } else {
        const updates = activeEmployees.map(emp => 
          prisma.attendanceDay.upsert({
            where: {
              employeeId_periodId_tanggal: {
                employeeId: emp.id,
                periodId: period.id,
                tanggal: tgl
              }
            },
            update: {
              status,
              keterangan: keterangan || null
            },
            create: {
              employeeId: emp.id,
              periodId: period.id,
              tanggal: tgl,
              status,
              keterangan: keterangan || null
            }
          })
        );

        await prisma.$transaction(updates);
      }

      const redirectUrl = buildAbsensiRedirectUrl(req, b, t);

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: status === 'EMPTY'
            ? `Presensi tanggal ${tgl} untuk seluruh pegawai (${activeEmployees.length} orang) berhasil dikosongkan.`
            : `Presensi tanggal ${tgl} untuk seluruh pegawai (${activeEmployees.length} orang) berhasil diubah menjadi ${status === 'LIBUR' ? 'Libur (L)' : status}.`
        };
        return (req as any).session.save(() => res.redirect(redirectUrl));
      }

      res.redirect(redirectUrl);
    } catch (error: any) {
      console.error('Error in absensiController.bulkDateUpdate:', error);
      const redirectUrl = buildAbsensiRedirectUrl(req);
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'danger',
          message: 'Gagal memperbarui status presensi massal: ' + (error.message || 'Terjadi kesalahan sistem')
        };
        return (req as any).session.save(() => res.redirect(redirectUrl));
      }
      res.redirect(redirectUrl);
    }
  },

  submitKlarifikasi: async (req: Request, res: Response) => {
    try {
      let { employeeId, tanggalAbsen, tanggalMulai, tanggalSelesai, isRentang, statusAwal, statusPengganti, alasan } = req.body;
      const file = req.file;

      if (isRentang === 'true' || isRentang === true) {
        if (tanggalMulai && tanggalSelesai) {
          tanggalAbsen = `${tanggalMulai} s/d ${tanggalSelesai}`;
        }
      }

      if (!employeeId || !tanggalAbsen || !alasan) {
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'warning',
            message: 'Silakan lengkapi tanggal dan alasan klarifikasi.'
          };
          return (req as any).session.save(() => res.redirect(buildAbsensiRedirectUrl(req)));
        }
        return res.redirect(buildAbsensiRedirectUrl(req));
      }

      // Validasi izin klarifikasi untuk status NL dan PC
      const cms = await prisma.cmsConfig.findUnique({ where: { id: 'cms-main' } });
      const normStatusAwal = String(statusAwal || 'TK').trim().toUpperCase();

      const getDayNum = (str: string) => {
        const parts = str.trim().split('-');
        if (parts.length === 3) return parseInt(parts[2]);
        return null;
      };
      const getMonthNum = (str: string) => {
        const parts = str.trim().split('-');
        if (parts.length >= 2) return parseInt(parts[1]);
        return null;
      };

      const dayNum = getDayNum(tanggalAbsen);
      const monthNum = getMonthNum(tanggalAbsen);
      const activeKlarifikasiMonth = (cms as any)?.klarifikasiMonth || cms?.selectedMonth || 7;

      const isDatePermitted = (datesSetting: string, day: number | null) => {
        if (!day) return true;
        if (!datesSetting || datesSetting === 'ALL') return true;
        const arr = datesSetting.split(',').map(s => parseInt(s.trim())).filter(Boolean);
        return arr.includes(day);
      };

      if (normStatusAwal === 'HADIR' || normStatusAwal === 'NL') {
        const isMonthMatch = !monthNum || monthNum === activeKlarifikasiMonth;
        if (!cms?.klarifikasiNlEnabled || !isMonthMatch || !isDatePermitted(cms?.klarifikasiNlDates || 'ALL', dayNum)) {
          if ((req as any).session) {
            (req as any).session.toast = {
              type: 'warning',
              message: 'Pengajuan klarifikasi untuk status Hadir Normal (NL) pada bulan / tanggal tersebut sedang ditutup oleh Admin.'
            };
            return (req as any).session.save(() => res.redirect(buildAbsensiRedirectUrl(req)));
          }
          return res.redirect(buildAbsensiRedirectUrl(req));
        }
      } else if (normStatusAwal === 'PC' || normStatusAwal === 'TL') {
        const isMonthMatch = !monthNum || monthNum === activeKlarifikasiMonth;
        if (!cms?.klarifikasiPcEnabled || !isMonthMatch || !isDatePermitted(cms?.klarifikasiPcDates || 'ALL', dayNum)) {
          if ((req as any).session) {
            (req as any).session.toast = {
              type: 'warning',
              message: 'Pengajuan klarifikasi untuk status Terlambat (TL) & Pulang Cepat (PC) pada bulan / tanggal tersebut sedang ditutup oleh Admin.'
            };
            return (req as any).session.save(() => res.redirect(buildAbsensiRedirectUrl(req)));
          }
          return res.redirect(buildAbsensiRedirectUrl(req));
        }
      }

      if (!file) {
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'error',
            message: 'Wajib mengunggah berkas bukti klarifikasi berupa dokumen PDF!'
          };
          return (req as any).session.save(() => res.redirect(buildAbsensiRedirectUrl(req)));
        }
        return res.redirect(buildAbsensiRedirectUrl(req));
      }

      if (file.size > 1 * 1024 * 1024) {
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'error',
            message: 'Ukuran berkas bukti klarifikasi melebihi batas maksimal 1MB!'
          };
          return (req as any).session.save(() => res.redirect(buildAbsensiRedirectUrl(req)));
        }
        return res.redirect(buildAbsensiRedirectUrl(req));
      }

      let fileUrl = '';
      let fileName = file.originalname || 'Surat_Keterangan.pdf';

      // Fetch employee name for auto-naming
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { nama: true }
      });

      const { uploadToStorage, generateKlarifikasiFilename } = await import('../lib/supabase');
      const ext = file.originalname.includes('.')
        ? '.' + file.originalname.split('.').pop()!.toLowerCase()
        : '.pdf';
      const autoName = generateKlarifikasiFilename(
        employee?.nama || 'Pegawai',
        tanggalAbsen,
        statusPengganti,
        undefined,
        ext
      );
      // Folder: klarifikasi/2026
      const year = new Date().getFullYear().toString();
      const result = await uploadToStorage('klarifikasi', file.buffer, file.mimetype, year, autoName);

      if (result) {
        fileUrl = result.url;
        fileName = autoName;
      } else {
        // Fallback to Base64
        console.warn('[Upload] Supabase upload failed, falling back to Base64 for klarifikasi');
        fileUrl = `data:${file.mimetype || 'application/pdf'};base64,${file.buffer.toString('base64')}`;
        fileName = file.originalname;
      }

      await prisma.clarification.create({
        data: {
          employeeId,
          tanggalAbsen,
          statusAwal: statusAwal || 'TK',
          statusPengganti: statusPengganti || 'DL',
          alasan,
          fileUrl,
          fileName,
          statusVerifikasi: 'PENDING'
        }
      });

      const redirectUrl = buildAbsensiRedirectUrl(req);
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: 'Permohonan klarifikasi berhasil diajukan dan sedang menunggu review admin.'
        };
        return (req as any).session.save(() => res.redirect(redirectUrl));
      }

      res.redirect(redirectUrl);
    } catch (error: any) {
      console.error('Error in submitKlarifikasi:', error);
      const redirectUrl = buildAbsensiRedirectUrl(req);
      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'danger',
          message: 'Gagal mengajukan klarifikasi. Silakan coba kembali.'
        };
        return (req as any).session.save(() => res.redirect(redirectUrl));
      }
      res.redirect(redirectUrl);
    }
  },

  exportExcel: async (req: Request, res: Response) => {
    try {
      const cms = await prisma.cmsConfig.findUnique({ where: { id: 'cms-main' } });
      const activeDefaultMonth = cms?.selectedMonth || 7;
      const activeDefaultYear = cms?.selectedYear || 2026;

      const bulan = parseInt(req.query.bulan as string) || activeDefaultMonth;
      const tahun = parseInt(req.query.tahun as string) || activeDefaultYear;
      const selectedUnit = (req.query.unit as string) || 'unit-all';
      const search = ((req.query.search as string) || '').trim();

      const whereEmp: any = { aktif: true };
      if (selectedUnit && selectedUnit !== 'unit-all') {
        whereEmp.unitId = selectedUnit;
      }
      if (search) {
        whereEmp.OR = [
          { nama: { contains: search, mode: 'insensitive' } },
          { nip: { contains: search } }
        ];
      }

      const [employees, allUnits, period] = await Promise.all([
        prisma.employee.findMany({
          where: whereEmp,
          include: { unit: true },
          orderBy: [
            { unit: { namaUnit: 'asc' } },
            { nama: 'asc' }
          ]
        }),
        prisma.unit.findMany({ orderBy: { namaUnit: 'asc' } }),
        prisma.attendancePeriod.findUnique({
          where: { bulan_tahun: { bulan, tahun } },
          include: { attendanceDays: true }
        })
      ]);

      const daysInMonth = new Date(tahun, bulan, 0).getDate();

      const attendanceByEmp = new Map<string, Map<number, any>>();
      if (period) {
        for (const d of period.attendanceDays) {
          let m = attendanceByEmp.get(d.employeeId);
          if (!m) {
            m = new Map();
            attendanceByEmp.set(d.employeeId, m);
          }
          m.set(d.tanggal, d);
        }
      }

      const holidaysMap = holidayService.getHolidaysForMonth(tahun, bulan);
      const daysMeta: { day: number; isWeekend: boolean; nationalHoliday: any }[] = [];
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(tahun, bulan - 1, day);
        const dayOfWeek = date.getDay();
        daysMeta.push({
          day,
          isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
          nationalHoliday: holidaysMap.get(day) || null
        });
      }

      const rows = employees.map((emp, index) => {
        const empDaysMap = attendanceByEmp.get(emp.id);

        let hadirCount = 0;
        let tkCount = 0;
        let dlCount = 0;
        let tlCount = 0;
        let pcCount = 0;
        let stCount = 0;
        let ctCount = 0;
        let totalEfektif = 0;

        const rowObj: Record<string, any> = {
          'No': index + 1,
          'NIP': String(emp.nip),
          'Nama Pegawai': emp.nama,
          'Unit Kerja / Sekolah': emp.unit?.namaUnit || '-',
          'Jabatan': emp.jabatan || '-',
          'Status Kepegawaian': emp.statusKepegawaian || '-'
        };

        for (const meta of daysMeta) {
          const day = meta.day;
          let status = 'EMPTY';

          if (empDaysMap && empDaysMap.has(day)) {
            status = empDaysMap.get(day).status;
          } else if (meta.nationalHoliday || meta.isWeekend) {
            status = 'LIBUR';
          } else {
            status = 'EMPTY';
          }

          const isHolidayOrWeekend = meta.isWeekend || meta.nationalHoliday !== null;
          if (!isHolidayOrWeekend && status !== 'EMPTY') {
            totalEfektif++;
            if (status === 'HADIR') hadirCount++;
            else if (status === 'TK') tkCount++;
            else if (status === 'DL' || status === 'DL_KUNING') dlCount++;
            else if (status === 'TL') tlCount++;
            else if (status === 'PC') pcCount++;
            else if (status === 'ST') stCount++;
            else if (status === 'CT') ctCount++;
          }

          let displayCode = '-';
          if (status === 'HADIR') displayCode = 'H';
          else if (status === 'TK') displayCode = 'TK';
          else if (status === 'DL' || status === 'DL_KUNING') displayCode = 'DL';
          else if (status === 'TL') displayCode = 'TL';
          else if (status === 'PC') displayCode = 'PC';
          else if (status === 'ST') displayCode = 'S';
          else if (status === 'CT') displayCode = 'C';
          else if (status === 'LIBUR') displayCode = 'L';

          rowObj[`Tgl ${day}`] = displayCode;
        }

        const totalPresent = hadirCount + dlCount + tlCount + pcCount + stCount + ctCount;
        const persentase = totalEfektif > 0 ? Math.round((totalPresent / totalEfektif) * 100) : 0;

        rowObj['H (Hadir)'] = hadirCount;
        rowObj['TK (Tanpa Keterangan)'] = tkCount;
        rowObj['DL (Dinas Luar)'] = dlCount;
        rowObj['TL (Terlambat)'] = tlCount;
        rowObj['PC (Pulang Cepat)'] = pcCount;
        rowObj['S (Sakit)'] = stCount;
        rowObj['C (Cuti)'] = ctCount;
        rowObj['Efektif'] = totalEfektif;
        rowObj['Persentase (%)'] = `${persentase}%`;

        return rowObj;
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{
        'No': 1,
        'NIP': '-',
        'Nama Pegawai': 'Tidak ada data pegawai',
        'Unit Kerja / Sekolah': '-',
        'Jabatan': '-',
        'Status Kepegawaian': '-'
      }]);

      const colWidths: any[] = [
        { wch: 5 },  // No
        { wch: 22 }, // NIP
        { wch: 32 }, // Nama Pegawai
        { wch: 28 }, // Unit Kerja
        { wch: 20 }, // Jabatan
        { wch: 18 }, // Status Kepegawaian
      ];
      for (let day = 1; day <= daysInMonth; day++) {
        colWidths.push({ wch: 4.5 });
      }
      colWidths.push(
        { wch: 9 },  // H
        { wch: 9 },  // TK
        { wch: 9 },  // DL
        { wch: 9 },  // TL
        { wch: 9 },  // PC
        { wch: 9 },  // S
        { wch: 9 },  // C
        { wch: 9 },  // Efektif
        { wch: 14 }  // Persentase (%)
      );
      ws['!cols'] = colWidths;

      const bulanLabel = BULAN_NAMES[bulan] || `Bulan_${bulan}`;
      XLSX.utils.book_append_sheet(wb, ws, `Rekap Absensi ${bulanLabel}`);

      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
      const filename = `Rekap_Absensi_Korwil_Cibitung_${bulanLabel}_${tahun}.xlsx`;

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buffer);
    } catch (error) {
      console.error('Error in exportExcel absensi:', error);
      return res.status(500).send('Gagal mengekspor data absensi ke Excel.');
    }
  },

  exportPdf: async (req: Request, res: Response) => {
    try {
      const cms = await prisma.cmsConfig.findUnique({ where: { id: 'cms-main' } });
      const activeDefaultMonth = cms?.selectedMonth || 7;
      const activeDefaultYear = cms?.selectedYear || 2026;

      const bulan = parseInt(req.query.bulan as string) || activeDefaultMonth;
      const tahun = parseInt(req.query.tahun as string) || activeDefaultYear;
      const selectedUnit = (req.query.unit as string) || 'unit-all';
      const search = ((req.query.search as string) || '').trim();

      const whereEmp: any = { aktif: true };
      if (selectedUnit && selectedUnit !== 'unit-all') {
        whereEmp.unitId = selectedUnit;
      }
      if (search) {
        whereEmp.OR = [
          { nama: { contains: search, mode: 'insensitive' } },
          { nip: { contains: search } }
        ];
      }

      const [employees, allUnits, period] = await Promise.all([
        prisma.employee.findMany({
          where: whereEmp,
          include: { unit: true },
          orderBy: [
            { unit: { namaUnit: 'asc' } },
            { nama: 'asc' }
          ]
        }),
        prisma.unit.findMany({ orderBy: { namaUnit: 'asc' } }),
        prisma.attendancePeriod.findUnique({
          where: { bulan_tahun: { bulan, tahun } },
          include: { attendanceDays: true }
        })
      ]);

      const daysInMonth = new Date(tahun, bulan, 0).getDate();

      const attendanceByEmp = new Map<string, Map<number, any>>();
      if (period) {
        for (const d of period.attendanceDays) {
          let m = attendanceByEmp.get(d.employeeId);
          if (!m) {
            m = new Map();
            attendanceByEmp.set(d.employeeId, m);
          }
          m.set(d.tanggal, d);
        }
      }

      const holidaysMap = holidayService.getHolidaysForMonth(tahun, bulan);
      const daysMeta: { day: number; isWeekend: boolean; nationalHoliday: any }[] = [];
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(tahun, bulan - 1, day);
        const dayOfWeek = date.getDay();
        daysMeta.push({
          day,
          isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
          nationalHoliday: holidaysMap.get(day) || null
        });
      }

      const unitLabel = selectedUnit === 'unit-all' ? 'Semua Unit Kerja' :
        allUnits.find(u => u.id === selectedUnit)?.namaUnit || '-';

      const bulanLabel = BULAN_NAMES[bulan] || `Bulan ${bulan}`;
      const printedAt = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' });

      // Generate printable HTML
      const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>Rekap Absensi Pegawai - ${bulanLabel} ${tahun}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Arial', sans-serif; font-size: 9px; color: #0f172a; background: #fff; line-height: 1.25; }
  @page { size: A4 landscape; margin: 8mm 10mm; }
  
  .header { text-align: center; margin-bottom: 12px; border-bottom: 2.5px double #0f172a; padding-bottom: 8px; position: relative; }
  .header img { position: absolute; left: 10px; top: 0; width: 48px; height: auto; }
  .header h2 { font-size: 11px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; color: #334155; }
  .header h1 { font-size: 14px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; color: #0f172a; margin-top: 1px; }
  .header p { font-size: 9px; color: #475569; margin-top: 2px; }

  .meta-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 9.5px; font-weight: 600; color: #334155; }
  .meta-bar .badge { display: inline-block; padding: 2px 8px; background: #e0e7ff; color: #3730a3; border-radius: 4px; font-size: 9px; }

  table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 10px; font-size: 8px; }
  th, td { border: 1px solid #cbd5e1; padding: 3.5px 2px; text-align: center; vertical-align: middle; }
  th { background-color: #f1f5f9; font-weight: bold; color: #1e293b; }
  .th-emp { text-align: left; padding-left: 5px; }
  .td-emp { text-align: left; padding-left: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .bg-weekend { background-color: #f1f5f9; color: #94a3b8; }
  .bg-holiday { background-color: #fee2e2; color: #dc2626; font-weight: bold; }
  .code-H { background-color: #dcfce7; color: #15803d; font-weight: bold; }
  .code-TK { background-color: #fee2e2; color: #b91c1c; font-weight: 800; }
  .code-DL { background-color: #dbeafe; color: #1d4ed8; font-weight: bold; }
  .code-TL { background-color: #ffedd5; color: #c2410c; font-weight: bold; }
  .code-PC { background-color: #fef3c7; color: #b45309; font-weight: bold; }
  .code-S { background-color: #f3e8ff; color: #7e22ce; font-weight: bold; }
  .code-C { background-color: #fae8ff; color: #86198f; font-weight: bold; }

  .legend-box { display: flex; flex-wrap: wrap; gap: 8px; font-size: 8.5px; margin-top: 6px; padding: 6px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .legend-color { width: 12px; height: 12px; border-radius: 2px; display: inline-flex; align-items: center; justify-content: center; font-size: 7.5px; font-weight: bold; }

  .footer-signatures { display: flex; justify-content: flex-end; margin-top: 15px; page-break-inside: avoid; }
  .sig-block { width: 220px; text-align: center; font-size: 9.5px; }
  .sig-space { height: 45px; }

  .action-bar { margin-bottom: 12px; padding: 8px 12px; background: #312e81; color: #fff; display: flex; justify-content: space-between; align-items: center; border-radius: 6px; }
  .btn-print { background: #4f46e5; color: white; border: none; padding: 6px 14px; border-radius: 4px; font-weight: bold; font-size: 11px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
  .btn-print:hover { background: #4338ca; }
  .btn-back { color: #c7d2fe; text-decoration: none; font-size: 10px; font-weight: 600; }
  .btn-back:hover { color: #fff; text-decoration: underline; }

  @media print {
    .no-print { display: none !important; }
    body { font-size: 8px; }
    th, td { padding: 2.5px 1.5px; }
  }
</style>
</head>
<body>

<div class="action-bar no-print">
  <div>
    <strong>Pratinjau Cetak Rekap Absensi</strong> &bull; Silakan gunakan opsi cetak atau Simpan sebagai PDF (A4 Landscape).
  </div>
  <div style="display: flex; gap: 10px; align-items: center;">
    <a href="/absensi?bulan=${bulan}&tahun=${tahun}&unit=${selectedUnit}" class="btn-back">&larr; Kembali ke SIMPEG</a>
    <button onclick="window.print()" class="btn-print">
      <span>&#128438; Cetak / Simpan PDF</span>
    </button>
  </div>
</div>

<div class="header">
  <img src="/img/logo-emblem.png" alt="Logo">
  <h2>Pemerintah Kabupaten Bekasi &bull; Dinas Pendidikan</h2>
  <h1>Koordinator Wilayah Bidang Pendidikan Kecamatan Cibitung</h1>
  <p>Sistem Informasi Manajemen Presensi & Kinerja Pegawai (SIMPEG) &bull; Dokumen Rekapitulasi Presensi</p>
</div>

<div class="meta-bar">
  <div>
    <strong>Periode:</strong> ${bulanLabel} ${tahun} &bull; 
    <strong>Unit Kerja:</strong> ${unitLabel}
    ${search ? ` &bull; <strong>Pencarian:</strong> "${search}"` : ''}
  </div>
  <div>
    <span class="badge">Total Pegawai: ${employees.length} Orang</span> &bull; 
    <span>Dicetak: ${printedAt} WIB</span>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th style="width: 22px;">No</th>
      <th style="width: 95px;">NIP</th>
      <th style="width: 140px;" class="th-emp">Nama Pegawai</th>
      <th style="width: 110px;" class="th-emp">Unit Kerja</th>
      ${daysMeta.map(m => {
        const bg = m.nationalHoliday ? 'bg-holiday' : (m.isWeekend ? 'bg-weekend' : '');
        return `<th style="width: 17px;" class="${bg}">${m.day}</th>`;
      }).join('')}
      <th style="width: 20px;" title="Hadir">H</th>
      <th style="width: 20px;" title="Tanpa Keterangan">TK</th>
      <th style="width: 20px;" title="Dinas Luar">DL</th>
      <th style="width: 20px;" title="Terlambat">TL</th>
      <th style="width: 20px;" title="Pulang Cepat">PC</th>
      <th style="width: 20px;" title="Sakit">S</th>
      <th style="width: 20px;" title="Cuti">C</th>
      <th style="width: 26px;" title="Persentase">%</th>
    </tr>
  </thead>
  <tbody>
    ${employees.length === 0 ? `<tr><td colspan="${daysInMonth + 12}" style="padding: 20px; text-align: center; color: #94a3b8;">Tidak ada data pegawai untuk kriteria filter ini.</td></tr>` : ''}
    ${employees.map((emp, index) => {
      const empDaysMap = attendanceByEmp.get(emp.id);

      let hadirCount = 0;
      let tkCount = 0;
      let dlCount = 0;
      let tlCount = 0;
      let pcCount = 0;
      let stCount = 0;
      let ctCount = 0;
      let totalEfektif = 0;

      const dayCells = daysMeta.map(meta => {
        const day = meta.day;
        let status = 'EMPTY';

        if (empDaysMap && empDaysMap.has(day)) {
          status = empDaysMap.get(day).status;
        } else if (meta.nationalHoliday || meta.isWeekend) {
          status = 'LIBUR';
        }

        const isHolidayOrWeekend = meta.isWeekend || meta.nationalHoliday !== null;
        if (!isHolidayOrWeekend && status !== 'EMPTY') {
          totalEfektif++;
          if (status === 'HADIR') hadirCount++;
          else if (status === 'TK') tkCount++;
          else if (status === 'DL' || status === 'DL_KUNING') dlCount++;
          else if (status === 'TL') tlCount++;
          else if (status === 'PC') pcCount++;
          else if (status === 'ST') stCount++;
          else if (status === 'CT') ctCount++;
        }

        let displayCode = '';
        let cellClass = '';
        if (status === 'HADIR') { displayCode = 'H'; cellClass = 'code-H'; }
        else if (status === 'TK') { displayCode = 'TK'; cellClass = 'code-TK'; }
        else if (status === 'DL' || status === 'DL_KUNING') { displayCode = 'DL'; cellClass = 'code-DL'; }
        else if (status === 'TL') { displayCode = 'TL'; cellClass = 'code-TL'; }
        else if (status === 'PC') { displayCode = 'PC'; cellClass = 'code-PC'; }
        else if (status === 'ST') { displayCode = 'S'; cellClass = 'code-S'; }
        else if (status === 'CT') { displayCode = 'C'; cellClass = 'code-C'; }
        else if (status === 'LIBUR') {
          displayCode = meta.nationalHoliday ? 'LN' : 'L';
          cellClass = meta.nationalHoliday ? 'bg-holiday' : 'bg-weekend';
        }

        return `<td class="${cellClass}">${displayCode}</td>`;
      }).join('');

      const totalPresent = hadirCount + dlCount + tlCount + pcCount + stCount + ctCount;
      const persentase = totalEfektif > 0 ? Math.round((totalPresent / totalEfektif) * 100) : 0;

      return `<tr>
        <td>${index + 1}</td>
        <td style="font-family: monospace; font-size: 8px;">${emp.nip}</td>
        <td class="td-emp" title="${emp.nama}"><strong>${emp.nama}</strong></td>
        <td class="td-emp" title="${emp.unit?.namaUnit || '-'}">${emp.unit?.namaUnit || '-'}</td>
        ${dayCells}
        <td style="font-weight: bold; color: #15803d;">${hadirCount}</td>
        <td style="font-weight: bold; color: #b91c1c;">${tkCount}</td>
        <td>${dlCount}</td>
        <td>${tlCount}</td>
        <td>${pcCount}</td>
        <td>${stCount}</td>
        <td>${ctCount}</td>
        <td style="font-weight: 800; background: #f8fafc;">${persentase}%</td>
      </tr>`;
    }).join('')}
  </tbody>
</table>

<div class="legend-box">
  <div class="legend-item"><span class="legend-color code-H">H</span> Hadir</div>
  <div class="legend-item"><span class="legend-color code-TK">TK</span> Tanpa Keterangan</div>
  <div class="legend-item"><span class="legend-color code-DL">DL</span> Dinas Luar</div>
  <div class="legend-item"><span class="legend-color code-TL">TL</span> Terlambat</div>
  <div class="legend-item"><span class="legend-color code-PC">PC</span> Pulang Cepat</div>
  <div class="legend-item"><span class="legend-color code-S">S</span> Sakit</div>
  <div class="legend-item"><span class="legend-color code-C">C</span> Cuti</div>
  <div class="legend-item"><span class="legend-color bg-weekend">L</span> Akhir Pekan</div>
  <div class="legend-item"><span class="legend-color bg-holiday">LN</span> Libur Nasional</div>
</div>

<div class="footer-signatures">
  <div class="sig-block">
    <p>Cibitung, ${new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <p style="margin-top: 2px;">Koordinator Wilayah Bidang Pendidikan<br>Kecamatan Cibitung</p>
    <div class="sig-space"></div>
    <p style="font-weight: bold; text-decoration: underline;">( ..................................................... )</p>
    <p style="font-size: 8.5px; color: #64748b; margin-top: 1px;">NIP. .................................................</p>
  </div>
</div>

<script>
  window.addEventListener('load', () => {
    // Optional auto-print trigger after small render delay
    setTimeout(() => {
      // window.print();
    }, 400);
  });
</script>

</body>
</html>`;

      return res.send(html);
    } catch (error) {
      console.error('Error in exportPdf absensi:', error);
      return res.status(500).send('Gagal membuat dokumen cetak/PDF rekap absensi.');
    }
  }
};

