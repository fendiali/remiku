/* ============================================================================
 * Remiku — tests/dom.test.js
 * ----------------------------------------------------------------------------
 * Uji otomatis untuk LAPISAN DOM (render, aksi, modal, persistensi).
 *
 * Cara menjalankan:
 *   node tests/dom.test.js
 *
 * Mengapa tanpa dependency?
 *   Proyek ini sengaja bebas dependency (tools/make-icons.py pun menulis PNG
 *   sendiri tanpa Pillow). Karena itu uji DOM ini memakai DOM MINI yang ditulis
 *   tangan, bukan jsdom. DOM mini hanya mengimplementasikan bagian yang BENAR-
 *   BENAR dipakai js/app.js — itulah sebabnya berkas ini tetap ringkas.
 *
 * Yang diuji di sini adalah BERKAS ASLI:
 *   - index.html  -> diurai menjadi pohon DOM
 *   - js/app.js   -> dievaluasi apa adanya (bukan salinan)
 * Jadi bila render/aksi rusak, uji ini gagal.
 * ==========================================================================*/

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const APP_PATH = path.join(ROOT, 'js', 'app.js');
const HTML_PATH = path.join(ROOT, 'index.html');

/* ============================================================================
 * BAGIAN 1 — DOM MINI (tanpa dependency)
 * ==========================================================================*/

const VOID_TAGS = {
  area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1,
  link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1
};

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g;

/** "a b  c" -> ['a','b','c'] */
function splitClasses(value) {
  return String(value || '').split(/\s+/).filter(Boolean);
}

/** Mengubah `data-player-id` menjadi `playerId`. */
function toCamel(name) {
  return name.replace(/-([a-z0-9])/g, function (_, c) { return c.toUpperCase(); });
}

/** Mengubah `playerId` menjadi `player-id` (untuk pemantulan dataset -> atribut). */
function toDash(name) {
  return String(name).replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
}

function makeClassList(el) {
  return {
    contains: function (name) { return splitClasses(el.className).indexOf(name) !== -1; },
    add: function () {
      const list = splitClasses(el.className);
      for (let i = 0; i < arguments.length; i++) {
        const name = arguments[i];
        if (name && list.indexOf(name) === -1) list.push(name);
      }
      el.className = list.join(' ');
    },
    remove: function () {
      let list = splitClasses(el.className);
      for (let i = 0; i < arguments.length; i++) {
        const name = arguments[i];
        list = list.filter(function (x) { return x !== name; });
      }
      el.className = list.join(' ');
    },
    toggle: function (name, force) {
      const has = this.contains(name);
      const shouldHave = (force === undefined) ? !has : !!force;
      if (shouldHave) this.add(name); else this.remove(name);
      return shouldHave;
    }
  };
}

/* ------------------------------ TextNode --------------------------------- */

class TextNode {
  constructor(data) {
    this.nodeType = 3;
    this.data = String(data);
    this.parentNode = null;
    this.childNodes = [];
  }
  get textContent() { return this.data; }
  set textContent(value) { this.data = String(value); }
}

/* --------------------------- DocumentFragment ---------------------------- */

class DocumentFragment {
  constructor(ownerDocument) {
    this.nodeType = 11;
    this.ownerDocument = ownerDocument;
    this.childNodes = [];
    this.parentNode = null;
  }
  appendChild(node) {
    if (node && node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i !== -1) {
      this.childNodes.splice(i, 1);
      node.parentNode = null;
    }
    return node;
  }
  get textContent() {
    return this.childNodes.map(function (c) { return c.textContent; }).join('');
  }
}

/* ------------------------- Pencocokan selector --------------------------- */
/*
 * Hanya selector yang benar-benar dipakai js/app.js yang perlu didukung:
 *   'input' , 'button, [href], input, ...' , '.card[data-player="0"]' ,
 *   '[data-close]' , ':not([tabindex="-1"])'
 * Selector yang tidak dikenali mengembalikan false (gagal aman), bukan error.
 */

const COMPOUND_RE = /([a-zA-Z*][-\w]*)|\.([-\w]+)|#([-\w]+)|\[([-\w]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\]|:not\(([^)]*)\)/g;

function matchCompound(el, compound) {
  if (!el || el.nodeType !== 1) return false;

  COMPOUND_RE.lastIndex = 0;
  let consumed = 0;
  let m;

  while ((m = COMPOUND_RE.exec(compound)) !== null) {
    if (m.index !== consumed) return false; // ada sisa yang tak dipahami
    consumed = COMPOUND_RE.lastIndex;

    if (m[1]) {
      if (m[1] !== '*' && el.tagName !== m[1].toUpperCase()) return false;
    } else if (m[2]) {
      if (!el.classList.contains(m[2])) return false;
    } else if (m[3]) {
      if (el.id !== m[3]) return false;
    } else if (m[4]) {
      const name = m[4];
      const expected = (m[5] !== undefined) ? m[5] : ((m[6] !== undefined) ? m[6] : m[7]);
      const flag = (name === 'disabled') ? el.disabled : (name === 'hidden' ? el.hidden : undefined);
      const present = Object.prototype.hasOwnProperty.call(el.attributes, name) || flag === true;
      if (!present) return false;
      if (m[5] !== undefined && String(el.attributes[name]) !== expected) return false;
    } else if (m[8] !== undefined) {
      if (matchCompound(el, m[8].trim())) return false;
    }
  }

  return consumed === compound.length && consumed > 0;
}

function matches(el, selector) {
  if (!selector || !selector.trim()) return false;
  const groups = selector.split(',');
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i].trim();
    if (g && matchCompound(el, g)) return true;
  }
  return false;
}

function collect(el, selector, out) {
  const kids = el.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i];
    if (kid.nodeType !== 1) continue;
    if (matches(kid, selector)) out.push(kid);
    collect(kid, selector, out);
  }
  return out;
}

/* ------------------------------- Element --------------------------------- */

