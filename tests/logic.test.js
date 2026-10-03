/* ============================================================================
 * Remiku — tests/logic.test.js
 * ----------------------------------------------------------------------------
 * Uji otomatis untuk LOGIKA PERMAINAN (tanpa DOM / browser).
 *
 * Cara menjalankan:
 *   node tests/logic.test.js
 *
 * Mengapa bisa diuji tanpa browser?
 *   Seluruh logika inti berada di dalam blok `/* === LOGIC-START === *\/` ...
 *   `/* === LOGIC-END === *\/` pada js/app.js. Blok tersebut sengaja tidak
 *   menyentuh DOM maupun localStorage, sehingga dapat diekstrak dan dijalankan
 *   di dalam `vm` milik Node.js. Dengan cara ini, uji selalu memakai KODE ASLI
 *   yang dipakai aplikasi (bukan salinan) -> tidak bisa "diam-diam" menyimpang.
 *
 * Tanpa dependency eksternal: hanya `fs`, `path`, `vm`, dan `assert` (bawaan Node).
 * ==========================================================================*/

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const APP_PATH = path.join(__dirname, '..', 'js', 'app.js');
const START_MARKER = '/* === LOGIC-START === */';
const END_MARKER = '/* === LOGIC-END === */';

/**
 * Mengekstrak blok logika dari js/app.js lalu mengevaluasinya di konteks vm.
 * Mengembalikan objek berisi konstanta & fungsi logika (nama sama seperti asli).
 */
function loadLogic() {
  const source = fs.readFileSync(APP_PATH, 'utf8');

  const start = source.indexOf(START_MARKER);
  const end = source.indexOf(END_MARKER);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Blok LOGIC-START / LOGIC-END tidak ditemukan di js/app.js');
  }

  const block = source.slice(start + START_MARKER.length, end);

  // PENTING: blok dijalankan di REALM YANG SAMA dengan Node (vm.runInThisContext).
  // Bila memakai realm baru (vm.createContext), array/objek hasil logika akan
  // memakai prototype realm tersebut sehingga assert.deepStrictEqual gagal
  // walau isinya identik ("same structure but not reference-equal").
  // Pembungkus IIFE menjaga agar nama-nama di blok logika tidak bocor ke global.
  const exportLine = `
return {
  TARGET_SCORE: TARGET_SCORE,
  MILESTONE_START: MILESTONE_START,
  MILESTONE_END: MILESTONE_END,
  PLAYER_COUNT: PLAYER_COUNT,
  HISTORY_LIMIT: HISTORY_LIMIT,
  NAME_MAX: NAME_MAX,
  MAX_ABS_INPUT: MAX_ABS_INPUT,
  DEFAULT_NAMES: DEFAULT_NAMES,
  createDefaultState: createDefaultState,
  registerMilestones: registerMilestones,
  detectOvertakenPlayers: detectOvertakenPlayers,
  milestoneOwner: milestoneOwner,
  determineResets: determineResets,
  checkWinner: checkWinner,
  computeRanking: computeRanking,
  applyScoreChange: applyScoreChange,
  parseScoreInput: parseScoreInput,
  normalizeNumberText: normalizeNumberText,
  base64ToBytes: base64ToBytes
};
`;

  const factory = vm.runInThisContext(
    '(function () {\n' + block + '\n' + exportLine + '\n})',
    { filename: 'remiku-logic-block.js' }
  );

  return factory();
}

const L = loadLogic();

/* ------------------------------- KERANGKA UJI ----------------------------- */

let passed = 0;
const failures = [];
let currentGroup = '';

function group(title) {
  currentGroup = title;
  console.log('\n' + title);
}

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  \u2713 ' + name);
  } catch (err) {
    failures.push({ group: currentGroup, name: name, error: err });
    console.log('  \u2717 ' + name);
    console.log('      ' + (err && err.message ? err.message : String(err)));
  }
}

/* --------------------------------- HELPERS -------------------------------- */

/** State baru yang bersih. */
function newState() {
  return L.createDefaultState();
}

