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
const TARGET_SCORE = 1000;    // Target BAWAAN (dapat diubah pengguna lewat Pengaturan).
const MILESTONE_START = 500;  // Awal rentang milestone khusus (500-999).
const MILESTONE_END = 999;    // Akhir rentang milestone khusus.
const PLAYER_COUNT = 4;       // Jumlah pemain tetap.
const HANDAL_STREAK_MIN = 4;  // "Pengocok Handal": TOTAL skor terendah BERTURUT-TURUT selama >= 4 ronde.
const STORAGE_KEY = 'remiku_data_v1';
const DATA_VERSION = 1;
const HISTORY_LIMIT = 500;    // Batas entri riwayat (agar localStorage tetap ringan).
const NAME_MAX = 24;          // Panjang maksimum nama pemain.
const MAX_ABS_INPUT = 100000; // Batas wajar nilai input (mencegah input absurd).
const MAX_TARGET_SCORE = 1000000; // Batas wajar target poin kustom (setting "Target Poin").
const DEFAULT_NAMES = ['Pemain 1', 'Pemain 2', 'Pemain 3', 'Pemain 4'];

/**
 * Preset tombol skor cepat (urutan array = urutan tampil):
 *   [-35] [-40] [+250] [+300]
 * PENTING: keempat tombol hanya MENGISI input sementara pemain (belum masuk
 * permainan). Skor benar-benar dicatat saat tombol Tambah ditekan sebagai satu
 * ronde, sehingga milestone/overtake/reset/winner/history tetap satu jalur.
 */
const QUICK_PRESETS = [-35, -40, 250, 300];

/**
 * Jeda maksimum (ms) antar-pencatatan skor yang MASIH dianggap satu "ronde".
 * Dipakai HANYA sebagai lapisan kedua saat menyimpulkan batas ronde dari riwayat.
 * Lapisan utama: seorang pemain idealnya mencatat skor maksimal sekali per ronde,
 * jadi pencatatan berulang oleh pemain yang sama menandai ronde baru.
 * Lihat groupHistoryIntoRounds().
 */
const ROUND_GAP_MS = 2 * 60 * 1000;

/**
 * State default sekaligus dokumentasi struktur data yang disimpan.
 * {
 *   version: number,
 *   names:   string[4],                       // nama pemain (dipertahankan antar permainan)
 *   scores:  number[4],                       // skor terkini
 *   reach:   { "<milestone>": [index, ...] },  // URUTAN pemain yang pertama mencapai skor m
 *   history: Event[],                          // riwayat perubahan skor
 *   target:  number,                           // target poin aktif (bawaan 1000, dapat diubah)
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
    target: TARGET_SCORE, // target poin aktif (dinamis; bawaan 1000)
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
 * "Overtakes" = SEBELUMNYA skor pemain <= skor lawan, dan SEKARANG menjadi >.
 * Dengan definisi ini, berakhir seri (tie) BUKAN overtake sehingga tidak
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

/**
 * Pemain yang PALING DULU mencapai milestone `m` (null bila belum ada).
 *
 * Inilah "pemilik milestone" yang dipakai determineResets(): seorang pemain
 * direset saat overtaken HANYA jika ia pemilik milestone sebesar skornya saat itu.
 * `state.reach` terus diisi oleh registerMilestones() agar urutan "siapa datang
 * lebih dulu" tetap adil walau skor pemain sempat turun.
 */
function milestoneOwner(state, milestone) {
  const list = state.reach[String(milestone)];
  return list && list.length ? list[0] : null;
}

/**
 * Menentukan pemain yang harus RESET (ke 0) akibat satu aksi penambahan skor.
 *
 * ATURAN INTI — berbasis KEPEMILIKAN MILESTONE (rentang 500-999):
 *  - Reset hanya berlaku untuk pemain yang OVERTAKEN pada aksi ini.
 *  - "Overtaken" berarti: skor penyerang SEBELUM penambahan <= skor lawan, dan
 *    skor penyerang SESUDAH penambahan > skor lawan (lihat detectOvertakenPlayers).
 *    Berakhir SERI bukan overtake, jadi tidak memicu reset.
 *  - Pemain yang overtaken direset HANYA bila ia PEMILIK milestone sebesar skornya
 *    saat ini (yang PALING DULU mencapai skor itu). Pemain yang mencapai nilai
 *    itu BELAKANGAN tidak direset meski ikut overtaken.
 *  - Batas rentang 500-999: skor < 500 / > 999 bukan milestone sehingga tidak
 *    memicu reset; skor TEPAT 500 MEMICU reset. Batas ini dijaga karena
 *    milestoneOwner() hanya mengenal milestone di dalam rentang tersebut.
 *  - Penyerang TIDAK pernah direset; pemain lain yang tidak overtaken tidak berubah.
 *
 * Contoh (A menyerang; kepemilikan dinilai SEBELUM penambahan):
 *   A = 600 (pemilik 600), B = 600 (bukan pemilik), C = 740. A +200 -> 800.
 *   A overtakes B, tetapi B bukan pemilik milestone 600 -> B TIDAK direset.
 *   A belum melewati C (740), jadi C tetap.
 */
function determineResets(state, overtaken) {
  const resets = [];
  for (let i = 0; i < overtaken.length; i++) {
    const q = overtaken[i];
    if (resets.indexOf(q) !== -1) continue; // jaminan: maksimal SEKALI per pemain per aksi
    // Reset hanya bila pemain yang overtaken adalah PEMILIK milestone sebesar
    // skornya saat ini. `state.scores[q]` belum tersentuh aksi ini (hanya skor
    // penyerang yang diubah), jadi nilainya = skor lawan sebelum penambahan.
    // milestoneOwner() mengembalikan null untuk skor di luar 500-999, sehingga
    // batas rentang otomatis terjaga di sini.
    if (milestoneOwner(state, state.scores[q]) === q) resets.push(q);
  }
  return resets;
}

/**
 * Target poin aktif untuk sebuah state.
 * Target disimpan DI DALAM state (`state.target`) agar ikut tersimpan/dipulihkan
 * lewat mekanisme localStorage yang sudah ada. Bila nilai target tidak valid
 * (mis. data dari versi lama), dipakai TARGET_SCORE sebagai fallback aman.
 */
function targetOf(state) {
  const t = state ? state.target : null;
  return (Number.isInteger(t) && t > 0 && t <= MAX_TARGET_SCORE) ? t : TARGET_SCORE;
}

/**
 * Deteksi pemenang.
 * Pada aplikasi ini HANYA SATU pemain yang berubah skornya per aksi, sehingga
 * pemenang adalah pemain dengan skor tertinggi bila skor itu >= target aktif.
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

  if (bestScore >= targetOf(state)) {
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

/* ----------------------------- STATISTIK RONDE ----------------------------
 * Statistik pemain (Ngocok, Skor Shutout, Pengocok Handal) dihitung
 * dari `state.history` yang SUDAH tersimpan — tidak ada penghitung terpisah
 * yang bisa tidak sinkron. Tidak ada struktur localStorage baru untuk statistik.
 *
 * Batas ronde ditentukan dengan dua cara:
 *   1) UTAMA: setiap event menyimpan `round` (id ronde dari satu klik Tambah).
 *      Event dengan `round` sama = satu ronde. Data baru selalu memakai ini.
 *   2) CADANGAN (data lama sebelum flow ronde): `round` belum ada, sehingga
 *      batas ronde disimpulkan dengan aman:
 *        a) nama pemain idealnya dicatat sekali per ronde — event berulang oleh
 *           pemain yang sudah tercatat menandai ronde baru;
 *        b) jeda waktu antar-event melewati ROUND_GAP_MS -> sesi baru = ronde baru.
 * Skor 250/300 (kemenangan ronde) TIDAK membatalkan perhitungan: ronde itu tetap
 * dihitung, dan Ngocok-nya mengikuti TOTAL skor terendah seperti ronde lain.
 */

/** true bila `round` (array event) sudah memuat pencatatan milik `player`. */
function roundIncludesPlayer(round, player) {
  for (let i = 0; i < round.length; i++) {
    if (round[i].player === player) return true;
  }
  return false;
}

/**
 * Menyusun array ronde dari riwayat. Tiap ronde = array event (urut waktu naik).
 * Lihat catatan "STATISTIK RONDE" di atas untuk aturan batas ronde.
 */
