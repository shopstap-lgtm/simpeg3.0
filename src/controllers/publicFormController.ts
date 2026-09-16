import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';

function isValidExtension(filename: string, fileType?: string, customExtensions?: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  const type = fileType || 'all';

  if (type === 'pdf') {
    return ext === '.pdf';
  } else if (type === 'image') {
    return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
  } else if (type === 'office') {
    return ['.pdf', '.docx', '.doc', '.xlsx', '.xls'].includes(ext);
  } else if (type === 'custom' && customExtensions) {
    const allowed = customExtensions.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    return allowed.some(a => (a.startsWith('.') ? a : `.${a}`) === ext);
  }
  return true; // 'all' allows any standard uploaded file
}

function getReadableAllowedExtensions(fileType?: string, customExtensions?: string): string {
  const type = fileType || 'all';
  if (type === 'pdf') return 'Khusus Dokumen PDF (.pdf)';
  if (type === 'image') return 'Gambar / Foto (.jpg, .jpeg, .png)';
  if (type === 'office') return 'Dokumen Office (.pdf, .docx, .xlsx)';
  if (type === 'custom' && customExtensions) return customExtensions;
  return 'PDF, Gambar, atau Dokumen';
}

function generateRenamedFilename(
  originalFilename: string,
  pattern: string | undefined,
  meta: { nip?: string | null; nama?: string | null; unitNama?: string | null }
): string {
  const ext = path.extname(originalFilename);
  const baseName = path.basename(originalFilename, ext);

  if (!pattern || !pattern.trim()) {
    return `${Date.now()}-${baseName.replace(/[^a-zA-Z0-9-_]/g, '_')}${ext}`;
  }

  const cleanNip = (meta.nip || 'NONIP').replace(/[^0-9]/g, '') || 'NONIP';
  const cleanNama = (meta.nama || 'ANONIM').toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_') || 'ANONIM';
  const cleanUnit = (meta.unitNama || 'NOUNIT').toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_') || 'NOUNIT';
  const dateStr = new Date().toISOString().split('T')[0];
  const cleanBaseName = baseName.replace(/[^a-zA-Z0-9-_]/g, '_') || 'BERKAS';

  let result = pattern
    .replace(/\{NIP\}/gi, cleanNip)
    .replace(/\{NAMA\}/gi, cleanNama)
    .replace(/\{SEKOLAH\}/gi, cleanUnit)
    .replace(/\{UNIT\}/gi, cleanUnit)
    .replace(/\{TANGGAL\}/gi, dateStr)
    .replace(/\{NAMA_FILE\}/gi, cleanBaseName);

  result = result.replace(/[^a-zA-Z0-9-_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!result) result = `BERKAS_${Date.now()}`;

  return `${result}${ext}`;
}

export const publicFormController = {
  // 1. Render form to fill
  renderForm: async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const form = await prisma.customForm.findUnique({
        where: { slug }
      });

      if (!form || form.status === 'DRAFT') {
        return res.status(404).render('partials/404', {
          title: 'Formulir Tidak Ditemukan',
          message: 'Formulir yang Anda cari tidak ditemukan atau belum dipublikasikan.'
        });
      }

      // Check dates
      const now = new Date();
      let isExpired = false;
      let isNotStarted = false;

      if (form.status === 'CLOSED') {
        isExpired = true;
      } else {
        if (form.endDate && now > new Date(form.endDate)) {
          isExpired = true;
        }
        if (form.startDate && now < new Date(form.startDate)) {
          isNotStarted = true;
        }
      }

      // Load units and active employees for dynamic SIMPEG fields
      const [units, rawEmployees] = await Promise.all([
        prisma.unit.findMany({
          select: { id: true, namaUnit: true },
          orderBy: { namaUnit: 'asc' }
        }),
        prisma.employee.findMany({
          where: { aktif: true },
          select: {
            id: true,
            nip: true,
            nama: true,
            unitId: true,
            unit: { select: { namaUnit: true } }
          },
          orderBy: { nama: 'asc' }
        })
      ]);

      const employees = rawEmployees.map(e => ({
        id: e.id,
        nip: e.nip,
        nama: e.nama,
        unitId: e.unitId,
        unitNama: e.unit?.namaUnit || ''
      }));

      // Render view
      res.render('public/form-fill', {
        title: `${form.title} - SIMPEG Cibitung`,
        page: 'public-form',
        form,
        units,
        employees,
        isExpired,
        isNotStarted,
        toast: (req as any).session?.formError || null
      });

      // Clear toast after render
      if ((req as any).session) {
        delete (req as any).session.formError;
      }
    } catch (error) {
      console.error('Error render public form:', error);
      res.status(500).render('partials/404', {
        title: 'Terjadi Kesalahan',
        message: 'Gagal memuat formulir.'
      });
    }
  },

  // 2. Process form submission
  submitForm: async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const form = await prisma.customForm.findUnique({
        where: { slug }
      });

      if (!form || form.status === 'DRAFT' || form.status === 'CLOSED') {
        return res.status(403).send('Formulir tidak menerima pengisian.');
      }

      const now = new Date();
      if (form.endDate && now > new Date(form.endDate)) {
        return res.status(403).send('Formulir telah ditutup.');
      }
      if (form.startDate && now < new Date(form.startDate)) {
        return res.status(403).send('Formulir belum dibuka.');
      }

      const fieldsList = (form.fields as any) as Array<{
        id: string;
        label: string;
        type: string;
        required?: boolean;
        options?: string[];
        fileType?: string;
        customExtensions?: string;
        renamePattern?: string;
      }>;

      // Identity extraction from form answers or body
      let employeeId: string | null = req.body._employeeId ? String(req.body._employeeId).trim() : null;
      let nip: string | null = req.body._nip ? String(req.body._nip).trim() : null;
      let nama: string | null = req.body._nama ? String(req.body._nama).trim() : null;
      let unitNama: string | null = req.body._unitNama ? String(req.body._unitNama).trim() : null;

      // Pre-extract identity from dynamic questions (unit & employee)
      for (const field of fieldsList) {
        const fieldKey = `field_${field.id}`;
        const rawVal = req.body[fieldKey] !== undefined ? req.body[fieldKey] : req.body[field.id];

        if (field.type === 'unit' && rawVal) {
          if (!unitNama) unitNama = String(rawVal).trim();
        } else if (field.type === 'employee' && rawVal) {
          if (typeof rawVal === 'string' && rawVal.includes('|')) {
            const parts = rawVal.split('|');
            if (parts.length >= 2) {
              if (!employeeId && parts[0]) employeeId = parts[0].trim();
              if (!nama && parts[1]) nama = parts[1].trim();
              if (!nip && parts[2]) nip = parts[2].trim();
              if (!unitNama && parts[3]) unitNama = parts[3].trim();
            }
          } else {
            const empId = req.body[`${fieldKey}_id`];
            const empNip = req.body[`${fieldKey}_nip`];
            const empUnit = req.body[`${fieldKey}_unit`];

            if (!employeeId && empId) employeeId = String(empId).trim();
            if (!nip && empNip) nip = String(empNip).trim();
            if (!unitNama && empUnit) unitNama = String(empUnit).trim();
            if (!nama && typeof rawVal === 'string') {
              const match = rawVal.match(/^(.*?)\s*\(NIP:/);
              nama = match ? match[1].trim() : rawVal.trim();
            }
          }
        }
      }

      // If employeeId is present, enrich missing nip, nama, unitNama from database
      if (employeeId && (!nip || !nama || !unitNama)) {
        const emp = await prisma.employee.findUnique({
          where: { id: employeeId },
          include: { unit: true }
        });
        if (emp) {
          if (!nip) nip = emp.nip;
          if (!nama) nama = emp.nama;
          if (!unitNama) unitNama = emp.unit?.namaUnit || null;
        }
      }

      // Check single-response limit if allowMultiple is false and NIP is available
      if (!form.allowMultiple && nip) {
        const existingResp = await prisma.formResponse.findFirst({
          where: {
            formId: form.id,
            nip: nip
          }
        });
        if (existingResp) {
          (req as any).session.formError = `Pegawai dengan NIP ${nip} telah mengirimkan respon sebelumnya. Formulir ini dibatasi hanya 1 kali pengisian per pegawai.`;
          return res.redirect(`/form/${slug}`);
        }
      }

      // Process uploaded files with extension validation & dynamic renaming
      const rawFiles = (req.files && Array.isArray(req.files)) ? (req.files as Express.Multer.File[]) : [];
      const filesMap: Record<string, any> = {};

      for (const field of fieldsList) {
        if (field.type === 'file') {
          const uploadedFile = rawFiles.find(f => f.fieldname === `field_${field.id}` || f.fieldname === field.id);

          if (!uploadedFile) {
            if (field.required) {
              (req as any).session.formError = `Kolom "${field.label}" wajib melampirkan berkas!`;
              return res.redirect(`/form/${slug}`);
            }
          } else {
            // Validate extension
            if (!isValidExtension(uploadedFile.originalname, field.fileType, field.customExtensions)) {
              // Delete invalid file from disk
              try { fs.unlinkSync(uploadedFile.path); } catch {}
              const allowedText = getReadableAllowedExtensions(field.fileType, field.customExtensions);
              (req as any).session.formError = `Format berkas untuk "${field.label}" tidak diizinkan. Format yang diterima: ${allowedText}`;
              return res.redirect(`/form/${slug}`);
            }

            // Generate clean renamed filename
            const newFilename = generateRenamedFilename(uploadedFile.originalname, field.renamePattern, { nip, nama, unitNama });
            const uploadDir = path.dirname(uploadedFile.path);
            const targetPath = path.join(uploadDir, newFilename);

            try {
              // If target file already exists, avoid collision by appending unique timestamp
              let finalPath = targetPath;
              let finalFilename = newFilename;
              if (fs.existsSync(targetPath)) {
                const ext = path.extname(newFilename);
                const base = path.basename(newFilename, ext);
                finalFilename = `${base}_${Date.now()}${ext}`;
                finalPath = path.join(uploadDir, finalFilename);
              }

              fs.renameSync(uploadedFile.path, finalPath);

              filesMap[field.id] = {
                url: `/uploads/${finalFilename}`,
                filename: finalFilename,
                originalName: uploadedFile.originalname,
                size: uploadedFile.size,
                mimetype: uploadedFile.mimetype
              };
            } catch (renameErr) {
              console.error('Error renaming uploaded file:', renameErr);
              filesMap[field.id] = {
                url: `/uploads/${uploadedFile.filename}`,
                filename: uploadedFile.filename,
                originalName: uploadedFile.originalname,
                size: uploadedFile.size,
                mimetype: uploadedFile.mimetype
              };
            }
          }
        }
      }

      // Process answers
      const answers: Record<string, any> = {};

      for (const field of fieldsList) {
        const fieldKey = `field_${field.id}`;
        let rawVal = req.body[fieldKey] !== undefined ? req.body[fieldKey] : req.body[field.id];

        if (field.type === 'file') {
          if (filesMap[field.id]) {
            answers[field.id] = filesMap[field.id];
          }
        } else if (field.type === 'unit') {
          if (field.required && (!rawVal || (typeof rawVal === 'string' && rawVal.trim() === ''))) {
            (req as any).session.formError = `Kolom "${field.label}" wajib memilih unit kerja / sekolah!`;
            return res.redirect(`/form/${slug}`);
          }
          if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
            answers[field.id] = rawVal;
          }
        } else if (field.type === 'employee') {
          if (field.required && (!rawVal || (typeof rawVal === 'string' && rawVal.trim() === ''))) {
            (req as any).session.formError = `Kolom "${field.label}" wajib memilih nama pegawai / guru!`;
            return res.redirect(`/form/${slug}`);
          }
          if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
            if (typeof rawVal === 'string' && rawVal.includes('|')) {
              const parts = rawVal.split('|');
              answers[field.id] = parts[1] || rawVal;
            } else {
              answers[field.id] = rawVal;
            }
          }
        } else {
          // Check required
          if (field.required) {
            if (rawVal === undefined || rawVal === null || (typeof rawVal === 'string' && rawVal.trim() === '')) {
              (req as any).session.formError = `Kolom "${field.label}" wajib diisi!`;
              return res.redirect(`/form/${slug}`);
            }
            if (Array.isArray(rawVal) && rawVal.length === 0) {
              (req as any).session.formError = `Kolom "${field.label}" wajib dipilih minimal satu opsi!`;
              return res.redirect(`/form/${slug}`);
            }
          }

          if (rawVal !== undefined && rawVal !== null) {
            answers[field.id] = rawVal;
          }
        }
      }

      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || null;
      const userAgent = req.headers['user-agent'] || null;

      await prisma.formResponse.create({
        data: {
          formId: form.id,
          employeeId,
          nip,
          nama,
          unitNama,
          answers,
          ipAddress: typeof ipAddress === 'string' ? ipAddress.split(',')[0].trim() : null,
          userAgent: typeof userAgent === 'string' ? userAgent.substring(0, 255) : null
        }
      });

      res.redirect(`/form/${slug}/success`);
    } catch (error) {
      console.error('Error submit public form:', error);
      (req as any).session.formError = 'Terjadi kesalahan sistem saat mengirim formulir. Silakan coba lagi.';
      res.redirect(`/form/${req.params.slug}`);
    }
  },

  // 3. Render success page
  renderSuccess: async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const form = await prisma.customForm.findUnique({
        where: { slug }
      });

      if (!form) {
        return res.redirect('/');
      }

      res.render('public/form-success', {
        title: 'Pengiriman Berhasil - SIMPEG Cibitung',
        form,
        user: (req as any).session?.user || null
      });
    } catch (error) {
      console.error('Error render success form:', error);
      res.redirect('/');
    }
  }
};