/** Menambahkan skor dan memastikan aksi diterima. */
function add(state, player, amount) {
  const result = L.applyScoreChange(state, player, amount);
  assert.strictEqual(result.ok, true, 'aksi seharusnya diterima, alasan: ' + result.reason);
  return result;
}

/** Pemain-pemain yang direset pada aksi terakhir. */
function resetPlayers(result) {
  return result.resets.map(function (r) { return r.player; });
}

/* ========================================================================== */
/* KASUS UJI                                                                  */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
group('TEST 1 \u2014 State awal');

test('terdiri dari 4 pemain dengan skor 0', function () {
  const s = newState();
  assert.strictEqual(s.scores.length, 4);
  assert.deepStrictEqual(s.scores, [0, 0, 0, 0]);
  assert.strictEqual(L.PLAYER_COUNT, 4);
});

test('urutan milestone (reach) kosong dan belum ada pemenang', function () {
  const s = newState();
  assert.deepStrictEqual(s.reach, {});
  assert.strictEqual(s.winner, null);
  assert.strictEqual(s.gameActive, true);
});

test('memiliki nama default untuk setiap pemain', function () {
  const s = newState();
  assert.deepStrictEqual(s.names, ['Pemain 1', 'Pemain 2', 'Pemain 3', 'Pemain 4']);
});

test('konstanta sesuai spec: target 1000, milestone 500-999', function () {
  assert.strictEqual(L.TARGET_SCORE, 1000);
  assert.strictEqual(L.MILESTONE_START, 500);
  assert.strictEqual(L.MILESTONE_END, 999);
});

/* -------------------------------------------------------------------------- */
group('TEST 2 \u2014 Perubahan skor dasar');

test('+50 menaikkan skor pemain yang dipilih saja', function () {
  const s = newState();
  add(s, 1, 50);
  assert.deepStrictEqual(s.scores, [0, 50, 0, 0]);
});

test('-50 menurunkan skor (skor boleh negatif)', function () {
  const s = newState();
  add(s, 2, -50);
  assert.deepStrictEqual(s.scores, [0, 0, -50, 0]);
  add(s, 2, -100);
  assert.strictEqual(s.scores[2], -150);
});

test('riwayat mencatat pemain, delta, skor awal dan skor akhir', function () {
  const s = newState();
  add(s, 3, 100);
  assert.strictEqual(s.history.length, 1);

  const e = s.history[0];
  assert.strictEqual(e.player, 3);
  assert.strictEqual(e.delta, 100);
  assert.strictEqual(e.from, 0);
  assert.strictEqual(e.to, 100);
  assert.deepStrictEqual(e.resets, []);
});

/* -------------------------------------------------------------------------- */
group('TEST 3 \u2014 Validasi input (parseScoreInput)');

test('menerima bilangan bulat dengan/tanpa tanda dan spasi di tepi', function () {
  assert.strictEqual(L.parseScoreInput('50'), 50);
  assert.strictEqual(L.parseScoreInput('+50'), 50);
  assert.strictEqual(L.parseScoreInput('-50'), -50);
  assert.strictEqual(L.parseScoreInput('  100  '), 100);
  assert.strictEqual(L.parseScoreInput('-100'), -100);
});

test('menolak input kosong, spasi, huruf, dan desimal', function () {
  assert.strictEqual(L.parseScoreInput(''), null);
  assert.strictEqual(L.parseScoreInput('   '), null);
  assert.strictEqual(L.parseScoreInput('abc'), null);
  assert.strictEqual(L.parseScoreInput('5a'), null);
  assert.strictEqual(L.parseScoreInput('1.5'), null);
  assert.strictEqual(L.parseScoreInput('1,5'), null);
  assert.strictEqual(L.parseScoreInput('50%'), null);
});

test('menolak 0 (bukan perubahan bermakna) dan nilai non-string', function () {
  assert.strictEqual(L.parseScoreInput('0'), null);
  assert.strictEqual(L.parseScoreInput('+0'), null);
  assert.strictEqual(L.parseScoreInput(50), null);
  assert.strictEqual(L.parseScoreInput(null), null);
  assert.strictEqual(L.parseScoreInput(undefined), null);
});

