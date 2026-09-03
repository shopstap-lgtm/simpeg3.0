import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClientInstance: SupabaseClient | null = null;

/**
 * Get Supabase client lazily and safely.
 * Returns null if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClientInstance) {
    return supabaseClientInstance;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey || !supabaseUrl.startsWith('http')) {
    console.warn('[Supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set or invalid. Storage uploads will fallback to Base64.');
    return null;
  }

  try {
    supabaseClientInstance = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    return supabaseClientInstance;
  } catch (err) {
    console.error('[Supabase] Failed to initialize Supabase client:', err);
    return null;
  }
}

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
  const client = getSupabaseClient();
  if (!client) {
    // Mode VPS / Self-Hosted: Simpan berkas fisik langsung ke disk lokal di public/uploads
    try {
      const pathModule = await import('path');
      const fsModule = await import('fs');
      const uploadsDir = pathModule.resolve(process.cwd(), 'public', 'uploads');
      if (!fsModule.existsSync(uploadsDir)) {
        fsModule.mkdirSync(uploadsDir, { recursive: true });
      }

      // Simpan langsung dengan format nama resmi tanpa prefix timestamp
      let finalFilename = filename;
      let fullPath = pathModule.join(uploadsDir, finalFilename);
      const ext = pathModule.extname(filename);
      const base = pathModule.basename(filename, ext);
      let counter = 1;
      while (fsModule.existsSync(fullPath)) {
        finalFilename = `${base} (${counter})${ext}`;
        fullPath = pathModule.join(uploadsDir, finalFilename);
        counter++;
      }

      fsModule.writeFileSync(fullPath, fileBuffer);

      const publicUrl = `/uploads/${finalFilename}`;
      console.log(`[Storage VPS] Berkas fisik berhasil disimpan ke disk: ${publicUrl}`);
      return { url: publicUrl, path: finalFilename };
    } catch (fsErr) {
      console.error('[Storage VPS] Gagal menyimpan berkas ke disk lokal:', fsErr);
      return null;
    }
  }

  try {
    const filePath = `${folder}/${filename}`;

    const { data, error } = await client.storage
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
    const { data: urlData } = client.storage
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
 * Format: HARIAN/BULANAN [BULAN YANG DIAJUKAN] [NAMA PEGAWAI].pdf
 */
export function generateEkinerjaFilename(
  bulan: number,
  tahun: number,
  namaUnit: string,
  namaPegawai: string,
  type: 'Harian' | 'Bulanan',
  originalExt: string = '.pdf'
): string {
  const typeStr = type.toUpperCase();
  const bName = (BULAN_NAMES[bulan] || `BULAN ${bulan}`).toUpperCase();
  const cleanNama = namaPegawai.replace(/,/g, '').replace(/\./g, ' ').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  return `${typeStr} ${bName} ${cleanNama}${originalExt}`;
}

/**
 * Generate nama file otomatis untuk klarifikasi absensi
 * Format: KLAR [BULAN] [NAMA] [STATUS YANG DIAJUKAN] [TANGGAL YANG DIAJUKAN].pdf
 */
export function generateKlarifikasiFilename(
  namaPegawai: string,
  tanggalAbsen: string,
  statusPengganti: string = 'DL',
  bulan?: number,
  originalExt: string = '.pdf'
): string {
  let bName = '';
  if (bulan && BULAN_NAMES[bulan]) {
    bName = BULAN_NAMES[bulan].toUpperCase();
  } else {
    const match = tanggalAbsen.match(/(\d{4})[-/](\d{1,2})/);
    if (match) {
      const bNum = parseInt(match[2], 10);
      bName = (BULAN_NAMES[bNum] || `BULAN ${bNum}`).toUpperCase();
    } else {
      const altMatch = tanggalAbsen.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
      if (altMatch) {
        const bNum = parseInt(altMatch[2], 10);
        bName = (BULAN_NAMES[bNum] || `BULAN ${bNum}`).toUpperCase();
      } else {
        bName = (BULAN_NAMES[new Date().getMonth() + 1] || '').toUpperCase();
      }
    }
  }

  const cleanNama = namaPegawai.replace(/,/g, '').replace(/\./g, ' ').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const cleanStatus = (statusPengganti || 'DL').trim().toUpperCase();
  const cleanTgl = tanggalAbsen.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ');
  return `KLAR ${bName} ${cleanNama} ${cleanStatus} ${cleanTgl}${originalExt}`;
}