function groupHistoryIntoRounds(history) {
  const list = Array.isArray(history) ? history : [];
  const rounds = [];
  let current = null;
  let lastTs = 0;
  let lastRoundId = null; // null = ronde disimpulkan heuristik (data lama)

  for (let i = 0; i < list.length; i++) {
    const event = list[i];
    const ts = Number(event && event.ts);
    const stamp = Number.isFinite(ts) ? ts : 0;
    const roundId = (event && event.round !== undefined && event.round !== null)
      ? String(event.round)
      : null;

    let startNew;
    if (current === null) {
      startNew = true;
    } else if (roundId !== null || lastRoundId !== null) {
      // Salah satu (atau kedua) ronde memakai penanda eksplisit -> bandingkan id.
      startNew = roundId !== lastRoundId;
    } else {
      // Keduanya data lama -> simpulkan batas ronde dari heuristik.
      const repeatedPlayer = roundIncludesPlayer(current, event && event.player);
      const newSession = (stamp - lastTs) > ROUND_GAP_MS;
      startNew = repeatedPlayer || newSession;
    }

    if (startNew) {
      current = [];
      rounds.push(current);
      lastRoundId = roundId;
    }

    current.push(event);
    lastTs = stamp;
  }

  return rounds;
}

/**
 * Menghitung statistik tiap pemain dari riwayat event, lalu menentukan
 * "Pengocok Handal": SATU pemain yang paling lama berada di posisi TOTAL skor
 * terendah secara BERTURUT-TURUT (badge ini khusus untuk 1 pemain). SERI di
 * posisi terendah TETAP dihitung. Syaratnya: rentetan >= HANDAL_STREAK_MIN
 * (yaitu 4 ronde berturut-turut).
 *
 * Untuk setiap ronde dihitung skor tiap pemain = jumlah `delta` yang ia catat
 * di ronde itu (pada flow ronde nilainya satu: mis. 250/300 atau -35/-40).
 * Pemain dengan input KOSONG tidak ikut dihitung (bukan skor 0).
 *
 * Definisi:
 *   - counts[i]  = "Ngocok": berapa kali pemain i berada di posisi TOTAL skor
 *                  TERENDAH pada sebuah ronde. Dihitung dari TOTAL skor berjalan
 *                  (BUKAN dari skor rondenya), dan berlaku untuk SEMUA pemain —
 *                  termasuk yang TIDAK mencatat skor di ronde itu — sebab posisi
 *                  terendah ditentukan oleh TOTAL, bukan oleh siapa yang mengubah
 *                  skornya. Ronde dihitung selama ADA skor tercatat (sekalipun
 *                  hanya satu pencatat: satu kali [Perbarui] = satu ronde) DAN
 *                  total antar-pemain tidak semuanya seri. Bila seri di posisi
 *                  terendah, SEMUA yang seri mendapat +1.
 *   - perfect[i] = "Skor Shutout": berapa kali skor pemain i = 250 atau 300.
 *   - leaders    = [index] (0 atau TEPAT 1 elemen) = pemain "Pengocok Handal",
 *                  yaitu pemain yang paling lama berada di posisi TOTAL skor
 *                  terendah secara BERTURUT-TURUT selama >= 4 ronde. SERI di
 *                  posisi terendah TETAP dihitung (rentetan tidak putus), jadi
 *                  satu pemain bisa menyandangnya walau beberapa ronde ia
 *                  terendah BERSAMA pemain lain. Bila beberapa pemain punya
 *                  rentetan sama-sama terpanjang, dipilih yang paling awal
 *                  (index terkecil). [] bila tak ada yang melewati ambang.
 *   - streak     = panjang rentetan yang membuat leaders[0] menjadi Pengocok
 *                  Handal (0 bila leaders kosong).
 *   - candidate  = index pemain dengan rentetan TERPANJANG saat ini walau BELUM
 *                  mencapai ambang (>= 4). Dipakai layar Statistik untuk
 *                  menampilkan "pemimpin sementara" sebelum ada yang resmi jadi
 *                  Pengocok Handal. -1 bila belum ada ronde yang bisa dihitung.
 *   - candidateStreak = panjang rentetan candidate (0 bila candidate = -1).
 *
 * Baik `counts` (Ngocok) MAUPUN rentetan "Pengocok Handal" dihitung dari TOTAL
 * skor berjalan tiap ronde, yang direkonstruksi dari `delta` + `resets` tiap
 * event. Dengan begitu pengocok bisa tetap sama walau skor rondenya naik-turun,
 * selama TOTAL-nya tetap terendah. Sebuah ronde TIDAK menambah Ngocok kepada
 * siapa pun DAN "memutus" rentetan HANYA bila semua pemain totalnya sama (tak ada
 * yang benar-benar di bawah). Ronde dengan SATU pencatat TETAP dihitung (satu
 * [Perbarui] = satu ronde).
 *
 * Mengembalikan { rounds, counts, perfect, leaders, streak, candidate,
 * candidateStreak }:
 *   - rounds : banyak ronde yang bisa dihitung (memiliki skor tercatat).
 */
function computePlayerStats(history) {
  const counts = new Array(PLAYER_COUNT).fill(0);
  const perfect = new Array(PLAYER_COUNT).fill(0);
  const totals = new Array(PLAYER_COUNT).fill(0); // TOTAL skor berjalan (termasuk reset)
  const rounds = groupHistoryIntoRounds(history);
  let countedRounds = 0;

  // Rentetan "Pengocok Handal": tiap pemain punya penghitung rentetannya SENDIRI.
  // Sebuah ronde dihitung selama ADA skor tercatat (sekalipun 1 pemain) DAN total
  // antar-pemain TIDAK semuanya seri. Semua pemain yang TOTAL-nya terendah (boleh SERI) mendapat
  // +1; pemain lain direset ke 0. Dengan begitu pemain yang konsisten berada di
  // posisi bawah tetap mengumpulkan rentetan walau beberapa ronde ia terendah
  // bersama pemain lain.
  const streakLen = new Array(PLAYER_COUNT).fill(0);
  let bestOwner = -1;
  let bestLen = 0;

  for (let r = 0; r < rounds.length; r++) {
    const events = rounds[r];
    const roundScore = new Array(PLAYER_COUNT).fill(null); // null = tak mencatat skor
    let hasScore = false;

    for (let e = 0; e < events.length; e++) {
      const ev = events[e];
      const p = ev.player;
      const delta = Number(ev.delta);
      if (!Number.isInteger(p) || p < 0 || p >= PLAYER_COUNT) continue;
      if (!Number.isFinite(delta)) continue;
      if (roundScore[p] === null) roundScore[p] = 0;
      roundScore[p] += delta;
      hasScore = true;
      // Rekonstruksi TOTAL skor: tambah `delta`, lalu terapkan reset yang tercatat.
      totals[p] += delta;
      const resets = Array.isArray(ev.resets) ? ev.resets : [];
      for (let q = 0; q < resets.length; q++) {
        const rp = resets[q] && resets[q].player;
        if (Number.isInteger(rp) && rp >= 0 && rp < PLAYER_COUNT) totals[rp] = 0;
      }
    }

    // Ronde tanpa skor tercatat dilewati -> tidak ada angka palsu.
    if (!hasScore) continue;
    countedRounds++;

    // Skor Shutout: nilai ronde seorang pemain = 250 atau 300.
    for (let i = 0; i < PLAYER_COUNT; i++) {
      if (roundScore[i] === 250 || roundScore[i] === 300) perfect[i]++;
    }

    // "Ngocok" (counts) DAN "Pengocok Handal" (rentetan) sama-sama ditentukan
    // oleh TOTAL skor berjalan ronde ini, BUKAN skor ronde. Pemain dengan TOTAL
    // terendah mendapat +1 Ngocok (walau ia tidak mencatat skor di ronde ini) dan
    // rentetannya bertambah. Ronde dihitung selama ADA skor tercatat (sekalipun
    // hanya satu pemain) DAN total antar-pemain tidak semuanya seri (ada pemilik
    // terendah yang jelas); ronde "semua total seri" tak punya pemilik terendah
    // -> tidak menambah Ngocok kepada siapa pun sekaligus memutus rentetan. SERI
    // di posisi terendah TETAP dihitung -> semua yang seri dapat +1.
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < PLAYER_COUNT; i++) {
      if (totals[i] < low) low = totals[i];
      if (totals[i] > high) high = totals[i];
    }
    const countable = high > low;

    for (let i = 0; i < PLAYER_COUNT; i++) {
      if (countable && totals[i] === low) {
        counts[i] += 1;       // Ngocok: pemilik TOTAL terendah ronde ini.
        streakLen[i] += 1;    // Rentetan "Pengocok Handal".
        // Hanya diperbarui saat STRICTLY lebih panjang -> index terkecil menang
        // saat panjang rentetan seri (dan yang lebih dulu mencapai juga menang).
        if (streakLen[i] > bestLen) {
          bestLen = streakLen[i];
          bestOwner = i;
        }
      } else {
        streakLen[i] = 0;
      }
    }
  }

  // "Pengocok Handal" HANYA untuk pemain dengan rentetan >= HANDAL_STREAK_MIN
  // (yaitu 4 ronde berturut-turut). Tepat satu pemain; rentetan terpanjang
  // menang (seri -> yang paling awal / index terkecil). leaders = [] bila tak ada.
  const leaders = [];
  let streak = 0;
  if (bestOwner !== -1 && bestLen >= HANDAL_STREAK_MIN) {
    leaders.push(bestOwner);
    streak = bestLen;
  }

  return {
    rounds: countedRounds,
    counts: counts,
    perfect: perfect,
    leaders: leaders,
    streak: streak,
    // Pemimpin sementara: pemain dengan rentetan TERPANJANG walau belum
    // mencapai ambang. Dipakai layar Statistik agar info "siapa calon Pengocok
    // Handal" tetap ada walau belum ada yang menembus >= 4 ronde. bestOwner = -1
    // bila belum ada satu pun ronde yang bisa dihitung.
    candidate: bestOwner,
    candidateStreak: bestLen
  };
}

