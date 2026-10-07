# Remiku — Papan Skor Remi (4 Pemain)

**Remiku** adalah papan skor untuk permainan kartu **Remi** dengan **4 pemain** yang
berjalan sepenuhnya di peramban (*static PWA*, tanpa backend dan tanpa dependency).
Tampilan dibuat *mobile-first* dengan nuansa **native mobile app**: surface ringan,
divider halus, shadow minimal, radius moderat, dan aksen pink cerah. Header *app bar*
sederhana menampilkan **logo kartu Remi** + wordmark **`Remiku`** (kiri) dan **meta
`versi · penulis`** (kanan, mis. `v1.4 · zkvoid`) yang konsisten di semua layar,
dengan **bottom navigation** sebagai navigasi utama. Nilai versi diambil dari satu
konstanta `APP_VERSION` di
`js/app.js` yang **selalu dinaikkan setiap ada perubahan**. Wordmark
**`Remi`** + **`ku`** tetap dipakai di layar hasil dan gambar PNG hasil.

```
Target 1000 poin · Milestone 500–999 · Reset bila pemilik milestone overtaken
```

---

## Daftar Isi

- [Fitur Utama](#fitur-utama)
- [Aturan Skor](#aturan-skor)
- [Cara Menggunakan](#cara-menggunakan)
- [Struktur Proyek](#struktur-proyek)
- [Menjalankan Secara Lokal](#menjalankan-secara-lokal)
- [Hosting / Deploy](#hosting--deploy)
- [PWA & Mode Offline](#pwa--mode-offline)
- [Penyimpanan Data & Privasi](#penyimpanan-data--privasi)
- [Pengujian Otomatis](#pengujian-otomatis)
- [Ikon Aplikasi](#ikon-aplikasi)
- [Aksesibilitas](#aksesibilitas)
- [Kompatibilitas Peramban](#kompatibilitas-peramban)
- [Lisensi & Kredit](#lisensi--kredit)

---

## Fitur Utama

| Fitur | Keterangan |
| --- | --- |
| 4 pemain tetap | Grid 2×2 di ponsel, melebar otomatis di tablet/desktop. |
| Skor cepat | Tombol `-35`, `-40`, `+250`, `+300` untuk setiap pemain (2×2 di ponsel, 4 sejajar di layar lebar). |
| Input manual | Kolom angka lebar penuh, diikuti tombol **Perbarui** lebar penuh (selalu bertumpuk di semua ukuran layar). Menerima bilangan bulat, mis. `250`, `+250`, atau `-35` (Enter = kirim). |
| Progress bar | Setiap kartu menampilkan kemajuan menuju target poin (default 1000, dapat diubah di **Pengaturan**). |
| Permainan Baru | Tombol reset (skor + riwayat + urutan milestone) ada di layar **Pengaturan**, bukan lagi di layar utama. Nama pemain tetap dipertahankan. |
| Badge kartu | Satu badge per kartu: **PENGOCOK HANDAL** (SATU pemain yang **paling lama berada di total skor terendah**, yaitu ≥ 4 ronde beruntun; **semua ronde berskor dihitung — termasuk ronde dengan satu pencatat**, karena satu kali **[Perbarui]** = satu ronde; hanya ronde **semua pemain seri** yang memutus rentetan — namun **seri di posisi terendah TETAP dihitung**) lebih diutamakan daripada **NGOCOK** (skor **total terendah saat ini** → mengocok ronde berikutnya; bila beberapa pemain seri, dipilih **satu secara acak**); kartu pemenang menampilkan **PEMENANG**. |
| Riwayat skor | 6 perubahan terbaru di layar utama + daftar lengkap di layar **Riwayat** (bottom navigation). |
| Riwayat reset | Peristiwa reset tersimpan lengkap (siapa overtaken oleh siapa, dari berapa ke 0). |
| Banner RESET | Banner kuning dengan ikon `⚠` dan prefix `RESET ·` agar pemain langsung tahu **mengapa** skornya jadi 0. |
| Nama pemain | Bisa diubah kapan saja dan tersimpan otomatis (maks. 24 karakter). |
| Layar hasil | Dua kartu status bertumpuk yang sejalan dengan badge kartu: **kartu Pemenang** (nama + skor) lalu **kartu Pengocok Handal** (penyandang + panjang rentetan, mis. `Pemain 1 · 5×`; bergaya netral `Belum ada · belum memenuhi syarat (min. 4 ronde)` bila belum ada yang ≥ 4 ronde), diikuti **ranking lengkap**. Tabel statistik per pemain tidak lagi di sini — ada di layar **Statistik**. Layar ini dibuka dengan **logo kartu + wordmark `Remiku`** dan baris **`versi · zkvoid`** (dari konstanta `APP_VERSION`) tepat seperti header. |
| Layar Statistik | Daftar ringkas tiap pemain (**Ngocok** = jumlah ronde di mana pemain punya **TOTAL skor terendah** / **Shutout** = jumlah skor ronde 250/300 — kolom **Terendah** lama dihapus karena selalu sama dengan **Ngocok**; baris dibuat lebih padat) + banner **Pengocok Handal** dengan panjang rentetan sebagai angka besar. Callout ini **SELALU** tampil: siapa penyandangnya (badge pink + panjang rentetan) bila sudah ada yang ≥ 4 ronde, atau **pemimpin sementara** ber-gaya netral (mis. `Pemain 1 · 3× — belum memenuhi syarat`) bila belum ada — jadi info "siapa calon Pengocok Handal" selalu terlihat. |
| Bottom navigation | Navigasi utama **Main · Riwayat · Statistik · Pengaturan** (fixed di bawah, aman *safe-area*, ikon + label, penanda aktif pink). |
| Layar navigasi | Riwayat, Statistik, dan Pengaturan berupa **layar penuh** di dalam halaman (bukan lagi modal). |
| Modal bottom-sheet | Hanya **Hasil Permainan** dan **Konfirmasi** yang tampil sebagai bottom-sheet di ponsel (≥ 600 px jadi dialog tengah). |
| Simpan hasil | Ekspor hasil menjadi gambar **PNG** lewat Canvas API (900 px, tajam di layar retina), dibuat **sinkron** di dalam gestur ketukan agar unduhan tidak diblokir peramban. Gambar memuat **logo kartu + wordmark `Remiku`** dengan baris **`versi · zkvoid`**, pemenang, ranking, **dan statistik lengkap** (callout pengocok handal + panjang rentetannya + hitungan **Ngocok / Shutout** tiap pemain). |
| Bagikan | Di perangkat sentuh (iOS/Android) memakai *Web Share API*; di desktop langsung mengunduh berkas. Selalu ada *fallback* unduhan. |
| Input skor negatif | Tombol **±** di dalam kolom skor (keypad numerik ponsel tidak punya tombol minus) + normalisasi otomatis varian minus Unicode. |
| Offline | Setelah kunjungan pertama, aplikasi bisa dibuka tanpa internet (service worker). |
| Installable | Bisa dipasang ke home screen Android/iOS sebagai PWA. |
| Tanpa dependency | Hanya HTML, CSS, dan JavaScript murni. Tidak ada CDN, tidak ada framework. |

---

## Aturan Skor

Aplikasi ini mengimplementasikan aturan berikut.

1. **Target kemenangan: 1000 poin.** Pemain pertama yang mencapai skor **≥ 1000**
   memenangkan permainan. Setelah menang, seluruh input skor dinonaktifkan.
2. **Rentang milestone: 500–999.** Untuk setiap nilai `m` dari 500 sampai 999,
   aplikasi mencatat **urutan pemain yang pertama kali mencapai skor ≥ m**.
3. **Overtakes = reset.** Bila pemain A menaikkan skornya sehingga **benar-benar melewati**
   skor pemain B (bukan sekadar menyamainya), dan B adalah **pemilik milestone** sebesar
   skor B saat itu, maka **skor B direset menjadi 0**.
4. **Seri bukan overtake.** Jika skor baru hanya *sama dengan* skor lawan, tidak ada
   reset. Reset hanya terjadi bila `skor baru > skor lawan`.
5. **Hanya pemilik milestone yang direset.** Pemain yang mencapai milestone tersebut
   **belakangan** tidak direset walaupun ikut overtaken.
6. **Skor di luar 500–999 tidak memicu reset.** Mis. overtakes pemain yang skornya 300
   tidak menyebabkan apa-apa.
7. **Urutan pencapaian tidak pernah dihapus.** Walaupun skor pemain turun (bahkan ke 0),
   catatan bahwa ia pernah mencapai milestone tertentu tetap tersimpan. Inilah yang
   membuat aturan "siapa datang lebih dulu" tetap adil.
8. **Satu pemain hanya direset maksimal sekali per aksi**, walau beberapa lawan overtaken
   sekaligus. Beberapa pemain berbeda bisa direset dalam satu aksi yang sama.

### Contoh Skenario

| Langkah | A | B | Catatan |
| --- | --- | --- | --- |
| A + 800 | 800 | 0 | A pemilik milestone 800 |
| B + 800 | 800 | 800 | Seri → **tanpa reset** |
| B + 1 | **0** | 801 | B melewati 800; A pemilik milestone 800 → **A reset ke 0** |

Pada langkah terakhir, milestone 800 adalah "milik" A karena A yang pertama mencapainya.
Karena A overtaken, A kehilangan milestone itu dan kembali ke 0.

---

## Cara Menggunakan

1. Buka aplikasi (lihat [Hosting](#hosting--deploy) atau [Menjalankan Secara Lokal](#menjalankan-secara-lokal)).
2. (Opsional) Ketuk tab **Pengaturan** pada *bottom navigation* untuk mengubah nama
   keempat pemain. Nama tersimpan otomatis dan **tidak** hilang saat memulai
   permainan baru.
3. Tambahkan skor memakai tombol skor cepat (`-35`, `-40`, `+250`, `+300`) atau ketik
   nilai manual lalu tekan **Perbarui**/Enter. Untuk skor **negatif** cukup ketik
   angkanya lalu ketuk tombol **±** di dalam kolom (keypad numerik ponsel tidak
   menyediakan tombol minus). Minus Unicode dari ponsel/tempelan (`−25`, `–25`)
   otomatis dirapikan menjadi `-25`.
4. Ketika ada pemain overtaken, akan muncul **banner RESET** dan kartu pemain yang
   direset berkedip kuning.
5. Ketuk tab **Riwayat** pada *bottom navigation* (atau tombol **Semua** di panel
   *Riwayat Terbaru*) untuk membuka riwayat lengkap (tersedia tombol **Hapus**).
6. Setelah ada pemain mencapai 1000 poin, layar **Hasil Permainan** terbuka otomatis.
   Ketuk **Simpan Hasil** untuk menyimpan gambar PNG: di desktop berkas langsung
   terunduh (mis. folder *Downloads*), di ponsel *share sheet* terbuka dan Anda bisa
   memilih **Simpan Gambar / Save Image**.
7. Ketuk **Permainan Baru** (kini di layar **Pengaturan**) untuk mengosongkan skor,
   riwayat, dan urutan milestone. Nama pemain tetap dipertahankan.

---

## Struktur Proyek

```
remiku/
├── index.html            # Struktur halaman: app bar + layar (bottom nav) + modal (HTML semantik)
├── manifest.json         # Metadata PWA (nama, warna, ikon, mode standalone)
├── sw.js                 # Service worker: cache-first, dukungan offline
├── css/
│   └── style.css         # Seluruh gaya (token tema, komponen, media query)
├── js/
│   └── app.js            # Seluruh logika + render + aksi + ekspor Canvas
├── icons/
│   ├── icon.svg          # Ikon sumber (SVG, desain = logo header)
│   ├── icon-192.png      # Ikon PWA 192×192
│   └── icon-512.png      # Ikon PWA 512×512 (dipakai juga sebagai maskable)
├── tests/
│   ├── logic.test.js     # Uji otomatis logika permainan (Node.js)
│   └── dom.test.js       # Uji otomatis DOM + interaksi antarmuka (Node.js)
├── tools/
│   └── make-icons.py     # Generator ikon PNG (Python, tanpa dependency)
└── README.md
```

Semua path bersifat **relatif**, sehingga aplikasi tetap benar walau di-host pada
sub-folder (mis. `https://contoh.github.io/remiku/`).

### Pemisahan Logika dan DOM

Di dalam `js/app.js` terdapat penanda berikut:

```js
/* === LOGIC-START === */
/* === LOGIC-END === */
```

Blok di antara penanda itu **murni logika** — tidak menyentuh DOM maupun
`localStorage`. Semua fungsi inti berada di sana: `createDefaultState`,
`registerMilestones`, `detectOvertakenPlayers`, `milestoneOwner`,
`determineResets`, `checkWinner`, `computeRanking`, `applyScoreChange`,
dan `parseScoreInput`.

Karena murni, blok tersebut dapat diekstrak dan dijalankan langsung oleh Node.js
untuk pengujian otomatis (lihat [Pengujian Otomatis](#pengujian-otomatis)).

---

## Menjalankan Secara Lokal

Aplikasi berupa file statis, tetapi **jangan** membukanya lewat `file://` bila ingin
menguji PWA/service worker — service worker hanya diizinkan pada `http(s)`.
(`app.js` otomatis melewatkan registrasi service worker pada protokol `file:`.)

### Opsi 1 — Python (paling cepat, tanpa install apa pun)

```bash
cd remiku
python3 -m http.server 8080
```

Lalu buka <http://localhost:8080>.

### Opsi 2 — Node.js

```bash
npx serve .          # atau: npx http-server . -p 8080
```

### Opsi 3 — PHP

```bash
php -S localhost:8080
```

> **Tips:** untuk menguji tampilan mobile, gunakan mode perangkat pada DevTools
> peramban (mis. lebar 320 px) atau buka alamat IP lokal komputer dari ponsel
> di jaringan yang sama.

---

## Hosting / Deploy

Karena hanya berisi file statis, Remiku dapat di-host di layanan *static hosting*
apa pun. Tidak ada proses build — cukup unggah seluruh isi folder.

### GitHub Pages

1. Unggah proyek ke sebuah repositori GitHub (mis. `nama-user/remiku`).
2. Buka **Settings → Pages** pada repositori tersebut.
3. Pada **Build and deployment → Source**, pilih **Deploy from a branch**.
4. Pilih branch `main` dan folder `/ (root)`, lalu **Save**.
5. Tunggu 1–2 menit; aplikasi tersedia di
   `https://nama-user.github.io/remiku/`.

```bash
# Alternatif lewat terminal
git init
git add .
git commit -m "Remiku: papan skor remi 4 pemain"
git branch -M main
git remote add origin git@github.com:nama-user/remiku.git
git push -u origin main
```

### Netlify

- **Drag & drop:** buka <https://app.netlify.com/drop>, lalu seret folder `remiku`.
- **Git:** hubungkan repositori, gunakan *Build command* **kosong** dan
  *Publish directory* `.` (root).

### Vercel

```bash
npm i -g vercel
cd remiku
vercel --prod
```

Framework preset: **Other** · Build command: **kosong** · Output directory: `.`

### Cloudflare Pages

Hubungkan repositori, lalu gunakan *Build command* **kosong** dan
*Build output directory* `.`.

### Server biasa (Apache/Nginx/VPS)

Cukup salin folder `remiku` ke *document root* (mis. `/var/www/html/remiku`).
Tidak ada konfigurasi khusus yang diperlukan.

### Catatan Penting Saat Deploy

- **Wajib HTTPS** agar service worker aktif dan PWA dapat dipasang.
  (`localhost` dikecualikan dan tetap dianggap sebagai konteks aman.)
- **Setelah memperbarui berkas**, naikkan nilai `CACHE_NAME` di `sw.js`
  (mis. `remiku-v11` → `remiku-v12`) agar pengguna lama mendapat versi terbaru.
  Data pemain di `localStorage` **tidak** ikut terhapus.
- Tidak perlu mengatur header khusus, tetapi bila bisa, tambahkan
  `Cache-Control: no-cache` untuk `sw.js` dan `index.html` agar pembaruan
  cepat terdeteksi.

---

## PWA & Mode Offline

- `manifest.json` mendefinisikan nama, warna tema (`#FF4D9D`), warna latar
  (`#FFF1F7`), orientasi `portrait-primary`, serta entri ikon `icon.svg` (`any`)
  plus PNG 192 px dan 512 px (yang 512 juga dipakai sebagai `maskable` untuk
  Android).
- `sw.js` memakai strategi **cache-first** untuk *app shell*: `index.html`,
  `manifest.json`, `css/style.css`, `js/app.js`, serta ikon PWA PNG
  (`icons/icon-192.png`, `icons/icon-512.png`) dan ikon sumber `icons/icon.svg`.
- Saat offline dan halaman dibuka kembali, service worker menyajikan salinan
  dari cache sehingga aplikasi tetap berjalan penuh.
- Permintaan lintas-origin (CDN, analytics, dsb.) **tidak** di-cache dan
  dibiarkan lewat apa adanya.
- Service worker **tidak pernah** menyentuh `localStorage`, sehingga
  pembaruan aplikasi tidak akan menghapus data pemain.

**Memperbarui versi aplikasi:** naikkan `CACHE_NAME` di `sw.js`
(`remiku-v11` → `remiku-v12`) dan `APP_VERSION` di `js/app.js` (`v1.3` → `v1.4`)
lalu deploy. Service worker lama akan dihapus otomatis pada fase `activate`,
dan header akan menampilkan versi terbaru.

**Memasang ke home screen:**

- **Android/Chrome:** menu ⋮ → *Install app* / *Tambahkan ke layar utama*.
- **iOS/Safari:** tombol *Share* → *Add to Home Screen*.

---

## Penyimpanan Data & Privasi

- Seluruh data disimpan **hanya di perangkat pengguna** melalui
  `localStorage` dengan kunci `remiku_data_v1`.
- Struktur data:

  ```js
  {
    version: 1,                 // versi skema data
    names:   ["Pemain 1", ...], // 4 nama pemain
    scores:  [0, 0, 0, 0],      // skor terkini
    reach:   { "500": [0, 2] }, // urutan pemain yang mencapai tiap milestone
    history: [ /* Event[] */ ], // riwayat perubahan skor (maks. 500 entri)
    gameActive: true,           // false setelah ada pemenang
    winner:  null               // { player, score, at } bila sudah selesai
  }
  ```

- Aplikasi **tidak** mengirim data ke mana pun. Tidak ada analytics,
  tidak ada cookie, tidak ada akun, tidak ada iklan.
- Data yang rusak/ tidak valid akan dibersihkan otomatis saat dibaca
  (`sanitizeState`), sehingga aplikasi tidak pernah gagal terbuka.
- Bila `localStorage` diblokir (mis. mode privat), aplikasi tetap berjalan —
  hanya tanpa penyimpanan permanen.
- **Menghapus data:** buka layar *Riwayat* (bottom nav) → **Hapus** (hanya riwayat),
  atau **Permainan Baru** (skor + riwayat + urutan milestone).
  Untuk menghapus semuanya termasuk nama, bersihkan data situs dari pengaturan
  peramban.

---

## Pengujian Otomatis

Uji otomatis dapat dijalankan dengan **Node.js** tanpa perlu memasang apa pun
(tanpa `npm install`, tanpa framework uji). Ada dua berkas uji:

```bash
node tests/logic.test.js   # logika permainan murni (tanpa DOM)
node tests/dom.test.js     # DOM + interaksi antarmuka (klik, ketik, modal)
```

Keluaran yang diharapkan:

```
TEST 1 — State awal
  ✓ terdiri dari 4 pemain dengan skor 0
  ...
----------------------------------------------------------------
SEMUA LULUS — 61 pengujian berhasil.
```

```
DOM 1 — Bootstrap: render 4 kartu pemain
  ✓ empat kartu pemain dirender dari index.html + app.js
  ...
----------------------------------------------------------------
SEMUA LULUS — 65 pengujian DOM berhasil.
```

*Exit code* `0` bila semua lulus, `1` bila ada yang gagal (cocok untuk CI).

### Alat diagnosa — `tests/diagnose-handal.js`

Bukan uji otomatis, melainkan **alat bantu** untuk menjawab *"kenapa badge
Pengocok Handal belum muncul?"*. Ia memakai **logika asli** aplikasi (blok
LOGIC-START/LOGIC-END yang sama) untuk membedah riwayat **ronde-per-ronde**:
skor ronde & total berjalan tiap pemain, siapa yang **total-nya terendah**
(ditandai `*`), ronde yang **memutus rentetan** (ditandai `!`), "Ngocok" per
pemain, rentetan terpanjang, dan keputusan akhir.

```bash
node tests/diagnose-handal.js data.json   # data.json = isi localStorage 'remiku_data_v1'
node tests/diagnose-handal.js -           # baca JSON dari stdin
```

Ambil data di peramban: buka aplikasi → DevTools → Console → jalankan
`copy(localStorage.getItem('remiku_data_v1'))`, lalu simpan hasilnya sebagai
`data.json`. Input boleh berupa objek state (`{"names":[...],"history":[...]}`)
atau array riwayat saja.

Bedanya dengan angka biasa: **"Ngocok"** menghitung *semua* ronde (boleh tak
berurutan) di mana pemain berada di posisi **TOTAL skor terendah**, sedangkan
**Pengocok Handal** butuh **4 ronde BERTURUT-TURUT** dengan **total** skor
berjalan yang paling rendah. Keduanya memakai **TOTAL skor berjalan** (bukan
skor rondenya): pemilik total terendah tetap dihitung Ngocok walau ia **tidak
mencatat skor** di ronde itu. Ronde **satu pencatat tetap dihitung** (satu kali
**[Perbarui]** = satu ronde). Jadi "Ngocok 4×" belum tentu menjadi Handal bila
ronde-ronde itu tak berurutan, terselip ronde yang memutus rentetan (**semua
total seri**), atau pemain lain sempat lebih rendah totalnya (mis. karena
di-reset ke 0).

### Uji logika — `tests/logic.test.js`

#### Bagaimana uji ini bekerja

`tests/logic.test.js` membaca `js/app.js`, mengambil cuplikan di antara penanda
`LOGIC-START` dan `LOGIC-END`, lalu mengevaluasinya sebagai fungsi IIFE di realm
Node yang sama (`vm.runInThisContext`). Karena itu, uji selalu menguji **kode asli
yang benar-benar dipakai aplikasi** — bukan salinan yang bisa menyimpang.

#### Cakupan Uji Logika

| Grup | Yang diuji |
| --- | --- |
| TEST 1 | State awal (4 pemain, skor 0, nama default, konstanta). |
| TEST 2 | Kenaikan/penurunan skor dan pencatatan riwayat. |
| TEST 3 | Validasi input: `50`, `+50`, `-50`, spasi, huruf, desimal, `0`, batas maksimum, serta normalisasi varian Unicode (`−50` U+2212, `–50` U+2013, `－５０` fullwidth, spasi/NBSP/zero-width). |
| TEST 4 | Penolakan `bad-amount` dan `bad-player` tanpa mengubah state. |
| TEST 5 | Pencatatan milestone 500–999 dan urutan pencapaian. |
| TEST 6 | Seri **bukan** overtake. |
| TEST 7 | Reset pemilik milestone yang overtaken + jejak di riwayat. |
| TEST 8 | Pemain yang datang belakangan tidak direset. |
| TEST 9 | Batas rentang milestone (499 vs 500). |
| TEST 10 | Kemenangan pada 1000 poin dan penguncian input. |
| TEST 11 | Ranking dan tie-breaker deterministik. |
| TEST 12 | Riwayat berurutan dan batas `HISTORY_LIMIT`. |
| TEST 13 | Dekoder base64 internal (`base64ToBytes`): padding, newline, penolakan input tidak valid, dan hasil samakan dengan `Buffer` bawaan Node (termasuk header PNG). |
| TEST 14 | Statistik pemain & badge **Pengocok Handal**: hitungan **Ngocok** (jumlah ronde di mana pemain berada di posisi **TOTAL skor terendah** — dihitung dari **total skor berjalan**, **bukan** skor rondenya, dan berlaku untuk **semua pemain termasuk yang tidak mencatat skor** di ronde itu; semua ronde berskor dihitung, **termasuk ronde satu pencatat** — satu kali **[Perbarui]** = satu ronde; seri +1) dan **Skor Shutout** (250/300); badge Handal = **SATU** pemain yang **paling lama berada di total skor terendah ≥ 4 ronde** (rentetan terpanjang menang; seri panjang → index terkecil; **seri di posisi terendah TETAP dihitung**, sedangkan ronde "semua pemain seri" **memutus** rentetan sekaligus tidak menambah Ngocok kepada siapa pun). `computePlayerStats` juga mengembalikan **`candidate`/`candidateStreak`** — rentetan terpanjang walau **belum** menembus ambang (untuk **pemimpin sementara** di layar Statistik). |
| QUICK SCORE §34 | Preset `-35 → -40 → +250 → +300` pada skor 0 menghasilkan `-35 → -75 → 175 → 475`, lengkap dengan riwayat & penyimpanan. |

### Uji DOM — `tests/dom.test.js`

Uji ini memverifikasi **aplikasi yang benar-benar dirender**, bukan salinan:
`index.html` di-parse ulang, lalu `js/app.js` dievaluasi apa adanya di dalam
`new Function` dengan `document`, `window`, `navigator`, dan `location` buatan.

#### Bagaimana uji ini bekerja

- **DOM mini tanpa dependency.** Berkas uji memuat parser HTML kecil (tag, atribut,
  teks, komentar, elemen void), `classList`, `dataset`, `querySelector(All)`
  terbatas, serta penyebaran event `click`/`keydown` yang naik dari target menuju
  `document`. Ini diperlukan karena `app.js` menaruh listener global di
  `document`, bukan di masing-masing tombol.
- **Jam virtual.** `setTimeout` disuntikkan sebagai fungsi yang waktunya hanya
  berjalan saat `tick(ms)` dipanggil. Uji karena itu tetap instan walau menguji
  timer 250 ms (membuka modal hasil) dan 12 detik (menyembunyikan banner RESET).
- **`localStorage` dalam memori.** `boot({ seed: ... })` dapat memuat ulang
  aplikasi dari state tersimpan untuk menyimulasikan *refresh* halaman.

#### Cakupan Uji DOM

| Grup | Yang diuji |
| --- | --- |
| DOM 1 | Bootstrap: 4 kartu pemain, tombol skor cepat `-35/-40/+250/+300`, input, progress bar, tahun footer. |
| DOM 2 | Klik tombol skor cepat: skor, progress bar, kelas `is-negative`, riwayat, penyimpanan, urutan preset (QUICK SCORE §34), serta milestone/reset lewat tombol cepat. |
| DOM 3 | Input manual: tombol Perbarui, tombol Enter, penolakan input tidak valid, tombol **±** (termasuk keadaan kosong & penguncian setelah menang), serta penerimaan minus Unicode/en dash/angka fullwidth. |
| DOM 4 | Banner RESET beserta penjelasannya, kartu direset, seri tidak me-reset, auto-hilang 12 detik. |
| DOM 5 | Modal hasil otomatis: **kartu Pemenang** + **kartu Pengocok Handal** (penyandang + `N×`, atau bergaya netral `Belum ada` bila belum ada rentetan ≥ 4 ronde) dan **ranking `#n`**; dibuka dengan **logo kartu + wordmark `Remiku`** (`Remi` + `ku`) dan baris **`versi · zkvoid`** (dari `APP_VERSION`); skor negatif di ranking ditandai `is-negative`, penguncian **semua** input & tombol, penolakan skor setelah menang. |
| DOM 6 | Persistensi: skor, riwayat, layar hasil, dan kunci input bertahan setelah refresh; data rusak tidak mematikan aplikasi. |
| DOM 7 | Permainan baru (tombol kini di layar Pengaturan): dialog konfirmasi, batal, nama dipertahankan, kunci input dibuka lagi. |
| DOM 8 | Nama pemain: pembaruan langsung tanpa mengubah skor, fallback nama kosong, Escape. |
| DOM 9 | Modal: riwayat lengkap, Escape hanya menutup modal teratas, klik backdrop, kelas `modal-open`. |
| DOM 10 | Hapus riwayat tidak menghapus skor. |
| DOM 11 | Jalur bootstrap cadangan (`readyState` `loading` vs `complete`). |
| DOM 12 | Simpan Hasil: PNG dibuat **sinkron** lewat `toDataURL` (bukan `toBlob`) dan unduhan `.png` terpicu di dalam satu klik; `navigator.share` di perangkat sentuh dipanggil **masih di dalam gestur klik**, gagal share jatuh ke unduhan (tanpa klaim palsu), batal share mengunduh tidak memaksa, desktop dengan *pointer* halus selalu mengunduh; tanpa pemenang tidak ada unduhan. |
| DOM 13 | Gambar hasil (PNG) juga memuat **logo + wordmark `Remiku`** dan baris **`versi · zkvoid`**, serta statistik lengkap: judul **STATISTIK LENGKAP**, callout **Pengocok Handal**, dan label **NGOCOK / SHUTOUT** per pemain (kolom **TERENDAH** dipastikan **tidak** digambar lagi) — berasal dari data statistik yang sama dengan kartu Hasil & layar Statistik. |
| DOM 14 | Layar Statistik: callout **Pengocok Handal** tampil dengan penyandangnya (badge pink + `N×`) saat sudah ada rentetan ≥ 4 ronde, dan menampilkan **pemimpin sementara** (**Kandidat Pengocok Handal** + "belum memenuhi syarat") saat belum ada. |

### Menjalankan di CI (contoh GitHub Actions)

```yaml
name: tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: node tests/logic.test.js
      - run: node tests/dom.test.js
```

---

## Ikon Aplikasi

Ikon aplikasi berbagi **satu sumber desain**: logo kartu Remi yang juga dipakai
di header dan layar hasil — dua kartu bertumpuk (kartu belakang pink, kartu depan
putih ber-border hitam tebal) dengan simbol hati pink.

- `icons/icon.svg` — ikon sumber (SVG), dipakai sebagai **favicon**
  (`<link rel="icon" type="image/svg+xml">`) dan entri ikon `any` di
  `manifest.json`.
- `icons/icon-192.png` / `icons/icon-512.png` — PNG asli untuk PWA (512 px
  dipakai juga sebagai ikon **maskable** di Android).

PNG-nya dihasilkan oleh skrip kecil tanpa dependency yang menggambar ulang
bentuk `icon.svg`:

```bash
python3 tools/make-icons.py
```

Skrip tersebut menulis PNG sendiri memakai modul standar `zlib` + `struct`
(tanpa Pillow), dengan *supersampling* 4×4 per piksel untuk tepi yang halus.
Desainnya dijaga berada di dalam *safe zone* ±80% dari pusat, sehingga aman
dipakai juga sebagai ikon **maskable** di Android.

Bila ingin mengganti ikon: ubah `icons/icon.svg` lalu jalankan ulang
`python3 tools/make-icons.py` (atau ganti berkas PNG-nya langsung — ukuran harus
tetap 192×192 dan 512×512, lalu sesuaikan `manifest.json` bila nama berkas
berubah).

---

## Aksesibilitas

- **Skip link** ("Lewati ke konten utama") untuk pengguna keyboard.
- Semua kontrol berupa `<button>`/`<input>` asli dengan `aria-label` berbahasa
  Indonesia, dan area sentuh minimal **44×44 px**.
- Modal memakai `role="dialog"`, `aria-modal="true"`, serta pengelolaan fokus
  (fokus dipindahkan saat terbuka dan dikembalikan saat tertutup).
- Tombol **Escape** menutup modal paling atas; modal dapat ditumpuk (stack)
  dengan benar, misalnya modal konfirmasi di atas modal riwayat.
- Perubahan penting diumumkan lewat `aria-live` (banner RESET, toast, riwayat).
- Mendukung `prefers-reduced-motion: reduce` — animasi dimatikan.
- Ada gaya khusus `@media print` dan tata letak aman untuk layar sempit 320 px.
- Input skor dan tombol **Perbarui** selalu lebar penuh dan bertumpuk, sehingga
  area ketik maupun target sentuh tetap besar di semua ukuran layar.

---

## Kompatibilitas Peramban

Diuji pada peramban modern (Chrome, Edge, Firefox, Safari — desktop dan mobile),
serta iOS 15+ dan Android 10+. Fitur berikut memiliki *fallback* otomatis:

| Fitur | Fallback |
| --- | --- |
| `canvas.toBlob()` | tidak dipakai lagi: PNG dibuat **sinkron** lewat `canvas.toDataURL()` agar izin gestur pengguna tetap aktif |
| `canvas.roundRect()` | digambar manual dengan `arcTo()` |
| `navigator.share()` | otomatis beralih ke unduhan file |
| `navigator.canShare()` | langsung memakai unduhan |
| `window.matchMedia()` / `File` / `Blob` | langsung memakai unduhan (data URL) |
| `atob()` saat membentuk berkas PNG | dekoder base64 internal (`base64ToBytes`), tanpa dependensi |
| Service Worker | dilewati bila tidak didukung atau pada protokol `file:` |
| `localStorage` | aplikasi tetap jalan, hanya tanpa penyimpanan |

JavaScript ditulis dalam sintaks ES5+ yang aman (tanpa modul, tanpa `import`),
sehingga dapat dimuat langsung sebagai `<script defer>`.

---

## Pemecahan Masalah

| Gejala | Penyebab & solusi |
| --- | --- |
| Perubahan kode tidak terlihat | Service worker masih menyajikan cache lama. Naikkan `CACHE_NAME` di `sw.js`, lalu *hard reload*. |
| PWA tidak bisa dipasang | Halaman harus diakses lewat `https://` atau `http://localhost`. |
| Skor tidak tersimpan | `localStorage` diblokir (mode privat / pengaturan situs). |
| Tombol **Simpan Hasil** tidak bereaksi | Gambar dibuat **sinkron** di dalam ketukan; bila masih gagal, pastikan ekstensi privasi tidak mematikan Canvas API. Pesan di layar tidak lagi menyesatkan: kegagalan selalu memunculkan toast error. |
| Tombol **Simpan Hasil** tidak mengunduh di ponsel | Di iOS/Android gambar dibagikan lewat *share sheet*; pilih **Save Image** / **Simpan ke Galeri**. |
| Skor negatif tidak bisa diketik di ponsel | Keypad numerik tidak punya tombol minus: ketuk tombol **±** di dalam kolom skor, atau tempel `-25` (varian minus Unicode otomatis dinormalkan). |
| `node: command not found` | Pasang Node.js 18+ hanya bila ingin menjalankan uji otomatis; aplikasi sendiri tidak memerlukannya. |

---

## Lisensi & Kredit

- **Remiku** — papan skor permainan kartu Remi untuk 4 pemain.
- **Powered by zkvoid.**
- Seluruh kode bebas dependency: HTML, CSS, dan JavaScript murni.

```
© 2026 Remiku · Powered by zkvoid
```



