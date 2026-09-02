import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[Supabase] ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set!');
}

// Use service role key for server-side uploads (bypasses RLS)
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const BULAN_NAMES = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

/**
 * Sanitize string for use in filenames (remove special chars, replace spaces with underscores)
 */
function sanitize(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

/**
 * Upload file ke Supabase Storage bucket
 * @param bucket - nama bucket (e.g. 'ekinerja' | 'klarifikasi')
 * @param fileBuffer - buffer file dari multer memoryStorage
 * @param mimetype - MIME type file
 * @param folder - subfolder dalam bucket (e.g. '2026/07')
 * @param filename - nama file final (sudah di-sanitize)
 * @returns public URL file atau null jika gagal
 */
export async function uploadToStorage(
  bucket: string,
  fileBuffer: Buffer,
  mimetype: string,
  folder: string,
  filename: string
): Promise<{ url: string; path: string } | null> {
  try {
    const filePath = `${folder}/${filename}`;

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filePath, fileBuffer, {
        contentType: mimetype,
        upsert: true // overwrite jika file sudah ada
      });

    if (error) {
      console.error('[Supabase Storage] Upload error:', error.message);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(data.path);

    return { url: urlData.publicUrl, path: data.path };
  } catch (err) {
    console.error('[Supabase Storage] Unexpected error:', err);
    return null;
  }
}

/**
 * Generate nama file otomatis untuk laporan E-Kinerja
 * Format: {Bulan}_{NamaUnitSanitized}_{NamaPegawaiSanitized}_{Harian|Bulanan}.pdf
 */
export function generateEkinerjaFilename(
  bulan: number,
  tahun: number,
  namaUnit: string,
  namaPegawai: string,
  type: 'Harian' | 'Bulanan',
  originalExt: string = '.pdf'
): string {
  const bulanName = BULAN_NAMES[bulan] || `Bulan${bulan}`;
  return `${bulanName}_${sanitize(namaUnit)}_${sanitize(namaPegawai)}_${type}${originalExt}`;
}

/**
 * Generate nama file otomatis untuk klarifikasi absensi
 * Format: Klarifikasi_{NamaPegawai}_{Tanggal}.pdf
 */
export function generateKlarifikasiFilename(
  namaPegawai: string,
  tanggalAbsen: string,
  originalExt: string = '.pdf'
): string {
  const tanggalSanitized = tanggalAbsen.replace(/\s/g, '_').replace(/\//g, '-');
  return `Klarifikasi_${sanitize(namaPegawai)}_${tanggalSanitized}${originalExt}`;
}
