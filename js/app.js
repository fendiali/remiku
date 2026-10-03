/* ============================================================================
 * Remiku — app.js
 * Papan skor permainan kartu Remi (4 pemain).
 *
 * Prinsip:
 *  - Vanilla JavaScript, tanpa dependency eksternal.
 *  - Logika permainan dipisah dari DOM (lihat blok LOGIC-START / LOGIC-END)
 *    sehingga bisa diuji otomatis (tests/logic.test.js).
 *  - Semua data penting dipersistensi ke localStorage setelah setiap perubahan.
 * ==========================================================================*/

'use strict';

/* === LOGIC-START === */
/* Blok ini MURNI logika (tanpa DOM / localStorage) agar dapat diuji terpisah. */

/* ------------------------------- KONSTANTA ------------------------------- */
const TARGET_SCORE = 1000;    // Skor yang dibutuhkan untuk menang.
const MILESTONE_START = 500;  // Awal rentang milestone khusus (500-999).
const MILESTONE_END = 999;    // Akhir rentang milestone khusus.
const PLAYER_COUNT = 4;       // Jumlah pemain tetap.
const STORAGE_KEY = 'remiku_data_v1';
const DATA_VERSION = 1;
const HISTORY_LIMIT = 500;    // Batas entri riwayat (agar localStorage tetap ringan).
const NAME_MAX = 24;          // Panjang maksimum nama pemain.
const MAX_ABS_INPUT = 100000; // Batas wajar nilai input (mencegah input absurd).
const DEFAULT_NAMES = ['Pemain 1', 'Pemain 2', 'Pemain 3', 'Pemain 4'];

/**
 * Preset tombol skor cepat (urutan array = urutan tampil):
 *   [-35] [-40] [+250] [+300]
 * PENTING: keempat tombol hanya memanggil addScore() yang SAMA seperti input
 * manual, sehingga milestone/overtake/reset/winner/history tetap berjalan
 * tanpa logika scoring terpisah.
 */
const QUICK_PRESETS = [-35, -40, 250, 300];

/**
 * State default sekaligus dokumentasi struktur data yang disimpan.
 * {
 *   version: number,
 *   names:   string[4],                       // nama pemain (dipertahankan antar permainan)
 *   scores:  number[4],                       // skor terkini
 *   reach:   { "<milestone>": [index, ...] },  // URUTAN pemain yang pertama mencapai skor m
 *   history: Event[],                          // riwayat perubahan skor
 *   gameActive: boolean,                       // false bila permainan sudah selesai
 *   winner:  null | { player, score, at }
 * }
 *
 * MENGAPA `reach` perlu disimpan (bukan cukup skor saja)?
 * Karena aturan reset bergantung pada SIAPA YANG LEBIH DULU mencapai sebuah
 * milestone (500-999), bukan pada skor saat ini. Urutan sejarah ini adalah
 * "sumber kebenaran" dan HARUS tetap ada walaupun skor pemain turun.
 */
function createDefaultState() {
  return {
    version: DATA_VERSION,
    names: DEFAULT_NAMES.slice(),
    scores: new Array(PLAYER_COUNT).fill(0),
    reach: {},
    history: [],
    gameActive: true,
    winner: null
  };
}

/* --------------------------- MILESTONE TRACKING ---------------------------
 * `reach[m]` = array index pemain sesuai URUTAN kapan mereka pertama kali
 * mencapai skor >= m. Inilah yang dipakai untuk mengetahui siapa "datang
 * lebih dulu" pada sebuah milestone.
 *
 * Catatan: nilai `reach` TIDAK dihapus saat skor turun (aturan #8), supaya
 * sejarah pencapaian tetap utuh dan tidak bisa dipakai ulang untuk curang.
 */
function registerMilestones(state, playerIndex, oldScore, newScore) {
  // Hanya kenaikan skor yang dapat menambah pencapaian baru.
  if (newScore <= oldScore) return;

  // Milestone yang baru dicapai: > oldScore dan <= newScore.
  const from = Math.max(oldScore + 1, MILESTONE_START);
  const to = Math.min(newScore, MILESTONE_END);

  for (let m = from; m <= to; m++) {
    const key = String(m);
    const list = state.reach[key] || (state.reach[key] = []);
    if (list.indexOf(playerIndex) === -1) list.push(playerIndex);
  }
}

/* --------------------------- OVERTAKE DETECTION ---------------------------
 * "Menyalip" = SEBELUMNYA skor pemain <= skor lawan, dan SEKARANG menjadi >.
 * Dengan definisi ini, berakhir seri (tie) BUKAN penyalipan sehingga tidak
 * akan memicu reset.
 */
function detectOvertakenPlayers(state, playerIndex, oldScore, newScore) {
  const result = [];
  for (let q = 0; q < PLAYER_COUNT; q++) {
    if (q === playerIndex) continue;
    const qScore = state.scores[q];
    if (oldScore <= qScore && newScore > qScore) result.push(q);
  }
  return result;
}

/** Pemain yang PALING DULU mencapai milestone `m` (null bila belum ada). */
function milestoneOwner(state, milestone) {
  const list = state.reach[String(milestone)];
  return list && list.length ? list[0] : null;
}

/**
 * Menentukan pemain yang harus RESET (ke 0) akibat satu aksi penambahan skor.
 *
 * ATURAN INTI (jangan disederhanakan menjadi "skor lebih kecil = reset"):
 *  - Reset hanya berlaku untuk pemain yang DISALIP pada aksi ini.
 *  - Pemain Q yang disalip hanya direset bila Q adalah pemain yang PALING DULU
 *    mencapai milestone sebesar skor Q saat ini. Milestone itulah yang sedang
 *    diperebutkan; Q yang datang lebih dulu "kehilangan" miliknya karena disalip.
 *  - Pemain yang datang BELAKANGAN pada milestone tersebut TIDAK direset.
 *  - Tie bukan penyalipan (lihat detectOvertakenPlayers), jadi tidak memicu reset.
 *  - Skor di luar rentang milestone (mis. < 500) tidak memicu reset.
 *
 * Contoh nyata:
 *   A = 800 (pencapai 800 pertama), B = 700. B +100 -> 800 (tie, tidak reset).
 *   B +1 -> 801. B menyalip A. Skor A = 800 dan A adalah pencapai 800 pertama,
 *   maka A reset ke 0.
 */
function determineResets(state, overtaken) {
  const resets = [];
  for (let i = 0; i < overtaken.length; i++) {
    const q = overtaken[i];
    if (resets.indexOf(q) !== -1) continue; // jaminan: maksimal SEKALI per pemain per aksi
    const milestone = state.scores[q]; // skor Q saat disalip = milestone yang diperebutkan
    if (milestone < MILESTONE_START || milestone > MILESTONE_END) continue;
    if (milestoneOwner(state, milestone) === q) resets.push(q);
  }
  return resets;
}

/**
 * Deteksi pemenang.
 * Pada aplikasi ini HANYA SATU pemain yang berubah skornya per aksi, sehingga
 * pemenang adalah pemain dengan skor tertinggi bila skor itu >= TARGET_SCORE.
 * Tie-breaker (mis. saat memulihkan data rusak): index terkecil — dipilih agar
 * perilaku tetap deterministik.
 */
function checkWinner(state) {
  if (state.winner) return state.winner;

  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < PLAYER_COUNT; i++) {
    if (state.scores[i] > bestScore) {
      bestScore = state.scores[i];
      best = i;
    }
  }

  if (bestScore >= TARGET_SCORE) {
    state.winner = { player: best, score: bestScore, at: Date.now() };
    state.gameActive = false;
    return state.winner;
  }
  return null;
}

/**
 * Ranking skor tertinggi -> terendah.
 * Tie-breaker: index pemain menaik (Pemain 1 sebelum Pemain 2, dst).
 * Dipilih karena deterministik dan stabil antar-render.
 */
function computeRanking(state) {
  return state.scores
    .map(function (score, index) {
      return { index: index, score: score, name: state.names[index] };
    })
    .sort(function (a, b) {
      return (b.score - a.score) || (a.index - b.index);
    });
}