test('menolak nilai di luar batas wajar', function () {
  assert.strictEqual(L.parseScoreInput(String(L.MAX_ABS_INPUT + 1)), null);
  assert.strictEqual(L.parseScoreInput(String(-(L.MAX_ABS_INPUT + 1))), null);
  assert.strictEqual(L.parseScoreInput(String(L.MAX_ABS_INPUT)), L.MAX_ABS_INPUT);
});

/* Bug yang diperbaiki: keyboard ponsel/autokoreksi/hasil salin-tempel mengirim
   minus Unicode, sehingga "-25" terlihat benar di layar tapi DITOLAK. */

test('menerima semua varian tanda minus yang terlihat seperti "-25"', function () {
  [
    '-25',        // ASCII (keyboard biasa)
    '\u221225',   // U+2212 minus matematis (keyboard iOS/Android)
    '\u201325',   // U+2013 en dash (autokoreksi)
    '\u201425',   // U+2014 em dash
    '\u201025',   // U+2010 hyphen
    '\u201125',   // U+2011 non-breaking hyphen
    '\u201225',   // U+2012 figure dash
    '\u201525',   // U+2015 horizontal bar
    '\u204325',   // U+2043 hyphen bullet
    '\ufe6325',   // U+FE63 small hyphen-minus
    '\uff0d25',   // U+FF0D fullwidth hyphen-minus
    '- 25',       // spasi setelah tanda
    '\u00a0-\u00a025',  // NBSP di kiri & kanan tanda
    '\u200b-25',  // zero-width space
    '\u202f- 25'  // narrow NBSP + spasi
  ].forEach(function (raw) {
    assert.strictEqual(L.parseScoreInput(raw), -25, 'harus -25: ' + JSON.stringify(raw));
  });
});

test('menerima angka fullwidth dan varian tanda plus', function () {
  assert.strictEqual(L.parseScoreInput('\uff12\uff15'), 25);      // "２５"
  assert.strictEqual(L.parseScoreInput('\uff0b25'), 25);          // "＋25"
  assert.strictEqual(L.parseScoreInput('\ufe6225'), 25);          // "﹢25"
  assert.strictEqual(L.parseScoreInput('\u279525'), 25);          // "➕25"
  assert.strictEqual(L.parseScoreInput('\uff0d\uff12\uff15'), -25); // "－２５"
});

test('normalisasi TIDAK membuat input tidak valid menjadi diterima', function () {
  ['\u2212', '-', '+', '\u22122.5', '2,5', '--25', '+-25', '25-', 'a25', '2 5a',
   'NaN', 'Infinity', '\u2212\u221225'].forEach(function (raw) {
    assert.strictEqual(L.parseScoreInput(raw), null, 'harus ditolak: ' + JSON.stringify(raw));
  });
});

test('normalizeNumberText hanya merapikan bentuk, bukan mengubah tanda', function () {
  assert.strictEqual(L.normalizeNumberText('\u2212 25'), '-25');
  assert.strictEqual(L.normalizeNumberText('  +50 '), '+50');
  assert.strictEqual(L.normalizeNumberText('\uff12\uff15'), '25');
  assert.strictEqual(L.normalizeNumberText('\u00a0-25\u200b'), '-25');
  assert.strictEqual(L.normalizeNumberText(50), '', 'non-string dianggap kosong');
  assert.strictEqual(L.normalizeNumberText(null), '', 'null dianggap kosong');
});

/* -------------------------------------------------------------------------- */
group('TEST 4 \u2014 Penolakan perubahan skor tidak valid');

test('amount 0 / desimal / bukan angka ditolak dengan alasan bad-amount', function () {
  const s = newState();
  ['0', 1.5, NaN, Infinity, null, 'abc'].forEach(function (bad) {
    const r = L.applyScoreChange(s, 0, bad);
    assert.strictEqual(r.ok, false, 'nilai ' + String(bad) + ' seharusnya ditolak');
    assert.strictEqual(r.reason, 'bad-amount');
  });
});

