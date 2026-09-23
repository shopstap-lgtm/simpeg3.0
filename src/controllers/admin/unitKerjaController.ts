import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

export const unitKerjaController = {
  show: async (req: Request, res: Response) => {
    try {
      const search = (req.query.search as string) || '';
      const kategori = (req.query.kategori as string) || 'all';

      const whereClause: any = {};
      if (kategori === 'NEGERI' || kategori === 'SWASTA') {
        whereClause.kategori = kategori;
      }
      if (search.trim()) {
        whereClause.OR = [
          { namaUnit: { contains: search, mode: 'insensitive' } },
          { jenjang: { contains: search, mode: 'insensitive' } },
          { kepalaSekolah: { contains: search, mode: 'insensitive' } },
          { operatorSekolah: { contains: search, mode: 'insensitive' } }
        ];
      }

      const [units, totalUnits, totalNegeri, totalSwasta, activeEmployees] = await Promise.all([
        prisma.unit.findMany({
          where: whereClause,
          include: {
            _count: { select: { employees: { where: { aktif: true } } } }
          },
          orderBy: { namaUnit: 'asc' }
        }),
        prisma.unit.count(),
        prisma.unit.count({ where: { kategori: 'NEGERI' } }),
        prisma.unit.count({ where: { kategori: 'SWASTA' } }),
        prisma.employee.findMany({
          where: { aktif: true },
          select: {
            id: true,
            nama: true,
            nip: true,
            unitId: true,
            unit: { select: { namaUnit: true } }
          },
          orderBy: { nama: 'asc' }
        })
      ]);

      const formatted = units.map(u => ({
        id: u.id,
        namaUnit: u.namaUnit,
        kategori: u.kategori || 'NEGERI',
        jenjang: u.jenjang || 'SD',
        kepalaSekolah: u.kepalaSekolah || '',
        kontakKepalaSekolah: u.kontakKepalaSekolah || '',
        operatorSekolah: u.operatorSekolah || '',
        kontakOperator: u.kontakOperator || '',
        totalPegawaiAktif: u._count.employees,
        createdAt: u.createdAt.toISOString().split('T')[0]
      }));

      const toast = (req as any).session?.toast || null;
      if ((req as any).session) {
        delete (req as any).session.toast;
      }

      res.render('admin/unit-kerja', {
        title: 'Data Unit Kerja / Sekolah - Admin SIMPEG',
        page: 'admin-unit-kerja',
        units: formatted,
        employees: activeEmployees.map(e => ({
          id: e.id,
          nama: e.nama,
          nip: e.nip,
          unitId: e.unitId,
          unitNama: e.unit.namaUnit
        })),
        totalUnits,
        totalNegeri,
        totalSwasta,
        kategori,
        search,
        toast,
        user: (req as any).session?.user || { role: 'SUPER_ADMIN', namaLengkap: 'Administrator Utama' }
      });
    } catch (error) {
      console.error('Error in unitKerjaController.show:', error);
      res.status(500).send('Terjadi kesalahan sistem.');
    }
  },

  create: async (req: Request, res: Response) => {
    try {
      const { namaUnit, kategori, jenjang, kepalaSekolah, kontakKepalaSekolah, operatorSekolah, kontakOperator } = req.body;

      if (!namaUnit || namaUnit.trim() === '') {
        if ((req as any).session) {
          (req as any).session.toast = { type: 'warning', message: 'Nama unit kerja wajib diisi.' };
        }
        return res.redirect('/admin/unit-kerja');
      }

      // Check duplicate
      const existing = await prisma.unit.findFirst({
        where: { namaUnit: { equals: namaUnit.trim(), mode: 'insensitive' } }
      });

      if (existing) {
        if ((req as any).session) {
          (req as any).session.toast = { type: 'warning', message: `Unit kerja "${namaUnit.trim()}" sudah ada.` };
        }
        return res.redirect('/admin/unit-kerja');
      }

      const validKategori = kategori === 'SWASTA' ? 'SWASTA' : 'NEGERI';
      const validJenjang = jenjang?.trim() || 'SD';

      await prisma.unit.create({
        data: {
          namaUnit: namaUnit.trim(),
          kategori: validKategori,
          jenjang: validJenjang,
          kepalaSekolah: kepalaSekolah?.trim() || null,
          kontakKepalaSekolah: kontakKepalaSekolah?.trim() || null,
          operatorSekolah: operatorSekolah?.trim() || null,
          kontakOperator: kontakOperator?.trim() || null
        }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Unit kerja "${namaUnit.trim()}" (${validJenjang} ${validKategori}) berhasil ditambahkan.`
        };
        return (req as any).session.save(() => res.redirect('/admin/unit-kerja'));
      }
      res.redirect('/admin/unit-kerja');
    } catch (error) {
      console.error('Error in unitKerjaController.create:', error);
      if ((req as any).session) {
        (req as any).session.toast = { type: 'danger', message: 'Terjadi kesalahan saat menambahkan unit kerja.' };
      }
      res.redirect('/admin/unit-kerja');
    }
  },

  update: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { namaUnit, kategori, jenjang, kepalaSekolah, kontakKepalaSekolah, operatorSekolah, kontakOperator } = req.body;

      if (!namaUnit || namaUnit.trim() === '') {
        if ((req as any).session) {
          (req as any).session.toast = { type: 'warning', message: 'Nama unit kerja wajib diisi.' };
        }
        return res.redirect('/admin/unit-kerja');
      }

      // Check duplicate (excluding current id)
      const existing = await prisma.unit.findFirst({
        where: {
          namaUnit: { equals: namaUnit.trim(), mode: 'insensitive' },
          NOT: { id }
        }
      });

      if (existing) {
        if ((req as any).session) {
          (req as any).session.toast = { type: 'warning', message: `Nama unit "${namaUnit.trim()}" sudah digunakan oleh unit lain.` };
        }
        return res.redirect('/admin/unit-kerja');
      }

      const validKategori = kategori === 'SWASTA' ? 'SWASTA' : 'NEGERI';
      const validJenjang = jenjang?.trim() || 'SD';

      await prisma.unit.update({
        where: { id },
        data: {
          namaUnit: namaUnit.trim(),
          kategori: validKategori,
          jenjang: validJenjang,
          kepalaSekolah: kepalaSekolah?.trim() || null,
          kontakKepalaSekolah: kontakKepalaSekolah?.trim() || null,
          operatorSekolah: operatorSekolah?.trim() || null,
          kontakOperator: kontakOperator?.trim() || null
        }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Unit kerja berhasil diperbarui.`
        };
        return (req as any).session.save(() => res.redirect('/admin/unit-kerja'));
      }
      res.redirect('/admin/unit-kerja');
    } catch (error) {
      console.error('Error in unitKerjaController.update:', error);
      if ((req as any).session) {
        (req as any).session.toast = { type: 'danger', message: 'Terjadi kesalahan saat memperbarui unit kerja.' };
      }
      res.redirect('/admin/unit-kerja');
    }
  },

  delete: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Check if unit still has active employees
      const unit = await prisma.unit.findUnique({
        where: { id },
        include: { _count: { select: { employees: true } } }
      });

      if (!unit) {
        if ((req as any).session) {
          (req as any).session.toast = { type: 'warning', message: 'Unit kerja tidak ditemukan.' };
        }
        return res.redirect('/admin/unit-kerja');
      }

      if (unit._count.employees > 0) {
        if ((req as any).session) {
          (req as any).session.toast = {
            type: 'warning',
            message: `Tidak dapat menghapus "${unit.namaUnit}" karena masih memiliki ${unit._count.employees} pegawai terdaftar. Pindahkan pegawai terlebih dahulu.`
          };
          return (req as any).session.save(() => res.redirect('/admin/unit-kerja'));
        }
        return res.redirect('/admin/unit-kerja');
      }

      await prisma.unit.delete({ where: { id } });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `Unit kerja "${unit.namaUnit}" berhasil dihapus.`
        };
        return (req as any).session.save(() => res.redirect('/admin/unit-kerja'));
      }
      res.redirect('/admin/unit-kerja');
    } catch (error) {
      console.error('Error in unitKerjaController.delete:', error);
      if ((req as any).session) {
        (req as any).session.toast = { type: 'danger', message: 'Terjadi kesalahan saat menghapus unit kerja.' };
      }
      res.redirect('/admin/unit-kerja');
    }
  },

  bulkDelete: async (req: Request, res: Response) => {
    try {
      const { ids } = req.body;
      let targetIds: string[] = [];
      if (typeof ids === 'string') {
        try { targetIds = JSON.parse(ids); } catch { targetIds = [ids]; }
      } else if (Array.isArray(ids)) {
        targetIds = ids;
      }

      if (!targetIds || targetIds.length === 0) {
        if ((req as any).session) {
          (req as any).session.toast = { type: 'warning', message: 'Pilih minimal satu unit kerja untuk dihapus.' };
        }
        return res.redirect('/admin/unit-kerja');
      }

      // Check which units have employees
      const unitsWithEmployees = await prisma.unit.findMany({
        where: {
          id: { in: targetIds },
          employees: { some: {} }
        },
        select: { id: true, namaUnit: true, _count: { select: { employees: true } } }
      });

      const blockedIds = new Set(unitsWithEmployees.map(u => u.id));
      const allowedIds = targetIds.filter(id => !blockedIds.has(id));

      let deletedCount = 0;
      if (allowedIds.length > 0) {
        const delResult = await prisma.unit.deleteMany({
          where: { id: { in: allowedIds } }
        });
        deletedCount = delResult.count;
      }

      if ((req as any).session) {
        if (blockedIds.size > 0 && deletedCount > 0) {
          (req as any).session.toast = {
            type: 'warning',
            message: `${deletedCount} unit kerja berhasil dihapus. ${blockedIds.size} unit tidak dihapus karena masih memiliki data pegawai.`
          };
        } else if (blockedIds.size > 0 && deletedCount === 0) {
          (req as any).session.toast = {
            type: 'warning',
            message: `Gagal menghapus: semua ${blockedIds.size} unit yang dipilih masih memiliki data pegawai terdaftar.`
          };
        } else {
          (req as any).session.toast = {
            type: 'success',
            message: `${deletedCount} unit kerja berhasil dihapus.`
          };
        }
      }

      res.redirect('/admin/unit-kerja');
    } catch (error) {
      console.error('Error in unitKerjaController.bulkDelete:', error);
      if ((req as any).session) {
        (req as any).session.toast = { type: 'danger', message: 'Terjadi kesalahan saat menghapus unit kerja massal.' };
      }
      res.redirect('/admin/unit-kerja');
    }
  },

  bulkKategori: async (req: Request, res: Response) => {
    try {
      const { ids, kategori } = req.body;
      let targetIds: string[] = [];
      if (typeof ids === 'string') {
        try { targetIds = JSON.parse(ids); } catch { targetIds = [ids]; }
      } else if (Array.isArray(ids)) {
        targetIds = ids;
      }

      if (!targetIds || targetIds.length === 0) {
        if ((req as any).session) {
          (req as any).session.toast = { type: 'warning', message: 'Pilih minimal satu unit kerja.' };
        }
        return res.redirect('/admin/unit-kerja');
      }

      const validKategori = kategori === 'SWASTA' ? 'SWASTA' : 'NEGERI';
      await prisma.unit.updateMany({
        where: { id: { in: targetIds } },
        data: { kategori: validKategori }
      });

      if ((req as any).session) {
        (req as any).session.toast = {
          type: 'success',
          message: `${targetIds.length} unit kerja berhasil diubah status kategorinya menjadi ${validKategori}.`
        };
      }

      res.redirect('/admin/unit-kerja');
    } catch (error) {
      console.error('Error in unitKerjaController.bulkKategori:', error);
      res.redirect('/admin/unit-kerja');
    }
  }
};
