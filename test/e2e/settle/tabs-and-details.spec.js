// E2E: 精算タブ、詳細の開閉、新しい項目、月表示、タブの印
const fs = require('fs');
const path = require('path');
const { SHOT_DIR, sleep, hex, setTheme, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;

const AMOUNTS = { 'item-yachin': 60000, 'item-kaimono': 30000, 'item-denki': 4000, 'item-gas': 3000, 'item-suidou': 3000, 'item-net': 4000 };
const seedExample = (map) => {
  const S = WarikanStore, s = S.load();
  const m = '2026-11';
  S.ensureMonth(s, m);
  for (const pay of s.payments.filter((x) => x.month === m && !x.extra)) {
    if (map[pay.itemId] != null) S.updatePayment(s, pay.id, { amount: map[pay.itemId] });
  }
  S.setRatio(s, 50);
  S.clearMarks(s, m);
};
const hexColor = (p, sel, prop) => p.evaluate((s, pr) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const c = getComputedStyle(el)[pr];
  const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase() : c;
}, sel, prop);

(async () => {
  const b = await launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setBypassServiceWorker(true);
  await p.emulateTimezone('Asia/Tokyo');
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
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await p.evaluate(seedExample, AMOUNTS);
  await setTheme(p, 'light');
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);

  const tab = await p.evaluate(() => {
    const on = document.querySelector('.tabs button.on');
    const paths = on ? [...on.querySelectorAll('svg path')].map((x) => x.getAttribute('d')).join(' ') : '';
    const rects = on ? on.querySelectorAll('svg rect').length : -1;
    return { text: on && on.textContent.trim(), paths, rects };
  });
  ck('下のタブは「精算」が選ばれている', tab.text === '精算', JSON.stringify(tab));
  ck('精算タブのアイコンは ¥ で、紙の形ではない', tab.rects === 0 && /M8 5l4 6 4-6/.test(tab.paths) && /M8 13\.5h8/.test(tab.paths), JSON.stringify(tab));

  const month = await p.evaluate(() => {
    const year = document.querySelector('#mLbl .myear');
    const mon = document.querySelector('#mLbl .mmon');
    const prev = document.querySelector('[data-act=prev-m]');
    const next = document.querySelector('[data-act=next-m]');
    const pr = prev && prev.getBoundingClientRect();
    const nr = next && next.getBoundingClientRect();
    const ycs = year && getComputedStyle(year);
    const mcs = mon && getComputedStyle(mon);
    return {
      text: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
      year: year && year.textContent,
      mon: mon && mon.textContent,
      yearSize: ycs && ycs.fontSize,
      yearWeight: ycs && ycs.fontWeight,
      yearColor: ycs && ycs.color,
      monSize: mcs && mcs.fontSize,
      monWeight: mcs && mcs.fontWeight,
      prev: pr && { w: Math.round(pr.width), h: Math.round(pr.height) },
      next: nr && { w: Math.round(nr.width), h: Math.round(nr.height) },
    };
  });
  const yearHex = hex(month.yearColor);
  ck('月表示は「2026年」14px 灰色、「11月」24px 太字',
    month.year === '2026年' && month.mon === '11月' && /2026年11月/.test(month.text || '') &&
    month.yearSize === '14px' && month.monSize === '24px' && Number(month.monWeight) >= 700 &&
    yearHex === '#78716C',
    JSON.stringify(month) + ' ' + yearHex);
  ck('‹ › の押せる範囲は 44px 角', month.prev && month.prev.w === 44 && month.prev.h === 44 && month.next.w === 44 && month.next.h === 44, JSON.stringify({ prev: month.prev, next: month.next }));

  await p.setViewport({ width: 320, height: 568, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(80);
  // settle the month visually with lock? not yet. just check nowrap of label at 320
  const wrap = await p.evaluate(() => {
    const b = document.getElementById('mLbl');
    if (!b.querySelector('.mlock')) b.insertAdjacentHTML('beforeend', '<span class="mlock" aria-hidden="true">🔒</span>');
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    const year = document.querySelector('#mLbl .myear').getBoundingClientRect();
    const mon = document.querySelector('#mLbl .mmon').getBoundingClientRect();
    const lock = document.querySelector('#mLbl .mlock').getBoundingClientRect();
    return {
      nowrap: cs.whiteSpace === 'nowrap',
      inRow: year.left < mon.left && mon.left < lock.left,
      height: Math.round(r.height),
      overflow: r.right > 320 + 1 || b.scrollWidth > b.clientWidth + 1,
    };
  });
  ck('320px 幅でも月表示は折り返さない', wrap.nowrap && wrap.inRow && wrap.height <= 36 && !wrap.overflow, JSON.stringify(wrap));
  await p.evaluate(() => { const lock = document.querySelector('#mLbl .mlock'); if (lock) lock.remove(); });
  await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(80);

  const closed = await p.evaluate(() => {
    const btn = document.querySelector('[data-act=toggle-steps]');
    const wrap = document.querySelector('.settle-steps-wrap');
    const cs = btn && getComputedStyle(btn);
    const h = wrap && wrap.getBoundingClientRect().height;
    return {
      text: btn && btn.textContent,
      expanded: btn && btn.getAttribute('aria-expanded'),
      controls: btn && btn.getAttribute('aria-controls'),
      size: cs && cs.fontSize,
      color: cs && cs.color,
      wrapH: h,
      open: wrap && wrap.classList.contains('is-open'),
    };
  });
  ck('最初は「▽ 詳細」で閉じている（13px 灰色、aria-expanded=false）',
    closed.text === '▽ 詳細' && closed.expanded === 'false' && closed.controls === 'settleSteps' &&
    closed.size === '13px' && hex(closed.color) === '#78716C' && closed.open === false && closed.wrapH < 8,
    JSON.stringify(closed) + ' ' + hex(closed.color));

  await p.screenshot({ path: path.join(SHOT_DIR, 'settle-closed-375-light.png') });

  await p.click('[data-act=toggle-steps]');
  await sleep(250);
  const opened = await p.evaluate(() => {
    const btn = document.querySelector('[data-act=toggle-steps]');
    const wrap = document.querySelector('.settle-steps-wrap');
    const steps = [...document.querySelectorAll('.settle-step')].map((el) => el.innerText.replace(/\s+/g, ' ').trim());
    return {
      text: btn && btn.textContent,
      expanded: btn && btn.getAttribute('aria-expanded'),
      open: wrap && wrap.classList.contains('is-open'),
      h: wrap && wrap.getBoundingClientRect().height,
      steps,
    };
  });
  ck('開くと「△ 閉じる」になり内訳が見える',
    opened.text === '△ 閉じる' && opened.expanded === 'true' && opened.open && opened.h > 40 &&
    opened.steps.some((s) => /が払った分/.test(s) && /¥60,000|¥90,000/.test(s)),
    JSON.stringify(opened));
  await p.screenshot({ path: path.join(SHOT_DIR, 'settle-open-375-light.png') });

  await p.click('[data-act=toggle-steps]');
  await sleep(250);

  const addBtn = await p.evaluate(() => {
    const b = document.querySelector('[data-act=add-pay]');
    if (b) b.scrollIntoView({ block: 'center' });
    return b && { text: b.textContent.trim(), plus: /＋|\+/.test(b.textContent) };
  });
  ck('精算ページのボタンは設定と同じ「項目を追加」（記号なし）',
    addBtn && addBtn.text === '項目を追加' && !addBtn.plus, JSON.stringify(addBtn));
  await sleep(80);
  await p.screenshot({ path: path.join(SHOT_DIR, 'add-btn-375-light.png') });

  // 毎月の項目のフォームは設定から開く（v2.0.6 から精算ページの追加はその月だけの別フォーム）
  await p.evaluate(() => document.querySelector('[data-tab=set]').click());
  await sleep(200);
  await p.evaluate(() => { const b = document.querySelector('[data-act=add-item]'); if (b) b.click(); });
  await sleep(250);
  const neu = await p.evaluate(() => {
    const labels = [...document.querySelectorAll('#itemForm .f > label')].map((el) => el.textContent.trim());
    const fix = document.getElementById('fixWrap');
    return {
      open: document.getElementById('dlg') && document.getElementById('dlg').open,
      title: document.getElementById('dh') && document.getElementById('dh').textContent,
      labels,
      kinds: [...document.querySelectorAll('#itemForm [data-kind]')].map((b) => b.textContent.trim()),
      payers: [...document.querySelectorAll('#itemForm [data-payer]')].map((b) => b.textContent.trim()),
      chips: document.querySelectorAll('.ichip, .ichip-new, [data-new-item]').length,
      fixHidden: !!(fix && fix.hidden),
      hasInAmt: !!document.getElementById('inAmt'),
      hasPayAmt: !!document.getElementById('inPayAmt'),
    };
  });
  ck('設定の「毎月の項目を追加」で項目のフォームが開く',
    neu.open && neu.title === '項目を追加' && neu.chips === 0 &&
    neu.labels[0] === '名前' && neu.labels.includes('種類') && neu.labels.includes('いつも払う人') &&
    neu.kinds.includes('固定') && neu.kinds.includes('変動') && neu.fixHidden && neu.hasInAmt && !neu.hasPayAmt,
    JSON.stringify(neu));
  await p.screenshot({ path: path.join(SHOT_DIR, 'add-form-375-light.png') });

  // 変動の項目は金額なしで追加され、その月に未入力で出る
  await p.evaluate(() => {
    const name = document.getElementById('inName');
    name.value = 'カフェ';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const kind = document.querySelector('[data-kind=variable]');
    if (kind) kind.click();
  });
  await sleep(150);
  await p.evaluate(() => {
    const payer = document.querySelector('[data-payer=yamada]');
    if (payer) payer.click();
  });
  await sleep(150);
  await p.click('#itemForm button[type=submit]');
  await sleep(300);
  await p.evaluate(() => document.querySelector('[data-tab=home]').click());
  await sleep(200);
  const savedVar = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.prow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    const items = (WarikanStore.load().items || []).map((it) => it.name);
    return { rows, items, dlg: document.getElementById('dlg').open };
  });
  ck('変動の項目は一覧に加わり、その月に未入力で出る',
    !savedVar.dlg && savedVar.items.includes('カフェ') && savedVar.rows.some((t) => /カフェ/.test(t) && /未入力/.test(t)),
    JSON.stringify(savedVar));

  // 固定＋金額なら、その月の金額として入る
  await p.evaluate(() => document.querySelector('[data-tab=set]').click());
  await sleep(200);
  await p.evaluate(() => { const b = document.querySelector('[data-act=add-item]'); if (b) b.click(); });
  await sleep(200);
  await p.evaluate(() => {
    document.getElementById('inName').value = '駐車場';
    const kind = document.querySelector('[data-kind=fixed]');
    if (kind) kind.click();
  });
  await sleep(150);
  await p.evaluate(() => {
    const amt = document.getElementById('inAmt');
    amt.value = '8000';
    amt.dispatchEvent(new Event('input', { bubbles: true }));
    const payer = document.querySelector('[data-payer=yamada]');
    if (payer) payer.click();
  });
  await sleep(150);
  await p.click('#itemForm button[type=submit]');
  await sleep(300);
  await p.evaluate(() => document.querySelector('[data-tab=home]').click());
  await sleep(200);
  const savedFix = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.prow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    const items = WarikanStore.load().items || [];
    const it = items.find((x) => x.name === '駐車場');
    return { rows, kind: it && it.kind, amt: it && it.fixedAmount, dlg: document.getElementById('dlg').open };
  });
  ck('フォームに金額があればその月の金額として入る',
    !savedFix.dlg && savedFix.kind === 'fixed' && savedFix.amt === 8000 &&
    savedFix.rows.some((t) => /駐車場/.test(t) && /¥8,000/.test(t)),
    JSON.stringify(savedFix));

  await p.evaluate(() => document.querySelector('[data-tab=set]').click());
  await sleep(200);
  const inSet = await p.evaluate(() => [...document.querySelectorAll('.item .l b')].map((el) => el.textContent));
  ck('設定の項目にも「カフェ」と「駐車場」がある', inSet.includes('カフェ') && inSet.includes('駐車場'), JSON.stringify(inSet));
  await p.evaluate(() => document.querySelector('[data-tab=home]').click());
  await sleep(200);

  // 以前のその月だけの支払い（extra）はそのまま出る
  await p.evaluate(() => {
    const S = WarikanStore, s = S.load();
    S.addPayment(s, { month: '2026-11', payerId: 'kanojo', itemId: 'item-kaimono', itemName: '買い物', amount: 800, extra: true });
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  const extras = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.prow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    return { rows, kaimono: rows.filter((t) => /買い物/.test(t)) };
  });
  ck('以前のその月だけの支払いは壊さず表示する',
    extras.kaimono.some((t) => /¥800/.test(t)) && extras.kaimono.length >= 2,
    JSON.stringify(extras.kaimono));


  const pill = await p.evaluate(() => {
    const pill = document.getElementById('tabPill');
    const on = document.querySelector('.tabs button.on');
    const nav = document.getElementById('tabs');
    if (!pill || !on || !nav) return null;
    const br = on.getBoundingClientRect();
    const pr = pill.getBoundingClientRect();
    const cs = getComputedStyle(pill);
    const root = getComputedStyle(document.documentElement).getPropertyValue('--pick-on').trim();
    return {
      tab: on.dataset.tab,
      bg: cs.backgroundColor,
      pickOn: root,
      radius: cs.borderRadius,
      overlap: pr.left < br.right && pr.right > br.left && pr.top < br.bottom && pr.bottom > br.top,
      centered: Math.abs((pr.left + pr.right) / 2 - (br.left + br.right) / 2) < 12,
    };
  });
  ck('選択中のタブの後ろに --pick-on の丸い印がある',
    pill && pill.tab === 'home' && hex(pill.bg).toUpperCase() === String(pill.pickOn).toUpperCase() &&
    (pill.radius === '999px' || parseFloat(pill.radius) >= 16) && pill.overlap && pill.centered,
    JSON.stringify(pill) + ' ' + (pill && hex(pill.bg)));

  // バーをなぞると印が動き、離したタブに切り替わる
  const drag = await p.evaluate(async () => {
    const nav = document.getElementById('tabs');
    const hist = nav.querySelector('[data-tab=hist]');
    const r = hist.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const start = nav.querySelector('[data-tab=home]').getBoundingClientRect();
    const sx = start.left + start.width / 2;
    const sy = start.top + start.height / 2;
    const fire = (type, cx, cy) => {
      nav.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
        clientX: cx, clientY: cy, buttons: type === 'pointerup' ? 0 : 1,
      }));
    };
    fire('pointerdown', sx, sy);
    fire('pointermove', sx + 20, sy);
    fire('pointermove', x, y);
    const mid = document.getElementById('tabPill').getBoundingClientRect();
    fire('pointerup', x, y);
    await new Promise((res) => setTimeout(res, 250));
    const on = document.querySelector('.tabs button.on');
    const pr = document.getElementById('tabPill').getBoundingClientRect();
    const hr = hist.getBoundingClientRect();
    return {
      tab: on && on.dataset.tab,
      midMoved: mid.left !== start.left,
      landed: pr.left < hr.right && pr.right > hr.left,
    };
  });
  ck('バーをなぞると印がついていき、離したタブに切り替わる',
    drag && drag.tab === 'hist' && drag.landed, JSON.stringify(drag));

  // ダークのスクショ
  await p.evaluate(() => { const b = document.querySelector('[data-tab=home]'); if (b) b.click(); });
  await sleep(250);
  await setTheme(p, 'dark');
  await sleep(80);
  const onHome = await p.evaluate(() => document.querySelector('.tabs button.on') && document.querySelector('.tabs button.on').dataset.tab);
  if (onHome !== 'home') {
    await p.evaluate(() => { const b = document.querySelector('[data-tab=home]'); if (b) b.click(); });
    await sleep(250);
  }
  const darkClosed = await p.evaluate(() => {
    const btn = document.querySelector('[data-act=toggle-steps]');
    const open = document.querySelector('.settle-steps-wrap') && document.querySelector('.settle-steps-wrap').classList.contains('is-open');
    return { text: btn && btn.textContent, open, has: !!btn };
  });
  if (darkClosed.open) {
    await p.evaluate(() => { const b = document.querySelector('[data-act=toggle-steps]'); if (b) b.click(); });
    await sleep(250);
  }
  await p.screenshot({ path: path.join(SHOT_DIR, 'settle-closed-375-dark.png') });
  await p.evaluate(() => { const b = document.querySelector('[data-act=toggle-steps]'); if (b) b.click(); });
  await sleep(250);
  await p.screenshot({ path: path.join(SHOT_DIR, 'settle-open-375-dark.png') });
  await p.evaluate(() => {
    const b = document.querySelector('[data-act=add-pay]');
    if (b) { b.scrollIntoView({ block: 'center' }); b.click(); }
  });
  await sleep(250);
  await p.screenshot({ path: path.join(SHOT_DIR, 'add-sheet-375-dark.png') });
  await p.keyboard.press('Escape');
  await sleep(150);

  const darkYear = await hexColor(p, '#mLbl .myear', 'color');
  ck('ダークの年の色は副文色', darkYear === '#A8A29E', darkYear);

  ck('ページエラーなし', errs.length === 0, errs.join(' | '));

  const shots = [
    'settle-closed-375-light.png', 'settle-open-375-light.png',
    'settle-closed-375-dark.png', 'settle-open-375-dark.png', 'add-sheet-375-dark.png',
    'add-btn-375-light.png', 'add-form-375-light.png',
  ];
  ck('375px のライト／ダークのスクショが揃っている', shots.every((f) => fs.existsSync(path.join(SHOT_DIR, f))), shots.join(', '));

  await b.close();
  if (R.fails) { console.log('\nFAILED', R.fails); process.exit(1); }
  console.log('\nAll v1.6.0 e2e passed');
})().catch((e) => { console.error(e); process.exit(1); });