class Element {
  constructor(tagName, ownerDocument) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = {};
    // Di browser, `el.dataset.player = '0'` juga memasang atribut `data-player`.
    // app.js memakai `dataset` saat membuat kartu dan `[data-player="0"]` saat
    // mencarinya kembali -> keduanya harus terhubung.
    this.dataset = new Proxy({}, {
      get: function (target, prop) { return prop in target ? target[prop] : undefined; },
      set: function (target, prop, value) {
        const str = String(value);
        target[prop] = str;
        this.attributes['data-' + toDash(prop)] = str;
        return true;
      }.bind(this),
      has: function (target, prop) { return prop in target; }
    });
    this.style = {};
    this.className = '';
    this.classList = makeClassList(this);
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.offsetWidth = 0;
    this.remikuPreviousFocus = null;
    this._listeners = {};
  }

  /* ------------------------------- anak ------------------------------ */

  appendChild(node) {
    if (!node) return node;

    if (node.nodeType === 11) { // DocumentFragment -> pindahkan isinya
      const kids = node.childNodes.slice();
      for (let i = 0; i < kids.length; i++) this.appendChild(kids[i]);
      node.childNodes.length = 0;
      return node;
    }

    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i !== -1) {
      this.childNodes.splice(i, 1);
      node.parentNode = null;
    }
    return node;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  replaceChildren() {
    this.childNodes.length = 0;
    for (let i = 0; i < arguments.length; i++) this.appendChild(arguments[i]);
  }

  /* ---------------------------- atribut ------------------------------ */

  setAttribute(name, value) {
    const str = String(value);
    this.attributes[name] = str;

    if (name === 'id') {
      this.id = str;
      if (this.ownerDocument && this.ownerDocument.registerId) this.ownerDocument.registerId(str, this);
    } else if (name === 'class') {
      this.className = str;
    } else if (name === 'value') {
      this.value = str;
    } else if (name === 'hidden') {
      this.hidden = true;
    } else if (name === 'disabled') {
      this.disabled = true;
    } else if (name.indexOf('data-') === 0) {
      this.dataset[toCamel(name.slice(5))] = str;
    }
  }

  getAttribute(name) {
    if (name === 'hidden') return this.hidden ? '' : null;
    if (name === 'disabled') return this.disabled ? '' : null;
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
    if (name === 'class') this.className = '';
    else if (name === 'id') this.id = undefined;
    else if (name === 'hidden') this.hidden = false;
    else if (name === 'disabled') this.disabled = false;
  }

  /* ---------------------------- selector ----------------------------- */

  matches(selector) { return matches(this, selector); }

  closest(selector) {
    let node = this;
    while (node && node.nodeType === 1) {
      if (matches(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    const found = collect(this, selector, []);
    return found.length ? found[0] : null;
  }

  querySelectorAll(selector) {
    return collect(this, selector, []);
  }

  /* ------------------------------ event ------------------------------ */

  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }

  removeEventListener(type, fn) {
    const list = this._listeners[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i !== -1) list.splice(i, 1);
  }

  /* ------------------------------ fokus ------------------------------ */

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  blur() {
    if (this.ownerDocument && this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = null;
    }
  }

  click() {
    dispatchEvent(this.ownerDocument, this, { type: 'click' });
  }

  /* --------------------------- textContent --------------------------- */

  _text() {
    let out = '';
    for (let i = 0; i < this.childNodes.length; i++) {
      const child = this.childNodes[i];
      out += (child.nodeType === 3) ? child.data : child._text();
    }
    return out;
  }
}

// `textContent = ''` harus MENGOSONGKAN anak (dipakai app.js untuk clear lalu isi ulang).
Object.defineProperty(Element.prototype, 'textContent', {
  get: function () { return this._text(); },
  set: function (value) {
    this.childNodes.length = 0;
    if (value !== null && value !== undefined && String(value) !== '') {
      this.appendChild(this.ownerDocument.createTextNode(value));
    }
  }
});

/* --------------------- Penyebaran event (bubbling) ----------------------- */
/*
 * js/app.js menaruh listener `click` dan `keydown` di `document`, sedangkan
 * event-nya berasal dari elemen anak (mis. tombol, backdrop). Karena itu event
 * HARUS naik dari target ke document.
 */
function dispatchEvent(doc, target, event) {
  const ev = event || {};
  if (!ev.type) ev.type = 'click';

  if (typeof ev.preventDefault !== 'function') {
    ev.defaultPrevented = false;
    ev.preventDefault = function () { ev.defaultPrevented = true; };
    ev.stopPropagation = function () { ev._stopped = true; };
  }
  ev.target = target;

  const chain = [];
  let node = target;
  while (node) {
    chain.push(node);
    node = node.parentNode;
  }
  if (chain.indexOf(doc) === -1) chain.push(doc);
  if (doc.defaultView) chain.push(doc.defaultView);

  for (let i = 0; i < chain.length; i++) {
    const current = chain[i];
    ev.currentTarget = current;
    const list = current._listeners && current._listeners[ev.type];
    if (list && list.length) {
      const copy = list.slice();
      for (let j = 0; j < copy.length; j++) copy[j].call(current, ev);
    }
    if (ev._stopped) break;
  }

  return !ev.defaultPrevented;
}

/* ------------------------------- Document -------------------------------- */

function createDocument() {
  const doc = {
    nodeType: 9,
    readyState: 'loading',
    activeElement: null,
    defaultView: null,
    _byId: new Map(),
    _listeners: {},

    registerId: function (id, el) { doc._byId.set(id, el); },
    createElement: function (tag) { return new Element(tag, doc); },
    createTextNode: function (data) { return new TextNode(data); },
    createDocumentFragment: function () { return new DocumentFragment(doc); },
    getElementById: function (id) { return doc._byId.get(id) || null; },
    querySelector: function (sel) { return doc.documentElement.querySelector(sel); },
    querySelectorAll: function (sel) { return doc.documentElement.querySelectorAll(sel); },
    addEventListener: function (type, fn) {
      if (!doc._listeners[type]) doc._listeners[type] = [];
      doc._listeners[type].push(fn);
    },
    removeEventListener: function (type, fn) {
      const list = doc._listeners[type];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    },
    dispatchEvent: function (event) { return dispatchEvent(doc, doc, event); }
  };

  doc.documentElement = doc.createElement('html');
  doc.head = doc.createElement('head');
  doc.body = doc.createElement('body');
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);

  return doc;
}

/* -------------------------- Pengurai HTML mini --------------------------- */
/*
 * Cukup untuk index.html milik proyek ini: tag bersarang, komentar, atribut,
 * dan void element. `<script>` TIDAK dieksekusi (isinya kosong di sini).
 */