/**
 * Menerapkan perubahan skor secara atomik (tanpa DOM) agar mudah diuji.
 * Urutan pemrosesan:
 *   1. Deteksi penyalipan (dinilai dari skor SEBELUM diubah).
 *   2. Ubah skor pemain.
 *   3. Catat milestone baru yang dicapai (selalu, walau nanti ada reset).
 *   4. Tentukan & terapkan reset berdasarkan urutan pencapaian milestone.
 *   5. Simpan event ke riwayat.
 *   6. Cek pemenang.
 * Mengembalikan objek hasil agar pemanggil bisa memberi umpan balik visual.
 */
function applyScoreChange(state, playerIndex, amount) {
  const result = { ok: false, reason: null, event: null, resets: [], winner: null };

  if (!state.gameActive) {
    result.reason = 'game-over';
    return result;
  }
  if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= PLAYER_COUNT) {
    result.reason = 'bad-player';
    return result;
  }
  // Hanya bilangan bulat & bukan 0 yang dianggap perubahan bermakna.
  if (!Number.isInteger(amount) || amount === 0) {
    result.reason = 'bad-amount';
    return result;
  }

  const oldScore = state.scores[playerIndex];
  const newScore = oldScore + amount;

  // (1) Penyalipan dinilai dari kondisi SEBELUM skor berubah.
  const overtaken = detectOvertakenPlayers(state, playerIndex, oldScore, newScore);

  // (2) Terapkan skor baru.
  state.scores[playerIndex] = newScore;

  // (3) Catat milestone baru.
  registerMilestones(state, playerIndex, oldScore, newScore);

  // (4) Reset (satu kali per pemain per event -> tidak ada reset berulang).
  const resetPlayers = determineResets(state, overtaken);
  const resetInfo = [];
  for (let i = 0; i < resetPlayers.length; i++) {
    const q = resetPlayers[i];
    const from = state.scores[q];
    state.scores[q] = 0;
    resetInfo.push({ player: q, by: playerIndex, from: from, to: 0, milestone: from });
  }

  // (5) Riwayat.
  const event = {
    ts: Date.now(),
    player: playerIndex,
    delta: amount,
    from: oldScore,
    to: newScore,
    resets: resetInfo
  };
  state.history.push(event);
  if (state.history.length > HISTORY_LIMIT) {
    state.history.splice(0, state.history.length - HISTORY_LIMIT);
  }

  // (6) Pemenang.
  const winner = checkWinner(state);

  result.ok = true;
  result.event = event;
  result.resets = resetInfo;
  result.winner = winner;
  return result;
}

/** Alfabet base64 standar (dipakai dekoder manual di bawah). */
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Menormalkan teks angka dari keyboard/tempat tempel apa pun menjadi ASCII,
 * mis. "\u221225" (minus Unicode) -> "-25".
 *
 * MENGAPA perlu? Keyboard ponsel, autokoreksi, dan hasil salin-tempel sering
 * mengirim karakter yang BUKAN tanda minus ASCII:
 *   U+2212 "−" (minus matematis), U+2013 "–" (en dash), U+2014 "—" (em dash),
 *   U+2010/U+2011/U+2012/U+2015/U+2043/U+FE63/U+FF0D "－" (fullwidth),
 *   plus varian plus U+FF0B "＋", U+FE62, U+2795.
 * Ditambah angka fullwidth ("２５") serta spasi/NBSP/zero-width yang ikut
 * tersalin. Tanpa normalisasi, semua itu ditolak padahal di layar terlihat
 * persis seperti "-25".
 */
function normalizeNumberText(value) {
  if (typeof value !== 'string') return '';

  return value
    // Karakter tak terlihat (zero-width space/joiner, word joiner).
    .replace(/[\u200b-\u200d\u2060]/g, '')
    // Semua spasi dibuang (regex \s mencakup NBSP U+00A0, narrow NBSP U+202F,
    // dan BOM U+FEFF) supaya "- 25" tetap dibaca "-25".
    .replace(/\s+/g, '')
    // Varian tanda minus/penghubung -> "-" ASCII.
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2043\u2212\ufe63\uff0d]/g, '-')
    // Varian tanda plus -> "+" ASCII.
    .replace(/[\u2795\ufe62\uff0b]/g, '+')
    // Angka fullwidth "２５" -> "25" (blok U+FF10-U+FF19 digeser ke U+0030-U+0039).
    .replace(/[\uff10-\uff19]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    });
}

/**
 * Mendekode teks base64 menjadi Uint8Array, atau null bila tidak valid.
 *
 * MENGAPA ditulis manual (bukan `atob`)? Agar hasilnya identik di browser
 * maupun di Node.js sehingga bisa diuji otomatis tanpa DOM, sekaligus tidak
 * bergantung pada ketersediaan `atob` di peramban lama.
 */
function base64ToBytes(base64) {
  if (typeof base64 !== 'string') return null;

  const clean = base64.replace(/\s+/g, '');
  const data = clean.replace(/=+$/, '');
  if (data === '') return clean === '' ? new Uint8Array(0) : null;
  if (!/^[A-Za-z0-9+/]+$/.test(data)) return null;
  if (data.length % 4 === 1) return null; // panjang mustahil untuk base64

  const bytes = new Uint8Array(Math.floor((data.length * 6) / 8));
  let out = 0;
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < data.length; i++) {
    buffer = (buffer << 6) | BASE64_ALPHABET.indexOf(data.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out++] = (buffer >> bits) & 0xff;
    }
  }

  return bytes;
}

/**
 * Mengubah teks input menjadi bilangan bulat, atau null bila tidak valid.
 * Ditolak: kosong, desimal, huruf, dan 0 (tidak mengubah apa pun).
 * Diterima: 50, +50, -50, serta varian yang dinormalkan normalizeNumberText
 * (mis. "−50" minus Unicode, "２５" angka fullwidth, "- 50" berspasi).
 */
function parseScoreInput(value) {
  if (typeof value !== 'string') return null;

  const v = normalizeNumberText(value);
  if (v === '') return null;                       // input kosong
  if (!/^[+-]?\d+$/.test(v)) return null;          // hanya bilangan bulat (tanpa titik/koma/huruf)

  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n === 0) return null;                        // 0 bukan perubahan bermakna
  if (Math.abs(n) > MAX_ABS_INPUT) return null;    // batas wajar

  return n;
}

/* === LOGIC-END === */

/* ============================================================================
 * STATE & PERSISTENCE (localStorage)
 * ==========================================================================*/

// State global aplikasi (selalu berupa objek valid).
let state = createDefaultState();

/**
 * Menyaring satu entri riwayat agar aman dirender.
 * Entri tidak valid dikembalikan sebagai null dan akan dibuang.
 */
function sanitizeHistoryEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const player = Math.trunc(Number(raw.player));
  const from = Math.trunc(Number(raw.from));
  const to = Math.trunc(Number(raw.to));
  const delta = Math.trunc(Number(raw.delta));
  const ts = Number(raw.ts);

  if (!Number.isInteger(player) || player < 0 || player >= PLAYER_COUNT) return null;
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(delta)) return null;

  const entry = {
    ts: Number.isFinite(ts) ? ts : Date.now(),
    player: player,
    delta: delta,
    from: from,
    to: to,
    resets: []
  };

  if (Array.isArray(raw.resets)) {
    for (let i = 0; i < raw.resets.length; i++) {
      const r = raw.resets[i];
      if (!r || typeof r !== 'object') continue;
      const rp = Math.trunc(Number(r.player));
      const by = Math.trunc(Number(r.by));
      if (!Number.isInteger(rp) || rp < 0 || rp >= PLAYER_COUNT) continue;
      entry.resets.push({
        player: rp,
        by: Number.isInteger(by) && by >= 0 && by < PLAYER_COUNT ? by : player,
        from: Math.trunc(Number(r.from)) || 0,
        to: 0,
        milestone: Math.trunc(Number(r.milestone)) || Math.trunc(Number(r.from)) || 0
      });
    }
  }

  return entry;
}

/**
 * Memvalidasi & membersihkan data mentah dari localStorage.
 *
 * MENGAPA: data bisa rusak / berasal dari versi lama / dimodifikasi manual.
 * Aplikasi TIDAK boleh crash; setiap bagian yang tidak dikenali diganti dengan
 * nilai default secara aman (fail-safe, tanpa loop).
 */
