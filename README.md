# Aplikasi Stock Barang (Multi-Perusahaan)

## Cara Menjalankan
1. Install dependensi
   ```bash
   npm install
   ```
2. (Opsional) Seed data demo
   ```bash
   npm run seed
   ```
3. Jalankan aplikasi
   ```bash
   npm run dev
   ```
4. Buka `http://localhost:3000`

## Catatan
- Multi-perusahaan: buat perusahaan baru atau koneksikan database `.db` existing dari halaman pilih perusahaan.
- Role:
  - `user`: bisa input harga, lihat harga, adjustment, dan daftar user.
  - `admin`: tidak melihat harga dan tidak bisa akses adjustment/user list.
- Export tersedia ke Excel (`.xlsx`) dan PDF untuk semua daftar dan laporan.

## Deploy Permanen (Render)
1. Push project ke GitHub.
2. Buat Web Service baru di Render.
3. Set:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Tambahkan Environment Variables:
   - `NODE_ENV=production`
   - `SESSION_SECRET=...` (isi random panjang)
   - `SETUP_KEY=...` (opsional, untuk izin pembuatan perusahaan)
   - `DATA_DIR=/var/data` (sesuaikan dengan mount disk)
5. Tambahkan Persistent Disk dan mount ke `/var/data`.

## Struktur Data
Data tersimpan di folder `data/`.
- `data/master.db` menyimpan daftar perusahaan.
- `data/companies/*.db` berisi data per perusahaan.