test('index pemain di luar rentang ditolak dengan alasan bad-player', function () {
  const s = newState();
  [-1, 4, 99, 1.5].forEach(function (bad) {
    const r = L.applyScoreChange(s, bad, 50);
    assert.strictEqual(r.ok, false, 'index ' + String(bad) + ' seharusnya ditolak');
    assert.strictEqual(r.reason, 'bad-player');
  });
});

test('skor dan riwayat tidak berubah saat input ditolak', function () {
  const s = newState();
  L.applyScoreChange(s, 0, 0);
  L.applyScoreChange(s, 9, 50);
  assert.deepStrictEqual(s.scores, [0, 0, 0, 0]);
  assert.strictEqual(s.history.length, 0);
});

/* -------------------------------------------------------------------------- */
group('TEST 5 \u2014 Pencatatan milestone & urutan pencapaian');

test('pemain pertama yang mencapai 500 menjadi pemilik milestone 500', function () {
  const s = newState();
  add(s, 0, 500);
  assert.deepStrictEqual(s.reach['500'], [0]);
  assert.strictEqual(L.milestoneOwner(s, 500), 0);
});

test('pemain berikutnya dicatat SETELAH pemilik, bukan menggantikannya', function () {
  const s = newState();
  add(s, 0, 500);
  add(s, 1, 500);
  assert.deepStrictEqual(s.reach['500'], [0, 1]);
  assert.strictEqual(L.milestoneOwner(s, 500), 0, 'pemilik milestone tetap pemain pertama');
});

test('satu kenaikan besar mencatat seluruh milestone yang dilewati', function () {
  const s = newState();
  add(s, 3, 600);
  for (let m = 500; m <= 600; m++) {
    assert.deepStrictEqual(s.reach[String(m)], [3], 'milestone ' + m + ' harus tercatat');
  }
  assert.strictEqual(s.reach['499'], undefined, 'milestone < 500 tidak boleh tercatat');
  assert.strictEqual(s.reach['601'], undefined, 'milestone > skor tidak boleh tercatat');
});

test('milestone tidak dicatat ulang saat skor turun lalu naik kembali', function () {
  const s = newState();
  add(s, 0, 500);
  add(s, 0, -500);            // kembali ke 0
  add(s, 0, 500);             // naik lagi
  assert.deepStrictEqual(s.reach['500'], [0], 'index pemain tidak boleh terduplikasi');
});

/* -------------------------------------------------------------------------- */
group('TEST 6 \u2014 Seri (tie) bukan penyalipan');

test('mencapai skor yang sama persis tidak memicu reset', function () {
  const s = newState();
  add(s, 0, 800);             // P0 mencapai 800 lebih dulu
  const r = add(s, 1, 800);   // P1 menyamakan skor

  assert.deepStrictEqual(r.resets, []);
  assert.deepStrictEqual(s.scores, [800, 800, 0, 0]);
  assert.strictEqual(L.milestoneOwner(s, 800), 0);
});

test('aturan penyalipan: skor harus BENAR-BENAR melewati (bukan menyamai)', function () {
  const s = newState();
  s.scores = [800, 700, 0, 0];

  assert.deepStrictEqual(L.detectOvertakenPlayers(s, 1, 700, 800), [], 'tie bukan penyalipan');
  assert.deepStrictEqual(L.detectOvertakenPlayers(s, 1, 700, 801), [0], '801 melewati 800');
  assert.deepStrictEqual(L.detectOvertakenPlayers(s, 1, 700, 799), [], 'belum melewati');
});

/* -------------------------------------------------------------------------- */
group('TEST 7 \u2014 RESET saat menyalip pemilik milestone');

