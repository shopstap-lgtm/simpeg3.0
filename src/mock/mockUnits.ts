export interface Unit {
  id: string;
  namaUnit: string;
  alamat?: string;
  jumlahPegawai?: number;
}

export const mockUnits: Unit[] = [
  { id: 'unit-all', namaUnit: 'Semua Unit Kerja' },
  { id: 'unit-korwil', namaUnit: 'Kantor Korwil Bidik Cibitung', alamat: 'Jl. Raya Cibitung No. 12', jumlahPegawai: 14 },
  { id: 'unit-sdn-01', namaUnit: 'SDN Cibitung 01', alamat: 'Jl. Melati No. 45, Cibitung', jumlahPegawai: 28 },
  { id: 'unit-sdn-02', namaUnit: 'SDN Cibitung 02', alamat: 'Jl. Kenanga No. 10, Cibitung', jumlahPegawai: 24 },
  { id: 'unit-sdn-03', namaUnit: 'SDN Cibitung 03', alamat: 'Jl. Pendidikan No. 8, Cibitung', jumlahPegawai: 22 },
  { id: 'unit-sdn-04', namaUnit: 'SDN Cibitung 04', alamat: 'Jl. Anggrek No. 19, Cibitung', jumlahPegawai: 19 },
  { id: 'unit-sdn-05', namaUnit: 'SDN Cibitung 05', alamat: 'Jl. Mawar No. 3, Cibitung', jumlahPegawai: 25 },
  { id: 'unit-sdn-06', namaUnit: 'SDN Cibitung 06', alamat: 'Jl. Cempaka No. 14, Cibitung', jumlahPegawai: 21 },
  { id: 'unit-sdn-07', namaUnit: 'SDN Cibitung 07', alamat: 'Jl. Flamboyan No. 7, Cibitung', jumlahPegawai: 18 },
  { id: 'unit-sdn-08', namaUnit: 'SDN Cibitung 08', alamat: 'Jl. Kamboja No. 22, Cibitung', jumlahPegawai: 20 },
  { id: 'unit-smpn-01', namaUnit: 'SMPN 1 Cibitung', alamat: 'Jl. Merdeka No. 100, Cibitung', jumlahPegawai: 52 },
  { id: 'unit-smpn-02', namaUnit: 'SMPN 2 Cibitung', alamat: 'Jl. Garuda No. 55, Cibitung', jumlahPegawai: 46 },
];
