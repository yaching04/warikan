// E2E: キーボードで入力と保存が可視、印の色、主色、プレースホルダ、残り0の注記
const path = require('path');
const { SHOT_DIR, sleep, setTheme, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;


const AMOUNTS = {
  'item-yachin': 60000,
  'item-kaimono': 30000,
  'item-denki': 4000,
  'item-gas': 3000,
  'item-suidou': 3000,
  'item-net': 4000,
};

const VV_HOOK = `(() => {
  const orig = window.visualViewport;
  const listeners = { resize: [], scroll: [] };
  const baseH = () => (orig && orig.height) || window.innerHeight;
  const baseW = () => (orig && orig.width) || window.innerWidth;
  window.__vvState = { height: baseH(), offsetTop: 0, width: baseW(), mocked: false };
  const fake = {
    get width() { return window.__vvState.width; },
    get height() { return window.__vvState.height; },
    get offsetTop() { return window.__vvState.offsetTop; },
    get offsetLeft() { return 0; },
    get scale() { return 1; },
    get pageTop() { return window.scrollY || 0; },
    get pageLeft() { return 0; },
    addEventListener(type, fn) { if (listeners[type]) listeners[type].push(fn); },
    removeEventListener(type, fn) { if (listeners[type]) listeners[type] = listeners[type].filter((x) => x !== fn); },
    dispatchEvent() { return true; },
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, get() { return fake; } });
  window.__setKb = (visibleH, offsetTop) => {
    window.__vvState.height = visibleH;
    window.__vvState.offsetTop = offsetTop || 0;
    window.__vvState.width = window.innerWidth;
    window.__vvState.mocked = true;
    (listeners.resize || []).slice().forEach((fn) => { try { fn(); } catch (e) {} });
  };
  window.__resetKb = () => {
    window.__vvState.height = window.innerHeight;
    window.__vvState.offsetTop = 0;
    window.__vvState.width = window.innerWidth;
    window.__vvState.mocked = false;
    (listeners.resize || []).slice().forEach((fn) => { try { fn(); } catch (e) {} });
    window.dispatchEvent(new Event('resize'));
  };
})();`;

const hex = (c) => {
  const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return String(c).toUpperCase();
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
};

(async () => {
  const b = await launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setBypassServiceWorker(true);
  await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument(VV_HOOK);
  await p.evaluateOnNewDocument(() => { window.__warikanNow = Date.parse('2026-11-15T12:00:00+09:00'); window.__warikanSettleDelay = 20000; });
  await p.evaluateOnNewDocument(() => {
    window.__warikanShareCalls = [];
    try {
      navigator.canShare = function (d) { return !!(d && d.files && d.files.length); };
      navigator.share = function (d) {
        window.__warikanShareCalls.push(d);
        return Promise.resolve();
      };
    } catch (e) {}
  });
  await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate(() => localStorage.clear());
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await sleep(200);

  const gap = await p.evaluate(() => {
    const fill = document.querySelector('[data-act=fill-missing]');
    const settle = document.querySelector('[data-act=settle]');
    if (!fill || !settle) return null;
    return Math.round(settle.getBoundingClientRect().top - fill.getBoundingClientRect().bottom);
  });
  ck('未入力と精算するの間隔は 8px', gap === 8, 'gap=' + gap);

  const pri = await p.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const btn = document.querySelector('[data-act=fill-missing]');
    const tab = document.querySelector('.tabs button.on');
    const bar = document.querySelector('.settle-bar > span');
    const dots = [...document.querySelectorAll('.prow .dot')].map((el) => getComputedStyle(el).backgroundColor);
    return {
      pri: root.getPropertyValue('--pri').trim().toUpperCase(),
      teal: root.getPropertyValue('--teal').trim().toUpperCase(),
      btn: getComputedStyle(btn).backgroundColor,
      tab: getComputedStyle(tab).color,
      bar: bar && getComputedStyle(bar).backgroundColor,
      yamadaDot: dots[1] || dots[0], // 電気 is yamada if present; 家賃 is kanojo first
    };
  });
  ck('ライトの --pri は #0F766E', pri.pri === '#0F766E');
  ck('装飾の --teal は #14B8A6 のまま', pri.teal === '#14B8A6');
  ck('主ボタンの背景は --pri', hex(pri.btn) === '#0F766E');
  ck('選択中タブの色は --pri', hex(pri.tab) === '#0F766E');
  ck('進捗バーの塗りは --teal', hex(pri.bar) === '#14B8A6');

  await p.screenshot({ path: path.join(SHOT_DIR, 'pri-after-home-incomplete-375-light.png') });

  // 先月の電気を入れて、追加・編集のプレースホルダ
  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    S.ensureMonth(s, '2026-10');
    const pay = s.payments.find((x) => x.month === '2026-10' && x.itemId === 'item-denki');
    if (pay) S.updatePayment(s, pay.id, { amount: 4000 });
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);

  await p.evaluate(() => {
    const row = [...document.querySelectorAll('.prow')].find((r) => /電気/.test(r.innerText));
    if (row) row.click();
  });
  await sleep(200);
  const editPh = await p.evaluate(() => ({
    title: document.querySelector('#dh') && document.querySelector('#dh').textContent,
    ph: document.getElementById('aa') && document.getElementById('aa').placeholder,
  }));
  ck('未入力の編集でも「先月 ¥4,000」', editPh.ph === '先月 ¥4,000');
  await p.keyboard.press('Escape');
  await sleep(150);

  // 全部入れて主色 after + 精算シートの注記なし
  await p.evaluate((map) => {
    const S = WarikanStore, L = WarikanLogic, s = S.load(), m = L.monthKey(new Date());
    S.ensureMonth(s, m);
    for (const pay of s.payments.filter((x) => x.month === m && !x.extra)) {
      if (map[pay.itemId] != null) S.updatePayment(s, pay.id, { amount: map[pay.itemId] });
    }
  }, AMOUNTS);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await p.screenshot({ path: path.join(SHOT_DIR, 'pri-after-home-complete-375-light.png') });
  await p.evaluate(() => document.querySelector('[data-act=settle]').click());
  await sleep(200);
  const zeroNote = await p.evaluate(() => ({
    open: document.getElementById('dlg').open,
    text: document.querySelector('.settle-confirmed') && document.querySelector('.settle-confirmed').textContent,
  }));
  ck('精算はシートを出さず確定する', zeroNote.open === false && /を確定しました/.test(zeroNote.text || ''), JSON.stringify(zeroNote));
  await sleep(150);
  await p.click('[data-tab=set]');
  await sleep(150);
  await p.screenshot({ path: path.join(SHOT_DIR, 'pri-after-set-375-light.png') });
  await p.click('[data-tab=home]');
  await sleep(200);

  // 履歴の印（ライト / ダーク）: 一部残り + 返済、10月精算済み、9月残り
  await p.evaluate(() => {
    const S = WarikanStore, L = WarikanLogic, s = S.load();
    const m = L.monthKey(new Date());
    S.clearMarks(s, m);
    S.setOpening(s, 'yamada', 260000);
    S.settleMonth(s, '2026-10', {
      from: 'yamada', to: 'kanojo', amount: 38000, net: 38000, choice: 'full', paid: 38000, carried: 0,
      kanojoPaid: 90000, yamadaPaid: 14000, yamadaBurdenOfKanojo: 45000, kanojoBurdenOfYamada: 7000, ratioYamada: 50,
    });
    S.settleMonth(s, '2026-09', {
      from: 'yamada', to: 'kanojo', amount: 38000, net: 38000, choice: 'carry', paid: 0, carried: 38000,
      kanojoPaid: 90000, yamadaPaid: 14000, yamadaBurdenOfKanojo: 45000, kanojoBurdenOfYamada: 7000, ratioYamada: 50,
    });
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  await p.evaluate(() => document.querySelector('[data-act=settle]').click());
  await sleep(200);
  await p.click('[data-tab=hist]');
  await sleep(150);
  await p.click('[data-tab=home]');
  await sleep(200);
  await p.click('[data-act=repay]');
  await sleep(200);
  await p.evaluate(() => {
    const aa = document.getElementById('repayAmt');
    aa.value = '30000';
    aa.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.click('#repayForm button[type=submit]');
  await sleep(250);

  await p.click('[data-tab=hist]');
  await sleep(200);
  const badgesLight = await p.evaluate(() => {
    const out = {};
    document.querySelectorAll('.hbadge').forEach((el) => {
      const cs = getComputedStyle(el);
      out[el.textContent.trim()] = { bg: cs.backgroundColor, fg: cs.color, cls: el.className };
    });
    return out;
  });
  ck('ライト 精算済み印は #E6F7F5 / #0F766E',
    badgesLight['精算済み'] && hex(badgesLight['精算済み'].bg) === '#E6F7F5' && hex(badgesLight['精算済み'].fg) === '#0F766E');
  await p.screenshot({ path: path.join(SHOT_DIR, 'history-375-light.png') });

  await setTheme(p, 'dark');
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  await p.click('[data-tab=hist]');
  await sleep(200);
  const badgesDark = await p.evaluate(() => {
    const out = {};
    document.querySelectorAll('.hbadge').forEach((el) => {
      const cs = getComputedStyle(el);
      out[el.textContent.trim()] = { bg: cs.backgroundColor, fg: cs.color };
    });
    return out;
  });
  ck('ダーク 精算済み印は #134E4A / #5EEAD4',
    badgesDark['精算済み'] && hex(badgesDark['精算済み'].bg) === '#134E4A' && hex(badgesDark['精算済み'].fg) === '#5EEAD4');
  await p.screenshot({ path: path.join(SHOT_DIR, 'history-375-dark.png') });
  await setTheme(p, 'light');

  // ----- キーボード: 6シート -----
  async function prepHome() {
    await p.evaluate(() => { if (window.__resetKb) window.__resetKb(); });
    if (await p.evaluate(() => document.getElementById('dlg') && document.getElementById('dlg').open)) {
      await p.keyboard.press('Escape');
      await sleep(150);
    }
    await p.evaluate(() => {
      const S = WarikanStore, L = WarikanLogic, s = S.load();
      const m = L.monthKey(new Date());
      S.ensureMonth(s, m);
      const map = { 'item-yachin': 60000, 'item-kaimono': 30000, 'item-denki': 4000, 'item-gas': 3000, 'item-suidou': 3000, 'item-net': 4000 };
      for (const pay of s.payments.filter((x) => x.month === m && !x.extra)) {
        if (map[pay.itemId] != null) S.updatePayment(s, pay.id, { amount: map[pay.itemId] });
      }
      if (!S.getOpening(s)) S.setOpening(s, 'yamada', 260000);
      S.clearMarks(s, m);
    });
    await p.reload({ waitUntil: 'networkidle0' });
    await sleep(200);
    await p.click('[data-tab=home]');
    await sleep(150);
    if (await p.evaluate(() => !!document.querySelector('[data-act=close-ledger]'))) {
      await p.click('[data-act=close-ledger]');
      await sleep(150);
    }
  }

  async function openSheet(kind) {
    if (kind === 'fill') {
      await p.evaluate(() => {
        const S = WarikanStore, L = WarikanLogic, s = S.load();
        const m = L.monthKey(new Date());
        const pay = s.payments.find((x) => x.month === m && x.itemId === 'item-denki' && !x.extra);
        if (pay) S.updatePayment(s, pay.id, { amount: null });
      });
      await p.reload({ waitUntil: 'networkidle0' });
      await sleep(200);
      await p.evaluate(() => {
        const row = [...document.querySelectorAll('.prow')].find((r) => /電気/.test(r.innerText) && /未入力/.test(r.innerText));
        if (row) row.click();
      });
    } else if (kind === 'edit') {
      await p.evaluate(() => {
        const row = [...document.querySelectorAll('.prow')].find((r) => /家賃/.test(r.innerText));
        if (row) row.click();
      });
    } else if (kind === 'add') {
      await p.evaluate(() => document.querySelector('[data-act=add-pay]').click());
      await sleep(200);
      await p.evaluate(() => { const b = document.querySelector('[data-kind=fixed]'); if (b) b.click(); });
    } else if (kind === 'opening') {
      await p.evaluate(() => document.querySelector('[data-tab=set]').click());
      await sleep(200);
      await p.evaluate(() => document.querySelector('[data-act=edit-opening]').click());
    } else if (kind === 'partial') {
      await p.evaluate(() => document.querySelector('[data-act=settle]').click());
      await sleep(200);
      await p.evaluate(() => document.querySelector('[data-act=settle-partial]').click());
    } else if (kind === 'repay') {
      await p.evaluate(() => document.querySelector('[data-act=repay]').click());
    }
    await sleep(250);
    const opened = await p.evaluate(() => !!(document.getElementById('dlg') && document.getElementById('dlg').open));
    if (!opened) throw new Error('sheet did not open: ' + kind);
    await p.evaluate(() => {
      const aa = document.querySelector('#aa, #openAmt, #paidAmt, #repayAmt, #inAmt, #inName');
      if (aa) aa.focus();
    });
    await sleep(80);
  }

  async function measure(limit) {
    return p.evaluate((limit) => {
      const vv = window.visualViewport;
      const cap = limit != null ? limit : (vv ? vv.height : window.innerHeight);
      const aa = document.querySelector('#aa, #openAmt, #paidAmt, #repayAmt, #inAmt, #inName');
      const dlg = document.getElementById('dlg');
      const acts = dlg && (dlg.querySelector('.sheet > .acts') || dlg.querySelector('.acts:last-of-type') || dlg.querySelector('.acts'));
      const primary = acts && (acts.querySelector('.btn:not(.ghost):not(.danger)') || acts.querySelector('[type=submit]') || acts.querySelector('.btn'));
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10 };
      };
      return {
        open: !!(dlg && dlg.open),
        title: dlg && dlg.querySelector('h2') && dlg.querySelector('h2').textContent,
        field: box(aa),
        btn: box(primary),
        btnText: primary && primary.textContent.trim(),
        cap,
        inner: window.innerHeight,
        vvH: vv && vv.height,
        dlgBottom: dlg ? Math.round(dlg.getBoundingClientRect().bottom * 10) / 10 : null,
      };
    }, limit);
  }

  function visOk(box, cap) {
    return !!(box && box.top >= -1 && box.bottom <= cap + 1 && box.bottom - box.top >= 20);
  }

  async function checkKb(label, kind, cap, shot) {
    await openSheet(kind);
    if (typeof cap === 'number' && cap < 600) {
      await p.evaluate((h) => { if (window.__setKb) window.__setKb(h, 0); }, cap);
      await sleep(150);
      await p.evaluate(() => {
        const aa = document.querySelector('#aa, #openAmt, #paidAmt, #repayAmt, #inAmt, #inName');
        if (aa) aa.focus();
      });
      await sleep(80);
    }
    const info = await measure(cap);
    const okF = visOk(info.field, cap);
    const okB = visOk(info.btn, cap);
    ck(label + ' 金額欄が可視 (' + (info.field && info.field.bottom) + '/' + cap + ')', okF && info.open, JSON.stringify(info));
    ck(label + ' 主ボタンが可視 (' + (info.btn && info.btn.bottom) + '/' + cap + ' ' + (info.btnText || '') + ')', okB && info.open, JSON.stringify(info));
    if (shot) await p.screenshot({ path: path.join(SHOT_DIR, shot) });
    await p.keyboard.press('Escape');
    await sleep(150);
    await p.evaluate(() => { if (window.__resetKb) window.__resetKb(); });
  }

  const sheets = [
    ['fill', '未入力'],
    ['edit', '編集'],
    ['add', '追加'],
    ['opening', 'これまでの残り'],
    ['repay', '支払った'],
  ];

  // 方法B 375 / vis 500
  await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await prepHome();
  for (const [kind, name] of sheets) {
    if (kind === 'fill') {
      // fill mutates and reloads
    } else if (kind === 'partial' || kind === 'repay' || kind === 'edit' || kind === 'add' || kind === 'opening') {
      // after fill, denki may be empty; prep again for others except we call prepHome for fill only
    }
    if (kind !== 'fill') {
      await prepHome();
    }
    await checkKb('方法B 375/500 ' + name, kind, 500, 'kb-B-' + kind + '-375-500.png');
  }

  // 方法B 320 / vis 300
  await p.setViewport({ width: 320, height: 568, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  for (const [kind, name] of sheets) {
    await prepHome();
    await checkKb('方法B 320/300 ' + name, kind, 300, 'kb-B-' + kind + '-320-300.png');
  }

  // 方法A: 窓自体を 320x300 に縮める（返すを含む全シート）
  await p.setViewport({ width: 320, height: 300, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  for (const [kind, name] of sheets) {
    await prepHome();
    await p.evaluate(() => { if (window.__resetKb) window.__resetKb(); });
    await sleep(80);
    await checkKb('方法A 320/300 ' + name, kind, 300, 'kb-A-' + kind + '-320-300.png');
  }

  ck('ページエラーなし', errs.length === 0, errs.join(' | '));

  await b.close();
  if (R.fails) {
    console.log('FAILED ' + R.fails);
    process.exit(1);
  }
  console.log('e2e-v121 ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