/**
 * Menerapkan perubahan skor secara atomik (tanpa DOM) agar mudah diuji.
 * Urutan pemrosesan:
 *   1. Deteksi overtake (dinilai dari skor SEBELUM diubah).
 *   2. Ubah skor pemain.
 *   3. Catat milestone baru yang dicapai (selalu, walau nanti ada reset).
 *   4. Tentukan & terapkan reset berdasarkan urutan pencapaian milestone.
 *   5. Simpan event ke riwayat.
 *   6. Cek pemenang.
 * Mengembalikan objek hasil agar pemanggil bisa memberi umpan balik visual.
 *
 * `roundId`/`ts` (opsional) dipakai saat satu klik Tambah mencatat BEBERAPA
 * pemain sekaligus: seluruh event dari klik yang sama diberi `round` yang sama
 * agar tetap terbaca sebagai satu ronde. Bila tidak diberikan, event berdiri
 * sendiri (perilaku lama tetap utuh).
 */
function applyScoreChange(state, playerIndex, amount, roundId, ts) {
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

  // (1) Overtake dinilai dari kondisi SEBELUM skor berubah.
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

  // (5) Riwayat. `round` menandai event-event dari SATU klik Tambah (satu ronde),
  // sehingga batas ronde tidak perlu disimpulkan ulang saat statistik dihitung.
  const stamp = Number.isFinite(ts) ? ts : Date.now();
  const event = {
    ts: stamp,
    player: playerIndex,
    delta: amount,
    from: oldScore,
    to: newScore,
    resets: resetInfo
  };
  if (roundId !== undefined && roundId !== null) event.round = roundId;
  state.history.push(event);
  if (state.history.length > HISTORY_LIMIT) {
    state.history.splice(0, state.history.length - HISTORY_LIMIT);
  }

  // (6) Pemenang.
  const winner = checkWinner(state);

  result.ok = true;
  result.event = event;
  result.events = [event];
  result.resets = resetInfo;
  result.winner = winner;
  return result;
}

/**
 * Menerapkan SATU RONDE — kumpulan skor dari satu klik "Tambah" — secara atomik
 * (tanpa DOM). Ini adalah jalur utama pencatatan skor pada flow baru.
 *
 * `entries` = array { player, amount } untuk pemain yang inputnya TERISI.
 * Pemain dengan input kosong TIDAK ikut (tidak dianggap skor 0).
 *
 * Setiap pemain diproses memakai applyScoreChange() yang SAMA, berurutan menurut
 * indeks pemain, dengan `round` id yang sama. Dengan begitu aturan milestone/
 * overtake/reset/pemenang yang sudah berjalan TIDAK berubah — flow ronde hanya
 * menggabungkan beberapa pencatatan menjadi satu event.
 *
 * Mengembalikan { ok, reason, events[], resets[], winner }.
 */