function parseHtml(html, doc) {
  const root = doc.documentElement;
  const stack = [root];
  let i = 0;

  function addText(text) {
    const trimmed = String(text).replace(/\s+/g, ' ').trim();
    if (!trimmed) return;
    stack[stack.length - 1].appendChild(doc.createTextNode(trimmed));
  }

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { addText(html.slice(i)); break; }
    if (lt > i) addText(html.slice(i, lt));

    if (html.substr(lt, 4) === '<!--') {
      const end = html.indexOf('-->', lt);
      i = (end === -1) ? html.length : end + 3;
      continue;
    }
    if (html.charAt(lt + 1) === '!' || html.charAt(lt + 1) === '?') {
      const end = html.indexOf('>', lt);
      i = (end === -1) ? html.length : end + 1;
      continue;
    }

    const gt = html.indexOf('>', lt);
    if (gt === -1) break;
    const raw = html.slice(lt + 1, gt);

    if (raw.charAt(0) === '/') {
      const name = raw.slice(1).trim().toUpperCase();
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tagName === name) { stack.length = s; break; }
      }
      i = gt + 1;
      continue;
    }

    const selfClosed = raw.charAt(raw.length - 1) === '/';
    const body = selfClosed ? raw.slice(0, -1) : raw;
    const nameMatch = /^([a-zA-Z][-a-zA-Z0-9]*)/.exec(body);
    if (!nameMatch) { i = gt + 1; continue; }

    const tag = nameMatch[1].toLowerCase();
    const el = doc.createElement(tag);

    ATTR_RE.lastIndex = 0;
    let am;
    const attrStr = body.slice(nameMatch[0].length);
    while ((am = ATTR_RE.exec(attrStr)) !== null) {
      const value = (am[2] !== undefined) ? am[2] : ((am[3] !== undefined) ? am[3] : am[4]);
      el.setAttribute(am[1], value === undefined ? '' : value);
    }

    stack[stack.length - 1].appendChild(el);
    if (!selfClosed && !VOID_TAGS[tag]) stack.push(el);

    i = gt + 1;
  }
}

/* ============================================================================
 * BAGIAN 2 — LINGKUNGAN UJI (clock virtual, localStorage, pemuat app.js)
 * ==========================================================================*/

/**
 * Jam virtual: waktu berjalan hanya saat `tick()` dipanggil.
 * MENGAPA: membuat uji deterministik & instan (timer 250 ms / 12 s tidak benar-
 * benar ditunggu), tanpa bergantung pada waktu nyata.
 */
function makeClock() {
  let now = 0;
  let seq = 0;
  const queue = [];

  function setTimeoutFn(fn, ms) {
    seq += 1;
    queue.push({ id: seq, seq: seq, at: now + (Number(ms) || 0), fn: fn });
    return seq;
  }

  function clearTimeoutFn(id) {
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].id === id) { queue.splice(i, 1); return; }
    }
  }

  function tick(ms) {
    const target = now + (Number(ms) || 0);
    for (;;) {
      let next = null;
      for (let i = 0; i < queue.length; i++) {
        const t = queue[i];
        if (t.at > target) continue;
        if (!next || t.at < next.at || (t.at === next.at && t.seq < next.seq)) next = t;
      }
      if (!next) break;
      queue.splice(queue.indexOf(next), 1);
      now = next.at;
      if (typeof next.fn === 'function') next.fn();
    }
    now = target;
  }

  return {
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    tick: tick,
    pendingCount: function () { return queue.length; },
    now: function () { return now; }
  };
}

/** localStorage dalam memori (juga bisa dipakai untuk mensimulasikan "refresh"). */
function makeStorage(seed) {
  const map = new Map();
  if (seed) {
    Object.keys(seed).forEach(function (k) { map.set(k, String(seed[k])); });
  }
  return {
    getItem: function (k) { return map.has(k) ? map.get(k) : null; },
    setItem: function (k, v) { map.set(k, String(v)); },
    removeItem: function (k) { map.delete(k); },
    clear: function () { map.clear(); },
    snapshot: function () {
      const out = {};
      map.forEach(function (v, k) { out[k] = v; });
      return out;
    }
  };
}

const SILENT_CONSOLE = { log: function () {}, info: function () {}, warn: function () {}, error: function () {} };

/**
 * Mengevaluasi js/app.js APA ADANYA di dalam `new Function`, dengan browser
 * globals disuntikkan sebagai parameter. Tidak ada bagian berkas yang disalin.
 */
function evalApp(bindings) {
  const source = fs.readFileSync(APP_PATH, 'utf8');

  const exportLine = '\nreturn {\n' +
    '  init: init,\n' +
    '  render: render,\n' +
    '  renderPlayers: renderPlayers,\n' +
    '  addScore: addScore,\n' +
    '  submitScoreInput: submitScoreInput,\n' +
    '  startNewGame: startNewGame,\n' +
    '  openSettings: openSettings,\n' +
    '  openHistory: openHistory,\n' +
    '  openWinnerModal: openWinnerModal,\n' +
    '  closeModal: closeModal,\n' +
    '  closeConfirm: closeConfirm,\n' +
    '  clearHistoryAction: clearHistoryAction,\n' +
    '  playerName: playerName,\n' +
    '  els: els,\n' +
    '  getState: function () { return state; }\n' +
    '};\n';

  const factory = new Function(
    'document', 'window', 'navigator', 'location', 'clearTimeout',
    source + exportLine
  );

  return factory(
    bindings.document,
    bindings.window,
    bindings.navigator,
    bindings.location,
    bindings.clearTimeout
  );
}

/**
 * Menyiapkan lingkungan lengkap: DOM dari index.html + app.js + jam virtual.
 * `readyState` default 'interactive' -> meniru perilaku nyata `<script defer>`
 * (defer dijalankan SETELAH parsing, SEBELUM DOMContentLoaded).
 */
