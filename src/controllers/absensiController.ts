import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { holidayService } from '../services/holidayService';
const buildAbsensiRedirectUrl = (req: Request, fallbackBulan?: number, fallbackTahun?: number) => {
  const unit = (req.body?.filterUnit || req.query?.unit || '') as string;
  const bulan = req.body?.filterBulan || req.body?.bulan || req.query?.bulan || fallbackBulan || '';
  const tahun = req.body?.filterTahun || req.body?.tahun || req.query?.tahun || fallbackTahun || '';
  const search = (req.body?.filterSearch || req.query?.search || '') as string;
  const page = (req.body?.filterPage || req.query?.page || '') as string;

  const params = new URLSearchParams();
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

      const bulan = parseInt(req.query.bulan as string) || activeDefaultMonth;
      const tahun = parseInt(req.query.tahun as string) || activeDefaultYear;
      const selectedUnit = (req.query.unit as string) || 'unit-all';
      const search = (req.query.search as string) || '';

      // Pagination setup (default 25 rows)
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limitQuery = req.query.limit as string;
      const limit = limitQuery === 'all' ? 999999 : (parseInt(limitQuery) || 25);

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

      const [allUnits, totalFilteredEmployees, allActiveEmployees, employees, period, clarifications] = await Promise.all([
        prisma.unit.findMany({ orderBy: { namaUnit: 'asc' } }),
        prisma.employee.count({ where: whereEmp }),
        prisma.employee.findMany({
          where: { aktif: true },
          include: { unit: true },
          orderBy: { nama: 'asc' }
        }),
        prisma.employee.findMany({
          where: whereEmp,
          include: { unit: true },
          orderBy: [
            { unit: { namaUnit: 'asc' } },
            { nama: 'asc' }
          ],
          skip: limit === 999999 ? 0 : (page - 1) * limit,
          take: limit
        }),
        prisma.attendancePeriod.findUnique({
          where: { bulan_tahun: { bulan, tahun } },
          include: { attendanceDays: true }
        }),
        prisma.clarification.findMany({
          include: { employee: { include: { unit: true } } },
          orderBy: { createdAt: 'desc' }
        })
      ]);

      const daysInMonth = new Date(tahun, bulan, 0).getDate();

      // Build recap per employee
      const recap = employees.map(emp => {
        const empDaysMap = new Map<number, any>();
        if (period) {
          period.attendanceDays
            .filter(d => d.employeeId === emp.id)
            .forEach(d => empDaysMap.set(d.tanggal, d));
        }

        // Active clarifications for this employee
        const empClarifications = clarifications.filter(c => c.employeeId === emp.id);

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

        const holidaysMap = holidayService.getHolidaysForMonth(tahun, bulan);

        for (let day = 1; day <= daysInMonth; day++) {
          const date = new Date(tahun, bulan - 1, day);
          const dayOfWeek = date.getDay();
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
          const nationalHoliday = holidayService.getHoliday(tahun, bulan, day);

          let status = 'EMPTY';
          let keterangan: string | null = null;

          if (empDaysMap.has(day)) {
            const existing = empDaysMap.get(day);
            status = existing.status;
            keterangan = existing.keterangan;
          } else if (nationalHoliday) {
            status = 'LIBUR';
            keterangan = `Libur Nasional: ${nationalHoliday.name}`;
          } else if (isWeekend) {
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
                const [startStr, endStr] = c.tanggalAbsen.split(' s/d ').map(s => s.trim());
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

          const isHolidayOrWeekend = isWeekend || nationalHoliday !== null;
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
        // Status yang dihitung hadir: HADIR, CT, DL, DL_KUNING, TL, PC, ST
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

      res.render('absensi', {
        title: 'Rekap Absensi Pegawai - SIMPEG Korwil Cibitung',
        page: 'absensi',
        user: (req as any).session?.user || null,
        recap,
        clarifications: formattedClarifications,
        units: allUnits,
        allActiveEmployees,
        selectedUnit,
        bulan,
        tahun,
        activeDefaultMonth,
        activeDefaultYear,
        daysInMonth,
        search,
        isDefaultPeriod,
        holidays: Object.fromEntries(holidayService.getHolidaysForMonth(tahun, bulan)),
        isAdmin: (req as any).session?.user?.role === 'ADMIN' || (req as any).session?.user?.role === 'SUPERADMIN',
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
          totalPages: limit === 999999 ? 1 : Math.ceil(totalFilteredEmployees / limit),
          from: totalFilteredEmployees === 0 ? 0 : (page - 1) * limit + 1,
          to: limit === 999999 ? totalFilteredEmployees : Math.min(page * limit, totalFilteredEmployees)
        }
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
  }
};