function applyRound(state, entries, at) {
  const result = { ok: false, reason: null, events: [], resets: [], winner: null };

  if (!state.gameActive) {
    result.reason = 'game-over';
    return result;
  }
  if (!Array.isArray(entries)) {
    result.reason = 'bad-round';
    return result;
  }

  // Susun daftar entri valid: pemain unik, delta bulat & bukan 0.
  const valid = [];
  for (let i = 0; i < entries.length; i++) {
    const raw = entries[i];
    if (!raw || typeof raw !== 'object') continue;

    const p = Math.trunc(Number(raw.player));
    const d = Math.trunc(Number(raw.amount));
    if (!Number.isInteger(p) || p < 0 || p >= PLAYER_COUNT) continue;
    if (!Number.isInteger(d) || d === 0) continue;

    let duplicated = false;
    for (let j = 0; j < valid.length; j++) {
      if (valid[j].player === p) { duplicated = true; break; }
    }
    if (duplicated) continue;

    valid.push({ player: p, amount: d });
  }

  if (valid.length === 0) {
    result.reason = 'no-input';
    return result;
  }

  // Urutkan menurut indeks pemain agar hasil deterministik.
  valid.sort(function (a, b) { return a.player - b.player; });

  const ts = Number.isFinite(at) ? at : Date.now();
  const roundId = ts;

  for (let i = 0; i < valid.length; i++) {
    // Bila permainan berakhir di tengah ronde (mis. skor menembus target),
    // sisa pemain pada ronde itu tidak lagi dicatat.
    if (!state.gameActive) break;

    const r = applyScoreChange(state, valid[i].player, valid[i].amount, roundId, ts);
    if (!r.ok) continue;

    result.events.push(r.event);
    result.resets = result.resets.concat(r.resets);
    if (r.winner) result.winner = r.winner;
  }

  result.ok = result.events.length > 0;
  if (!result.ok) result.reason = 'no-change';
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

/**
 * Mengubah teks input "Target Poin" menjadi bilangan bulat positif, atau null
 * bila tidak valid. Ditolak: kosong, 0, negatif, desimal, NaN/Infinity, dan
 * nilai di luar batas wajar (MAX_TARGET_SCORE).
 * Memakai normalizeNumberText yang sama dengan input skor supaya angka fullwidth
 * dan spasi hasil salin-tempel tetap diterima.
 */
function parseTargetInput(value) {
  if (typeof value !== 'string') return null;

  const v = normalizeNumberText(value);
  if (v === '') return null;        // kosong
  if (!/^\+?\d+$/.test(v)) return null; // hanya digit (opsional "+"): menolak negatif & desimal

  const n = Number(v);
  if (!Number.isInteger(n)) return null;           // NaN / desimal
  if (n <= 0) return null;                         // 0 dan negatif ditolak
  if (n > MAX_TARGET_SCORE) return null;           // batas wajar

  return n;
}

/* === LOGIC-END === */

/* ============================================================================
 * STATE & PERSISTENCE (localStorage)
 * ==========================================================================*/

// State global aplikasi (selalu berupa objek valid).
let state = createDefaultState();

/**
 * Skor sementara tiap pemain (teks). Nilai di sini BELUM masuk permainan:
 * hanya diisi lewat input manual atau tombol skor cepat, lalu dikosongkan setelah
 * tombol Tambah mencatat satu ronde. Dipakai juga saat kartu dirender ulang agar
 * ketikan yang belum dicatat tidak hilang. TIDAK dipersistensi (bukan bagian data).
 */
const pendingScores = new Array(PLAYER_COUNT).fill('');

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

  // Penanda ronde (bila ada): event-event dari satu klik Tambah berbagi id sama.
  // Data lama tanpa `round` tetap aman (dikelompokkan lewat heuristik statistik).
  const roundRaw = Number(raw.round);
  if (Number.isFinite(roundRaw)) entry.round = roundRaw;

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

  // Target poin kustom: hanya bilangan bulat positif yang wajar.
  // (out.target sudah berisi TARGET_SCORE bawaan dari createDefaultState().)
  if (raw.target !== undefined && raw.target !== null) {
    const t = Math.trunc(Number(raw.target));
    if (Number.isInteger(t) && t > 0 && t <= MAX_TARGET_SCORE) out.target = t;
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
 * Pemain "Pengocok" = yang mengocok kartu untuk ronde berikutnya, yaitu pemilik
 * skor TERENDAH saat ini. Fungsi ini mengembalikan array berisi MAKSIMAL SATU
 * pemain:
 *  - Skor terendah unik -> pemain itu.
 *  - Skor terendah SERI (mis. Pemain 1 skor shutout sedangkan 3 pemain lain
 *    draw di 0; atau semua 0-0-0-0 di awal permainan) -> dipilih SATU secara
 *    ACAK, karena hanya satu orang yang mengocok.
 * Pilihan disimpan agar tidak berpindah-pindah tiap render: selama pemain yang
 * dipilih masih termasuk kelompok terendah, ia dipertahankan.
 */
let shufflerPick = null;

function currentLowestPlayers() {
  let min = Infinity;
  for (let i = 0; i < PLAYER_COUNT; i++) {
    if (state.scores[i] < min) min = state.scores[i];
  }
  const lowest = [];
  for (let i = 0; i < PLAYER_COUNT; i++) {
    if (state.scores[i] === min) lowest.push(i);
  }
  if (lowest.length === 0) return [];

  // Skor terendah unik -> dialah pengocok.
  if (lowest.length === 1) {
    shufflerPick = lowest[0];
    return lowest;
  }

  // SERI: pertahankan pilihan sebelumnya bila masih termasuk yang terendah;
  // jika tidak (atau belum pernah dipilih), pilih satu pemain BARU secara acak.
  if (shufflerPick === null || lowest.indexOf(shufflerPick) === -1) {
    shufflerPick = lowest[Math.floor(Math.random() * lowest.length)];
  }
  return [shufflerPick];
}

/**
 * Satu badge status di sebelah nama pemain pada kartu (menggantikan badge
 * peringkat #1..#4 yang lama). HANYA SATU badge per pemain, dengan prioritas:
 *   1. "PEMENANG"       : pemenang permainan.
 *   2. "PENGOCOK HANDAL" : SATU pemain yang paling lama berada di posisi TOTAL
 *                          Ngocok berturut-turut >= 4 ronde (statistik
 *                          dari riwayat, sumber sama dengan layar Statistik &
 *                          Hasil). Seri di posisi terendah tetap dihitung.
 *   3. "PENGOCOK"       : skor TERENDAH saat ini (mengocok ronde berikutnya).
 * Karena hanya satu yang ditampilkan, pemain yang sekaligus "Pengocok Handal"
 * dan "Pengocok" cukup tampil sebagai "Pengocok Handal".
 * Mengembalikan array node badge (kosong bila tidak ada status).
 */
function buildCardBadges(status, isWinner, name) {
  if (isWinner) {
    return [h('span', {
      class: 'badge badge-winner',
      text: 'PEMENANG',
      title: 'Pemenang permainan'
    })];
  }

  const st = status || {};

  // Prioritas: Pengocok Handal > Pengocok (hanya SATU yang tampil).
  if (st.handal) {
    const run = st.streak ? ' (' + st.streak + ' ronde berturut-turut)' : '';
    return [h('span', {
      class: 'badge badge-handal',
      text: 'Pengocok Handal',
      title: name + ': Ngocok berturut-turut' + run,
      'aria-label': name + ': Pengocok Handal'
    })];
  }
  if (st.pengocok) {
    return [h('span', {
      class: 'badge badge-pengocok',
      text: 'Ngocok',
      title: name + ': skor terendah, mengocok ronde berikutnya',
      'aria-label': name + ': Ngocok (skor terendah)'
    })];
  }

  return [];
}

/** Membuat satu kartu pemain lengkap. `status` = { pengocok, handal }. */
function buildPlayerCard(index, status) {
  const name = playerName(index);
  const score = state.scores[index];
  const target = targetOf(state); // target aktif (dinamis)
  const scoreStr = String(score);
  const locked = !state.gameActive;
  const isWinner = !!(state.winner && state.winner.player === index);

  const classes = ['card'];
  if (isWinner) classes.push('is-winner');

  // Nama pemain = info paling penting setelah skor. Badge status (Pengocok /
  // Pengocok Handal / PEMENANG) tampil compact di sebelah nama, menggantikan
  // badge peringkat #1..#4 yang lama.
  const badges = buildCardBadges(status, isWinner, name);
  const header = h('div', { class: 'card-header' }, [
    h('span', { class: 'card-name', text: name, title: name }),
    badges.length ? h('span', { class: 'card-badges' }, badges) : null
  ]);

  const scoreClasses = ['card-score'];
  if (score < 0) scoreClasses.push('is-negative');
  if (scoreStr.length >= 5) scoreClasses.push('is-long');

  const scoreEl = h('p', {
    class: scoreClasses.join(' '),
    text: scoreStr,
    'aria-label': 'Skor ' + name + ': ' + scoreStr + ' dari target ' + target
  });

  const progressLabel = h('p', {
    class: 'card-progress-label',
    text: score + ' / ' + target
  });

  // Progress bar sebagai indikator tambahan (bukan satu-satunya penanda status).
  const pct = Math.max(0, Math.min(100, (score / target) * 100));
  const fill = h('div', { class: 'progress-fill' });
  fill.style.width = pct.toFixed(1) + '%';
  const track = h('div', {
    class: 'progress-track',
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': String(target),
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
  const pending = pendingScores[index];
  const input = h('input', {
    id: inputId,
    class: 'score-input',
    type: 'text',
    inputmode: 'numeric',
    pattern: '[+-]?[0-9]+',
    value: pending === '' ? null : pending,
    placeholder: 'mis. +250',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    'aria-label': 'Input skor sementara untuk ' + name,
    disabled: locked ? 'disabled' : null
  });
  // Input ini adalah skor SEMENTARA: nilainya belum masuk permainan sampai
  // tombol Tambah ditekan. Normalisasi saat mengetik/menempel: keyboard ponsel &
  // autokoreksi kerap mengirim minus Unicode/U+2212 atau angka fullwidth. Nilainya
  // langsung diperbaiki di kolom input agar pengguna MELIHAT "-25" yang benar.
  input.addEventListener('input', function () {
    const normalized = normalizeNumberText(input.value);
    if (normalized !== input.value) {
      input.value = normalized;
      moveCaretToEnd(input);
    }
    pendingScores[index] = input.value;
  });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRound();
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

  return h('article', {
    class: classes.join(' '),
    dataset: { player: String(index) },
    'aria-label': 'Pemain ' + name
  }, [header, scoreEl, progressLabel, track, quick, inputWrap]);
}

/**
 * Tombol skor cepat.
 * Visual: pengurang (-35/-40) = sekunder/netral, penambah (+250/+300) = primer
 * dengan aksen pink. Logika: HANYA mengisi input sementara pemain — skor belum
 * masuk permainan sampai tombol Tambah ditekan (tidak ada jalur scoring terpisah).
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
    'aria-label': 'Isi skor ' + amount + ' untuk ' + playerName(index),
    disabled: !state.gameActive ? 'disabled' : null
  });

  btn.addEventListener('click', function () {
    // Cukup mengisi input sementara. Fokus tidak diambil agar keyboard mobile
    // tidak muncul saat tombol cepat dipakai.
    setPendingScore(index, String(amount));
  });

  return btn;
}

/** Merender seluruh kartu pemain (grid 2x2 di mobile). */
function renderPlayers() {
  const frag = document.createDocumentFragment();

  // Status badge dihitung SEKALI per render (bukan per kartu):
  //   - lowest : pemain dengan skor terendah SAAT INI ("Pengocok").
  //   - stats  : "Pengocok Handal" = SATU pemain yang paling lama berada di
  //              total skor terendah berturut-turut >= 4 ronde (lihat
  //              computePlayerStats).
  const lowest = currentLowestPlayers();
  const stats = computePlayerStats(state.history);

  for (let i = 0; i < PLAYER_COUNT; i++) {
    frag.appendChild(buildPlayerCard(i, {
      pengocok: lowest.indexOf(i) !== -1,
      handal: stats.leaders.indexOf(i) !== -1,
      streak: stats.streak
    }));
  }

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
        text: rName + ' overtaken by ' + byName + ' \u00b7 Skor ' + r.from + ' \u2192 0'
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
 * RENDER — STATISTIK
 * ==========================================================================*/

/** Urutan pemain untuk daftar statistik: terbanyak dulu, seri -> index menaik. */
function orderPlayersByCount(counts) {
  const order = [];
  for (let i = 0; i < PLAYER_COUNT; i++) order.push({ index: i, count: counts[i] });
  order.sort(function (a, b) {
    return (b.count - a.count) || (a.index - b.index);
  });
  return order;
}

/** Satu metrik kecil di baris statistik (nilai + label ringkas). */
function buildStatMetric(value, label) {
  return h('span', { class: 'stat' }, [
    h('span', { class: 'stat-value', text: String(value) }),
    h('span', { class: 'stat-label', text: label })
  ]);
}

/**
 * Merender blok statistik pemain ke elemen yang diberikan. Dipakai BERSAMA oleh
 * layar Statistik dan layar Hasil Permainan agar makna & tampilan selalu sama.
 *
 * refs = { summary?, leaders?, list?, empty?, withCandidate? } — semua opsional;
 * hanya elemen yang ada yang diperbarui.
 *   - leaders      : callout "Pengocok Handal" (nama + panjang rentetan ronde).
 *   - withCandidate: bila true (layar Statistik), callout JUGA menampilkan
 *                    "Kandidat Pengocok Handal" = pemimpin sementara dengan
 *                    rentetan terpanjang walau belum mencapai ambang >= 4 ronde,
 *                    sehingga info "siapa calon Pengocok Handal" selalu ada.
 *   - list         : daftar tiap pemain = Ngocok / Shutout.
 */
function renderStatsBlock(refs, stats) {
  const hasData = stats.rounds > 0;

  if (refs.summary) {
    refs.summary.textContent = hasData ? 'Dihitung dari ' + stats.rounds + ' ronde.' : '';
  }

  // Callout "Pengocok Handal" (TEPAT satu pemain: paling lama berada di total
  // skor terendah berturut-turut >= 4 ronde).
  //   - Bila ada penyandang: tampilkan badge pink + nama + panjang rentetan.
  //   - Bila BELUM ada tapi layar meminta kandidat (layar Statistik), tampilkan
  //     "pemimpin sementara" (rentetan terpanjang saat ini, belum memenuhi
  //     syarat) dengan gaya netral, agar informasi siapa calon Pengocok Handal
  //     tetap terlihat.
  if (refs.leaders) {
    refs.leaders.textContent = '';
    const hasLeader = hasData && stats.leaders.length > 0;
    const hasCandidate = !hasLeader && !!refs.withCandidate && hasData &&
      stats.candidate >= 0 && stats.candidateStreak > 0;

    refs.leaders.hidden = !(hasLeader || hasCandidate);
    refs.leaders.classList.toggle('is-candidate', hasCandidate);

    if (hasLeader) {
      const names = [];
      for (let i = 0; i < stats.leaders.length; i++) names.push(playerName(stats.leaders[i]));
      refs.leaders.appendChild(h('span', {
        class: 'badge badge-stat',
        text: '\uD83C\uDFC6 Pengocok Handal'
      }));
      refs.leaders.appendChild(h('span', {
        class: 'stats-leader-names',
        text: names.join(' & ')
      }));
      // Panjang rentetan ditulis sebagai angka besar supaya langsung menonjol.
      refs.leaders.appendChild(h('span', {
        class: 'stats-leader-streak',
        text: stats.streak + '\u00d7',
        title: 'Ngocok berturut-turut ' + stats.streak + ' ronde',
        'aria-label': 'Ngocok berturut-turut ' + stats.streak + ' ronde'
      }));
    } else if (hasCandidate) {
      refs.leaders.appendChild(h('span', {
        class: 'badge badge-candidate',
        text: '\uD83C\uDFAF Kandidat Pengocok Handal'
      }));
      refs.leaders.appendChild(h('span', {
        class: 'stats-leader-names',
        text: playerName(stats.candidate) + ' \u00b7 ' + stats.candidateStreak +
          '\u00d7 \u2014 belum memenuhi syarat (min. ' + HANDAL_STREAK_MIN + ' ronde)'
      }));
    }
  }

  // Daftar seluruh pemain: Ngocok / Shutout tampil per baris.
  if (refs.list) {
    refs.list.textContent = '';
    if (hasData) {
      const order = orderPlayersByCount(stats.counts);
      for (let i = 0; i < order.length; i++) {
        const item = order[i];
        const isLeader = stats.leaders.indexOf(item.index) !== -1;

        const head = h('div', { class: 'stats-head' }, [
          h('span', { class: 'stats-pos', text: '#' + (i + 1) }),
          h('span', { class: 'stats-name', text: playerName(item.index), title: playerName(item.index) })
        ]);
        if (isLeader) {
          head.appendChild(h('span', { class: 'badge badge-stat', text: '\uD83C\uDFC6 Pengocok Handal' }));
        }

        const row = h('li', { class: 'stats-item' + (isLeader ? ' is-leader' : '') }, [
          head,
          h('div', { class: 'stats-metrics' }, [
            buildStatMetric(item.count, 'Ngocok'),
            buildStatMetric(stats.perfect[item.index], 'Shutout')
          ])
        ]);

        refs.list.appendChild(row);
      }
    }
  }

  if (refs.empty) refs.empty.hidden = hasData;
}

/**
 * Merender isi modal Statistik dari riwayat skor TERKINI.
 * Selalu dihitung ulang dari `state.history` agar mengikuti data terbaru
 * (mis. setelah pencatatan ronde baru atau permainan baru dibuat).
 */
function renderStats() {
  if (!els.statsList) return;

  renderStatsBlock({
    summary: els.statsSummary,
    leaders: els.statsLeaders,
    list: els.statsList,
    empty: els.statsEmpty,
    // Layar Statistik: tampilkan pemimpin sementara walau belum ada yang >= 4 ronde.
    withCandidate: true
  }, computePlayerStats(state.history));
}

/* ============================================================================
 * RENDER — VERSI & CHANGELOG
 * ==========================================================================*/

/**
 * Versi rilisan aplikasi yang tampil di header (kanan atas).
 * PENTING: naikkan nilai ini SETIAP kali ada perubahan, agar pengguna selalu
 * melihat versi terbaru. Format: "vMAJOR.MINOR".
 */
const APP_VERSION = 'v1.4';

/**
 * Menampilkan versi rilisan di header (mis. "v1.1") DAN di layar Hasil Permainan
 * (di bawah logo), agar pengguna selalu melihat versi yang sama di mana pun.
 */
function renderVersion() {
  if (els.appVersion) els.appVersion.textContent = APP_VERSION;
  if (els.winnerVersion) els.winnerVersion.textContent = APP_VERSION;
}

/**
 * Data changelog — cukup edit array ini untuk menambah/mengubah entri.
 * Konvensi: entri TERBARU diletakkan paling atas (urutan tampil = urutan array).
 */
const CHANGELOG_ENTRIES = [
  {
    date: '2026-10-07',
    title: 'feat(ui): Result-screen logo & version, "Ngocok" term, consistent buttons'
  },
  {
    date: '2026-10-07',
    title: 'fix(stats): count single-recorder rounds (1 [Perbarui] = 1 round)'
  },
  {
    date: '2026-10-07',
    title: 'feat(result): Winner card + Pengocok Handal card (statistics table removed)'
  },
  {
    date: '2026-10-07',
    title: 'feat(ui): rename the Pengocok badge to Ngocok'
  },
  {
    date: '2026-10-07',
    title: 'feat(ui): Remi card logo, [Perbarui] button, cleaner Settings screen'
  },
  {
    date: '2026-10-07',
    title: 'feat(stats): Statistik screen always shows Pengocok Handal (provisional leader before 4 rounds)'
  },
  {
    date: '2026-10-07',
    title: 'feat(stats): Pengocok Handal = longest run at the lowest total (ties count), >= 4 rounds'
  },
  {
    date: '2026-10-07',
    title: 'feat(result): statistics in the shared PNG result card'
  },
  {
    date: '2026-10-07',
    title: 'feat(result): full player statistics on the game-result screen'
  },
  {
    date: '2026-10-07',
    title: 'fix(stats): ignore single-player rounds for the handal badge'
  },
  {
    date: '2026-10-07',
    title: 'feat(stats): require >3 lowest scores for the handal badge'
  },
  {
    date: '2026-10-07',
    title: 'feat(cards): random shuffler badge on score tie'
  },
  {
    date: '2026-10-07',
    title: 'fix(rules): reset only the milestone owner (500-999)'
  },
  {
    date: '2026-10-07',
    title: 'feat(cards): single per-player status badge'
  },
  {
    date: '2026-10-07',
    title: 'feat(rounds): per-round scoring + stats'
  },
  {
    date: '2026-10-07',
    title: 'feat(config): customizable target score'
  },
  {
    date: '2026-10-07',
    title: 'style(ui): interface refresh'
  }
];

/** Merender daftar changelog (konten statis, cukup dipanggil sekali saat init). */
function renderChangelog() {
  if (!els.changelogList) return;

  els.changelogList.textContent = '';
  for (let i = 0; i < CHANGELOG_ENTRIES.length; i++) {
    const entry = CHANGELOG_ENTRIES[i];
    els.changelogList.appendChild(h('li', { class: 'changelog-item' }, [
      h('p', { class: 'changelog-meta' }, [
        h('span', { class: 'changelog-date', text: entry.date }),
        h('span', { class: 'changelog-title', text: entry.title })
      ])
    ]));
  }
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
  if (els.btnAddRound) els.btnAddRound.disabled = gameOver;

  // Bila modal riwayat sedang terbuka, ikut diperbarui.
  if (els.historyModal && !els.historyModal.hidden) renderFullHistory();

  // Bila modal statistik sedang terbuka, ikut diperbarui (mengikuti data terbaru).
  if (els.statsModal && !els.statsModal.hidden) renderStats();
}

/** Mengisi konten modal hasil (pemenang + ranking + statistik lengkap). */
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

  // Kartu "Pengocok Handal" (kartu kedua layar hasil, tepat di bawah pemenang):
  // SATU pemain dengan rentetan "Ngocok" terpanjang (total skor terendah)
  // >= HANDAL_STREAK_MIN ronde. Kartu SELALU tampil; bila belum ada yang memenuhi
  // syarat, ia memakai gaya netral (.is-empty) agar susunan layar tetap konsisten.
  // Sumber data SAMA dengan badge kartu & layar Statistik (computePlayerStats),
  // sehingga angkanya tidak pernah berbeda. Tabel statistik penuh per pemain
  // sengaja TIDAK lagi ditampilkan di sini (pindah ke layar Statistik).
  if (els.winnerHandalBox) {
    const stats = computePlayerStats(state.history);
    const hasLeader = stats.rounds > 0 && stats.leaders.length > 0;
    els.winnerHandalBox.classList.toggle('is-empty', !hasLeader);
    if (hasLeader) {
      els.winnerHandalName.textContent = playerName(stats.leaders[0]);
      els.winnerHandalMeta.textContent =
        stats.streak + '\u00d7 Ngocok berturut-turut';
    } else {
      els.winnerHandalName.textContent = 'Belum ada';
      els.winnerHandalMeta.textContent =
        'Belum memenuhi syarat (min. ' + HANDAL_STREAK_MIN + ' ronde)';
    }
  }
}

/* ============================================================================
 * AKSI — SKOR SEMENTARA & CATAT RONDE
 * ==========================================================================*/

/** Mengisi skor sementara pemain (dipakai tombol skor cepat) + sinkronkan input. */
function setPendingScore(playerIndex, text) {
  if (playerIndex < 0 || playerIndex >= PLAYER_COUNT) return;

  const next = typeof text === 'string' ? text : '';
  pendingScores[playerIndex] = next;

  const input = document.getElementById('score-input-' + playerIndex);
  if (input && !input.disabled) {
    input.value = next;
    moveCaretToEnd(input);
  }
}

/** Mengosongkan seluruh skor sementara (setelah ronde dicatat / permainan baru). */
function clearPendingScores() {
  for (let i = 0; i < PLAYER_COUNT; i++) pendingScores[i] = '';
}

/**
 * Dipanggil dari tombol "Tambah" (atau Enter pada input): mencatat SEMUA skor
 * yang terisi sebagai SATU ronde. Input kosong TIDAK dianggap 0 (pemain itu
 * tidak ikut dalam ronde). Setelah berhasil, skor sementara dikosongkan agar
 * siap untuk ronde berikutnya.
 */
function commitRound() {
  if (!state.gameActive) {
    showToast('Permainan sudah selesai.', 'error');
    return;
  }

  const entries = [];
  let firstInvalid = -1;

  for (let i = 0; i < PLAYER_COUNT; i++) {
    const raw = pendingScores[i];
    if (typeof raw !== 'string' || raw.trim() === '') continue; // kosong => tidak ikut

    const amount = parseScoreInput(raw);
    if (amount === null) { firstInvalid = i; break; }
    entries.push({ player: i, amount: amount });
  }

  if (firstInvalid !== -1) {
    showToast('Skor ' + playerName(firstInvalid) + ' tidak valid. Contoh: 50 atau -50.', 'error');
    focusPlayerInput(firstInvalid);
    return;
  }

  if (entries.length === 0) {
    showToast('Isi skor minimal satu pemain dulu.', 'error');
    return;
  }

  const result = applyRound(state, entries, Date.now());
  if (!result.ok) {
    if (result.reason === 'game-over') showToast('Permainan sudah selesai.', 'error');
    return;
  }

  clearPendingScores();
  saveState();
  render();
  applyRoundFeedback(result);

  if (result.winner) openWinnerModal();
}

/*
 * LEGACY — dipertahankan agar jalur/perkakas lama (mis. tests/dom.test.js) yang
 * masih memanggil addScore()/submitScoreInput() tetap berfungsi. UI sekarang
 * mencatat skor lewat commitRound() (satu klik Tambah = satu ronde).
 */

/** Menambahkan skor SATU pemain (jalur lama, tanpa penggabungan ronde). */
function addScore(playerIndex, amount, focusInput) {
  const result = applyScoreChange(state, playerIndex, amount);

  if (!result.ok) {
    if (result.reason === 'bad-amount') showToast('Nilai skor tidak valid.', 'error');
    return;
  }

  saveState();
  render();
  if (focusInput) focusPlayerInput(playerIndex);
  applyRoundFeedback(result);

  if (result.winner) openWinnerModal();
}

/** Mencatat skor dari input SATU pemain (jalur lama). */
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
  pendingScores[playerIndex] = next;
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

/* ============================================================================
 * AKSI — UMPAN BALIK VISUAL
 * ==========================================================================*/

/**
 * Umpan balik setelah satu ronde dicatat.
 * - Kartu tiap pemain yang IKUT dalam ronde berkedip singkat.
 * - Kartu pemain yang direset berkedip lebih kuat (kuning).
 * - Banner besar ditampilkan agar user langsung tahu MENGAPA skor jadi 0,
 *   tanpa harus membuka riwayat.
 */
function applyRoundFeedback(result) {
  for (let i = 0; i < result.events.length; i++) {
    const card = els.players.querySelector('.card[data-player="' + result.events[i].player + '"]');
    flashClass(card, 'just-updated', 520);
  }

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
    els.alertBanner.appendChild(h('p', { text: byName + ' overtakes ' + rName + '.' }));
    els.alertBanner.appendChild(h('p', { text: rName + ': ' + r.from + ' \u2192 0' }));
  } else {
    els.alertBanner.appendChild(h('span', {
      class: 'alert-title',
      text: '\u26a0 RESET \u2014 pemain overtaken'
    }));
    for (let i = 0; i < resets.length; i++) {
      const r = resets[i];
      const rName = playerName(r.player);
      els.alertBanner.appendChild(h('p', {
        text: rName + ' overtaken by ' + playerName(r.by) + '. ' + rName + ': ' + r.from + ' \u2192 0'
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
 * AKSI — PENGATURAN (TARGET & NAMA)
 * ==========================================================================*/

/**
 * Field "Target Poin" + tombol Simpan.
 * Target BERLAKU setelah tombol Simpan ditekan (bukan auto-save seperti nama),
 * sehingga menutup modal tanpa menyimpan TIDAK mengubah target.
 */
function buildTargetField() {
  const targetInput = h('input', {
    id: 'target-input',
    class: 'field-input',
    type: 'text',
    inputmode: 'numeric',
    pattern: '[0-9]*',
    maxlength: '7',
    autocomplete: 'off',
    'aria-label': 'Target poin',
    value: String(targetOf(state))
  });

  // Normalisasi saat mengetik/menempel (angka fullwidth & spasi hasil salin-tempel).
  targetInput.addEventListener('input', function () {
    const normalized = normalizeNumberText(targetInput.value);
    if (normalized !== targetInput.value) {
      targetInput.value = normalized;
      moveCaretToEnd(targetInput);
    }
  });
  targetInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyTargetInput(targetInput);
    }
  });

  const saveBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: 'Simpan'
  });
  saveBtn.addEventListener('click', function () {
    applyTargetInput(targetInput);
  });

  return h('div', { class: 'field field-target' }, [
    h('label', { class: 'field-label', for: 'target-input', text: 'Target Poin' }),
    h('div', { class: 'field-row' }, [targetInput, saveBtn]),
    h('p', { class: 'field-hint', text: 'Bilangan bulat positif. Bawaan 1000.' })
  ]);
}

/** Membangun field 4 nama pemain + target poin di layar Pengaturan. */
function buildSettingsFields() {
  const form = els.settingsForm;
  form.textContent = '';

  // Kelompok 1 — Nama Pemain (tersimpan otomatis setiap ketikan).
  form.appendChild(h('p', { class: 'field-group-label', text: 'Nama Pemain' }));
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

  // Kelompok 2 — Target Poin (baru berlaku setelah menekan Simpan).
  form.appendChild(buildTargetField());
}

/**
 * Menerapkan target poin dari field pengaturan.
 * Bila nilai tidak valid (kosong, 0, negatif, desimal, NaN) atau di luar batas,
 * target TIDAK berubah dan pengguna diberi tahu lewat toast.
 * PENTING: hanya `state.target` yang diubah — skor, riwayat, dan milestone tetap.
 */
function applyTargetInput(input) {
  const value = parseTargetInput(input.value);
  if (value === null) {
    showToast('Target harus bilangan bulat positif (contoh: 1000).', 'error');
    try { input.focus(); } catch (err) {}
    if (input.select) input.select();
    return;
  }

  state.target = value;

  // Target baru bisa membuat skor yang SUDAH ada melewati target -> permainan
  // selesai saat itu juga (kondisi menang memakai target aktif).
  const hadWinner = !!state.winner;
  const winner = checkWinner(state);

  saveState();
  render();
  showToast('Target diubah menjadi ' + value + ' poin.');
  if (!hadWinner && winner) openWinnerModal();
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

/** Membuka layar Pengaturan dengan nilai terkini. */
function openSettings() {
  setActiveTab('settings');
}

/* ============================================================================
 * AKSI — RIWAYAT & PERMAINAN BARU
 * ==========================================================================*/

/** Membuka layar Riwayat lengkap. */
function openHistory() {
  setActiveTab('history');
}

/** Membuka layar Statistik (selalu dihitung dari riwayat terkini). */
function openStats() {
  setActiveTab('stats');
}

/* ============================================================================
 * NAVIGASI — BOTTOM NAVIGATION (TAB)
 * ----------------------------------------------------------------------------
 * Riwayat / Statistik / Pengaturan kini berupa LAYAR di dalam <main>, bukan
 * lagi bottom-sheet modal. Bottom navigation hanya mengganti layar yang tampil;
 * tidak ada logika permainan/skor yang disentuh.
 * ==========================================================================*/
const SCREEN_IDS = {
  main: 'screenMain',
  history: 'historyModal',
  stats: 'statsModal',
  settings: 'settingsModal'
};

/** Menampilkan satu layar dan menandai tab yang aktif. */
function setActiveTab(name) {
  if (!SCREEN_IDS[name]) name = 'main';

  const keys = Object.keys(SCREEN_IDS);
  for (let i = 0; i < keys.length; i++) {
    const el = document.getElementById(SCREEN_IDS[keys[i]]);
    if (el) el.hidden = keys[i] !== name;
  }

  const tabs = document.querySelectorAll('[data-tab]');
  for (let i = 0; i < tabs.length; i++) {
    const on = tabs[i].getAttribute('data-tab') === name;
    tabs[i].classList.toggle('is-active', on);
    if (on) tabs[i].setAttribute('aria-current', 'page');
    else tabs[i].removeAttribute('aria-current');
  }

  // Segarkan konten layar yang baru dibuka dari state terkini.
  if (name === 'history') renderFullHistory();
  else if (name === 'stats') renderStats();
  else if (name === 'settings') buildSettingsFields();
  else render();

  // Mulai dari atas layar saat berpindah tab.
  try { window.scrollTo(0, 0); } catch (err) { /* bukan hal kritis */ }
}

/** Kembali ke layar utama (tab "Main"). */
function openMain() {
  setActiveTab('main');
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
 * MENGAPA: hanya DATA PERMAINAN yang direset. Nama pemain DAN target poin
 * dipertahankan (target = pengaturan, bukan bagian dari permainan).
 */
function startNewGame() {
  confirmAction(
    'Mulai permainan baru?',
    'Skor, riwayat, dan urutan milestone permainan saat ini akan dihapus. Nama pemain dan target poin tetap dipertahankan.',
    'Ya, mulai baru',
    function () {
      const names = state.names.slice(); // pertahankan nama
      const target = targetOf(state);    // pertahankan target poin (bukan bagian "permainan")
      state = createDefaultState();
      state.names = names;
      state.target = target;
      clearPendingScores(); // buang skor sementara dari permainan sebelumnya
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

/** Klik pada backdrop modal (elemen dengan `data-close`).
 *  Hanya dialog konfirmasi yang masih memakai backdrop (Riwayat/Statistik/
 *  Pengaturan kini layar, bukan modal). */
function onDocumentClick(event) {
  const target = event.target;
  if (!target || typeof target.closest !== 'function') return;

  const closer = target.closest('[data-close]');
  if (!closer) return;

  if (closer.getAttribute('data-close') === 'confirmCancel') closeConfirm();
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

/* Bagian statistik pada gambar hasil (muncul hanya bila ada ronde tercatat). */
const IMG_STAT_ROW_H = 78;      // tinggi tiap baris statistik pemain (termasuk jarak)
const IMG_STAT_ROW_GAP = 12;    // jarak antar baris statistik
const IMG_STAT_LEAD_H = 72;     // tinggi kotak callout "Pengocok Handal"
const IMG_STAT_METRIC_W = 156;  // lebar tiap kolom metrik (NGOCOK/SHUTOUT)

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

/**
 * Menggambar logo "kartu Remi" (dua kartu bertumpuk + hati pink) — bentuk yang
 * SAMA PERSIS dengan ikon di header (svg viewBox "0 0 24 24") dan dengan favicon/
 * ikon PWA, supaya logo di layar dan di gambar PNG berbagi satu sumber desain.
 * `x`/`y` = sudut kiri-atas, `size` = panjang sisi kotak logo (px); koordinat
 * SVG 24x24 diskalakan ke dalam kotak tersebut.
 */
function drawBrandLogo(ctx, x, y, size) {
  const s = size / 24;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Kartu belakang (pink).
  ctx.fillStyle = IMG_COLORS.pink;
  drawRoundedRect(ctx, 8.4, 2.8, 11, 15.2, 2.2);
  ctx.fill();

  // Kartu depan (putih + garis hitam).
  ctx.fillStyle = IMG_COLORS.card;
  ctx.strokeStyle = IMG_COLORS.ink;
  ctx.lineWidth = 1.4;
  drawRoundedRect(ctx, 4.6, 5.2, 11, 15.2, 2.2);
  ctx.fill();
  ctx.stroke();

  // Hati: path persis sama dengan <path class="logo-heart"> di header.
  ctx.beginPath();
  ctx.moveTo(10.1, 16.2);
  ctx.bezierCurveTo(8.3, 14.9, 7.1, 13.8, 7.1, 12.2);
  ctx.bezierCurveTo(7.1, 11.1, 8, 10.2, 9.1, 10.2);
  ctx.bezierCurveTo(9.7, 10.2, 10.3, 10.5, 10.7, 11.1);
  ctx.bezierCurveTo(11.1, 10.5, 11.7, 10.2, 12.3, 10.2);
  ctx.bezierCurveTo(13.4, 10.2, 14.3, 11.1, 14.3, 12.2);
  ctx.bezierCurveTo(14.3, 13.8, 13.1, 14.9, 11.3, 16.2);
  ctx.lineTo(10.7, 16.6);
  ctx.closePath();
  ctx.fillStyle = IMG_COLORS.pink;
  ctx.fill();

  ctx.restore();
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
 * Komposisi: wordmark Remiku, tanggal, kotak pemenang, ranking, statistik
 * lengkap (pengocok handal + hitungan tiap pemain), lalu footer. Statistik
 * memakai `computePlayerStats(state.history)` yang SAMA dengan modal Hasil &
 * modal Statistik, sehingga angka di gambar tidak pernah berbeda dengan UI.
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

  // Statistik lengkap: dihitung dari riwayat yang SAMA seperti modal Hasil &
  // modal Statistik, sehingga gambar hasil tidak pernah berbeda dengan UI.
  const stats = computePlayerStats(state.history);
  const hasStats = stats.rounds > 0;
  const hasLeader = hasStats && stats.leaders.length > 0;

  const W = IMG_WIDTH;
  const cardX = IMG_MARGIN;
  const cardY = IMG_MARGIN;
  const cardW = W - IMG_MARGIN * 2;
  const contentX = cardX + IMG_PAD;
  const contentW = cardW - IMG_PAD * 2;
  const centerX = cardX + cardW / 2;

  // ---- Tata letak vertikal (semua dihitung, tidak ada koordinat rapuh) ----
  // Urutan atas meniru header & layar Hasil: logo kartu + wordmark "Remiku",
  // lalu baris "versi · kredit" di bawahnya, baru kicker "HASIL PERMAINAN".
  const brandY = cardY + IMG_PAD + 74;   // baseline wordmark "Remiku"
  const logoSize = 66;                   // tinggi logo kartu (px)
  const logoTop = brandY - 50;           // sejajar visual dengan wordmark
  const metaY = brandY + 40;             // baris "versi · kredit"
  const kickerY = metaY + 42;
  const dateY = kickerY + 44;
  const winnerBoxY = dateY + 40;
  const rankTitleY = winnerBoxY + IMG_BOX_H + 84;
  const rowsY = rankTitleY + 26;
  const rowsH = ranking.length * IMG_ROW_H +
    (ranking.length > 1 ? (ranking.length - 1) * IMG_ROW_GAP : 0);

  // ---- Bagian statistik lengkap (muncul HANYA bila ada ronde tercatat) ----
  const statOrder = hasStats ? orderPlayersByCount(stats.counts) : [];
  const statsTitleY = rowsY + rowsH + 78;
  const statsTopY = statsTitleY + 30;
  const statsLeadersH = hasLeader ? IMG_STAT_LEAD_H + 18 : 0;
  const statsRowsH = hasStats
    ? (PLAYER_COUNT * IMG_STAT_ROW_H + (PLAYER_COUNT - 1) * IMG_STAT_ROW_GAP)
    : 0;
  const statsH = statsLeadersH + statsRowsH;
  const statsEndY = statsTopY + statsH;

  const dividerY = hasStats ? (statsEndY + 58) : (rowsY + rowsH + 58);
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

  // ---- Logo kartu + wordmark "Remiku" (sama dengan header & layar Hasil) ----
  ctx.font = '900 72px ' + FONT_STACK;
  ctx.textAlign = 'left';
  const brandW1 = ctx.measureText(BRAND_A).width;
  const brandW2 = ctx.measureText(BRAND_B).width;
  const brandTextW = brandW1 + brandW2;
  const brandGap = 22;
  const brandGroupW = logoSize + brandGap + brandTextW;
  const brandLeft = centerX - brandGroupW / 2;

  drawBrandLogo(ctx, brandLeft, logoTop, logoSize);

  const brandX = brandLeft + logoSize + brandGap;
  ctx.fillStyle = IMG_COLORS.ink;
  ctx.fillText(BRAND_A, brandX, brandY);
  ctx.fillStyle = IMG_COLORS.pink;
  ctx.fillText(BRAND_B, brandX + brandW1, brandY);

  // ---- Baris versi & kredit, tepat di bawah logo (sama seperti header) -----
  ctx.textAlign = 'center';
  ctx.fillStyle = IMG_COLORS.muted;
  ctx.font = '800 21px ' + FONT_STACK;
  ctx.fillText(APP_VERSION + ' \u00b7 zkvoid', centerX, metaY);

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

  // ---- Statistik lengkap: pengocok handal + hitungan tiap pemain ----
  if (hasStats) {
    // Judul + garis aksen pink (sama gaya dengan judul "RANKING").
    ctx.textAlign = 'left';
    ctx.fillStyle = IMG_COLORS.ink;
    ctx.font = '900 26px ' + FONT_STACK;
    ctx.fillText('STATISTIK LENGKAP', contentX, statsTitleY);

    ctx.fillStyle = IMG_COLORS.pink;
    drawRoundedRect(ctx, contentX, statsTitleY + 12, 110, 6, 3);
    ctx.fill();

    let sy = statsTopY;

    // Callout "Pengocok Handal": pil gelap + nama & panjang rentetan ronde.
    if (hasLeader) {
      ctx.fillStyle = IMG_COLORS.pinkSoft;
      ctx.strokeStyle = IMG_COLORS.ink;
      ctx.lineWidth = 3;
      drawRoundedRect(ctx, contentX, sy, contentW, IMG_STAT_LEAD_H, 18);
      ctx.fill();
      ctx.stroke();

      const leadMidY = sy + IMG_STAT_LEAD_H / 2;

      ctx.font = '900 20px ' + FONT_STACK;
      const badgeText = '\uD83C\uDFC6 PENGOCOK HANDAL';
      const badgeW = ctx.measureText(badgeText).width + 36;
      const badgeH = 40;
      const badgeX = contentX + 18;
      ctx.fillStyle = IMG_COLORS.ink;
      drawRoundedRect(ctx, badgeX, leadMidY - badgeH / 2, badgeW, badgeH, badgeH / 2);
      ctx.fill();

      ctx.fillStyle = IMG_COLORS.card;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, badgeX + badgeW / 2, leadMidY + 1);

      const names = [];
      for (let n = 0; n < stats.leaders.length; n++) names.push(playerName(stats.leaders[n]));
      const leadNames = names.join(' & ') + ' \u00b7 ' + stats.streak + '\u00d7';
      const leadNameX = badgeX + badgeW + 18;
      const leadNameMaxW = contentX + contentW - 18 - leadNameX;

      ctx.font = '800 24px ' + FONT_STACK;
      ctx.fillStyle = IMG_COLORS.ink;
      ctx.textAlign = 'left';
      ctx.fillText(ellipsize(ctx, leadNames, leadNameMaxW, '800', 24), leadNameX, leadMidY + 1);

      ctx.textBaseline = 'alphabetic';
      sy += IMG_STAT_LEAD_H + 18;
    }

    // Baris tiap pemain: nama + metrik Ngocok / Shutout (dua kolom).
    const metricW = IMG_STAT_METRIC_W;
    const metricsW = metricW * 2;
    const statRowPadX = 22;
    const statRowInnerH = IMG_STAT_ROW_H - IMG_STAT_ROW_GAP;
    const statNameMaxW = contentW - statRowPadX * 2 - 46 - metricsW - 14;
    const metricsX = contentX + contentW - statRowPadX - metricsW;
    const metricLabels = ['NGOCOK', 'SHUTOUT'];

    for (let i = 0; i < statOrder.length; i++) {
      const item = statOrder[i];
      const isLeaderRow = stats.leaders.indexOf(item.index) !== -1;
      const ry = sy + i * IMG_STAT_ROW_H;
      const midY = ry + statRowInnerH / 2;

      ctx.fillStyle = isLeaderRow ? IMG_COLORS.pinkSoft : IMG_COLORS.pinkTint;
      ctx.strokeStyle = IMG_COLORS.ink;
      ctx.lineWidth = isLeaderRow ? 4 : 3;
      drawRoundedRect(ctx, contentX, ry, contentW, statRowInnerH, 16);
      ctx.fill();
      ctx.stroke();

      ctx.textBaseline = 'middle';

      // Peringkat "#n".
      ctx.textAlign = 'left';
      ctx.fillStyle = IMG_COLORS.ink;
      ctx.font = '900 24px ' + FONT_STACK;
      ctx.fillText('#' + (i + 1), contentX + statRowPadX, midY + 1);

      // Nama pemain (dipotong aman bila kepanjangan).
      const statNameX = contentX + statRowPadX + 46;
      ctx.font = '800 24px ' + FONT_STACK;
      ctx.fillText(
        ellipsize(ctx, playerName(item.index), statNameMaxW, '800', 24),
        statNameX, midY + 1
      );

      // Dua metrik rata kanan: nilai di atas, label kecil di bawah.
      const values = [item.count, stats.perfect[item.index]];
      for (let m = 0; m < metricLabels.length; m++) {
        const colCenter = metricsX + metricW * m + metricW / 2;
        ctx.textAlign = 'center';

        ctx.fillStyle = IMG_COLORS.ink;
        ctx.font = '900 28px ' + FONT_STACK;
        ctx.fillText(String(values[m]), colCenter, midY - 12);

        ctx.fillStyle = IMG_COLORS.muted;
        ctx.font = '700 14px ' + FONT_STACK;
        ctx.fillText(metricLabels[m], colCenter, midY + 20);
      }

      ctx.textBaseline = 'alphabetic';
    }

    ctx.textAlign = 'left';
  }

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
  els.changelogList = document.getElementById('changelogList');
  els.appVersion = document.getElementById('appVersion');
  els.historyFullList = document.getElementById('historyFullList');
  els.historyEmpty = document.getElementById('historyEmpty');
  els.historyModal = document.getElementById('historyModal');
  els.statsModal = document.getElementById('statsModal');
  els.statsList = document.getElementById('statsList');
  els.statsSummary = document.getElementById('statsSummary');
  els.statsLeaders = document.getElementById('statsLeaders');
  els.statsEmpty = document.getElementById('statsEmpty');
  els.settingsModal = document.getElementById('settingsModal');
  els.settingsForm = document.getElementById('settingsForm');
  els.winnerModal = document.getElementById('winnerModal');
  els.winnerVersion = document.getElementById('winnerVersion');
  els.winnerName = document.getElementById('winnerName');
  els.winnerScore = document.getElementById('winnerScore');
  els.rankingList = document.getElementById('rankingList');
  els.winnerHandalBox = document.getElementById('winnerHandalBox');
  els.winnerHandalName = document.getElementById('winnerHandalName');
  els.winnerHandalMeta = document.getElementById('winnerHandalMeta');
  els.confirmModal = document.getElementById('confirmModal');
  els.confirmTitle = document.getElementById('confirmTitle');
  els.confirmMessage = document.getElementById('confirmMessage');
  els.btnConfirmOk = document.getElementById('btnConfirmOk');
  els.toast = document.getElementById('toast');
  els.alertBanner = document.getElementById('alertBanner');
  els.btnWinner = document.getElementById('btnWinner');
  els.btnAddRound = document.getElementById('btnAddRound');
  els.year = document.getElementById('year');
  els.yearWinner = document.getElementById('yearWinner');
}

/** Memasang semua event listener. */
function bindEvents() {
  // Bottom navigation: setiap tab menampilkan layarnya masing-masing.
  const TAB_HANDLERS = {
    main: openMain,
    history: openHistory,
    stats: openStats,
    settings: openSettings
  };

  const tabs = document.querySelectorAll('[data-tab]');
  for (let i = 0; i < tabs.length; i++) {
    const handler = TAB_HANDLERS[tabs[i].getAttribute('data-tab')];
    if (handler) tabs[i].addEventListener('click', handler);
  }

  // "Semua" pada riwayat singkat (layar utama) -> buka layar Riwayat.
  const btnHistory = document.getElementById('btnHistory');
  if (btnHistory) btnHistory.addEventListener('click', openHistory);

  document.getElementById('btnClearHistory').addEventListener('click', clearHistoryAction);

  document.getElementById('btnNewGame').addEventListener('click', startNewGame);
  document.getElementById('btnNewGameWinner').addEventListener('click', startNewGame);

  // Tombol "Perbarui": mencatat SEMUA skor terisi sebagai satu ronde.
  document.getElementById('btnAddRound').addEventListener('click', commitRound);

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

  renderVersion();   // versi rilisan (satu sumber: APP_VERSION)
  render();
  renderChangelog(); // konten statis -> cukup sekali saat init
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
