import fs from 'fs';
import path from 'path';
import os from 'os';
import { PDFDocument } from 'pdf-lib';
import prisma from '../lib/prisma';

// Use legacy build of pdfjs-dist for robust Node.js execution
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

// Configure pdfjs to suppress unnecessary font loading errors in console
if (pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
}

export interface ProcessNcrResult {
  periodId: string;
  bulan: number;
  tahun: number;
  fileName: string;
  filteredFilePath: string;
  totalOriginalPages: number;
  totalFilteredPages: number;
  totalEmployeesMatched: number;
  discardedPagesCount: number;
  matchedUnits: string[];
}

export interface ProcessNcrFileItem {
  filePath: string;
  fileName: string;
}

export interface ProcessNcrOptions {
  files?: ProcessNcrFileItem[];
  filePath?: string;
  fileName?: string;
  bulan: number;
  tahun: number;
  uploadedBy?: string;
  onProgress?: (current: number, total: number, status: string) => void;
}

// Regex to capture Indonesian NPWP (15 or 16 digits, with or without dots/dashes)
const NPWP_REGEX = /\b(\d{2}\.?\d{3}\.?\d{3}\.?\d{1}[-.]?\d{3}\.?\d{3}|\d{15,16})\b/g;

/**
 * Normalizes text for case-insensitive and whitespace-tolerant matching
 */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[\s\-_.,/()]+/g, ' ').trim();
}

/**
 * Cleans digits only (for NIP or NPWP)
 */
function cleanDigits(val: string): string {
  return val.replace(/\D/g, '');
}

/**
 * Formats a 15-digit or 16-digit NPWP string into standard XX.XXX.XXX.X-XXX.XXX format
 */
function formatNpwp(digits: string): string {
  const d = cleanDigits(digits);
  if (d.length === 15) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}.${d.slice(8, 9)}-${d.slice(9, 12)}.${d.slice(12, 15)}`;
  }
  if (d.length === 16) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}.${d.slice(8, 9)}-${d.slice(9, 12)}.${d.slice(12, 16)}`;
  }
  return digits;
}