function sanitizeState(raw) {
  const out = createDefaultState();
  if (!raw || typeof raw !== 'object') return out;

  // Nama: string tidak kosong, panjang dibatasi.
  if (Array.isArray(raw.names)) {
    for (let i = 0; i < PLAYER_COUNT; i++) {
      const v = raw.names[i];
      if (typeof v === 'string') {
        const trimmed = v.trim().slice(0, NAME_MAX);
        if (trimmed !== '') out.names[i] = trimmed;
      }
    }
  }

  // Skor: paksa menjadi bilangan bulat.
  if (Array.isArray(raw.scores)) {
    for (let i = 0; i < PLAYER_COUNT; i++) {
      const n = Math.trunc(Number(raw.scores[i]));
      out.scores[i] = Number.isFinite(n) ? n : 0;
    }
  }

  // Reach: hanya milestone valid (500-999) dengan index pemain unik.
  if (raw.reach && typeof raw.reach === 'object') {
    const keys = Object.keys(raw.reach);
    for (let k = 0; k < keys.length; k++) {
      const m = Number(keys[k]);
      if (!Number.isInteger(m) || m < MILESTONE_START || m > MILESTONE_END) continue;
      const arr = raw.reach[keys[k]];
      if (!Array.isArray(arr)) continue;
      const clean = [];
      for (let j = 0; j < arr.length; j++) {
        const pi = Math.trunc(Number(arr[j]));
        if (Number.isInteger(pi) && pi >= 0 && pi < PLAYER_COUNT && clean.indexOf(pi) === -1) {
          clean.push(pi);
        }
      }
      if (clean.length) out.reach[String(m)] = clean;
    }
  }

  // Riwayat.
  if (Array.isArray(raw.history)) {
    const clean = [];
    for (let i = 0; i < raw.history.length; i++) {
      const e = sanitizeHistoryEntry(raw.history[i]);
      if (e) clean.push(e);
    }
    out.history = clean.slice(-HISTORY_LIMIT);
  }

  // Pemenang (bila ada -> permainan sudah selesai).
  if (raw.winner && typeof raw.winner === 'object') {
    const p = Math.trunc(Number(raw.winner.player));
    if (Number.isInteger(p) && p >= 0 && p < PLAYER_COUNT) {
      const sc = Math.trunc(Number(raw.winner.score));
      out.winner = {
        player: p,
        score: Number.isFinite(sc) ? sc : out.scores[p],
        at: Number(raw.winner.at) || Date.now()
      };
      out.gameActive = false;
    }
  }

  if (!out.winner) {
    out.gameActive = raw.gameActive !== false;
    // Pemulihan: bila skor sudah >= target namun pemenang belum tercatat.
    const recovered = checkWinner(out);
    if (recovered) out.winner = recovered;
  }

  return out;
}

/**
 * Membaca state dari localStorage.
 * Mengembalikan state default bila localStorage tidak tersedia, kosong,
 * atau berisi JSON yang tidak valid. Tidak pernah melempar error.
 */
function loadState() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    return createDefaultState(); // localStorage diblokir / mode privat.
  }

  if (!raw) return createDefaultState();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return createDefaultState(); // JSON rusak -> fallback aman.
  }

  return sanitizeState(parsed);
}

/**
 * Menyimpan state ke localStorage.
 * Bila gagal (mis. kuota penuh / diblokir), aplikasi TETAP jalan di memori;
 * tidak ada error yang dilempar ke pemanggil.
 */
function saveState() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    if (window.console && window.console.warn) {
      window.console.warn('Remiku: gagal menyimpan ke localStorage.', err);
    }
  }
}

/* ============================================================================
 * DOM HELPERS
 * ==========================================================================*/

// Referensi elemen DOM yang sering dipakai.
const els = {};

/**
 * Pembuat elemen kecil.
 * MENGAPA: semua teks dimasukkan lewat `textContent`, BUKAN `innerHTML`.
 * Dengan begitu nama pemain (input user) tidak pernah dieksekusi sebagai HTML.
 */
function h(tag, attrs, children) {
  const node = document.createElement(tag);

  if (attrs) {
    const keys = Object.keys(attrs);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const value = attrs[key];
      if (value === null || value === undefined) continue;

      if (key === 'class') {
        node.className = value;
      } else if (key === 'text') {
        node.textContent = value;
      } else if (key === 'dataset') {
        const dKeys = Object.keys(value);
        for (let j = 0; j < dKeys.length; j++) node.dataset[dKeys[j]] = value[dKeys[j]];
      } else if (key.indexOf('on') === 0 && typeof value === 'function') {
        node.addEventListener(key.slice(2), value);
      } else {
        node.setAttribute(key, value);
      }
    }
  }

  if (children) {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child === null || child === undefined) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
  }

  return node;
}

/** Nama pemain yang aman dipakai di teks (fallback bila kosong). */
function playerName(index) {
  const name = state.names[index];
  return (typeof name === 'string' && name !== '') ? name : ('Pemain ' + (index + 1));
}

/** Menambahkan kelas animasi sesaat lalu menghapusnya kembali. */
function flashClass(node, cls, ms) {
  if (!node) return;
  node.classList.remove(cls);
  void node.offsetWidth; // paksa reflow agar animasi dapat diputar ulang
  node.classList.add(cls);
  window.setTimeout(function () {
    node.classList.remove(cls);
  }, ms);
}

/** Kembalikan fokus ke input skor pemain tertentu (bila tersedia & aktif). */
function focusPlayerInput(playerIndex) {
  const input = document.getElementById('score-input-' + playerIndex);
  if (input && !input.disabled) {
    try {
      input.focus();
    } catch (err) {
      /* fokus gagal bukan masalah kritis */
    }
  }
}

/* ============================================================================
 * RENDER — KARTU PEMAIN
 * ==========================================================================*/

/**
 * Peringkat pemain (1..4) memakai computeRanking() yang sudah ada.
 * Tie-breaker TIDAK diubah: tetap mengikuti logika ranking yang berlaku.
 */
function playerRank(index) {
  const ranking = computeRanking(state);
  for (let i = 0; i < ranking.length; i++) {
    if (ranking[i].index === index) return i + 1;
  }
  return index + 1;
}

/** Membuat satu kartu pemain lengkap. */
function buildPlayerCard(index) {
  const name = playerName(index);
  const rank = playerRank(index);
  const score = state.scores[index];
  const scoreStr = String(score);
  const locked = !state.gameActive;
  const isWinner = !!(state.winner && state.winner.player === index);

  const classes = ['card'];
  if (isWinner) classes.push('is-winner');

  // Nama pemain = info paling penting setelah skor. Peringkat tampil compact;
  // bila sudah menang, badge eksplisit "PEMENANG" menggantikan peringkat
  // (bukan hanya mengandalkan warna hijau pada kartu).
  const header = h('div', { class: 'card-header' }, [
    h('span', { class: 'card-name', text: name, title: name }),
    isWinner
      ? h('span', { class: 'badge badge-winner', text: 'PEMENANG', title: 'Pemenang permainan' })
      : h('span', { class: 'card-rank', text: '#' + rank, 'aria-label': 'Peringkat ' + rank })
  ]);

  const scoreClasses = ['card-score'];
  if (score < 0) scoreClasses.push('is-negative');
  if (scoreStr.length >= 5) scoreClasses.push('is-long');

  const scoreEl = h('p', {
    class: scoreClasses.join(' '),
    text: scoreStr,
    'aria-label': 'Skor ' + name + ': ' + scoreStr + ' dari target ' + TARGET_SCORE
  });

  const progressLabel = h('p', {
    class: 'card-progress-label',
    text: score + ' / ' + TARGET_SCORE
  });

  // Progress bar sebagai indikator tambahan (bukan satu-satunya penanda status).
  const pct = Math.max(0, Math.min(100, (score / TARGET_SCORE) * 100));
  const fill = h('div', { class: 'progress-fill' });
  fill.style.width = pct.toFixed(1) + '%';
  const track = h('div', {
    class: 'progress-track',
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': String(TARGET_SCORE),
    'aria-valuenow': String(Math.max(0, score)),
    'aria-label': 'Kemajuan ' + name
  }, [fill]);

  // Tombol skor cepat: nilai & urutan HANYA berasal dari QUICK_PRESETS.
  const quickButtons = [];
  for (let q = 0; q < QUICK_PRESETS.length; q++) {
    quickButtons.push(buildQuickButton(index, QUICK_PRESETS[q]));
  }
  const quick = h('div', {
    class: 'quick-grid',
    role: 'group',
    'aria-label': 'Skor cepat untuk ' + name
  }, quickButtons);

  const inputId = 'score-input-' + index;
  const input = h('input', {
    id: inputId,
    class: 'score-input',
    type: 'text',
    inputmode: 'numeric',
    pattern: '[+-]?[0-9]+',
    placeholder: 'mis. +250',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    'aria-label': 'Input skor untuk ' + name,
    disabled: locked ? 'disabled' : null
  });
  // Normalisasi saat mengetik/menempel: keyboard ponsel & autokoreksi kerap
  // mengirim minus Unicode/U+2212 atau angka fullwidth. Nilainya langsung
  // diperbaiki di kolom input agar pengguna MELIHAT "-25" yang benar.
  input.addEventListener('input', function () {
    const normalized = normalizeNumberText(input.value);
    if (normalized !== input.value) {
      input.value = normalized;
      moveCaretToEnd(input);
    }
  });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitScoreInput(index);
    }
  });

  // Tombol "±": keypad numerik di ponsel (`inputmode="numeric"`) TIDAK punya
  // tombol minus, sehingga tanpa tombol ini skor negatif tak bisa diketik.
  const signBtn = h('button', {
    class: 'sign-toggle',
    type: 'button',
    text: '\u00b1',
    title: 'Ubah tanda plus/minus',
    'aria-label': 'Ubah tanda skor ' + name + ' menjadi negatif atau positif',
    disabled: locked ? 'disabled' : null
  });
  signBtn.addEventListener('click', function () {
    toggleScoreSign(index);
  });

  const inputWrap = h('div', { class: 'input-wrap' }, [input, signBtn]);

  const addBtn = h('button', {
    class: 'btn btn-primary btn-add',
    type: 'button',
    text: 'Tambah',
    'aria-label': 'Tambah skor untuk ' + name,
    disabled: locked ? 'disabled' : null
  });
  addBtn.addEventListener('click', function () {
    submitScoreInput(index);
  });

  const inputRow = h('div', { class: 'input-row' }, [inputWrap, addBtn]);

  return h('article', {
    class: classes.join(' '),
    dataset: { player: String(index) },
    'aria-label': 'Pemain ' + name
  }, [header, scoreEl, progressLabel, track, quick, inputRow]);
}