test('pemilik milestone direset ke 0 ketika disalip', function () {
  const s = newState();
  add(s, 0, 800);             // P0 = 800 (pemilik milestone 800)
  add(s, 1, 800);             // P1 = 800 (seri, tanpa reset)
  const r = add(s, 1, 1);     // P1 = 801 -> menyalip P0

  assert.deepStrictEqual(s.scores, [0, 801, 0, 0]);
  assert.deepStrictEqual(resetPlayers(r), [0]);
  assert.strictEqual(r.resets[0].from, 800);
  assert.strictEqual(r.resets[0].to, 0);
  assert.strictEqual(r.resets[0].by, 1);
  assert.strictEqual(r.resets[0].milestone, 800);
});

test('riwayat mencatat peristiwa reset pada aksi yang sama', function () {
  const s = newState();
  add(s, 0, 800);
  add(s, 1, 800);
  add(s, 1, 1);

  const last = s.history[s.history.length - 1];
  assert.strictEqual(last.player, 1);
  assert.strictEqual(last.delta, 1);
  assert.strictEqual(last.resets.length, 1);
  assert.strictEqual(last.resets[0].player, 0);
});

test('reach tetap utuh sesudah pemilik milestone direset', function () {
  const s = newState();
  add(s, 0, 800);
  add(s, 1, 800);
  add(s, 1, 1);

  assert.strictEqual(s.scores[0], 0);
  assert.deepStrictEqual(s.reach['800'], [0, 1], 'sejarah pencapaian harus tetap utuh');
  assert.strictEqual(L.milestoneOwner(s, 800), 0);
});

/* -------------------------------------------------------------------------- */
group('TEST 8 \u2014 Pemain yang datang BELAKANGAN tidak direset');

test('hanya pemilik milestone yang direset, pengejar tidak', function () {
  const s = newState();
  add(s, 0, 600);             // P0 = 600 -> pemilik milestone 500..600
  add(s, 1, 500);             // P1 = 500 -> BUKAN pemilik milestone 500
  const r = add(s, 2, 501);   // P2 = 501 -> menyalip P1

  assert.strictEqual(L.milestoneOwner(s, 500), 0);
  assert.deepStrictEqual(r.resets, [], 'P1 bukan pemilik milestone 500 -> tanpa reset');
  assert.deepStrictEqual(s.scores, [600, 500, 501, 0]);
});

test('beberapa pemain dapat direset dalam satu aksi, masing-masing sekali', function () {
  const s = newState();
  // Kondisi dibuat langsung: dua pemain berbeda sama-sama pemilik milestone
  // sebesar skor mereka saat ini. (Kondisi ini jarang, tetapi mungkin terjadi
  // setelah pemulihan data, sehingga kontrak fungsinya tetap harus diuji.)
  s.scores = [700, 500, 600, 0];
  s.reach = { '500': [1], '600': [2] };

  assert.deepStrictEqual(L.determineResets(s, [1, 2]), [1, 2], 'dua pemain berbeda boleh direset');
  assert.deepStrictEqual(L.determineResets(s, [1, 1, 2]), [1, 2], 'pemain yang sama tidak direset dua kali');
  assert.deepStrictEqual(L.determineResets(s, [3]), [], 'skor 0 di luar rentang milestone');
});

test('kasus nyata: pengejar tidak direset, pemilik milestone direset', function () {
  const s = newState();
  add(s, 0, 600);             // P0 = 600 -> pemilik milestone 500..600
  add(s, 1, 600);             // P1 = 600 -> seri, tetap BUKAN pemilik
  add(s, 0, 200);             // P0 = 800 -> menyalip P1 (600)

  assert.strictEqual(s.scores[1], 600, 'P1 bukan pemilik milestone 600 -> tidak direset');
  assert.strictEqual(L.milestoneOwner(s, 600), 0);

  const r = add(s, 1, 300);   // P1 = 900 -> menyalip P0 (800) yang MEMANG pemiliknya
  assert.deepStrictEqual(resetPlayers(r), [0]);
  assert.deepStrictEqual(s.scores, [0, 900, 0, 0]);
});

/* -------------------------------------------------------------------------- */
group('TEST 9 \u2014 Batas rentang milestone (500-999)');

