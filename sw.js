/* ============================================================================
 * Remiku — Service Worker
 * ----------------------------------------------------------------------------
 * Tujuan:
 *  - Membuat aplikasi dapat dipakai OFFLINE setelah kunjungan pertama.
 *  - Strategi: CACHE-FIRST untuk aset statis milik aplikasi sendiri.
 *  - Tidak pernah menyentuh localStorage (data pemain aman saat SW update).
 *
 * Catatan penting:
 *  - Semua path memakai RELATIVE path ("./..."), sehingga aplikasi tetap benar
 *    walau di-host pada sub-folder (mis. GitHub Pages /remiku/).
 *  - Tidak ada request ke CDN. Hanya same-origin yang ditangani.
 *
 * Cara merilis versi baru:
 *  - Naikkan CACHE_NAME (mis. "remiku-v3" -> "remiku-v4").
 *  - SW lama akan dihapus pada fase "activate", localStorage TIDAK tersentuh.
 * ==========================================================================*/

'use strict';

const CACHE_NAME = 'remiku-v12';

/* Aset inti (app shell). Semua relatif terhadap scope service worker. */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/* ------------------------------- INSTALL --------------------------------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        // Cache satu per satu agar satu kegagalan tidak membatalkan seluruh instalasi.
        // `cache: 'reload'` memaksa ambil versi segar, bukan dari HTTP cache.
        return Promise.all(
          APP_SHELL.map((url) =>
            cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
          )
        );
      })
      .then(() => self.skipWaiting()) // aktifkan SW baru secepatnya
  );
});

/* ------------------------------- ACTIVATE -------------------------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => (key === CACHE_NAME ? Promise.resolve() : caches.delete(key)))
        )
      )
      .then(() => self.clients.claim()) // kendalikan halaman yang sudah terbuka
  );
});

/* -------------------------------- FETCH ---------------------------------- */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Hanya menangani GET.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }

  // Abaikan request cross-origin (mis. analytics/CDN yang mungkin ditambahkan user).
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      // 1) CACHE-FIRST: gunakan cache bila ada.
      if (cached) return cached;

      // 2) Belum ada di cache: ambil dari jaringan.
      return fetch(request)
        .then((response) => {
          // Simpan hanya response same-origin yang valid (tidak opaque/redirect error).
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, copy))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => {
          // 3) Offline & tidak ada di cache.
          if (request.mode === 'navigate') {
            // Navigasi: kembalikan halaman aplikasi.
            return caches
              .match('./index.html')
              .then((page) => page || caches.match('./'))
              .then((page) => page || offlineResponse());
          }
          return offlineResponse();
        });
    })
  );
});

function offlineResponse() {
  return new Response('Offline — Remiku belum tersimpan di cache.', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

/* --------------------------- (Opsional) MESSAGE -------------------------- */
// Memungkinkan halaman meminta SW baru segera mengambil alih.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