/**
 * Tombol skor cepat.
 * Visual: pengurang (-35/-40) = sekunder/netral, penambah (+250/+300) = primer
 * dengan aksen pink. Logika: tetap memanggil addScore() yang sama dengan input
 * manual, jadi tidak ada jalur scoring terpisah.
 */
function buildQuickButton(index, amount) {
  const isPlus = amount > 0;
  const classes = ['btn-quick', isPlus ? 'plus' : 'minus'];
  if (isPlus) classes.push('is-primary');

  const btn = h('button', {
    class: classes.join(' '),
    type: 'button',
    text: (isPlus ? '+' : '') + amount,
    'data-amount': String(amount),
    'aria-label': (isPlus ? 'Tambah ' : 'Kurangi ') + Math.abs(amount) + ' untuk ' + playerName(index),
    disabled: !state.gameActive ? 'disabled' : null
  });

  btn.addEventListener('click', function () {
    // Fokus tidak diambil agar keyboard mobile tidak muncul saat tombol cepat dipakai.
    addScore(index, amount, false);
  });

  return btn;
}

/** Merender seluruh kartu pemain (grid 2x2 di mobile). */
function renderPlayers() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < PLAYER_COUNT; i++) frag.appendChild(buildPlayerCard(i));
  els.players.textContent = '';
  els.players.appendChild(frag);
}

/** Jam:menit lokal untuk entri riwayat. */
function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    return '';
  }
}

/* ============================================================================
 * RENDER — RIWAYAT
 * ==========================================================================*/

/** Membuat satu item riwayat (termasuk baris RESET bila ada). */
function buildHistoryItem(event) {
  const name = playerName(event.player);
  const sign = event.delta > 0 ? '+' : '';
  const deltaCls = event.delta > 0 ? 'plus' : 'minus';

  const main = h('div', { class: 'h-main' }, [
    h('span', { class: 'h-name', text: name }),
    h('span', { class: 'h-delta ' + deltaCls, text: sign + event.delta }),
    h('span', { class: 'h-transition', text: 'Skor: ' + event.from + ' \u2192 ' + event.to }),
    h('span', { class: 'h-time', text: formatTime(event.ts) })
  ]);

  const li = h('li', { class: 'history-item' }, [main]);

  if (event.resets && event.resets.length) {
    for (let i = 0; i < event.resets.length; i++) {
      const r = event.resets[i];
      const rName = playerName(r.player);
      const byName = playerName(r.by);
      li.appendChild(h('p', {
        class: 'history-reset',
        text: rName + ' disalip ' + byName + ' \u00b7 Skor ' + r.from + ' \u2192 0'
      }));
    }
  }

  return li;
}

/** Riwayat singkat (terbaru dulu) untuk layar utama. */
function renderRecentHistory() {
  const events = state.history.slice(-6).reverse();
  els.recentList.textContent = '';
  for (let i = 0; i < events.length; i++) {
    els.recentList.appendChild(buildHistoryItem(events[i]));
  }
  if (els.recentEmpty) els.recentEmpty.hidden = events.length > 0;
}

/** Riwayat lengkap untuk modal. */
function renderFullHistory() {
  const events = state.history.slice().reverse();
  els.historyFullList.textContent = '';
  for (let i = 0; i < events.length; i++) {
    els.historyFullList.appendChild(buildHistoryItem(events[i]));
  }
  if (els.historyEmpty) els.historyEmpty.hidden = events.length > 0;
}

/* ============================================================================
 * RENDER — UTAMA
 * ==========================================================================*/

/** Merender seluruh UI dari state terkini. */
function render() {
  renderPlayers();
  renderRecentHistory();
  renderWinnerModalContent();

  const gameOver = !state.gameActive;
  if (els.btnWinner) els.btnWinner.hidden = !gameOver;

  // Bila modal riwayat sedang terbuka, ikut diperbarui.
  if (els.historyModal && !els.historyModal.hidden) renderFullHistory();
}

/** Mengisi konten modal hasil (pemenang + ranking). */
function renderWinnerModalContent() {
  if (!state.winner) return;

  const w = state.winner;
  els.winnerName.textContent = playerName(w.player);
  els.winnerScore.textContent = w.score + ' poin';

  const ranking = computeRanking(state);
  els.rankingList.textContent = '';
  for (let i = 0; i < ranking.length; i++) {
    const item = ranking[i];
    /* Skor negatif ditandai kelas yang sama dengan kartu pemain
       (.ranking-score.is-negative = merah + garis bergelombang) supaya makna
       "minus" konsisten di seluruh UI dan tidak bergantung warna saja. */
    els.rankingList.appendChild(h('li', { class: 'ranking-item' }, [
      h('span', { class: 'ranking-pos', text: '#' + (i + 1) }),
      h('span', { class: 'ranking-name', text: item.name, title: item.name }),
      h('span', {
        class: item.score < 0 ? 'ranking-score is-negative' : 'ranking-score',
        text: String(item.score),
        'aria-label': 'Skor ' + item.name + ': ' + item.score
      })
    ]));
  }
}

/* ============================================================================
 * AKSI — INPUT SKOR
 * ==========================================================================*/

/** Dipanggil dari tombol "Tambah" atau tombol Enter pada input. */
function submitScoreInput(playerIndex) {
  if (!state.gameActive) return;

  const input = document.getElementById('score-input-' + playerIndex);
  if (!input) return;

  const amount = parseScoreInput(input.value);
  if (amount === null) {
    showToast('Masukkan bilangan bulat, contoh: 50 atau -50 (tombol \u00b1 untuk minus).', 'error');
    try { input.focus(); } catch (err) {}
    if (input.select) input.select();
    return;
  }

  addScore(playerIndex, amount, true);
}

/**
 * Membalik tanda nilai pada input skor (mis. "25" -> "-25", "−25" -> "25").
 * Dipanggil tombol "±" sehingga pengguna keypad numerik (yang tidak punya
 * tombol minus) tetap bisa memasukkan skor negatif.
 * Nilai yang hanya berisi tanda minus/null tetap dapat dirapikan lewat tombol ini.
 */
