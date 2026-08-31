"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAttendanceDayDirect = updateAttendanceDayDirect;
exports.generateMockAttendanceRecap = generateMockAttendanceRecap;
const mockEmployees_1 = require("./mockEmployees");
const mockClarifications_1 = require("./mockClarifications");
// In-memory attendance database store (employeeId_year_month_day -> DayAttendance)
const attendanceStore = new Map();
// Helper to get cache key
function getKey(employeeId, tahun, bulan, day) {
    return `${employeeId}_${tahun}_${bulan}_${day}`;
}
// Initialize seed data once
function initSeedData() {
    if (attendanceStore.size > 0)
        return;
    const daysInMonth = 31;
    const currentDay = 26;
    mockEmployees_1.mockEmployees.forEach((emp, idx) => {
        for (let day = 1; day <= daysInMonth; day++) {
            const dayOfWeek = (day + 2) % 7;
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            if (isWeekend) {
                attendanceStore.set(getKey(emp.id, 2026, 7, day), {
                    status: 'LIBUR',
                    keterangan: 'Hari Libur Akhir Pekan'
                });
                continue;
            }
            if (day > currentDay) {
                attendanceStore.set(getKey(emp.id, 2026, 7, day), {
                    status: 'EMPTY',
                    keterangan: 'Belum berlangsung'
                });
                continue;
            }
            let status = 'HADIR';
            let ket = 'Hadir Tepat Waktu';
            const seed = (idx * 19 + day * 7) % 100;
            if (idx === 2 && (day === 14 || day === 15)) {
                status = 'TK';
                ket = 'Tanpa Keterangan';
            }
            else if (idx === 3 && day === 8) {
                status = 'DL';
                ket = 'Dinas Luar - Surat Tugas Sesuai';
            }
            else if (idx === 3 && (day === 9 || day === 10)) {
                status = 'DL_KUNING';
                ket = 'Dinas Luar - Surat Tugas Belum Sesuai (Perlu Klarifikasi)';
            }
            else if (idx === 4 && day === 18) {
                status = 'TL';
                ket = 'Terlambat Masuk (07:45 WIB)';
            }
            else if (idx === 1 && day === 21) {
                status = 'ST';
                ket = 'Sakit - Surat Dokter Terlampir';
            }
            else if (idx === 5 && (day === 21 || day === 22 || day === 23)) {
                status = 'CT';
                ket = 'Cuti Tahunan';
            }
            else if (idx === 6 && day === 16) {
                status = 'PC';
                ket = 'Pulang Cepat dengan Izin Pimpinan';
            }
            else if (seed === 11) {
                status = 'TK';
                ket = 'Tanpa Keterangan';
            }
            else if (seed === 22) {
                status = 'DL_KUNING';
                ket = 'Dinas Luar (Surat Tugas Belum Sesuai)';
            }
            else if (seed === 33) {
                status = 'DL';
                ket = 'Dinas Luar (Sesuai)';
            }
            else if (seed === 44) {
                status = 'TL';
                ket = 'Terlambat Masuk';
            }
            else if (seed === 55) {
                status = 'PC';
                ket = 'Pulang Cepat';
            }
            else if (seed === 66) {
                status = 'ST';
                ket = 'Sakit';
            }
            else if (seed === 77) {
                status = 'CT';
                ket = 'Cuti';
            }
            else {
                status = 'HADIR';
            }
            attendanceStore.set(getKey(emp.id, 2026, 7, day), { status, keterangan: ket });
        }
    });
}
initSeedData();
// Direct update function (e.g. for Admin direct edit or approval update)
function updateAttendanceDayDirect(employeeId, tahun, bulan, day, status, keterangan) {
    attendanceStore.set(getKey(employeeId, tahun, bulan, day), {
        status,
        keterangan: keterangan || `Diperbarui oleh Admin (${status})`
    });
}
// Generate 31 days recap linked with real-time clarifications
function generateMockAttendanceRecap(bulan = 7, tahun = 2026, unitId, search) {
    initSeedData();
    let filtered = mockEmployees_1.mockEmployees;
    if (unitId && unitId !== 'unit-all') {
        filtered = filtered.filter(e => e.unitId === unitId);
    }
    if (search && search.trim() !== '') {
        const s = search.toLowerCase();
        filtered = filtered.filter(e => e.nama.toLowerCase().includes(s) ||
            e.nip.toLowerCase().includes(s) ||
            e.unitNama.toLowerCase().includes(s));
    }
    const daysInMonth = 31;
    return filtered.map(emp => {
        const days = [];
        let murniHadir = 0;
        let tk = 0;
        let dl = 0;
        let dlKuning = 0;
        let tl = 0;
        let pc = 0;
        let st = 0;
        let ct = 0;
        let totalHariKerja = 0;
        for (let day = 1; day <= daysInMonth; day++) {
            const dayOfWeek = (day + 2) % 7;
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const stored = attendanceStore.get(getKey(emp.id, tahun, bulan, day)) || {
                status: isWeekend ? 'LIBUR' : 'HADIR',
                keterangan: isWeekend ? 'Hari Libur Akhir Pekan' : 'Hadir'
            };
            const dayObj = {
                tanggal: day,
                status: stored.status,
                keterangan: stored.keterangan,
                isWeekend
            };
            // Match with clarifications for this employee
            const dateStr = `${tahun}-${String(bulan).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const matchedClarification = mockClarifications_1.mockClarifications.find(c => {
                if (c.employeeId !== emp.id)
                    return false;
                if (c.tanggalAbsen.includes('s/d')) {
                    const [start, end] = c.tanggalAbsen.split(' s/d ').map(s => s.trim());
                    return dateStr >= start && dateStr <= end;
                }
                return c.tanggalAbsen === dateStr;
            });
            if (matchedClarification) {
                dayObj.clarificationStatus = matchedClarification.statusVerifikasi;
                dayObj.clarificationNote = matchedClarification.catatanAdmin || matchedClarification.alasan;
                dayObj.proposedStatus = matchedClarification.statusPengganti;
            }
            if (!isWeekend && stored.status !== 'EMPTY') {
                totalHariKerja++;
                if (stored.status === 'HADIR')
                    murniHadir++;
                else if (stored.status === 'TK')
                    tk++;
                else if (stored.status === 'DL')
                    dl++;
                else if (stored.status === 'DL_KUNING')
                    dlKuning++;
                else if (stored.status === 'TL')
                    tl++;
                else if (stored.status === 'PC')
                    pc++;
                else if (stored.status === 'ST')
                    st++;
                else if (stored.status === 'CT')
                    ct++;
            }
            days.push(dayObj);
        }
        const totalHadir = murniHadir + dl + dlKuning + tl + pc + st + ct;
        const persentase = totalHariKerja > 0
            ? Math.round((totalHadir / totalHariKerja) * 100)
            : 100;
        return {
            employee: emp,
            days,
            summary: {
                hadir: totalHadir,
                tk,
                dl,
                dlKuning,
                tl,
                pc,
                st,
                ct,
                persentase
            }
        };
    });
}