test('skor di bawah 500 tidak pernah memicu reset', function () {
  const s = newState();
  add(s, 0, 300);
  const r = add(s, 1, 350);   // menyalip P0, tetapi 300 < 500

  assert.deepStrictEqual(r.resets, []);
  assert.deepStrictEqual(s.scores, [300, 350, 0, 0]);
});

test('batas tepat: 499 tidak memicu reset, 500 memicu reset', function () {
  const bawah = newState();
  add(bawah, 0, 499);
  assert.deepStrictEqual(add(bawah, 1, 500).resets, [], 'milestone 499 di luar rentang');

  const batas = newState();
  add(batas, 0, 500);
  const r = add(batas, 1, 501);   // menyalip pemilik milestone 500
  assert.deepStrictEqual(resetPlayers(r), [0]);
  assert.strictEqual(batas.scores[0], 0);
});

/* -------------------------------------------------------------------------- */
group('TEST 10 \u2014 Target 1000 poin & akhir permainan');

test('mencapai 1000 poin memenangkan permainan', function () {
  const s = newState();
  const r = add(s, 2, 1000);

  assert.strictEqual(r.winner.player, 2);
  assert.strictEqual(r.winner.score, 1000);
  assert.strictEqual(s.winner.player, 2);
  assert.strictEqual(s.gameActive, false);
});

test('999 poin belum menang, 1000 poin menang', function () {
  const s = newState();
  add(s, 0, 999);
  assert.strictEqual(s.winner, null, '999 belum memenuhi target');

  const r = add(s, 0, 1);
  assert.strictEqual(r.winner.player, 0);
  assert.strictEqual(s.winner.score, 1000);
});

test('perubahan skor ditolak setelah permainan selesai (game-over)', function () {
  const s = newState();
  add(s, 1, 1000);

  const r = L.applyScoreChange(s, 0, 50);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'game-over');
  assert.deepStrictEqual(s.scores, [0, 1000, 0, 0], 'skor tidak boleh berubah setelah menang');
});

test('deteksi pemenang memakai skor tertinggi (bukan skor terakhir diubah)', function () {
  const s = newState();
  s.scores = [1050, 900, 0, 0];
  const w = L.checkWinner(s);

  assert.strictEqual(w.player, 0);
  assert.strictEqual(w.score, 1050);
  assert.strictEqual(s.gameActive, false);
});

test('pemenang yang sudah tercatat tidak diganti oleh pemanggilan berikutnya', function () {
  const s = newState();
  add(s, 3, 1000);

  const lagi = L.checkWinner(s);
  assert.strictEqual(lagi.player, 3);
  assert.strictEqual(s.winner.player, 3);
});

/* -------------------------------------------------------------------------- */
group('TEST 11 \u2014 Ranking & tie-breaker');

test('ranking diurutkan dari skor tertinggi ke terendah', function () {
  const s = newState();
  s.scores = [100, 900, 400, 650];
  const r = L.computeRanking(s);

  assert.deepStrictEqual(r.map(function (x) { return x.score; }), [900, 650, 400, 100]);
  assert.deepStrictEqual(r.map(function (x) { return x.index; }), [1, 3, 2, 0]);
});

test('tie-breaker memakai index pemain menaik (deterministik)', function () {
  const s = newState();
  s.scores = [600, 600, 100, 0];
  const r = L.computeRanking(s);

  assert.deepStrictEqual(r.map(function (x) { return x.index; }), [0, 1, 2, 3]);
});

test('ranking menyertakan nama pemain terkini', function () {
  const s = newState();
  s.names[0] = 'Andi';
  s.scores = [10, 20, 30, 40];
  const r = L.computeRanking(s);

  assert.strictEqual(r[0].name, 'Pemain 4');
  assert.strictEqual(r[3].name, 'Andi');
});

/* -------------------------------------------------------------------------- */
group('TEST 12 \u2014 Riwayat permainan');