function toggleScoreSign(playerIndex) {
  const input = document.getElementById('score-input-' + playerIndex);
  if (!input || input.disabled) return;

  const current = normalizeNumberText(input.value);
  let next;

  if (current === '') next = '-';                              // mulai dari minus
  else if (current.charAt(0) === '-') next = current.slice(1);  // negatif -> positif
  else if (current.charAt(0) === '+') next = '-' + current.slice(1);
  else next = '-' + current;                                   // positif -> negatif

  input.value = next;
  moveCaretToEnd(input);
  try { input.focus(); } catch (err) {}
}

/** Menaruh kursor di akhir teks (dilewati di lingkungan tanpa API selection). */
function moveCaretToEnd(input) {
  try {
    const end = input.value.length;
    if (typeof input.setSelectionRange === 'function') input.setSelectionRange(end, end);
  } catch (err) {
    /* kursor bukan hal kritis */
  }
}

/**
 * Menambahkan skor, lalu menyimpan, merender, dan memberi umpan balik.
 * `focusInput` true hanya untuk input manual (agar keyboard mobile tidak muncul
 * saat pengguna menekan tombol cepat).
 */
function addScore(playerIndex, amount, focusInput) {
  const result = applyScoreChange(state, playerIndex, amount);

  if (!result.ok) {
    if (result.reason === 'bad-amount') showToast('Nilai skor tidak valid.', 'error');
    return;
  }

  saveState();
  render();
  if (focusInput) focusPlayerInput(playerIndex);
  applyCardFeedback(playerIndex, result);

  if (result.winner) openWinnerModal();
}

/* ============================================================================
 * AKSI — UMPAN BALIK VISUAL
 * ==========================================================================*/

/**
 * Umpan balik setelah skor berubah.
 * - Kartu yang diubah berkedip singkat.
 * - Kartu pemain yang direset berkedip lebih kuat (kuning).
 * - Banner besar ditampilkan agar user langsung tahu MENGAPA skor jadi 0,
 *   tanpa harus membuka riwayat.
 */
function applyCardFeedback(playerIndex, result) {
  const card = els.players.querySelector('.card[data-player="' + playerIndex + '"]');
  flashClass(card, 'just-updated', 520);

  for (let i = 0; i < result.resets.length; i++) {
    const r = result.resets[i];
    const rCard = els.players.querySelector('.card[data-player="' + r.player + '"]');
    flashClass(rCard, 'just-reset', 1900);
  }

  if (result.resets.length) showResetAlert(result.resets);
}

let alertTimer = null;

/** Menampilkan banner RESET yang jelas (bukan sekadar perubahan warna). */
function showResetAlert(resets) {
  if (!els.alertBanner) return;

  els.alertBanner.textContent = '';

  if (resets.length === 1) {
    const r = resets[0];
    const rName = playerName(r.player);
    const byName = playerName(r.by);
    els.alertBanner.appendChild(h('span', {
      class: 'alert-title',
      text: '\u26a0 ' + rName.toUpperCase() + ' RESET'
    }));
    els.alertBanner.appendChild(h('p', { text: byName + ' menyalip ' + rName + '.' }));
    els.alertBanner.appendChild(h('p', { text: rName + ': ' + r.from + ' \u2192 0' }));
  } else {
    els.alertBanner.appendChild(h('span', {
      class: 'alert-title',
      text: '\u26a0 RESET \u2014 pemain disalip'
    }));
    for (let i = 0; i < resets.length; i++) {
      const r = resets[i];
      const rName = playerName(r.player);
      els.alertBanner.appendChild(h('p', {
        text: rName + ' disalip ' + playerName(r.by) + '. ' + rName + ': ' + r.from + ' \u2192 0'
      }));
    }
  }

  els.alertBanner.hidden = false;
  if (alertTimer) clearTimeout(alertTimer);
  alertTimer = window.setTimeout(function () {
    els.alertBanner.hidden = true;
    alertTimer = null;
  }, 12000);
}

/** Menyembunyikan banner RESET (mis. saat permainan baru dimulai). */
function hideResetAlert() {
  if (alertTimer) {
    clearTimeout(alertTimer);
    alertTimer = null;
  }
  if (els.alertBanner) els.alertBanner.hidden = true;
}

/* ============================================================================
 * AKSI — PENGATURAN NAMA
 * ==========================================================================*/

/** Membangun 4 field nama di modal pengaturan. */
function buildSettingsFields() {
  const form = els.settingsForm;
  form.textContent = '';

  for (let i = 0; i < PLAYER_COUNT; i++) {
    const id = 'name-input-' + i;
    const input = h('input', {
      id: id,
      class: 'field-input',
      type: 'text',
      maxlength: String(NAME_MAX),
      autocomplete: 'off',
      'aria-label': 'Nama Pemain ' + (i + 1),
      value: state.names[i]
    });

    input.addEventListener('input', function () {
      onNameInput(i, input);
    });

    form.appendChild(h('div', { class: 'field' }, [
      h('label', { class: 'field-label', for: id, text: 'Pemain ' + (i + 1) }),
      input
    ]));
  }
}

/**
 * Menyimpan nama secara langsung (auto-save).
 * PENTING: hanya `names` yang diubah — skor, riwayat, dan milestone TIDAK tersentuh.
 * Bila dikosongkan, nama kembali ke default ("Pemain N").
 */
function onNameInput(index, input) {
  const trimmed = String(input.value).trim().slice(0, NAME_MAX);
  state.names[index] = trimmed === '' ? DEFAULT_NAMES[index] : trimmed;

  saveState();
  renderPlayers();          // perbarui nama di kartu
  renderRecentHistory();    // nama pada riwayat juga mengikuti
}

/** Membuka modal pengaturan dengan nilai nama terkini. */
function openSettings() {
  buildSettingsFields();
  openModal(els.settingsModal, els.settingsForm.querySelector('input'));
}

/* ============================================================================
 * AKSI — RIWAYAT & PERMAINAN BARU
 * ==========================================================================*/

/** Membuka modal riwayat lengkap. */
function openHistory() {
  renderFullHistory();
  openModal(els.historyModal, document.getElementById('btnCloseHistory'));
}

/**
 * Menghapus riwayat skor.
 * MENGAPA dipisah dari "Permainan Baru": spec meminta menghapus riwayat TIDAK
 * menghapus state permainan aktif (skor & urutan milestone tetap).
 */
function clearHistoryAction() {
  confirmAction(
    'Hapus riwayat?',
    'Riwayat perubahan skor akan dihapus. Skor dan urutan milestone tetap tersimpan.',
    'Ya, hapus',
    function () {
      state.history = [];
      saveState();
      render();
      renderFullHistory();
      showToast('Riwayat dihapus.');
    }
  );
}

/**
 * Memulai permainan baru.
 * MENGAPA: hanya DATA PERMAINAN yang direset. Nama pemain dipertahankan
 * sesuai permintaan (lihat spec bagian 4 & 15).
 */
function startNewGame() {
  confirmAction(
    'Mulai permainan baru?',
    'Skor, riwayat, dan urutan milestone permainan saat ini akan dihapus. Nama pemain tetap dipertahankan.',
    'Ya, mulai baru',
    function () {
      const names = state.names.slice(); // pertahankan nama
      state = createDefaultState();
      state.names = names;
      saveState();
      hideResetAlert();
      closeModal(els.winnerModal);
      render();
      showToast('Permainan baru dimulai.');
    }
  );
}

/* ============================================================================
 * MODAL & TOAST
 * ==========================================================================*/

let modalStack = [];           // modal yang sedang terbuka (mendukung penumpukan)
let confirmCallback = null;    // aksi yang dijalankan bila user menyetujui konfirmasi
let toastTimer = null;

function anyModalOpen() {
  return modalStack.length > 0;
}

/** Modal paling atas (untuk penanganan tombol Escape). */
function topModal() {
  return modalStack.length ? modalStack[modalStack.length - 1] : null;
}

function openModal(modal, focusTarget) {
  if (!modal) return;
  if (modalStack.indexOf(modal) !== -1) return; // sudah terbuka

  modal.remikuPreviousFocus = document.activeElement; // fokus sebelum modal ini dibuka
  modalStack.push(modal);
  modal.hidden = false;
  document.body.classList.add('modal-open');

  const target = focusTarget || modal.querySelector(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );

  if (target && target.focus) {
    window.setTimeout(function () {
      try { target.focus(); } catch (err) {}
    }, 30);
  }
}

