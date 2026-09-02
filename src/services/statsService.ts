import prisma from '../lib/prisma';

export interface DashboardStats {
  totalPegawai: number;
  persenKehadiran: number;
  hadirHariIni: number;
  dlHariIni: number;
  dlKuningHariIni: number;
  terlambatHariIni: number;
  sakitCutiHariIni: number;
  tkHariIni: number;
  statusBreakdown: {
    status: string;
    label: string;
    count: number;
    persen: number;
    color: string;
    bgClass: string;
  }[];
  unitStats: {
    unitId: string;
    namaUnit: string;
    totalPegawai: number;
    persenKehadiran: number;
  }[];
}

export async function getDashboardStatsFromDB(unitId?: string, bulan: number = 7, tahun: number = 2026): Promise<DashboardStats> {
  const whereEmp: any = { aktif: true };
  if (unitId && unitId !== 'unit-all') {
    whereEmp.unitId = unitId;
  }

  const employees = await prisma.employee.findMany({
    where: whereEmp,
    include: { unit: true }
  });

  const totalPegawai = employees.length;

  const counts: Record<string, number> = {
    PNS: 0,
    PPPK: 0,
    PPPK_PW: 0,
    OUTSOURCING: 0
  };

  employees.forEach(e => {
    if (counts[e.statusKepegawaian] !== undefined) {
      counts[e.statusKepegawaian]++;
    }
  });

  const statusBreakdown = [
    {
      status: 'PNS',
      label: 'Pegawai Negeri Sipil (PNS)',
      count: counts.PNS,
      persen: totalPegawai > 0 ? Math.round((counts.PNS / totalPegawai) * 100) : 0,
      color: '#3b82f6',
      bgClass: 'bg-blue-500'
    },
    {
      status: 'PPPK',
      label: 'PPPK Penuh Waktu',
      count: counts.PPPK,
      persen: totalPegawai > 0 ? Math.round((counts.PPPK / totalPegawai) * 100) : 0,
      color: '#10b981',
      bgClass: 'bg-emerald-500'
    },
    {
      status: 'PPPK_PW',
      label: 'PPPK Paruh Waktu (PW)',
      count: counts.PPPK_PW,
      persen: totalPegawai > 0 ? Math.round((counts.PPPK_PW / totalPegawai) * 100) : 0,
      color: '#f59e0b',
      bgClass: 'bg-amber-500'
    },
    {
      status: 'OUTSOURCING',
      label: 'Tenaga Alih Daya / OS',
      count: counts.OUTSOURCING,
      persen: totalPegawai > 0 ? Math.round((counts.OUTSOURCING / totalPegawai) * 100) : 0,
      color: '#8b5cf6',
      bgClass: 'bg-purple-500'
    }
  ];

  // Attendance stats
  const period = await prisma.attendancePeriod.findUnique({
    where: { bulan_tahun: { bulan, tahun } }
  });

  let hadirHariIni = 0;
  let dlHariIni = 0;
  let dlKuningHariIni = 0;
  let terlambatHariIni = 0;
  let sakitCutiHariIni = 0;
  let tkHariIni = 0;
  let avgKehadiran = 0;

  if (period && employees.length > 0) {
    const empIds = employees.map(e => e.id);
    const todayDay = new Date().getDate();

    const days = await prisma.attendanceDay.findMany({
      where: {
        periodId: period.id,
        employeeId: { in: empIds }
      }
    });

    const todayDays = days.filter(d => d.tanggal === todayDay);
    todayDays.forEach(d => {
      if (d.status === 'HADIR') hadirHariIni++;
      else if (d.status === 'DL') dlHariIni++;
      else if (d.status === 'DL_KUNING') dlKuningHariIni++;
      else if (d.status === 'TL' || d.status === 'PC') terlambatHariIni++;
      else if (d.status === 'ST' || d.status === 'CT') sakitCutiHariIni++;
      else if (d.status === 'TK') tkHariIni++;
    });

    // Compute average attendance rate: (H + DL + DL_KUNING + TL + PC + ST + CT) / Total Effective Days
    const effectiveDays = days.filter(d => d.status !== 'LIBUR' && d.status !== 'EMPTY');
    const presentDays = effectiveDays.filter(d => d.status !== 'TK');
    if (effectiveDays.length > 0) {
      avgKehadiran = Math.round((presentDays.length / effectiveDays.length) * 100);
    }
  }

  return {
    totalPegawai,
    persenKehadiran: avgKehadiran,
    hadirHariIni,
    dlHariIni,
    dlKuningHariIni,
    terlambatHariIni,
    sakitCutiHariIni,
    tkHariIni,
    statusBreakdown,
    unitStats: []
  };
}