test('riwayat menyimpan setiap perubahan secara berurutan (terbaru di akhir)', function () {
  const s = newState();
  add(s, 0, 50);
  add(s, 1, 100);
  add(s, 2, -20);

  assert.strictEqual(s.history.length, 3);
  assert.deepStrictEqual(
    s.history.map(function (e) { return e.player; }),
    [0, 1, 2]
  );
  assert.deepStrictEqual(
    s.history.map(function (e) { return e.delta; }),
    [50, 100, -20]
  );
});

test('peristiwa reset tersimpan di dalam entri riwayat yang menyebabkannya', function () {
  const s = newState();
  add(s, 0, 500);
  add(s, 1, 501);

  assert.strictEqual(s.history[0].resets.length, 0, 'kenaikan tanpa penyalipan: tanpa reset');
  assert.strictEqual(s.history[1].resets.length, 1, 'aksi penyalipan: satu reset');
  assert.strictEqual(s.history[1].resets[0].player, 0);
});

test('riwayat dibatasi HISTORY_LIMIT entri agar localStorage tetap ringan', function () {
  const s = newState();
  const total = L.HISTORY_LIMIT + 25;

  for (let i = 0; i < total; i++) L.applyScoreChange(s, 0, 1);

  assert.strictEqual(s.history.length, L.HISTORY_LIMIT);
  assert.strictEqual(s.scores[0], total, 'skor tetap terakumulasi penuh');
});

/* -------------------------------------------------------------------------- */
group('TEST 13 \u2014 Dekoder base64 (jalur Simpan Hasil)');

test('base64ToBytes mendekode data dengan/tanpa padding', function () {
  assert.deepStrictEqual(Array.from(L.base64ToBytes('UmVtaWt1')), [0x52, 0x65, 0x6d, 0x69, 0x6b, 0x75]);
  assert.deepStrictEqual(Array.from(L.base64ToBytes('TWE=')), [0x4d, 0x61]);
  assert.deepStrictEqual(Array.from(L.base64ToBytes('TQ==')), [0x4d]);
  assert.deepStrictEqual(Array.from(L.base64ToBytes('AQID')), [1, 2, 3]);
  assert.deepStrictEqual(Array.from(L.base64ToBytes('')), [], 'teks kosong -> byte kosong');
  assert.deepStrictEqual(Array.from(L.base64ToBytes('UmVt\naWt1')), [0x52, 0x65, 0x6d, 0x69, 0x6b, 0x75],
    'baris baru diabaikan');
});

test('hasil base64ToBytes sama dengan Buffer bawaan Node (termasuk header PNG)', function () {
  [
    'UmVtaWt1',
    'TQ==',
    'AQIDBAUGBwgJCg==',
    'iVBORw0KGgo=',                       // 8 byte pertama berkas PNG
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
  ].forEach(function (b64) {
    const expected = Array.from(Buffer.from(b64, 'base64'));
    assert.deepStrictEqual(Array.from(L.base64ToBytes(b64)), expected, 'sampel ' + b64.slice(0, 16) + '...');
  });
});

test('base64ToBytes menolak teks yang bukan base64', function () {
  ['!!!!', 'UmV=A', '====', '=', null, undefined, 42, {}, []].forEach(function (bad) {
    assert.strictEqual(L.base64ToBytes(bad), null, 'harus null: ' + JSON.stringify(bad));
  });
  assert.strictEqual(L.base64ToBytes('A'), null, '1 karakter mustahil untuk base64');
});

/* ========================================================================== */
/* RINGKASAN & EXIT CODE                                                      */
/* ========================================================================== */

console.log('\n' + '-'.repeat(64));

if (failures.length === 0) {
  console.log('SEMUA LULUS \u2014 ' + passed + ' pengujian berhasil.');
  process.exit(0);
}

console.log('GAGAL \u2014 ' + failures.length + ' dari ' + (passed + failures.length) + ' pengujian gagal:');
failures.forEach(function (f) {
  const detail = f.error && f.error.stack ? f.error.stack.split('\n').slice(0, 2).join(' ') : String(f.error);
  console.log('  \u2022 [' + f.group + '] ' + f.name);
  console.log('      ' + detail);
});
process.exit(1);