function closeModal(modal) {
  if (!modal) return;

  modal.hidden = true;

  const index = modalStack.indexOf(modal);
  if (index !== -1) modalStack.splice(index, 1);

  if (!anyModalOpen()) document.body.classList.remove('modal-open');

  const previous = modal.remikuPreviousFocus;
  modal.remikuPreviousFocus = null;
  if (previous && previous.focus) {
    try { previous.focus(); } catch (err) {}
  }
}

/** Menampilkan dialog konfirmasi untuk aksi destruktif. */
function confirmAction(title, message, okLabel, onOk) {
  if (!els.confirmModal) return;

  els.confirmTitle.textContent = title;
  els.confirmMessage.textContent = message;
  els.btnConfirmOk.textContent = okLabel || 'Ya, lanjutkan';
  confirmCallback = onOk;

  openModal(els.confirmModal, els.btnConfirmOk);
}

function closeConfirm() {
  confirmCallback = null;
  closeModal(els.confirmModal);
}

/** Membuka layar/modal hasil permainan. */
function openWinnerModal() {
  if (!state.winner) return;
  renderWinnerModalContent();
  openModal(els.winnerModal, document.getElementById('btnSaveResult'));
}

/** Klik pada backdrop (elemen dengan `data-close`). */
function onDocumentClick(event) {
  const target = event.target;
  if (!target || typeof target.closest !== 'function') return;

  const closer = target.closest('[data-close]');
  if (!closer) return;

  const which = closer.getAttribute('data-close');
  if (which === 'confirmCancel') closeConfirm();
  else if (which === 'settingsModal') closeModal(els.settingsModal);
  else if (which === 'historyModal') closeModal(els.historyModal);
}

/** Tombol Escape menutup modal paling atas. */
function onDocumentKeydown(event) {
  if (event.key !== 'Escape') return;

  const top = topModal();
  if (!top) return;

  if (top === els.confirmModal) closeConfirm();
  else closeModal(top);
}

/** Toast singkat untuk umpan balik umum. */
function showToast(message, kind, duration) {
  if (!els.toast) return;

  els.toast.textContent = message;
  els.toast.className = 'toast' + (kind ? ' is-' + kind : '');
  els.toast.hidden = false;

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(function () {
    els.toast.hidden = true;
    toastTimer = null;
  }, duration || 2600);
}

/* ============================================================================
 * SIMPAN HASIL SEBAGAI GAMBAR (Canvas API)
 * ----------------------------------------------------------------------------
 * Murni memakai Canvas API bawaan browser (tanpa API/CDN eksternal), sehingga
 * tetap bekerja OFFLINE. Ukuran logis di-render dengan skala devicePixelRatio
 * agar hasil PNG tajam di layar retina.
 * ==========================================================================*/

/* Font: sistem saja (tanpa font/CDN eksternal) supaya tetap bekerja offline. */
const FONT_STACK = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';

/* Wordmark dipakai konsisten di header, layar hasil, dan gambar hasil. */
const BRAND_A = 'Remi';
const BRAND_B = 'ku';

/* Palet gambar hasil (mengikuti karakter warna UI: pink utama, hijau sekunder). */
const IMG_COLORS = {
  bg: '#FFE9F4',
  dots: 'rgba(17, 17, 17, 0.06)',
  card: '#FFFFFF',
  ink: '#111111',
  muted: '#5A5A5A',
  pink: '#FF4D9D',
  pinkSoft: '#FFD1E6',
  pinkTint: '#FFF1F7',
  greenSoft: '#CDF5D9',
  danger: '#E5484D'
};

/* Ukuran logis gambar hasil (px), portrait agar nyaman dibagikan ke chat.
   Skala devicePixelRatio diterapkan saat menggambar agar tetap tajam. */