function boot(options) {
  const opts = options || {};
  const clock = makeClock();
  const storage = makeStorage(opts.seed);

  const doc = createDocument();

  const win = {
    console: SILENT_CONSOLE,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    devicePixelRatio: 2,
    localStorage: storage,
    File: function File() {},
    _listeners: {},
    addEventListener: function (type, fn) {
      if (!win._listeners[type]) win._listeners[type] = [];
      win._listeners[type].push(fn);
    },
    removeEventListener: function () {}
  };
  doc.defaultView = win;

  parseHtml(fs.readFileSync(HTML_PATH, 'utf8'), doc);
  doc.readyState = opts.readyState || 'interactive';

  const api = evalApp({
    document: doc,
    window: win,
    navigator: {},
    location: { protocol: 'https:' },
    clearTimeout: clock.clearTimeout
  });

  if (doc.readyState === 'loading' && opts.autoInit !== false) {
    doc.dispatchEvent({ type: 'DOMContentLoaded' });
  }

  return {
    doc: doc,
    window: win,
    api: api,
    clock: clock,
    storage: storage,
    byId: function (id) { return doc.getElementById(id); },
    fireDomContentLoaded: function () { doc.dispatchEvent({ type: 'DOMContentLoaded' }); }
  };
}

/* ============================================================================
 * BAGIAN 3 — KERANGKA UJI (gaya sama dengan tests/logic.test.js)
 * ==========================================================================*/

let passed = 0;
const failures = [];
let currentGroup = '';

function group(title) {
  currentGroup = title;
  console.log('\n' + title);
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('  \u2713 ' + name);
  } catch (err) {
    failures.push({ group: currentGroup, name: name, error: err });
    console.log('  \u2717 ' + name);
    const detail = (err && err.message) ? err.message : String(err);
    String(detail).split('\n').slice(0, 8).forEach(function (line) {
      console.log('      ' + line);
    });
  }
}

/* ------------------------------- PEMBANTU -------------------------------- */

const YEAR = String(new Date().getFullYear());
const ARROW = '\u2192';

function cards(env) { return env.byId('players').querySelectorAll('.card'); }
function card(env, i) { return env.byId('players').querySelector('.card[data-player="' + i + '"]'); }
function scoreOf(env, i) { return card(env, i).querySelector('.card-score').textContent; }
function cardName(env, i) { return card(env, i).querySelector('.card-name').textContent; }
function quickBtns(env, i) { return card(env, i).querySelectorAll('.btn-quick'); }
function quickLabels(env, i) {
  return quickBtns(env, i).map(function (b) { return b.textContent; });
}
function stateOf(env) { return env.api.getState(); }
function saved(env) { return JSON.parse(env.storage.getItem('remiku_data_v1')); }

function click(env, el) {
  assert.ok(el, 'elemen yang akan diklik tidak ditemukan');
  dispatchEvent(env.doc, el, { type: 'click' });
}

function press(env, el, key) { dispatchEvent(env.doc, el, { type: 'keydown', key: key }); }
function esc(env) { env.doc.dispatchEvent({ type: 'keydown', key: 'Escape' }); }

function typeIn(env, el, value) {
  el.value = value;
  dispatchEvent(env.doc, el, { type: 'input' });
}

function recentItems(env) { return env.byId('recentList').querySelectorAll('.history-item'); }
function toastText(env) { return env.byId('toast').textContent; }

/* ============================================================================
 * BAGIAN 4 — PENGUJIAN
 * ==========================================================================*/

