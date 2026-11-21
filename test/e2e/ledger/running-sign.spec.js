// E2E: 台帳の符号は累計の絶対値、いまの残りは残りの支払いカードと同じレイアウト
const path = require('path');
const { SHOT_DIR, sleep, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;

const hex = (c) => {
  const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return String(c).toUpperCase();
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
};

async function openLedger(p) {
  await p.waitForSelector('[data-card=tsuke] .tsuke-body');
  await p.evaluate(() => document.querySelector('[data-card=tsuke] .tsuke-body').click());
  await p.waitForSelector('.tsuke-now .tsuke-lab, .lrow, .empty');
  await sleep(150);
}

async function inspectHead(p) {
  return p.evaluate(() => {
    const box = document.querySelector('.tsuke-now');
    const lab = box && box.querySelector('.tsuke-lab');
    const main = box && box.querySelector('.tsuke-main');
    const who = box && [...box.querySelectorAll('.tsuke-who')].find((el) => getComputedStyle(el).display !== 'none');
    const amt = box && box.querySelector('.tsuke-amt');
    const none = box && box.querySelector('.tsuke-none');
    if (!box || !lab || !main) return { missing: true };
    const rr = (el) => {
      const r = el.getBoundingClientRect();
      return { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width };
    };
    const lr = rr(lab);
    const mr = rr(main);
    const info = {
      lab: lab.textContent,
      none: none && none.textContent,
      who: who && who.textContent,
      amt: amt && amt.textContent,
      labelAbove: lr.b <= mr.t + 2,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
    if (who && amt) {
      const wr = rr(who);
      const ar = rr(amt);
      const acs = getComputedStyle(amt);
      info.amtSize = acs.fontSize;
      info.amtWeight = acs.fontWeight;
      info.amtWrap = acs.whiteSpace;
      info.amtTabular = acs.fontVariantNumeric;
      info.amtRects = amt.getClientRects().length;
      info.sameRow = wr.b > ar.t + 2 && ar.b > wr.t + 2;
      info.amtAfterWho = ar.l >= wr.r - 1;
      info.whoTrunc = who.scrollWidth > who.clientWidth + 1;
    }
    return info;
  });
}

(async () => {
  const b = await launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setBypassServiceWorker(true);
  await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument(() => { window.__warikanNow = Date.parse('2026-11-15T12:00:00+09:00'); });
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
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);

  // 例: これまでの残り 1,278,000、相手 → 自分 80,000、返した 30,000
  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    S.setOpening(s, 'yamada', 1278000);
    S.addCarry(s, '2026-11', -80000, { paid: 0, carried: 80000 });
    const last = s.ledger[s.ledger.length - 1];
    if (last) last.createdAt -= 10;
    S.save(s);
    S.addRepayment(s, -30000);
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await openLedger(p);

  const led = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.lrow')].map((row) => {
      const amt = row.querySelector('.amt');
      const dir = row.querySelector('small.dir');
      return {
        text: row.innerText.replace(/\s+/g, ' ').trim(),
        dir: dir ? dir.textContent : null,
        amt: amt && amt.textContent,
        amtClass: amt && amt.className,
        color: amt ? getComputedStyle(amt).color : '',
      };
    });
    return {
      lab: document.querySelector('.tsuke-now .tsuke-lab') && document.querySelector('.tsuke-now .tsuke-lab').textContent,
      who: (() => { const w = [...document.querySelectorAll('.tsuke-now .tsuke-who')].find((el) => getComputedStyle(el).display !== 'none'); return w && w.textContent; })(),
      amt: document.querySelector('.tsuke-now .tsuke-amt') && document.querySelector('.tsuke-now .tsuke-amt').textContent,
      rows,
    };
  });
  const by = (re) => led.rows.find((r) => re.test(r.text));
  const openRow = by(/これまでの残り/);
  const carryRow = by(/11月分/);
  const repayRow = by(/支払った/);
  ck('見出しは「残りの支払い」自分 → 相手 ¥1,168,000',
    led.lab === '残りの支払い' && led.who === '自分 → 相手' && led.amt === '¥1,168,000');
  ck('これまでの残りは琥珀の +¥1,278,000',
    !!(openRow && openRow.amt === '+¥1,278,000' && /\binc\b/.test(openRow.amtClass) && hex(openRow.color) === '#A16207'));
  ck('相手 → 自分の繰り越しは累計が減ったのでティールの −¥80,000（ASCII ハイフンではない）',
    !!(carryRow && carryRow.amt === '−¥80,000' && carryRow.amt.charCodeAt(0) === 0x2212
      && /\bdec\b/.test(carryRow.amtClass) && hex(carryRow.color) === '#0F766E'));
  ck('返した分も累計が減ったのでティールの −¥30,000',
    !!(repayRow && repayRow.amt === '−¥30,000' && repayRow.amt.charCodeAt(0) === 0x2212
      && /\bdec\b/.test(repayRow.amtClass) && hex(repayRow.color) === '#0F766E'));

  for (const width of [320, 375, 390]) {
    await p.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await sleep(200);
    const h = await inspectHead(p);
    const expectWho = '自分 → 相手';
    ck(`いまの残り ${width}px / ¥1,168,000 はラベル上・金額1行 ` + JSON.stringify({ who: h.who, amt: h.amt, size: h.amtSize, same: h.sameRow, rects: h.amtRects, trunc: h.whoTrunc }),
      h.lab === '残りの支払い' && h.who === expectWho && h.amt === '¥1,168,000'
      && h.labelAbove && h.sameRow && h.amtAfterWho
      && h.amtRects === 1 && h.amtWrap === 'nowrap' && h.amtSize === '36px'
      && Number(h.amtWeight) >= 800 && /tabular-nums/.test(h.amtTabular)
      && h.overflow === false);
    await p.screenshot({ path: path.join(SHOT_DIR, `ledger-${width}.png`) });
  }

  // 台帳の「返す」（残高あり）
  const ledgerRepay = await p.evaluate(() => {
    const b = document.querySelector('.tsuke-now [data-act=repay]');
    const r = b && b.getBoundingClientRect();
    return { ok: !!b, text: b && b.textContent, h: r ? Math.round(r.height) : 0 };
  });
  ck('台帳にも「返す」がある（高さ ≥44）', ledgerRepay.ok && ledgerRepay.text === '支払った' && ledgerRepay.h >= 44);
  await p.click('.tsuke-now [data-act=repay]');
  await sleep(200);
  ck('台帳の「返す」でダイアログが開く', await p.evaluate(() => {
    const f = document.getElementById('repayForm');
    return !!(document.getElementById('dlg').open && f && f.noValidate);
  }));
  await p.click('[data-act=close]');
  await sleep(150);

  // 7桁のいまの残り（これまでの残りだけ 2,168,000）
  await p.click('[data-act=close-ledger]');
  await sleep(200);
  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    s.ledger = [];
    S.setOpening(s, 'yamada', 2168000);
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await openLedger(p);
  for (const width of [320, 375, 390]) {
    await p.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await sleep(200);
    const h = await inspectHead(p);
    const expectWho7 = '自分 → 相手';
    ck(`いまの残り ${width}px / 7桁 ¥2,168,000 は金額が折り返さない ` + JSON.stringify({ who: h.who, amt: h.amt, rects: h.amtRects, ov: h.overflow, trunc: h.whoTrunc }),
      h.lab === '残りの支払い' && h.who === expectWho7 && h.amt === '¥2,168,000'
      && h.labelAbove && h.sameRow && h.amtAfterWho
      && h.amtRects === 1 && h.amtWrap === 'nowrap' && h.amtSize === '36px'
      && h.overflow === false);
    await p.screenshot({ path: path.join(SHOT_DIR, `ledger-7digit-${width}.png`) });
  }

  // ゼロ越え: |直後| が小さい → −、大きい → +
  await p.click('[data-act=close-ledger]');
  await sleep(150);
  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    s.ledger = [];
    S.setOpening(s, 'yamada', 100000);
    S.addCarry(s, '2026-11', -180000, { paid: 0, carried: 180000 });
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await openLedger(p);
  const flipDec = await p.evaluate(() => {
    const row = [...document.querySelectorAll('.lrow')].find((r) => /11月分/.test(r.innerText));
    const amt = row && row.querySelector('.amt');
    return amt && { text: amt.textContent, cls: amt.className, color: getComputedStyle(amt).color };
  });
  ck('ゼロ越えでも |直後| が小さければ −¥180,000 ティール',
    !!(flipDec && flipDec.text === '−¥180,000' && /\bdec\b/.test(flipDec.cls) && hex(flipDec.color) === '#0F766E'));

  await p.click('[data-act=close-ledger]');
  await sleep(150);
  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    s.ledger = [];
    S.setOpening(s, 'yamada', 50000);
    S.addCarry(s, '2026-11', -200000, { paid: 0, carried: 200000 });
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await openLedger(p);
  const flipInc = await p.evaluate(() => {
    const row = [...document.querySelectorAll('.lrow')].find((r) => /11月分/.test(r.innerText));
    const amt = row && row.querySelector('.amt');
    const now = document.querySelector('.tsuke-now .tsuke-amt');
    const who = document.querySelector('.tsuke-now .tsuke-who');
    return {
      text: amt && amt.textContent,
      cls: amt && amt.className,
      color: amt ? getComputedStyle(amt).color : '',
      now: now && now.textContent,
      who: who && who.textContent,
    };
  });
  ck('ゼロ越えでも |直後| が大きければ +¥200,000 琥珀',
    !!(flipInc && flipInc.text === '+¥200,000' && /\binc\b/.test(flipInc.cls) && hex(flipInc.color) === '#A16207'));
  ck('反転後のいまの残りは 相手 → 自分 ¥150,000',
    flipInc.who === '相手 → 自分' && flipInc.now === '¥150,000');
  await p.screenshot({ path: path.join(SHOT_DIR, 'ledger-flip-390.png') });


  // 残高0の台帳には「返す」を出さない
  await p.click('[data-act=close-ledger]');
  await sleep(150);
  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    s.ledger = [];
    S.save(s);
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await openLedger(p);
  ck('残高0の台帳に「返す」はない', await p.evaluate(() => !document.querySelector('.tsuke-now [data-act=repay]') && !!(document.querySelector('.tsuke-none') && document.querySelector('.tsuke-none').textContent === '残りなし')));
  await p.click('[data-act=close-ledger]');
  await sleep(150);

  // 320px / ¥278,000 は「自分 → 相手」で省略しない
  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    s.ledger = [];
    S.setOpening(s, 'yamada', 278000);
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await p.setViewport({ width: 320, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(200);
  const home278 = await p.evaluate(() => {
    const who = [...document.querySelectorAll('[data-card=tsuke] .tsuke-who')].find((el) => getComputedStyle(el).display !== 'none');
    const amt = document.querySelector('[data-card=tsuke] .tsuke-amt');
    return {
      who: who && who.textContent,
      trunc: who ? who.scrollWidth > who.clientWidth + 1 : null,
      amt: amt && amt.textContent,
    };
  });
  ck('ホーム 320px / ¥278,000 は「自分 → 相手」で省略しない ' + JSON.stringify(home278),
    home278.who === '自分 → 相手' && home278.trunc === false && home278.amt === '¥278,000');
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-278000-320.png') });
  await openLedger(p);
  const now278 = await inspectHead(p);
  ck('台帳 320px / ¥278,000 も「自分 → 相手」で省略しない ' + JSON.stringify({ who: now278.who, trunc: now278.whoTrunc }),
    now278.who === '自分 → 相手' && now278.whoTrunc === false && now278.amt === '¥278,000');
  await p.click('[data-act=close-ledger]');
  await sleep(150);

  // キーボードで残りの支払いカードを開ける
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(150);
  const kb = await p.evaluate(() => {
    const el = document.querySelector('.tsuke-open');
    const css = [...document.styleSheets].flatMap((s) => {
      try { return [...s.cssRules].map((r) => r.cssText); } catch (e) { return []; }
    }).join('\n');
    return {
      tag: el && el.tagName,
      role: el && (el.getAttribute('role') || (el.tagName === 'BUTTON' ? 'button' : '')),
      act: el && el.getAttribute('data-act'),
      hasFocusVisible: /tsuke-open:focus-visible/.test(css),
    };
  });
  ck('残りの支払いカードの開く操作は button（Enter / Space、フォーカスリング）',
    kb.tag === 'BUTTON' && kb.role === 'button' && kb.act === 'open-ledger' && kb.hasFocusVisible === true);
  await p.focus('.tsuke-open');
  await p.keyboard.press('Enter');
  await sleep(250);
  ck('Enter で台帳が開く', await p.evaluate(() => !!(document.querySelector('.tsuke-now .tsuke-lab') && document.querySelector('.tsuke-now .tsuke-lab').textContent === '残りの支払い')));
  await p.click('[data-act=close-ledger]');
  await sleep(200);
  await p.focus('.tsuke-open');
  await p.keyboard.press('Space');
  await sleep(250);
  ck('Space で台帳が開く', await p.evaluate(() => !!(document.querySelector('.tsuke-now .tsuke-lab') && document.querySelector('.tsuke-now .tsuke-lab').textContent === '残りの支払い')));

  ck('ページエラーなし ' + (errs[0] || ''), errs.length === 0);


  await b.close();
  if (R.fails) {
    console.log(R.fails + ' failed');
    process.exit(1);
  }
  console.log('all passed');
})().catch((e) => { console.error(e); process.exit(1); });