const IMG_WIDTH = 900;
const IMG_MARGIN = 20;
const IMG_PAD = 56;
const IMG_SHADOW = 12;
const IMG_RADIUS = 26;
const IMG_BOX_H = 264;
const IMG_ROW_H = 92;
const IMG_ROW_GAP = 14;

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** YYYY-MM-DD untuk nama file (tanggal lokal saat menyimpan). */
function dateStamp(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** Tanggal yang enak dibaca untuk isi gambar. */
function formatDateID(d) {
  try {
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch (err) {
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
  }
}

/** Path rounded-rectangle, dengan fallback untuk browser lama. */
function drawRoundedRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }

  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Mencari ukuran font terbesar (turun 2px) agar teks muat dalam maxWidth. */
function fitFontSize(ctx, text, maxWidth, startSize, weight) {
  let size = startSize;
  while (size > 12) {
    ctx.font = weight + ' ' + size + 'px ' + FONT_STACK;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

/** Memotong teks dengan "…" bila melebihi maxWidth (menangani nama panjang). */
function ellipsize(ctx, text, maxWidth, weight, size) {
  ctx.font = weight + ' ' + size + 'px ' + FONT_STACK;
  if (ctx.measureText(text).width <= maxWidth) return text;

  let t = text;
  while (t.length > 1 && ctx.measureText(t + '\u2026').width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '\u2026';
}

/**
 * Memecah teks menjadi beberapa baris (maksimal `maxLines`).
 * Baris terakhir diberi "…" bila masih ada sisa kata yang belum muat.
 * Dipakai agar nama pemain panjang tetap rapi dan tidak keluar dari kotaknya.
 */
function wrapText(ctx, text, maxWidth, maxLines, weight, size) {
  ctx.font = weight + ' ' + size + 'px ' + FONT_STACK;

  const words = String(text).split(/\s+/).filter(function (w) { return w !== ''; });
  const lines = [];
  let current = '';

  for (let i = 0; i < words.length; i++) {
    const candidate = (current === '') ? words[i] : (current + ' ' + words[i]);

    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current === '') {
      // Satu kata saja sudah terlalu lebar -> potong dengan "…".
      lines.push(ellipsize(ctx, words[i], maxWidth, weight, size));
      continue;
    }

    lines.push(current);
    current = '';

    if (lines.length >= maxLines - 1) {
      lines.push(ellipsize(ctx, words.slice(i).join(' '), maxWidth, weight, size));
      return lines;
    }

    i--; // kata ini belum ditempatkan; proses ulang untuk baris berikutnya
  }

  if (current !== '') lines.push(current);
  if (!lines.length) lines.push(ellipsize(ctx, text, maxWidth, weight, size));
  return lines.slice(0, maxLines);
}

/**
 * Menggambar KARTU HASIL khusus untuk dibagikan (bukan screenshot UI).
 * Komposisi: wordmark Remiku, tanggal, kotak pemenang, ranking, dan footer.
 * Tinggi kanvas dihitung dari tinggi konten sehingga tidak ada bagian
 * yang terpotong, termasuk untuk nama panjang, skor negatif, maupun 1000+.
 */
function drawResultCard(canvas) {
  const ranking = computeRanking(state);
  const winnerIndex = state.winner ? state.winner.player
    : (ranking.length ? ranking[0].index : 0);
  const winnerName = playerName(winnerIndex);
  const winnerScore = state.scores[winnerIndex];
  const now = new Date();

  const W = IMG_WIDTH;
  const cardX = IMG_MARGIN;
  const cardY = IMG_MARGIN;
  const cardW = W - IMG_MARGIN * 2;
  const contentX = cardX + IMG_PAD;
  const contentW = cardW - IMG_PAD * 2;
  const centerX = cardX + cardW / 2;

  // ---- Tata letak vertikal (semua dihitung, tidak ada koordinat rapuh) ----
  const brandY = cardY + IMG_PAD + 74;
  const kickerY = brandY + 50;
  const dateY = kickerY + 44;
  const winnerBoxY = dateY + 40;
  const rankTitleY = winnerBoxY + IMG_BOX_H + 84;
  const rowsY = rankTitleY + 26;
  const rowsH = ranking.length * IMG_ROW_H +
    (ranking.length > 1 ? (ranking.length - 1) * IMG_ROW_GAP : 0);
  const dividerY = rowsY + rowsH + 58;
  const footerY = dividerY + 54;
  const cardH = (footerY + IMG_PAD - IMG_MARGIN) - cardY;
  const H = cardH + IMG_MARGIN * 2;

  // Skala devicePixelRatio (dibatasi 2..3) agar PNG tajam di layar retina.
  const dpr = (window.devicePixelRatio && window.devicePixelRatio > 1) ? window.devicePixelRatio : 2;
  const scale = Math.min(3, Math.max(2, dpr));

  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D tidak tersedia');
  ctx.scale(scale, scale);

  // ---- Latar belakang off-white pink + pola titik halus ----
  ctx.fillStyle = IMG_COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = IMG_COLORS.dots;
  ctx.beginPath();
  for (let dy = 20; dy < H; dy += 36) {
    for (let dx = 20; dx < W; dx += 36) {
      ctx.moveTo(dx + 2, dy);
      ctx.arc(dx, dy, 2, 0, Math.PI * 2);
    }
  }
  ctx.fill();

  // ---- Kartu luar neo-brutalism: offset shadow + border hitam tebal ----
  ctx.fillStyle = IMG_COLORS.ink;
  drawRoundedRect(ctx, cardX + IMG_SHADOW, cardY + IMG_SHADOW, cardW, cardH, IMG_RADIUS + 4);
  ctx.fill();

  ctx.fillStyle = IMG_COLORS.card;
  ctx.strokeStyle = IMG_COLORS.ink;
  ctx.lineWidth = 6;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, IMG_RADIUS);
  ctx.fill();
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';

  // ---- Wordmark: "Remi" hitam + "ku" pink (sama dengan header & layar hasil) ----
  ctx.font = '900 72px ' + FONT_STACK;
  ctx.textAlign = 'left';
  const brandW1 = ctx.measureText(BRAND_A).width;
  const brandW2 = ctx.measureText(BRAND_B).width;
  const brandX = centerX - (brandW1 + brandW2) / 2;

  ctx.fillStyle = IMG_COLORS.ink;
  ctx.fillText(BRAND_A, brandX, brandY);
  ctx.fillStyle = IMG_COLORS.pink;
  ctx.fillText(BRAND_B, brandX + brandW1, brandY);

  // ---- Subjudul + tanggal aktual (DD BULAN YYYY, bahasa Indonesia) ----
  ctx.textAlign = 'center';

  ctx.fillStyle = IMG_COLORS.pink;
  ctx.font = '900 24px ' + FONT_STACK;
  ctx.fillText('HASIL PERMAINAN', centerX, kickerY);

  ctx.fillStyle = IMG_COLORS.muted;
  ctx.font = '800 22px ' + FONT_STACK;
  ctx.fillText(formatDateID(now).toUpperCase(), centerX, dateY);

  // ---- Kotak pemenang (fokus utama gambar) ----
  ctx.fillStyle = IMG_COLORS.greenSoft;
  ctx.strokeStyle = IMG_COLORS.ink;
  ctx.lineWidth = 5;
  drawRoundedRect(ctx, contentX, winnerBoxY, contentW, IMG_BOX_H, 22);
  ctx.fill();
  ctx.stroke();

  // Pil "PEMENANG" (penanda bentuk, bukan hanya warna).
  ctx.font = '900 22px ' + FONT_STACK;
  const flagText = 'PEMENANG';
  const flagW = ctx.measureText(flagText).width + 40;
  const flagH = 40;
  const flagY = winnerBoxY + 30;
  ctx.fillStyle = IMG_COLORS.ink;
  drawRoundedRect(ctx, centerX - flagW / 2, flagY, flagW, flagH, flagH / 2);
  ctx.fill();

  ctx.fillStyle = IMG_COLORS.card;
  ctx.textBaseline = 'middle';
  ctx.fillText(flagText, centerX, flagY + flagH / 2 + 1);

  // Nama pemenang: ukuran font dicari otomatis, dipotong aman bila kepanjangan.
  const nameMaxW = contentW - 80;
  const nameSize = fitFontSize(ctx, winnerName, nameMaxW, 58, '900');
  const nameText = ellipsize(ctx, winnerName, nameMaxW, '900', nameSize);
  ctx.font = '900 ' + nameSize + 'px ' + FONT_STACK;
  ctx.fillStyle = IMG_COLORS.ink;
  ctx.fillText(nameText, centerX, flagY + flagH + 52);

  ctx.font = '900 40px ' + FONT_STACK;
  ctx.fillStyle = IMG_COLORS.pink;
  ctx.fillText(winnerScore + ' POIN', centerX, flagY + flagH + 108);
  ctx.textBaseline = 'alphabetic';

  // ---- Judul ranking + garis aksen pink ----
  ctx.textAlign = 'left';
  ctx.fillStyle = IMG_COLORS.ink;
  ctx.font = '900 26px ' + FONT_STACK;
  ctx.fillText('RANKING', contentX, rankTitleY);

  ctx.fillStyle = IMG_COLORS.pink;
  drawRoundedRect(ctx, contentX, rankTitleY + 12, 110, 6, 3);
  ctx.fill();

  // ---- Baris ranking: skor rata kanan, nama panjang aman (maks 2 baris) ----
  const rowH = IMG_ROW_H - IMG_ROW_GAP;
  const posColW = 76;
  const scoreColW = 170;
  const colGap = 14;
  const rowPadX = 24;
  const nameMaxWRow = contentW - rowPadX * 2 - posColW - scoreColW - colGap * 2;

  for (let i = 0; i < ranking.length; i++) {
    const item = ranking[i];
    const ry = rowsY + i * IMG_ROW_H;
    const isFirst = i === 0;

    ctx.fillStyle = isFirst ? IMG_COLORS.greenSoft : IMG_COLORS.pinkTint;
    ctx.strokeStyle = IMG_COLORS.ink;
    ctx.lineWidth = isFirst ? 5 : 3;
    drawRoundedRect(ctx, contentX, ry, contentW, rowH, 18);
    ctx.fill();
    ctx.stroke();

    const midY = ry + rowH / 2;
    ctx.textBaseline = 'middle';

    // Peringkat "#1"
    const posText = '#' + (i + 1);
    const posSize = fitFontSize(ctx, posText, posColW, 28, '900');
    ctx.font = '900 ' + posSize + 'px ' + FONT_STACK;
    ctx.fillStyle = IMG_COLORS.ink;
    ctx.textAlign = 'left';
    ctx.fillText(posText, contentX + rowPadX, midY);

    // Nama pemain (dibungkus maksimal 2 baris, sisanya dipotong dengan "…")
    const nameLines = wrapText(ctx, item.name, nameMaxWRow, 2, '800', 26);
    const nameX = contentX + rowPadX + posColW + colGap;
    ctx.fillStyle = IMG_COLORS.ink;
    ctx.font = '800 26px ' + FONT_STACK;
    ctx.textAlign = 'left';

    if (nameLines.length > 1) {
      ctx.fillText(nameLines[0], nameX, midY - 15);
      ctx.fillText(nameLines[1], nameX, midY + 15);
    } else {
      ctx.fillText(nameLines[0], nameX, midY);
    }

    // Skor (rata kanan). Negatif tetap jelas karena tanda minus selalu tampil.
    const scoreText = String(item.score);
    const scoreSize = fitFontSize(ctx, scoreText, scoreColW, 30, '900');
    ctx.font = '900 ' + scoreSize + 'px ' + FONT_STACK;
    ctx.fillStyle = (item.score < 0) ? IMG_COLORS.danger : IMG_COLORS.ink;
    ctx.textAlign = 'right';
    ctx.fillText(scoreText, contentX + contentW - rowPadX, midY);
  }

  ctx.textBaseline = 'alphabetic';

  // ---- Garis pemisah putus-putus ----
  ctx.strokeStyle = IMG_COLORS.ink;
  ctx.lineWidth = 3;
  ctx.setLineDash([16, 14]);
  ctx.beginPath();
  ctx.moveTo(contentX, dividerY);
  ctx.lineTo(contentX + contentW, dividerY);
  ctx.stroke();
  ctx.setLineDash([]);

  // ---- Footer (tahun dinamis, sama seperti footer aplikasi) ----
  ctx.textAlign = 'center';
  ctx.fillStyle = IMG_COLORS.muted;
  ctx.font = '800 21px ' + FONT_STACK;
  ctx.fillText('\u00a9 ' + now.getFullYear() + ' Remiku \u00b7 Powered by zkvoid', centerX, footerY);

  ctx.textAlign = 'left';
}

/* ------------------------------------------------------------------------- */
/* Ekspor PNG + Web Share API (dengan fallback download biasa).               */
/* ------------------------------------------------------------------------- */

/**
 * Menyimpan hasil permainan sebagai gambar PNG.
 *
 * MENGAPA seluruh proses ditulis SINKRON? `canvas.toBlob()` asinkron, sehingga
 * `navigator.share()` (dan unduhan di iOS/Safari) dipanggil di luar gestur klik
 * pengguna -> izin "user activation" hilang -> share gagal senyap sementara
 * toast tetap muncul, dan tombol terasa tidak bekerja. `toDataURL()` sinkron,
 * jadi izin masih melekat saat share/unduhan dipicu.
 *
 * Urutan: di perangkat sentuh (iOS/Android) pakai *share sheet* karena di sana
 * itu cara paling andal menyimpan gambar; di desktop langsung unduh berkas
 * (tombolnya bernama "Simpan Hasil", jadi unduhan adalah harapan pengguna).
 */
function saveResultAsImage() {
  if (!state.winner) {
    showToast('Belum ada hasil permainan untuk disimpan.', 'error');
    return;
  }

  const now = new Date();
  const filename = 'remiku-hasil-' + dateStamp(now) + '.png';

  let dataUrl = null;
  try {
    const canvas = document.createElement('canvas');
    drawResultCard(canvas);
    dataUrl = canvas.toDataURL('image/png');
  } catch (err) {
    if (window.console && window.console.warn) {
      window.console.warn('Remiku: gagal menggambar hasil.', err);
    }
  }

  if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/png') !== 0) {
    showToast('Gagal membuat gambar hasil.', 'error');
    return;
  }

  const blob = dataUrlToBlob(dataUrl);

  if (isTouchPrimaryDevice() && canShareImage(blob, filename)) {
    shareResultImage(blob, dataUrl, filename);
    return;
  }

  downloadResultImage(blob, dataUrl, filename);
}

/** Mengubah data URL PNG menjadi Blob (juga dasar berkas untuk Web Share). */
function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma === -1 || dataUrl.indexOf(';base64') === -1) return null;

  const bytes = base64ToBytes(dataUrl.slice(comma + 1));
  if (!bytes) return null;

  try {
    return new Blob([bytes], { type: 'image/png' });
  } catch (err) {
    return null;
  }
}