export const ncrPdfService = {
  /**
   * Helper to ensure safe writable directory for filtered master NCR files
   */
  getNcrStorageDir(): string {
    const localDir = path.join(process.cwd(), 'public', 'uploads', 'ncr');
    try {
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }
      fs.accessSync(localDir, fs.constants.W_OK);
      return localDir;
    } catch {
      const tmpDir = path.join(os.tmpdir(), 'uploads', 'ncr');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      return tmpDir;
    }
  },

  /**
   * Reads raw text of all pages in a PDF using pdfjs-dist
   */
  async extractTextFromAllPages(pdfBuffer: Buffer): Promise<{ pageNumber: number; text: string }[]> {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0
    });

    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;
    const pages: { pageNumber: number; text: string }[] = [];

    for (let i = 1; i <= numPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items
          .map((item: any) => item.str || '')
          .join(' ');
        pages.push({ pageNumber: i, text });
      } catch (err) {
        console.warn(`[ncrPdfService] Failed to extract text from page ${i}:`, err);
        pages.push({ pageNumber: i, text: '' });
      }
    }

    return pages;
  },

  /**
   * Processes the Master PDF 1-Kabupaten:
   * 1. Extracts text from each page
   * 2. Checks if page belongs to Cibitung (matches Cibitung unit name, 'Cibitung' keyword, or employee NIP/Name)
   * 3. Slices and keeps only Cibitung pages, saving a new compact master PDF
   * 4. Extracts NPWP for each matched employee
   * 5. Persists NcrPeriod and NcrEmployeePage in database
   */
  async processMasterNcrPdf(options: ProcessNcrOptions): Promise<ProcessNcrResult> {
    const { bulan, tahun, uploadedBy = 'Admin Korwil' } = options;

    const inputFiles: ProcessNcrFileItem[] = [];
    if (options.files && options.files.length > 0) {
      inputFiles.push(...options.files);
    } else if (options.filePath && options.fileName) {
      inputFiles.push({ filePath: options.filePath, fileName: options.fileName });
    }

    if (inputFiles.length === 0) {
      throw new Error('Tidak ada berkas PDF Master NCR yang diberikan.');
    }

    console.log(`[ncrPdfService] Starting master NCR processing for ${bulan}/${tahun} with ${inputFiles.length} file(s)...`);

    const CIBITUNG_KEYWORDS = [
      'cibitung', 'wanasari', 'wanajaya', 'kertamukti',
      'muktiwari', 'sarimukti', 'sukajaya', 'cibuntu'
    ];

    // 1. Fetch all reference employees in Cibitung
    const employees = await prisma.employee.findMany({
      select: {
        id: true,
        nip: true,
        nama: true,
        unitId: true,
        npwp: true,
        unit: { select: { namaUnit: true } }
      }
    });

    const empByNip = new Map<string, typeof employees[0]>();
    for (const e of employees) {
      empByNip.set(cleanDigits(e.nip), e);
    }

    let totalOriginalPages = 0;
    const matchedUnitsSet = new Set<string>();
    const employeesToUpdateNpwp = new Map<string, string>(); // employeeId -> npwp

    // Map cleanNip -> unique employee page data
    const employeePageMap = new Map<string, {
      originalPageNumber: number;
      newFilteredPageNumber: number;
      employeeId: string;
      nip: string;
      nama: string;
      unitNama: string;
      npwp: string | null;
      npwpLast4: string | null;
      isSalaryRow: boolean;
    }>();

    // 2. Initialize consolidated PDFDocument for kept Cibitung pages
    const filteredDoc = await PDFDocument.create();
    let totalKeptPages = 0;

    // 3. Process each input PDF file
    for (let fIdx = 0; fIdx < inputFiles.length; fIdx++) {
      const fileItem = inputFiles[fIdx];
      console.log(`[ncrPdfService] Processing file [${fIdx + 1}/${inputFiles.length}]: ${fileItem.fileName}`);

      const fileBuffer = await fs.promises.readFile(fileItem.filePath);
      const extractedPages = await this.extractTextFromAllPages(fileBuffer);
      totalOriginalPages += extractedPages.length;

      const fileKeptIndices: number[] = [];
      const fileMatchedEmpsPerPage = new Map<number, Array<{
        emp: typeof employees[0];
        cleanNip: string;
        nipIdx: number;
        snippet: string;
        isSalaryRow: boolean;
        rawText: string;
        unitNamaFromHeader: string;
        origPageNum: number;
      }>>();

      for (let idx = 0; idx < extractedPages.length; idx++) {
        const { pageNumber: origPageNum, text: rawText } = extractedPages[idx];

        // Check Cibitung header
        const headerMatch = rawText.match(/\[\s*DINAS\s+PENDIDIKAN\s*\]\s*([^]+?)\s*DAFTAR\s+PEMBAYARAN/i);
        let isCibitungPage = false;
        let unitNamaFromHeader = 'Korwil Cibitung';

        if (headerMatch) {
          const headerUnit = headerMatch[1].toLowerCase().replace(/\s+/g, ' ').trim();
          if (CIBITUNG_KEYWORDS.some(kw => headerUnit.includes(kw))) {
            isCibitungPage = true;
            unitNamaFromHeader = headerMatch[1].replace(/\s+/g, ' ').trim();
            matchedUnitsSet.add(unitNamaFromHeader);
          }
        } else {
          const lower = rawText.toLowerCase();
          if (CIBITUNG_KEYWORDS.some(kw => lower.includes(kw))) {
            isCibitungPage = true;
          }
        }

        const pageMatchedEmps: Array<{
          emp: typeof employees[0];
          cleanNip: string;
          nipIdx: number;
          snippet: string;
          isSalaryRow: boolean;
          rawText: string;
          unitNamaFromHeader: string;
          origPageNum: number;
        }> = [];

        for (const [cleanNip, emp] of empByNip.entries()) {
          if (rawText.includes(cleanNip)) {
            const nipIdx = rawText.indexOf(cleanNip);
            const snippet = rawText.substring(nipIdx, nipIdx + 80);
            const isSalaryRow = /\(\s*(pns|pppk)/i.test(snippet);

            if (isSalaryRow) {
              isCibitungPage = true;
            }

            pageMatchedEmps.push({ emp, cleanNip, nipIdx, snippet, isSalaryRow, rawText, unitNamaFromHeader, origPageNum });
          }
        }

        if (!isCibitungPage) {
          continue;
        }

        fileKeptIndices.push(idx);
        fileMatchedEmpsPerPage.set(idx, pageMatchedEmps);
      }

      if (fileKeptIndices.length > 0) {
        const srcDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
        const copiedPages = await filteredDoc.copyPages(srcDoc, fileKeptIndices);

        for (let cIdx = 0; cIdx < copiedPages.length; cIdx++) {
          filteredDoc.addPage(copiedPages[cIdx]);
          totalKeptPages++;
          const newFilteredPageNumber = totalKeptPages;
          const origIdx = fileKeptIndices[cIdx];
          const matchedEmps = fileMatchedEmpsPerPage.get(origIdx) || [];

          for (const item of matchedEmps) {
            const { emp, cleanNip, nipIdx, isSalaryRow, rawText, unitNamaFromHeader, origPageNum } = item;
            const existing = employeePageMap.get(cleanNip);

            if (!existing || (isSalaryRow && !existing.isSalaryRow)) {
              let detectedNpwp: string | null = null;
              const rowSnippet = rawText.substring(Math.max(0, nipIdx - 150), Math.min(rawText.length, nipIdx + 300));

              const formattedMatches = rowSnippet.match(/\b\d{2}\.?\d{3}\.?\d{3}\.?\d{1}[-.]?\d{3}\.?\d{3}\b/g) || [];
              for (const cand of formattedMatches) {
                const digits = cleanDigits(cand);
                if ((digits.length === 15 || digits.length === 16) && !digits.startsWith('19') && !digits.startsWith('20') && digits !== cleanNip) {
                  detectedNpwp = formatNpwp(digits);
                  break;
                }
              }

              if (!detectedNpwp) {
                const npwpMatches = rowSnippet.match(/\b(\d{15,16})\b/g) || [];
                for (const candidate of npwpMatches) {
                  if (!candidate.startsWith('19') && !candidate.startsWith('20') && candidate !== cleanNip) {
                    detectedNpwp = formatNpwp(candidate);
                    break;
                  }
                }
              }

              const finalNpwp = detectedNpwp || emp.npwp || null;
              const finalFirst4 = finalNpwp ? cleanDigits(finalNpwp).slice(0, 4) : null;

              if (detectedNpwp && !emp.npwp) {
                employeesToUpdateNpwp.set(emp.id, detectedNpwp);
              }

              const unitDisplayName = emp.unit?.namaUnit || unitNamaFromHeader;
              matchedUnitsSet.add(unitDisplayName);

              employeePageMap.set(cleanNip, {
                originalPageNumber: origPageNum,
                newFilteredPageNumber,
                employeeId: emp.id,
                nip: emp.nip,
                nama: emp.nama,
                unitNama: unitDisplayName,
                npwp: finalNpwp,
                npwpLast4: finalFirst4,
                isSalaryRow
              });
            }
          }
        }
      }
    }

    const matchedEmployeePagesData = Array.from(employeePageMap.values());
    console.log(`[ncrPdfService] Filtered result: Kept ${totalKeptPages} of ${totalOriginalPages} pages. Matched ${matchedEmployeePagesData.length} employee-page records.`);

    if (totalKeptPages === 0) {
      throw new Error('Tidak ditemukan halaman yang memuat unit kerja sekolah Cibitung atau NIP pegawai Korwil Cibitung dalam berkas PDF yang diunggah. Mohon pastikan berkas yang diunggah memuat data Kecamatan Cibitung.');
    }

    // 4. Save consolidated PDF containing ONLY kept Cibitung pages
    const filteredBytes = await filteredDoc.save();
    const storageDir = this.getNcrStorageDir();
    const timestamp = Date.now();
    const filteredFileName = `ncr_cibitung_${bulan}_${tahun}_${timestamp}.pdf`;
    const targetFilePath = path.join(storageDir, filteredFileName);
    const publicRelativeUrl = `/uploads/ncr/${filteredFileName}`;

    await fs.promises.writeFile(targetFilePath, Buffer.from(filteredBytes));
    console.log(`[ncrPdfService] Saved consolidated filtered PDF to ${targetFilePath} (${(filteredBytes.length / 1024 / 1024).toFixed(2)} MB)`);

    // 5. Database transaction: Upsert NcrPeriod and NcrEmployeePage
    const monthNames = [
      '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const periodJudul = `NCR Gaji ${monthNames[bulan] || bulan} ${tahun}`;

    // Consolidated display file name
    const displayFileName = inputFiles.length === 1 
      ? inputFiles[0].fileName 
      : `${inputFiles.map(f => f.fileName).join(', ').slice(0, 200)} (${inputFiles.length} Berkas PDF)`;

    const period = await prisma.$transaction(async (tx) => {
      const existing = await tx.ncrPeriod.findUnique({
        where: { bulan_tahun: { bulan, tahun } },
        select: { id: true, fileUrl: true }
      });

      if (existing) {
        try {
          const oldFull = path.join(process.cwd(), 'public', existing.fileUrl);
          if (fs.existsSync(oldFull)) {
            fs.unlinkSync(oldFull);
          }
        } catch (e) {
          console.warn('[ncrPdfService] Could not remove old file:', e);
        }

        await tx.ncrPeriod.delete({
          where: { id: existing.id }
        });
      }

      const newPeriod = await tx.ncrPeriod.create({
        data: {
          bulan,
          tahun,
          judul: periodJudul,
          fileName: displayFileName,
          fileUrl: publicRelativeUrl,
          totalOriginalPages,
          totalFilteredPages: totalKeptPages,
          totalEmployeesMatched: matchedEmployeePagesData.length,
          uploadedBy
        }
      });

      // Bulk insert employeePages with createMany (much faster than nested create)
      if (matchedEmployeePagesData.length > 0) {
        await tx.ncrEmployeePage.createMany({
          data: matchedEmployeePagesData.map(d => ({
            ncrPeriodId: newPeriod.id,
            employeeId: d.employeeId,
            nip: d.nip,
            nama: d.nama,
            unitNama: d.unitNama,
            pageNumber: d.newFilteredPageNumber,
            npwp: d.npwp,
            npwpLast4: d.npwpLast4
          }))
        });
      }

      return newPeriod;
    }, {
      timeout: 60000,
      maxWait: 15000
    });

    // 6. Sync extracted NPWPs back to Employee master data
    if (employeesToUpdateNpwp.size > 0) {
      console.log(`[ncrPdfService] Syncing ${employeesToUpdateNpwp.size} newly extracted NPWPs to Employee master data...`);
      const updateEntries = Array.from(employeesToUpdateNpwp.entries());
      const chunkSize = 25;
      for (let i = 0; i < updateEntries.length; i += chunkSize) {
        const chunk = updateEntries.slice(i, i + chunkSize);
        await Promise.allSettled(chunk.map(([empId, npwpVal]) => 
          prisma.employee.update({
            where: { id: empId },
            data: { npwp: npwpVal }
          })
        ));
      }
    }

    return {
      periodId: period.id,
      bulan,
      tahun,
      fileName: displayFileName,
      filteredFilePath: targetFilePath,
      totalOriginalPages,
      totalFilteredPages: totalKeptPages,
      totalEmployeesMatched: matchedEmployeePagesData.length,
      discardedPagesCount: totalOriginalPages - totalKeptPages,
      matchedUnits: Array.from(matchedUnitsSet)
    };
  },

  /**
   * Slices a single page (the employee's pay slip) from the filtered master PDF
   * and returns the binary PDF Buffer ready for streaming / download.
   */
  async extractEmployeeSlipPdf(filteredPdfUrlOrPath: string, pageNumber: number): Promise<Uint8Array> {
    let fullPath = filteredPdfUrlOrPath;
    if (filteredPdfUrlOrPath.startsWith('/uploads/')) {
      fullPath = path.join(process.cwd(), 'public', filteredPdfUrlOrPath);
    }

    if (!fs.existsSync(fullPath)) {
      // Try tmpdir fallback
      const tmpPath = path.join(os.tmpdir(), filteredPdfUrlOrPath.replace(/^\//, ''));
      if (fs.existsSync(tmpPath)) {
        fullPath = tmpPath;
      } else {
        throw new Error(`Berkas PDF master tidak ditemukan di server: ${filteredPdfUrlOrPath}`);
      }
    }

    const masterBytes = await fs.promises.readFile(fullPath);
    const masterDoc = await PDFDocument.load(masterBytes, { ignoreEncryption: true });

    const totalPages = masterDoc.getPageCount();
    if (pageNumber < 1 || pageNumber > totalPages) {
      throw new Error(`Nomor halaman slip (${pageNumber}) di luar jangkauan total halaman berkas (${totalPages})`);
    }

    // Create a new 1-page PDF document
    const singleDoc = await PDFDocument.create();
    const [copiedPage] = await singleDoc.copyPages(masterDoc, [pageNumber - 1]);
    singleDoc.addPage(copiedPage);

    const singleBytes = await singleDoc.save();
    return singleBytes;
  }
};
