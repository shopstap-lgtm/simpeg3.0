/**
 * Indonesian National Holidays Service (Kalender Hari Libur Nasional & Tanggal Merah)
 * Berdasarkan SKB 3 Menteri Resmi Republik Indonesia.
 */

export interface HolidayInfo {
  date: string; // YYYY-MM-DD
  name: string;
}

const INDONESIAN_HOLIDAYS: Record<string, string> = {
  // 2024
  '2024-01-01': 'Tahun Baru 2024 Masehi',
  '2024-02-08': "Isra Mi'raj Nabi Muhammad SAW",
  '2024-02-10': 'Tahun Baru Imlek 2575 Kongzili',
  '2024-03-11': 'Hari Suci Nyepi (Tahun Baru Saka 1946)',
  '2024-03-29': 'Wafat Yesus Kristus',
  '2024-03-31': 'Hari Paskah',
  '2024-04-10': 'Hari Raya Idul Fitri 1445 Hijriah',
  '2024-04-11': 'Hari Raya Idul Fitri 1445 Hijriah',
  '2024-05-01': 'Hari Buruh Internasional',
  '2024-05-09': 'Kenaikan Yesus Kristus',
  '2024-05-23': 'Hari Raya Waisak 2568 BE',
  '2024-06-01': 'Hari Lahir Pancasila',
  '2024-06-17': 'Hari Raya Idul Adha 1445 Hijriah',
  '2024-07-07': 'Tahun Baru Islam 1446 Hijriah',
  '2024-08-17': 'Hari Kemerdekaan Republik Indonesia Ke-79',
  '2024-09-16': 'Maulid Nabi Muhammad SAW',
  '2024-12-25': 'Hari Raya Natal',

  // 2025
  '2025-01-01': 'Tahun Baru 2025 Masehi',
  '2025-01-27': "Isra Mi'raj Nabi Muhammad SAW",
  '2025-01-29': 'Tahun Baru Imlek 2576 Kongzili',
  '2025-03-29': 'Hari Suci Nyepi (Tahun Baru Saka 1947)',
  '2025-03-31': 'Hari Raya Idul Fitri 1446 Hijriah',
  '2025-04-01': 'Hari Raya Idul Fitri 1446 Hijriah',
  '2025-04-18': 'Wafat Yesus Kristus',
  '2025-04-20': 'Hari Paskah',
  '2025-05-01': 'Hari Buruh Internasional',
  '2025-05-12': 'Hari Raya Waisak 2569 BE',
  '2025-05-29': 'Kenaikan Yesus Kristus',
  '2025-06-01': 'Hari Lahir Pancasila',
  '2025-06-06': 'Hari Raya Idul Adha 1446 Hijriah',
  '2025-06-27': 'Tahun Baru Islam 1447 Hijriah',
  '2025-08-17': 'Hari Kemerdekaan Republik Indonesia Ke-80',
  '2025-09-05': 'Maulid Nabi Muhammad SAW',
  '2025-12-25': 'Hari Raya Natal',

  // 2026
  '2026-01-01': 'Tahun Baru 2026 Masehi',
  '2026-01-16': "Isra Mi'raj Nabi Muhammad SAW",
  '2026-02-17': 'Tahun Baru Imlek 2577 Kongzili',
  '2026-03-19': 'Hari Suci Nyepi (Tahun Baru Saka 1948)',
  '2026-03-20': 'Hari Raya Idul Fitri 1447 Hijriah',
  '2026-03-21': 'Hari Raya Idul Fitri 1447 Hijriah',
  '2026-04-03': 'Wafat Yesus Kristus',
  '2026-04-05': 'Hari Paskah',
  '2026-05-01': 'Hari Buruh Internasional',
  '2026-05-14': 'Kenaikan Yesus Kristus',
  '2026-05-27': 'Hari Raya Idul Adha 1447 Hijriah',
  '2026-05-31': 'Hari Raya Waisak 2570 BE',
  '2026-06-01': 'Hari Lahir Pancasila',
  '2026-06-16': 'Tahun Baru Islam 1448 Hijriah',
  '2026-08-17': 'Hari Kemerdekaan Republik Indonesia Ke-81',
  '2026-08-25': 'Maulid Nabi Muhammad SAW',
  '2026-12-25': 'Hari Raya Natal',

  // 2027
  '2027-01-01': 'Tahun Baru 2027 Masehi',
  '2027-01-06': "Isra Mi'raj Nabi Muhammad SAW",
  '2027-02-06': 'Tahun Baru Imlek 2578 Kongzili',
  '2027-03-09': 'Hari Raya Idul Fitri 1448 Hijriah',
  '2027-03-10': 'Hari Raya Idul Fitri 1448 Hijriah',
  '2027-03-26': 'Wafat Yesus Kristus',
  '2027-04-08': 'Hari Suci Nyepi (Tahun Baru Saka 1949)',
  '2027-05-01': 'Hari Buruh Internasional',
  '2027-05-06': 'Kenaikan Yesus Kristus',
  '2027-05-16': 'Hari Raya Idul Adha 1448 Hijriah',
  '2027-05-20': 'Hari Raya Waisak 2571 BE',
  '2027-06-01': 'Hari Lahir Pancasila',
  '2027-06-06': 'Tahun Baru Islam 1449 Hijriah',
  '2027-08-15': 'Maulid Nabi Muhammad SAW',
  '2027-08-17': 'Hari Kemerdekaan Republik Indonesia Ke-82',
  '2027-12-25': 'Hari Raya Natal'
};

export const holidayService = {
  /**
   * Cek apakah tanggal tertentu adalah hari libur nasional Indonesia
   */
  getHoliday(year: number, month: number, day: number): { isHoliday: boolean; name: string } | null {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const name = INDONESIAN_HOLIDAYS[key];
    if (name) {
      return { isHoliday: true, name };
    }
    return null;
  },

  /**
   * Cek apakah hari libur nasional (boolean)
   */
  isHoliday(year: number, month: number, day: number): boolean {
    return this.getHoliday(year, month, day) !== null;
  },

  /**
   * Ambil peta semua hari libur dalam satu bulan tertentu
   * Key: day number (1..31), Value: nama libur
   */
  getHolidaysForMonth(year: number, month: number): Map<number, string> {
    const map = new Map<number, string>();
    const monthStr = String(month).padStart(2, '0');
    const prefix = `${year}-${monthStr}-`;

    for (const [dateStr, name] of Object.entries(INDONESIAN_HOLIDAYS)) {
      if (dateStr.startsWith(prefix)) {
        const day = parseInt(dateStr.substring(8), 10);
        map.set(day, name);
      }
    }
    return map;
  }
};