/** true bila perangkat utama memakai sentuhan (ponsel/tablet). */
function isTouchPrimaryDevice() {
  try {
    if (!window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) return false;
    return (navigator.maxTouchPoints || 0) > 0;
  } catch (err) {
    return false;
  }
}

/** true bila Web Share API bisa mengirim berkas PNG ini. */
function canShareImage(blob, filename) {
  if (!blob) return false;
  if (typeof navigator.canShare !== 'function' || typeof window.File !== 'function') return false;

  try {
    return navigator.canShare({ files: [new File([blob], filename, { type: 'image/png' })] });
  } catch (err) {
    return false;
  }
}

/**
 * Membagikan gambar lewat Web Share API.
 * Dibatalkan pengguna -> diam saja; gagal karena sebab lain -> unduhan.
 */
function shareResultImage(blob, dataUrl, filename) {
  let promise;
  try {
    const file = new File([blob], filename, { type: 'image/png' });
    promise = navigator.share({
      files: [file],
      title: 'Hasil Permainan Remiku',
      text: 'Hasil permainan Remiku'
    });
  } catch (err) {
    downloadResultImage(blob, dataUrl, filename);
    return;
  }

  if (!promise || typeof promise.then !== 'function') {
    showToast('Hasil permainan dibagikan.');
    return;
  }

  promise
    .then(function () {
      showToast('Hasil permainan dibagikan.');
    })
    .catch(function (err) {
      if (err && err.name === 'AbortError') return; // pengguna membatalkan
      downloadResultImage(blob, dataUrl, filename);
    });
}

/** Unduhan final: pakai Blob bila tersedia, selain itu data URL. */
function downloadResultImage(blob, dataUrl, filename) {
  if (blob) downloadBlob(blob, filename);
  else downloadDataUrl(dataUrl, filename);
}

/** Mengunduh blob sebagai file. */
function downloadBlob(blob, filename) {
  let url = null;
  try {
    url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();

    window.setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      if (url) URL.revokeObjectURL(url);
    }, 1500);

    showToast('Gambar hasil disimpan.');
  } catch (err) {
    if (url) {
      try { URL.revokeObjectURL(url); } catch (e) {}
    }
    showToast('Gagal menyimpan gambar.', 'error');
  }
}

/** Unduhan cadangan memakai data URL (dipakai bila Blob tidak bisa dibuat). */
function downloadDataUrl(dataUrl, filename) {
  try {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    if (a.parentNode) a.parentNode.removeChild(a);
    showToast('Gambar hasil disimpan.');
  } catch (err) {
    showToast('Gagal menyimpan gambar.', 'error');
  }
}

/* ============================================================================
 * INISIALISASI
 * ==========================================================================*/

/** Menyimpan referensi elemen DOM yang dipakai berulang. */
function cacheDom() {
  els.players = document.getElementById('players');
  els.recentList = document.getElementById('recentList');
  els.recentEmpty = document.getElementById('recentEmpty');
  els.historyFullList = document.getElementById('historyFullList');
  els.historyEmpty = document.getElementById('historyEmpty');
  els.historyModal = document.getElementById('historyModal');
  els.settingsModal = document.getElementById('settingsModal');
  els.settingsForm = document.getElementById('settingsForm');
  els.winnerModal = document.getElementById('winnerModal');
  els.winnerName = document.getElementById('winnerName');
  els.winnerScore = document.getElementById('winnerScore');
  els.rankingList = document.getElementById('rankingList');
  els.confirmModal = document.getElementById('confirmModal');
  els.confirmTitle = document.getElementById('confirmTitle');
  els.confirmMessage = document.getElementById('confirmMessage');
  els.btnConfirmOk = document.getElementById('btnConfirmOk');
  els.toast = document.getElementById('toast');
  els.alertBanner = document.getElementById('alertBanner');
  els.btnWinner = document.getElementById('btnWinner');
  els.year = document.getElementById('year');
  els.yearWinner = document.getElementById('yearWinner');
}

/** Memasang semua event listener. */
function bindEvents() {
  document.getElementById('btnSettings').addEventListener('click', openSettings);
  document.getElementById('btnCloseSettings').addEventListener('click', function () {
    closeModal(els.settingsModal);
  });

  document.getElementById('btnHistory').addEventListener('click', openHistory);
  document.getElementById('btnCloseHistory').addEventListener('click', function () {
    closeModal(els.historyModal);
  });
  document.getElementById('btnClearHistory').addEventListener('click', clearHistoryAction);

  document.getElementById('btnNewGame').addEventListener('click', startNewGame);
  document.getElementById('btnNewGameWinner').addEventListener('click', startNewGame);

  document.getElementById('btnWinner').addEventListener('click', openWinnerModal);
  document.getElementById('btnCloseWinner').addEventListener('click', function () {
    closeModal(els.winnerModal);
  });
  document.getElementById('btnSaveResult').addEventListener('click', saveResultAsImage);

  document.getElementById('btnConfirmCancel').addEventListener('click', closeConfirm);
  document.getElementById('btnConfirmOk').addEventListener('click', function () {
    const cb = confirmCallback;
    closeConfirm(); // tutup dulu, lalu jalankan aksi
    if (typeof cb === 'function') cb();
  });

  // Backdrop modal & tombol Escape.
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeydown);
}

/**
 * Titik masuk aplikasi.
 * Urutan: cache DOM -> pasang tahun dinamis -> muat state -> render -> events.
 */
function init() {
  cacheDom();

  // Tahun copyright dinamis (footer halaman utama & footer gambar hasil).
  const year = String(new Date().getFullYear());
  if (els.year) els.year.textContent = year;
  if (els.yearWinner) els.yearWinner.textContent = year;

  state = loadState();

  render();
  bindEvents();

  // Bila permainan sudah selesai (mis. halaman di-refresh setelah menang),
  // tampilkan kembali layar hasil.
  if (state.winner) {
    window.setTimeout(openWinnerModal, 250);
  }

  registerServiceWorker();
}

/**
 * Mendaftarkan service worker (dukungan offline + installable PWA).
 * Kegagalan pendaftaran BUKAN error fatal: aplikasi tetap berjalan normal.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return; // SW hanya untuk http(s)

  const doRegister = function () {
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      if (window.console && window.console.info) {
        window.console.info('Remiku: service worker tidak aktif.', err);
      }
    });
  };

  if (document.readyState === 'complete') doRegister();
  else window.addEventListener('load', doRegister);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
