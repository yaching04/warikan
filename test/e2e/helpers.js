// E2E の共通部品。puppeteer-core と Chrome を使う。
//   CHROME=/path/to/chrome  APPURL=http://127.0.0.1:8766/index.html
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const ROOT = path.join(__dirname, '..', '..');
const APPURL = process.env.APPURL || 'http://127.0.0.1:8766/index.html';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const SHOT_DIR = path.join(ROOT, 'screenshots', 'e2e');
fs.mkdirSync(SHOT_DIR, { recursive: true });
// テストの「今」。2026年11月15日 12:00 JST に固定する。
const NOW = Date.parse('2026-11-15T12:00:00+09:00');
// 例として使う名前（実在の人とは関係ない）
const NAMES = { yamada: 'たろう', kanojo: 'はなこ' };

// 版は package.json を正とする（app.js の APP_VERSION と sw.js のキャッシュ名は version.spec.js で照合）
const VERSION = require(path.join(ROOT, 'package.json')).version;
const VERSION_RE = new RegExp('v' + VERSION.replace(/\./g, '\\.'));
const CACHE_NAME = 'warikan-v' + VERSION.replace(/\./g, '');
// 共有まわりの E2E で使う Firebase エミュレータ（firebase.json と同じポート）
const EMU = {
  host: process.env.FIRESTORE_EMU_HOST || '127.0.0.1',
  firestorePort: Number(process.env.FIRESTORE_EMU_PORT || 8088),
  authPort: Number(process.env.AUTH_EMU_PORT || 9098),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* セレクタの要素を DOM の click で押す（固定のタブバーに隠れていても押せる） */
const tap = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error('missing ' + s); el.click(); }, sel);

/* rgb()/rgba() を #RRGGBB にする */
const hex = (c) => { const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase() : String(c); };

const { contrast } = require('./contrast');

/* 再読み込みせずにテーマを切り替える（index.html の先読みスクリプトと同じ処理） */
const setTheme = async (p, t) => {
  await p.evaluate((v) => {
    localStorage.setItem('warikan-theme', v);
    document.documentElement.setAttribute('data-theme', v);
    document.documentElement.style.colorScheme = v;
    const m = document.getElementById('themeColor');
    if (m) m.content = v === 'dark' ? '#1C1B1A' : '#FAF8F5';
  }, t);
};

function readSource(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function launch(opts) {
  return puppeteer.launch(Object.assign({
    executablePath: CHROME,
    args: ['--no-sandbox', '--font-render-hinting=none'],
    headless: 'new',
  }, opts || {}));
}

/* チェック結果を数えて、最後に終了コードを返す */
function reporter(title) {
  let fails = 0;
  let count = 0;
  if (title) console.log('# ' + title);
  function ck(name, cond, info) {
    count++;
    if (!cond) fails++;
    console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (cond || info === undefined ? '' : ' [' + info + ']'));
  }
  function done() {
    if (fails) { console.log(fails + '/' + count + ' failed'); process.exitCode = 1; }
    else console.log('all ' + count + ' passed');
    return fails;
  }
  return { ck, done, get fails() { return fails; }, get count() { return count; } };
}

/* 新しいブラウザコンテキストに、時刻固定・SW 無効・375px のページを開く */
async function openPage(browser, opts) {
  const o = Object.assign({ width: 375, height: 812, now: NOW, memorySync: false, theme: null }, opts || {});
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.evaluateOnNewDocument((now, mem) => {
    if (now != null) window.__warikanNow = now;
    if (mem) window.__warikanSyncBackend = 'memory';
  }, o.now, o.memorySync);
  await p.setBypassServiceWorker(true);
  await p.emulateTimezone('Asia/Tokyo');
  await p.setViewport({ width: o.width, height: o.height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  return { ctx, page: p, errs };
}

/*
 * 例データを localStorage に入れる。
 *  example: true のとき、9月・10月を精算済み、11月は一部未入力の状態にする。
 */
async function seedState(p, opts) {
  const o = Object.assign({ theme: 'light', example: false, names: NAMES, month: '2026-11' }, opts || {});
  await p.evaluate((o) => {
    localStorage.clear();
    localStorage.setItem('warikan-theme', o.theme);
    const S = window.WarikanStore;
    const L = window.WarikanLogic;
    const s = S.defaultState();
    s.people.yamada.name = o.names.yamada;
    s.people.kanojo.name = o.names.kanojo;
    if (!o.example) {
      S.ensureMonth(s, o.month);
      localStorage.setItem(S.KEY, JSON.stringify(s));
      return;
    }
    const amounts = {
      '2026-09': { 'item-kaimono': 42800, 'item-denki': 8120, 'item-gas': 4310, 'item-suidou': 3980, 'item-net': 5170 },
      '2026-10': { 'item-kaimono': 38650, 'item-denki': 7460, 'item-gas': 4720, 'item-suidou': 3980, 'item-net': 5170 },
      '2026-11': { 'item-kaimono': 21400, 'item-denki': 6890 },
    };
    S.withoutSync(() => {
      S.setOpening(s, 'yamada', 12000);
      for (const m of Object.keys(amounts)) {
        S.ensureMonth(s, m);
        for (const p of S.paymentsInMonth(s, m)) {
          if (amounts[m][p.itemId] != null) S.updatePayment(s, p.id, { amount: amounts[m][p.itemId] });
        }
      }
      S.addPayment(s, { month: '2026-11', itemName: '旅行', payerId: 'yamada', amount: 18000, extra: true });
      for (const m of ['2026-09', '2026-10']) {
        const live = L.computeSettle(S.paymentsInMonth(s, m), s.ratioYamada);
        S.settleMonth(s, m, Object.assign({}, live, { ratioYamada: s.ratioYamada, choice: 'settled', paid: 0, carried: live.amount }));
      }
      S.addRepayment(s, -30000, '2026-10');
    });
    localStorage.setItem(S.KEY, JSON.stringify(s));
  }, o);
}

module.exports = {
  ROOT, APPURL, CHROME, SHOT_DIR, NOW, NAMES, VERSION, VERSION_RE, CACHE_NAME, EMU,
  sleep, tap, hex, contrast, setTheme, readSource, launch, reporter, openPage, seedState,
};
