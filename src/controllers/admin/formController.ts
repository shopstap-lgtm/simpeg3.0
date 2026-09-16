import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import prisma from '../../lib/prisma';

export const formController = {
  // 1. List all custom forms
  list: async (req: Request, res: Response) => {
    try {
      const forms = await prisma.customForm.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { responses: true }
          }
        }
      });

      const toast = (req as any).session?.toast || null;
      if ((req as any).session) {
        delete (req as any).session.toast;
      }

      res.render('admin/forms/index', {
        title: 'Kelola Formulir Dinamis - SIMPEG Cibitung',
        page: 'admin-forms',
        user: (req as any).session?.user,
        forms,
        toast
      });
    } catch (error) {
      console.error('Error list forms:', error);
      res.status(500).render('partials/404', {
        title: 'Terjadi Kesalahan',
        message: 'Gagal memuat data formulir dinamis.'
      });
    }
  },

  // 2. Render create form builder
  renderCreate: async (req: Request, res: Response) => {
    try {
      res.render('admin/forms/builder', {
        title: 'Buat Formulir Baru - SIMPEG Cibitung',
        page: 'admin-forms',
        user: (req as any).session?.user,
        form: null,
        isEdit: false,
        toast: null
      });
    } catch (error) {
      console.error('Error render create form:', error);
      res.status(500).send('Internal Server Error');
    }
  },

  // 3. Process create form
  create: async (req: Request, res: Response) => {
    try {
      const {
        title,
        slug,
        description,
        status,
        targetAudience,
        allowMultiple,
        startDate,
        endDate,
        fields,
        successMessage
      } = req.body;

      if (!title || !slug) {
        (req as any).session.toast = {
          type: 'error',
          message: 'Judul dan URL slug formulir wajib diisi!'
        };
        return res.redirect('/admin/forms/create');
      }

      // Format and clean slug
      const cleanedSlug = slug
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-_]/g, '-')
        .replace(/-+/g, '-');

      // Check unique slug
      const existing = await prisma.customForm.findUnique({
        where: { slug: cleanedSlug }
      });

      if (existing) {
        (req as any).session.toast = {
          type: 'error',
          message: `URL slug "${cleanedSlug}" sudah digunakan oleh formulir lain. Gunakan slug yang berbeda.`
        };
        return res.redirect('/admin/forms/create');
      }

      // Parse fields if stringified JSON
      let parsedFields = fields;
      if (typeof fields === 'string') {
        try {
          parsedFields = JSON.parse(fields);
        } catch {
          parsedFields = [];
        }
      }

      if (!Array.isArray(parsedFields) || parsedFields.length === 0) {
        (req as any).session.toast = {
          type: 'error',
          message: 'Formulir harus memiliki minimal 1 pertanyaan/kolom input!'
        };
        return res.redirect('/admin/forms/create');
      }

      await prisma.customForm.create({
        data: {
          title: title.trim(),
          slug: cleanedSlug,
          description: description?.trim() || null,
          status: status || 'PUBLISHED',
          targetAudience: targetAudience || 'PUBLIC',
          allowMultiple: allowMultiple === 'true' || allowMultiple === true,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          fields: parsedFields,
          successMessage: successMessage?.trim() || 'Terima kasih, data Anda telah berhasil dikirim.',
          createdBy: (req as any).session?.user?.username || 'Admin'
        }
      });

      (req as any).session.toast = {
        type: 'success',
        message: 'Formulir baru berhasil dibuat dan siap digunakan!'
      };
      res.redirect('/admin/forms');
    } catch (error) {
      console.error('Error create form:', error);
      (req as any).session.toast = {
        type: 'error',
        message: 'Terjadi kesalahan saat menyimpan formulir.'
      };
      res.redirect('/admin/forms/create');
    }
  },

  // 4. Render edit form builder
  renderEdit: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const form = await prisma.customForm.findUnique({
        where: { id }
      });

      if (!form) {
        (req as any).session.toast = {
          type: 'error',
          message: 'Formulir tidak ditemukan.'
        };
        return res.redirect('/admin/forms');
      }

      res.render('admin/forms/builder', {
        title: `Edit Formulir: ${form.title} - SIMPEG Cibitung`,
        page: 'admin-forms',
        user: (req as any).session?.user,
        form,
        isEdit: true,
        toast: null
      });
    } catch (error) {
      console.error('Error render edit form:', error);
      res.redirect('/admin/forms');
    }
  },

  // 5. Process update form
  update: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const {
        title,
        slug,
        description,
        status,
        targetAudience,
        allowMultiple,
        startDate,
        endDate,
        fields,
        successMessage
      } = req.body;

      const existingForm = await prisma.customForm.findUnique({ where: { id } });
      if (!existingForm) {
        return res.redirect('/admin/forms');
      }

      const cleanedSlug = slug
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-_]/g, '-')
        .replace(/-+/g, '-');

      // Check unique slug if changed
      if (cleanedSlug !== existingForm.slug) {
        const slugUsed = await prisma.customForm.findUnique({
          where: { slug: cleanedSlug }
        });
        if (slugUsed) {
          (req as any).session.toast = {
            type: 'error',
            message: `URL slug "${cleanedSlug}" sudah digunakan oleh formulir lain.`
          };
          return res.redirect(`/admin/forms/${id}/edit`);
        }
      }

      let parsedFields = fields;
      if (typeof fields === 'string') {
        try {
          parsedFields = JSON.parse(fields);
        } catch {
          parsedFields = [];
        }
      }

      await prisma.customForm.update({
        where: { id },
        data: {
          title: title.trim(),
          slug: cleanedSlug,
          description: description?.trim() || null,
          status: status || 'PUBLISHED',
          targetAudience: targetAudience || 'PUBLIC',
          allowMultiple: allowMultiple === 'true' || allowMultiple === true,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          fields: parsedFields,
          successMessage: successMessage?.trim() || 'Terima kasih, data Anda telah berhasil dikirim.'
        }
      });

      (req as any).session.toast = {
        type: 'success',
        message: 'Perubahan formulir berhasil disimpan!'
      };
      res.redirect('/admin/forms');
    } catch (error) {
      console.error('Error update form:', error);
      (req as any).session.toast = {
        type: 'error',
        message: 'Gagal memperbarui formulir.'
      };
      res.redirect(`/admin/forms/${req.params.id}/edit`);
    }
  },

  // 6. Toggle status (PUBLISHED <-> CLOSED)
  toggleStatus: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const form = await prisma.customForm.findUnique({ where: { id } });
      if (!form) return res.redirect('/admin/forms');

      const nextStatus = form.status === 'PUBLISHED' ? 'CLOSED' : 'PUBLISHED';
      await prisma.customForm.update({
        where: { id },
        data: { status: nextStatus }
      });

      (req as any).session.toast = {
        type: 'success',
        message: `Status formulir "${form.title}" berhasil diubah menjadi ${nextStatus === 'PUBLISHED' ? 'BUKA (Aktif)' : 'TUTUP'}.`
      };
      res.redirect('/admin/forms');
    } catch (error) {
      console.error('Error toggle status form:', error);
      res.redirect('/admin/forms');
    }
  },

  // 7. Delete form
  delete: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const form = await prisma.customForm.findUnique({ where: { id } });
      if (form) {
        await prisma.customForm.delete({ where: { id } });
        (req as any).session.toast = {
          type: 'success',
          message: `Formulir "${form.title}" dan seluruh respon di dalamnya berhasil dihapus.`
        };
      }
      res.redirect('/admin/forms');
    } catch (error) {
      console.error('Error delete form:', error);
      res.redirect('/admin/forms');
    }
  },

  // 8. List responses
  responses: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const form = await prisma.customForm.findUnique({
        where: { id },
        include: {
          responses: {
            orderBy: { createdAt: 'desc' },
            include: { employee: true }
          }
        }
      });

      if (!form) {
        return res.redirect('/admin/forms');
      }

      const toast = (req as any).session?.toast || null;
      if ((req as any).session) {
        delete (req as any).session.toast;
      }

      res.render('admin/forms/responses', {
        title: `Respon: ${form.title} - SIMPEG Cibitung`,
        page: 'admin-forms',
        user: (req as any).session?.user,
        form,
        responses: form.responses,
        toast
      });
    } catch (error) {
      console.error('Error list responses:', error);
      res.redirect('/admin/forms');
    }
  },

  // 9. Delete single response
  deleteResponse: async (req: Request, res: Response) => {
    try {
      const { id, responseId } = req.params;
      await prisma.formResponse.delete({
        where: { id: responseId }
      });

      (req as any).session.toast = {
        type: 'success',
        message: 'Respon data berhasil dihapus.'
      };
      res.redirect(`/admin/forms/${id}/responses`);
    } catch (error) {
      console.error('Error delete response:', error);
      res.redirect(`/admin/forms/${req.params.id}/responses`);
    }
  },

  // 10. Export responses to Excel (.xlsx)
  exportExcel: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const form = await prisma.customForm.findUnique({
        where: { id },
        include: {
          responses: {
            orderBy: { createdAt: 'asc' },
            include: { employee: true }
          }
        }
      });

      if (!form) {
        return res.status(404).send('Formulir tidak ditemukan');
      }

      const fieldsList = (Array.isArray(form.fields) ? form.fields : []) as Array<{
        id: string;
        label: string;
        type: string;
      }>;

      // Construct headers
      const headers = [
        'No',
        'Waktu Pengiriman',
        'NIP',
        'Nama Responden',
        'Unit Kerja / Sekolah'
      ];

      fieldsList.forEach(f => {
        headers.push(f.label || f.id);
      });

      const rows: any[][] = [];

      form.responses.forEach((resp, index) => {
        const answers = (resp.answers || {}) as Record<string, any>;
        const dateStr = new Date(resp.createdAt).toLocaleString('id-ID', {
          timeZone: 'Asia/Jakarta'
        });

        const row = [
          index + 1,
          dateStr,
          resp.nip || '-',
          resp.nama || '-',
          resp.unitNama || '-'
        ];

        fieldsList.forEach(f => {
          let val = answers[f.id];
          if (val === undefined || val === null) {
            row.push('-');
          } else if (typeof val === 'object') {
            if (val.url) {
              row.push(val.originalName ? `${val.originalName} (${val.url})` : val.url);
            } else if (Array.isArray(val)) {
              row.push(val.join(', '));
            } else {
              row.push(JSON.stringify(val));
            }
          } else {
            row.push(String(val));
          }
        });

        rows.push(row);
      });

      const wsData = [headers, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Auto column widths
      const colWidths = headers.map((h, i) => {
        let maxLen = h.length;
        rows.forEach(r => {
          const cellLen = r[i] ? String(r[i]).length : 0;
          if (cellLen > maxLen) maxLen = cellLen;
        });
        return { wch: Math.min(Math.max(maxLen + 3, 10), 50) };
      });
      ws['!cols'] = colWidths;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Data Respon');

      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
      const filename = `Rekap_${form.slug.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error) {
      console.error('Error export excel responses:', error);
      res.status(500).send('Gagal mengekspor data ke Excel.');
    }
  }
};