async function main() {

  /* ------------------------------------------------------------------------ */
  group('DOM 1 \u2014 Bootstrap: render 4 kartu pemain');

  await test('empat kartu pemain dirender dari index.html + app.js', function () {
    const env = boot();
    assert.strictEqual(cards(env).length, 4, 'jumlah kartu pemain');
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(cardName(env, i), 'Pemain ' + (i + 1), 'nama kartu ' + i);
      assert.strictEqual(scoreOf(env, i), '0', 'skor awal kartu ' + i);
    }
  });

  await test('setiap kartu punya tombol cepat -35, -40, +250, +300', function () {
    const env = boot();
    assert.deepStrictEqual(quickLabels(env, 0), ['-35', '-40', '+250', '+300']);
    assert.deepStrictEqual(quickLabels(env, 3), ['-35', '-40', '+250', '+300']);
    assert.deepStrictEqual(quickLabels(env, 0).indexOf('-50'), -1, 'preset lama sudah hilang');
    assert.deepStrictEqual(quickLabels(env, 0).indexOf('+100'), -1, 'preset lama sudah hilang');
  });

  await test('setiap kartu punya input skor dan tombol Tambah', function () {
    const env = boot();
    for (let i = 0; i < 4; i++) {
      const input = env.byId('score-input-' + i);
      assert.ok(input, 'input skor pemain ' + i + ' ada di DOM');
      assert.strictEqual(input.value, '', 'input skor awalnya kosong');
      assert.strictEqual(input.disabled, false, 'input aktif saat permainan berjalan');
      assert.ok(card(env, i).querySelector('.btn-add'), 'tombol Tambah pemain ' + i);
    }
  });

  await test('input angka dan tombol Tambah tersusun bertumpuk (input lebih dulu)', function () {
    const env = boot();
    const row = card(env, 0).querySelector('.input-row');
    assert.ok(row, 'wadah .input-row ada');
    const kids = row.childNodes.filter(function (n) { return n.nodeType === 1; });
    assert.strictEqual(kids.length, 2, '.input-row berisi input angka dan tombol saja');
    assert.strictEqual(kids[0], env.byId('score-input-0'), 'input angka tampil lebih dulu');
    assert.strictEqual(
      kids[1],
      row.querySelector('.btn-add'),
      'tombol Tambah tampil tepat setelah input (urutan tumpukan atas-bawah)'
    );
  });

  await test('progress bar menunjukkan 0% pada skor 0', function () {
    const env = boot();
    assert.strictEqual(card(env, 0).querySelector('.progress-fill').style.width, '0.0%');
    assert.strictEqual(card(env, 0).querySelector('.card-progress-label').textContent, '0 / 1000');
  });

  await test('tahun footer diisi dinamis di dua tempat', function () {
    const env = boot();
    assert.strictEqual(env.byId('year').textContent, YEAR);
    assert.strictEqual(env.byId('yearWinner').textContent, YEAR);
  });

  await test('riwayat kosong menampilkan catatan, bukan daftar kosong', function () {
    const env = boot();
    assert.strictEqual(recentItems(env).length, 0);
    assert.strictEqual(env.byId('recentEmpty').hidden, false, 'catatan "belum ada" terlihat');
    assert.strictEqual(env.byId('btnWinner').hidden, true, 'tombol Lihat Hasil belum muncul');
  });

  /* ------------------------------------------------------------------------ */
  group('DOM 2 \u2014 Tombol cepat');

  await test('tombol +250 menambah skor dan memperbarui progress bar', function () {
    const env = boot();
    click(env, quickBtns(env, 0)[2]); // +250

    assert.strictEqual(scoreOf(env, 0), '250');
    assert.strictEqual(card(env, 0).querySelector('.card-progress-label').textContent, '250 / 1000');
    assert.strictEqual(card(env, 0).querySelector('.progress-fill').style.width, '25.0%');
    assert.strictEqual(scoreOf(env, 1), '0', 'pemain lain tidak terpengaruh');
  });

  await test('skor negatif diberi kelas is-negative', function () {
    const env = boot();
    click(env, quickBtns(env, 2)[0]); // -35
    click(env, quickBtns(env, 2)[1]); // -40

    const scoreEl = card(env, 2).querySelector('.card-score');
    assert.strictEqual(scoreEl.textContent, '-75');
    assert.ok(scoreEl.classList.contains('is-negative'), 'kelas is-negative terpasang');
  });

  await test('QUICK SCORE \\u00a734: -35, -40, +250, +300 menghasilkan -35, -75, 175, 475', function () {
    const env = boot();

    click(env, quickBtns(env, 0)[0]); // -35
    assert.strictEqual(scoreOf(env, 0), '-35');
    click(env, quickBtns(env, 0)[1]); // -40
    assert.strictEqual(scoreOf(env, 0), '-75');
    click(env, quickBtns(env, 0)[2]); // +250
    assert.strictEqual(scoreOf(env, 0), '175');
    click(env, quickBtns(env, 0)[3]); // +300
    assert.strictEqual(scoreOf(env, 0), '475');

    assert.strictEqual(recentItems(env).length, 4, 'setiap klik masuk riwayat');
    assert.deepStrictEqual(saved(env).scores, [475, 0, 0, 0]);
  });

  await test('QUICK SCORE \\u00a734: milestone/overtake/reset berjalan lewat tombol cepat', function () {
    const env = boot();

    click(env, quickBtns(env, 0)[2]); // Pemain 1: +250 -> 250
    click(env, quickBtns(env, 0)[2]); // 500 (mencapai milestone lebih dulu)
    click(env, quickBtns(env, 0)[2]); // 750
    click(env, quickBtns(env, 1)[2]); // Pemain 2: +250 -> 250
    click(env, quickBtns(env, 1)[2]); // 500 (setelah Pemain 1)
    click(env, quickBtns(env, 1)[3]); // +300 -> 800, menyalip Pemain 1 di 750

    assert.strictEqual(scoreOf(env, 0), '0', 'Pemain 1 direset karena disalip');
    assert.strictEqual(scoreOf(env, 1), '800', 'Pemain 2 tetap naik ke 800');
    assert.strictEqual(env.byId('alertBanner').hidden, false, 'banner RESET tampil');
    assert.strictEqual(stateOf(env).reach['750'][0], 0, 'urutan pencapaian milestone tetap terjaga');
    assert.ok(saved(env).history.length >= 6, 'riwayat mencatat seluruh aksi');
  });

  await test('riwayat terbaru terisi dan catatan kosong disembunyikan', function () {
    const env = boot();
    click(env, quickBtns(env, 0)[2]); // +250

    const items = recentItems(env);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].querySelector('.h-name').textContent, 'Pemain 1');
    assert.strictEqual(items[0].querySelector('.h-delta').textContent, '+250');
    assert.strictEqual(items[0].querySelector('.h-transition').textContent, 'Skor: 0 ' + ARROW + ' 250');
    assert.strictEqual(env.byId('recentEmpty').hidden, true);
  });

  await test('perubahan langsung tersimpan ke localStorage', function () {
    const env = boot();
    click(env, quickBtns(env, 1)[2]); // +250 untuk Pemain 2

    const json = saved(env);
    assert.ok(json, 'remiku_data_v1 tersimpan');
    assert.deepStrictEqual(json.scores, [0, 250, 0, 0]);
    assert.strictEqual(json.history.length, 1);
  });

  /* ------------------------------------------------------------------------ */
  group('DOM 3 \u2014 Input manual');

  await test('input tidak valid memunculkan toast dan tidak mengubah skor', function () {
    const env = boot();
    typeIn(env, env.byId('score-input-0'), 'abc');
    click(env, card(env, 0).querySelector('.btn-add'));

    assert.strictEqual(scoreOf(env, 0), '0', 'skor tetap 0');
    assert.strictEqual(env.byId('toast').hidden, false, 'toast tampil');
    assert.ok(toastText(env).indexOf('bilangan bulat') !== -1,
      'toast memberi contoh input, dapat: "' + toastText(env) + '"');
  });

  await test('input valid menambah skor lewat tombol Tambah', function () {
    const env = boot();
    typeIn(env, env.byId('score-input-0'), '75');
    click(env, card(env, 0).querySelector('.btn-add'));

    assert.strictEqual(scoreOf(env, 0), '75');
    assert.strictEqual(stateOf(env).scores[0], 75);
  });

  await test('tombol Enter mengirim nilai input', function () {
    const env = boot();
    const input = env.byId('score-input-1');
    input.value = '+25';
    press(env, input, 'Enter');

    assert.strictEqual(scoreOf(env, 1), '25');
    assert.strictEqual(env.byId('score-input-1').value, '',
      'input baru hasil render ulang dalam keadaan kosong');
  });

  await test('input desimal ditolak', function () {
    const env = boot();
    typeIn(env, env.byId('score-input-2'), '5.5');
    click(env, card(env, 2).querySelector('.btn-add'));

    assert.strictEqual(scoreOf(env, 2), '0');
    assert.strictEqual(env.byId('toast').hidden, false);
  });

  /* ------------------------------------------------------------------------ */
  group('DOM 4 \u2014 Aturan reset terlihat di layar');

  await test('banner RESET muncul dengan penjelasan lengkap', function () {
    const env = boot();
    env.api.addScore(0, 800, false);
    env.api.addScore(1, 801, false); // Pemain 2 menyalip Pemain 1

    const banner = env.byId('alertBanner');
    assert.strictEqual(banner.hidden, false, 'banner terlihat');
    assert.ok(banner.textContent.indexOf('PEMAIN 1 RESET') !== -1,
      'judul banner, dapat: "' + banner.textContent + '"');
    assert.ok(banner.textContent.indexOf('Pemain 2 menyalip Pemain 1.') !== -1);
    assert.ok(banner.textContent.indexOf('Pemain 1: 800 ' + ARROW + ' 0') !== -1);
  });

  await test('skor pemilik milestone menjadi 0 di kartu', function () {
    const env = boot();
    env.api.addScore(0, 800, false);
    env.api.addScore(1, 801, false);

    assert.strictEqual(scoreOf(env, 0), '0', 'pemilik milestone direset');
    assert.strictEqual(scoreOf(env, 1), '801', 'penyalip mempertahankan skornya');
    assert.ok(card(env, 0).classList.contains('just-reset'), 'kartu direset diberi kelas kedip');
  });

  await test('seri tidak memicu RESET (hanya penyalipan ketat)', function () {
    const env = boot();
    env.api.addScore(0, 800, false);
    env.api.addScore(1, 800, false); // seri, bukan menyalip

    assert.strictEqual(env.byId('alertBanner').hidden, true, 'tanpa banner');
    assert.strictEqual(scoreOf(env, 0), '800', 'Pemain 1 tidak direset');
  });

  await test('riwayat menampilkan baris reset', function () {
    const env = boot();
    env.api.addScore(0, 800, false);
    env.api.addScore(1, 801, false);

    const note = recentItems(env)[0].querySelector('.history-reset');
    assert.ok(note, 'baris reset ada di entri riwayat terbaru');
    assert.strictEqual(note.textContent,
      'Pemain 1 disalip Pemain 2 \u00b7 Skor 800 ' + ARROW + ' 0');
  });

  await test('banner RESET hilang otomatis setelah 12 detik', function () {
    const env = boot();
    env.api.addScore(0, 800, false);
    env.api.addScore(1, 801, false);
    assert.strictEqual(env.byId('alertBanner').hidden, false);

    env.clock.tick(11999);
    assert.strictEqual(env.byId('alertBanner').hidden, false, 'belum 12 detik');

    env.clock.tick(2);
    assert.strictEqual(env.byId('alertBanner').hidden, true, 'sudah lewat 12 detik');
  });

  /* ------------------------------------------------------------------------ */
  group('DOM 5 \u2014 Kemenangan & kunci input');

  await test('modal hasil terbuka otomatis dengan pemenang yang benar', function () {
    const env = boot();
    env.api.addScore(0, 999, false);
    assert.strictEqual(env.byId('winnerModal').hidden, true, 'belum mencapai target: tertutup');

    env.api.addScore(0, 1, false); // tepat 1000
    assert.strictEqual(env.byId('winnerModal').hidden, false, 'modal hasil terbuka');
    assert.strictEqual(env.byId('winnerName').textContent, 'Pemain 1');
    assert.strictEqual(env.byId('winnerScore').textContent, '1000 poin');
  });

  await test('ranking menampilkan 4 pemain terurut dengan posisi "#n"', function () {
    const env = boot();
    env.api.addScore(0, 300, false);
    env.api.addScore(1, -50, false);  // skor negatif untuk menguji penandanya
    env.api.addScore(3, 1000, false);

    const items = env.byId('rankingList').querySelectorAll('.ranking-item');
    assert.strictEqual(items.length, 4, 'semua pemain masuk ranking');
    assert.strictEqual(items[0].querySelector('.ranking-name').textContent, 'Pemain 4');
    assert.strictEqual(items[0].querySelector('.ranking-score').textContent, '1000');
    assert.strictEqual(items[0].querySelector('.ranking-pos').textContent, '#1');
    assert.strictEqual(items[1].querySelector('.ranking-name').textContent, 'Pemain 1');
    assert.strictEqual(items[1].querySelector('.ranking-pos').textContent, '#2');
    assert.strictEqual(items[3].querySelector('.ranking-pos').textContent, '#4');
  });

  await test('skor negatif di ranking diberi kelas is-negative', function () {
    const env = boot();
    env.api.addScore(0, 300, false);
    env.api.addScore(2, -75, false);
    env.api.addScore(3, 1000, false);

    const items = env.byId('rankingList').querySelectorAll('.ranking-item');
    const negScore = items[3].querySelector('.ranking-score');
    assert.strictEqual(negScore.textContent, '-75', 'skor minus ada di posisi terakhir');
    assert.ok(negScore.classList.contains('is-negative'), 'kelas is-negative terpasang');

    const positive = items[0].querySelector('.ranking-score');
    assert.ok(!positive.classList.contains('is-negative'), 'skor positif tanpa kelas');
  });

  await test('kartu pemenang memakai badge teks PEMENANG, lainnya menampilkan peringkat', function () {
    const env = boot();
    env.api.addScore(0, 300, false);
    env.api.addScore(3, 1000, false);

    const badge = card(env, 3).querySelector('.badge-winner');
    assert.ok(badge, 'badge pemenang ada di kartu Pemain 4');
    assert.strictEqual(badge.textContent, 'PEMENANG');
    assert.strictEqual(card(env, 3).classList.contains('is-winner'), true, 'kartu pemenang ditandai');

    assert.strictEqual(card(env, 3).querySelector('.card-rank'), null, 'peringkat diganti badge');
    assert.strictEqual(card(env, 0).querySelector('.card-rank').textContent, '#2', 'Pemain 1 peringkat #2');
    assert.strictEqual(card(env, 1).querySelector('.card-rank').textContent, '#3', 'Pemain 2 (0 poin) lebih dulu dari Pemain 3');
  });

  await test('SEMUA input skor dinonaktifkan setelah menang', function () {
    const env = boot();
    env.api.addScore(0, 1000, false);

    const inputs = env.byId('players').querySelectorAll('input');
    assert.strictEqual(inputs.length, 4);
    inputs.forEach(function (input) {
      assert.strictEqual(input.disabled, true, 'input ' + input.id + ' harus terkunci');
    });
  });

  await test('tombol cepat dan tombol Tambah ikut dinonaktifkan', function () {
    const env = boot();
    env.api.addScore(0, 1000, false);

    const quick = env.byId('players').querySelectorAll('.btn-quick');
    assert.strictEqual(quick.length, 16);
    quick.forEach(function (b) { assert.strictEqual(b.disabled, true, 'tombol cepat terkunci'); });

    const addBtns = env.byId('players').querySelectorAll('.btn-add');
    assert.strictEqual(addBtns.length, 4);
    addBtns.forEach(function (b) { assert.strictEqual(b.disabled, true, 'tombol Tambah terkunci'); });
  });

  await test('percobaan menambah skor setelah menang tidak mengubah apa pun', function () {
    const env = boot();
    env.api.addScore(0, 1000, false);
    const before = JSON.stringify(saved(env));

    // Event tetap dipaksa terkirim (mis. lewat DevTools): logika tetap menolak.
    click(env, quickBtns(env, 0)[1]);
    env.api.addScore(1, 500, false);

    assert.strictEqual(scoreOf(env, 0), '1000', 'skor pemenang tetap');
    assert.strictEqual(scoreOf(env, 1), '0', 'pemain lain tidak bisa menambah skor');
    assert.strictEqual(JSON.stringify(saved(env)), before, 'state tersimpan tidak berubah');
  });

  await test('tombol "Lihat Hasil" muncul setelah permainan selesai', function () {
    const env = boot();
    assert.strictEqual(env.byId('btnWinner').hidden, true);
    env.api.addScore(0, 1000, false);
    assert.strictEqual(env.byId('btnWinner').hidden, false);
  });

  /* ------------------------------------------------------------------------ */
  group('DOM 6 \u2014 Persistensi setelah refresh');

  await test('skor dan riwayat dipulihkan setelah halaman dimuat ulang', function () {
    const first = boot();
    first.api.addScore(0, 450, false);
    first.api.addScore(2, 120, false);

    const second = boot({ seed: first.storage.snapshot() });
    assert.strictEqual(scoreOf(second, 0), '450');
    assert.strictEqual(scoreOf(second, 2), '120');
    assert.strictEqual(second.byId('recentList').querySelectorAll('.history-item').length, 2);
  });

  await test('layar hasil terbuka kembali bila permainan sudah selesai', function () {
    const first = boot();
    first.api.addScore(3, 1000, false);
    assert.strictEqual(first.byId('winnerModal').hidden, false);

    const second = boot({ seed: first.storage.snapshot() });
    assert.strictEqual(second.byId('winnerModal').hidden, true, 'dibuka tertunda 250 ms');
    second.clock.tick(300);
    assert.strictEqual(second.byId('winnerModal').hidden, false, 'terbuka otomatis');
    assert.strictEqual(second.byId('winnerName').textContent, 'Pemain 4');
  });

  await test('input tetap terkunci setelah refresh', function () {
    const first = boot();
    first.api.addScore(1, 1000, false);

    const second = boot({ seed: first.storage.snapshot() });
    second.byId('players').querySelectorAll('input').forEach(function (input) {
      assert.strictEqual(input.disabled, true, 'input ' + input.id + ' tetap terkunci');
    });
    assert.strictEqual(second.byId('btnWinner').hidden, false, 'tombol Lihat Hasil tersedia');
  });

  await test('localStorage rusak tidak merusak aplikasi', function () {
    const env = boot({ seed: { remiku_data_v1: '{{{ bukan json' } });
    assert.strictEqual(cards(env).length, 4, 'tetap merender 4 kartu');
    assert.strictEqual(scoreOf(env, 0), '0');
  });

  /* ------------------------------------------------------------------------ */
  group('DOM 7 \u2014 Permainan Baru');

  await test('permainan baru meminta konfirmasi lebih dulu', function () {
    const env = boot();
    click(env, env.byId('btnNewGame'));

    assert.strictEqual(env.byId('confirmModal').hidden, false, 'dialog konfirmasi tampil');
    assert.strictEqual(env.byId('confirmTitle').textContent, 'Mulai permainan baru?');
    assert.strictEqual(env.byId('btnConfirmOk').textContent, 'Ya, mulai baru');
  });

  await test('batal tidak mengubah apa pun', function () {
    const env = boot();
    env.api.addScore(0, 400, false);
    const before = JSON.stringify(saved(env));

    click(env, env.byId('btnNewGame'));
    click(env, env.byId('btnConfirmCancel'));

    assert.strictEqual(env.byId('confirmModal').hidden, true);
    assert.strictEqual(scoreOf(env, 0), '400');
    assert.strictEqual(JSON.stringify(saved(env)), before);
  });

  await test('konfirmasi mengosongkan skor & riwayat tetapi mempertahankan nama', function () {
    const env = boot();
    click(env, env.byId('btnSettings'));
    typeIn(env, env.byId('name-input-0'), 'Andi');
    click(env, env.byId('btnCloseSettings'));

    env.api.addScore(0, 400, false);
    env.api.addScore(1, 250, false);

    click(env, env.byId('btnNewGame'));
    click(env, env.byId('btnConfirmOk'));

    assert.strictEqual(cardName(env, 0), 'Andi', 'nama dipertahankan');
    assert.deepStrictEqual(stateOf(env).scores, [0, 0, 0, 0], 'semua skor direset');
    assert.strictEqual(recentItems(env).length, 0, 'riwayat dikosongkan');
    assert.strictEqual(env.byId('recentEmpty').hidden, false);
    assert.strictEqual(env.byId('confirmModal').hidden, true, 'dialog tertutup');
    assert.strictEqual(stateOf(env).gameActive, true, 'permainan aktif kembali');
  });

  await test('permainan baru menutup modal hasil dan membuka kunci input', function () {
    const env = boot();
    env.api.addScore(0, 1000, false);
    assert.strictEqual(env.byId('winnerModal').hidden, false);

    click(env, env.byId('btnNewGameWinner'));
    click(env, env.byId('btnConfirmOk'));

    assert.strictEqual(env.byId('winnerModal').hidden, true, 'modal hasil tertutup');
    assert.strictEqual(env.byId('btnWinner').hidden, true, 'tombol Lihat Hasil disembunyikan');
    assert.strictEqual(env.byId('players').querySelectorAll('input')[0].disabled, false,
      'input terbuka lagi');
    assert.strictEqual(scoreOf(env, 0), '0');
  });

  /* ------------------------------------------------------------------------ */
  group('DOM 8 \u2014 Nama pemain');

  await test('modal pengaturan memuat 4 field nama terkini', function () {
    const env = boot();
    click(env, env.byId('btnSettings'));

    assert.strictEqual(env.byId('settingsModal').hidden, false);
    for (let i = 0; i < 4; i++) {
      const field = env.byId('name-input-' + i);
      assert.ok(field, 'field nama ' + i + ' ada');
      assert.strictEqual(field.value, 'Pemain ' + (i + 1));
    }
  });

  await test('mengubah nama langsung memperbarui kartu dan tersimpan', function () {
    const env = boot();
    click(env, env.byId('btnSettings'));
    typeIn(env, env.byId('name-input-2'), 'Budi');

    assert.strictEqual(cardName(env, 2), 'Budi', 'kartu langsung diperbarui');
    assert.deepStrictEqual(saved(env).names, ['Pemain 1', 'Pemain 2', 'Budi', 'Pemain 4']);
  });

  await test('mengubah nama TIDAK mengubah skor maupun riwayat', function () {
    const env = boot();
    env.api.addScore(0, 150, false);
    click(env, env.byId('btnSettings'));
    typeIn(env, env.byId('name-input-0'), 'Andi');

    assert.strictEqual(scoreOf(env, 0), '150', 'skor tidak tersentuh');
    assert.strictEqual(stateOf(env).history.length, 1, 'riwayat tidak tersentuh');
  });

  await test('nama kosong kembali ke default', function () {
    const env = boot();
    click(env, env.byId('btnSettings'));
    typeIn(env, env.byId('name-input-1'), 'X');
    assert.strictEqual(cardName(env, 1), 'X');

    typeIn(env, env.byId('name-input-1'), '   ');
    assert.strictEqual(cardName(env, 1), 'Pemain 2', 'kembali ke default');
  });

  await test('Escape menutup modal pengaturan', function () {
    const env = boot();
    click(env, env.byId('btnSettings'));
    assert.strictEqual(env.byId('settingsModal').hidden, false);

    esc(env);
    assert.strictEqual(env.byId('settingsModal').hidden, true);
  });

  /* ------------------------------------------------------------------------ */
  group('DOM 9 \u2014 Modal & papan ketik');

  await test('riwayat lengkap terisi saat modal dibuka', function () {
    const env = boot();
    for (let i = 0; i < 8; i++) env.api.addScore(0, 10, false);

    click(env, env.byId('btnHistory'));
    assert.strictEqual(env.byId('historyModal').hidden, false);
    assert.strictEqual(env.byId('historyFullList').querySelectorAll('.history-item').length, 8,
      'riwayat lengkap memuat SEMUA entri (bukan hanya 6 terbaru)');
    assert.strictEqual(env.byId('historyEmpty').hidden, true);
  });

  await test('Escape hanya menutup modal paling atas', function () {
    const env = boot();
    env.api.addScore(0, 10, false);

    click(env, env.byId('btnHistory'));
    click(env, env.byId('btnClearHistory'));
    assert.strictEqual(env.byId('confirmModal').hidden, false, 'konfirmasi di atas riwayat');

    esc(env);
    assert.strictEqual(env.byId('confirmModal').hidden, true, 'konfirmasi tertutup');
    assert.strictEqual(env.byId('historyModal').hidden, false, 'riwayat MASIH terbuka');

    esc(env);
    assert.strictEqual(env.byId('historyModal').hidden, true, 'riwayat tertutup');
  });

  await test('klik backdrop menutup modal', function () {
    const env = boot();
    click(env, env.byId('btnSettings'));
    click(env, env.byId('settingsModal').querySelector('.modal-backdrop'));
    assert.strictEqual(env.byId('settingsModal').hidden, true);
  });

  await test('klik di dalam kartu modal tidak menutupnya', function () {
    const env = boot();
    click(env, env.byId('btnSettings'));
    click(env, env.byId('settingsModal').querySelector('.modal-card'));
    assert.strictEqual(env.byId('settingsModal').hidden, false, 'modal tetap terbuka');
  });

  await test('body mendapat kelas modal-open selama modal terbuka', function () {
    const env = boot();
    assert.strictEqual(env.doc.body.classList.contains('modal-open'), false);

    click(env, env.byId('btnSettings'));
    assert.ok(env.doc.body.classList.contains('modal-open'), 'kelas terpasang');

    esc(env);
    assert.strictEqual(env.doc.body.classList.contains('modal-open'), false, 'kelas dilepas');
  });

  /* ------------------------------------------------------------------------ */
  group('DOM 10 \u2014 Hapus riwayat');

  await test('hapus riwayat tidak menghapus skor', function () {
    const env = boot();
    env.api.addScore(0, 500, false);
    env.api.addScore(1, 200, false);

    click(env, env.byId('btnHistory'));
    click(env, env.byId('btnClearHistory'));
    assert.strictEqual(env.byId('confirmTitle').textContent, 'Hapus riwayat?');
    click(env, env.byId('btnConfirmOk'));

    assert.strictEqual(stateOf(env).history.length, 0, 'riwayat kosong');
    assert.deepStrictEqual(stateOf(env).scores, [500, 200, 0, 0], 'skor tetap utuh');
    assert.strictEqual(scoreOf(env, 0), '500');
    assert.strictEqual(env.byId('recentEmpty').hidden, false, 'catatan kosong muncul lagi');
  });

  /* ------------------------------------------------------------------------ */
  group('DOM 11 \u2014 Jalur bootstrap cadangan');

  await test('readyState "loading" menunda init sampai DOMContentLoaded', function () {
    const env = boot({ readyState: 'loading', autoInit: false });
    assert.strictEqual(cards(env).length, 0, 'belum dirender sebelum DOMContentLoaded');

    env.fireDomContentLoaded();
    assert.strictEqual(cards(env).length, 4, 'dirender setelah DOMContentLoaded');
    assert.strictEqual(env.byId('year').textContent, YEAR);
  });

  await test('readyState "complete" langsung menjalankan init', function () {
    const env = boot({ readyState: 'complete' });
    assert.strictEqual(cards(env).length, 4);
  });

  /* ========================================================================== */
  /* RINGKASAN & EXIT CODE                                                      */
  /* ========================================================================== */

  console.log('\n' + '-'.repeat(64));

  if (failures.length === 0) {
    console.log('SEMUA LULUS \u2014 ' + passed + ' pengujian DOM berhasil.');
    process.exit(0);
  }

  console.log('GAGAL \u2014 ' + failures.length + ' dari ' + (passed + failures.length) + ' pengujian gagal:');
  failures.forEach(function (f) {
    const detail = f.error && f.error.stack ? f.error.stack.split('\n').slice(0, 2).join(' ') : String(f.error);
    console.log('  \u2022 [' + f.group + '] ' + f.name);
    console.log('      ' + detail);
  });
  process.exit(1);
}

main();
