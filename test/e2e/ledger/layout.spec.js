// E2E: 残りの支払いカードの1行レイアウト、台帳の金額揃え・向きの出し分け・色
const path = require('path');
const { SHOT_DIR, sleep, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;

const contrast = (fg, bg) => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    const h = String(c).replace('#', '');
    const n = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) || 0);
  };
  const lin = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (c) => {
    const [r, g, b] = parse(c).map(lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const L1 = lum(fg);
  const L2 = lum(bg);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
};

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

  const none = await p.evaluate(() => {
    const card = document.querySelector('[data-card=tsuke]');
    return {
      text: card && card.innerText.replace(/\s+/g, ' ').trim(),
      lab: card && card.querySelector('.tsuke-lab') && card.querySelector('.tsuke-lab').textContent,
      none: card && card.querySelector('.tsuke-none') && card.querySelector('.tsuke-none').textContent,
    };
  });
  ck('初回は「残りの支払い」と入力するボタン（案内文は出さない）', none.lab === '残りの支払い' && !/これまでの残りがあれば入れてね/.test(none.text || '') && /入力する/.test(none.text || '') && !/残りなし/.test(none.text || ''));

  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    S.setOpening(s, 'yamada', 278000);
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);

  async function inspectCard() {
    return p.evaluate(() => {
      const card = document.querySelector('[data-card=tsuke]');
      const lab = card.querySelector('.tsuke-lab');
      const main = card.querySelector('.tsuke-main');
      const who = [...card.querySelectorAll('.tsuke-who')].find((el) => getComputedStyle(el).display !== 'none');
      const amt = card.querySelector('.tsuke-amt');
      const rr = (el) => {
        const r = el.getBoundingClientRect();
        return { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width, h: r.height };
      };
      const lr = rr(lab);
      const mr = rr(main);
      const wr = rr(who);
      const ar = rr(amt);
      const acs = getComputedStyle(amt);
      return {
        lab: lab.textContent,
        who: who.textContent,
        amt: amt.textContent,
        amtSize: acs.fontSize,
        amtWeight: acs.fontWeight,
        amtWrap: acs.whiteSpace,
        amtTabular: acs.fontVariantNumeric,
        amtRects: amt.getClientRects().length,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        labelAbove: lr.b <= mr.t + 2,
        sameRow: wr.b > ar.t + 2 && ar.b > wr.t + 2,
        amtAfterWho: ar.l >= wr.r - 1,
        whoTrunc: who.scrollWidth > who.clientWidth + 1,
        cardW: card.getBoundingClientRect().width,
        amtW: ar.w,
      };
    });
  }

  await p.setViewport({ width: 320, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(150);
  const six = await inspectCard();
  ck('6桁 320px は省略しない ' + JSON.stringify({ who: six.who, trunc: six.whoTrunc }),
    six.lab === '残りの支払い' && six.who === '自分 → 相手' && six.amt === '¥278,000'
    && six.whoTrunc === false
    && six.labelAbove && six.sameRow && six.amtAfterWho && six.amtRects === 1 && six.amtWrap === 'nowrap' && six.overflow === false);
  ck('金額は精算額と同じ 36px 太字・tabular-nums', six.amtSize === '36px' && Number(six.amtWeight) >= 800 && /tabular-nums/.test(six.amtTabular));
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-278000-320.png') });

  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    S.setOpening(s, 'yamada', 1278000);
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);

  for (const width of [320, 375, 390]) {
    await p.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await sleep(200);
    const info = await inspectCard();
    const expectWho = '自分 → 相手';
    ck(`7桁 ${width}px: 金額が折り返さず1行 ` + JSON.stringify({ who: info.who, amt: info.amt, rects: info.amtRects, ov: info.overflow, trunc: info.whoTrunc }),
      info.lab === '残りの支払い' && info.who === expectWho && info.amt === '¥1,278,000'
      && info.labelAbove && info.sameRow && info.amtAfterWho
      && info.amtRects === 1 && info.amtWrap === 'nowrap' && info.overflow === false
      && info.amtSize === '36px');
    await p.screenshot({ path: path.join(SHOT_DIR, `home-${width}.png`) });
  }

  // 台帳: 同方向の増減 + 逆向きの繰り越し（向きの出し分け）
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
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.waitForSelector('[data-card=tsuke] .tsuke-body');
  await p.evaluate(() => document.querySelector('[data-card=tsuke] .tsuke-body').click());
  await p.waitForSelector('.lrow');
  await sleep(150);

  const led = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.lrow')].map((row) => {
      const amt = row.querySelector('.amt');
      const del = row.querySelector('.lrow-del');
      const dir = row.querySelector('small.dir');
      const bg = amt ? getComputedStyle(amt).backgroundColor : '';
      const cardBg = getComputedStyle(row.closest('.card') || document.body).backgroundColor;
      return {
        text: row.innerText.replace(/\s+/g, ' ').trim(),
        kindLab: [...row.querySelectorAll('small')].map((s) => s.textContent),
        dir: dir ? dir.textContent : null,
        amt: amt && amt.textContent,
        amtClass: amt && amt.className,
        amtColor: amt ? getComputedStyle(amt).color : '',
        amtRight: amt ? amt.getBoundingClientRect().right : 0,
        hasDelBtn: !!(del && del.tagName === 'BUTTON'),
        hasPh: !!(del && del.classList.contains('lrow-del-ph')),
        delW: del ? Math.round(del.getBoundingClientRect().width) : 0,
        bg: bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent' ? cardBg : bg,
      };
    });
    return {
      now: document.querySelector('.tsuke-now') && document.querySelector('.tsuke-now').textContent,
      rows,
    };
  });

  const by = (re) => led.rows.find((r) => re.test(r.text));
  const repayRow = by(/支払った/);
  const carryRow = by(/11月分/);
  const openRow = by(/これまでの残り/);
  ck('台帳は3行（支払った・11月分・これまでの残り）', led.rows.length === 3 && !!(repayRow && carryRow && openRow));
  ck('いまの残りは自分 → 相手（1,278,000−80,000−30,000）', /自分 → 相手/.test(led.now || '') && /¥1,168,000/.test(led.now || ''));
  ck('行の見出しは 支払った / 11月分 / これまでの残り で、向き行は出さない',
    !!(repayRow && carryRow && openRow)
    && repayRow.dir === null && carryRow.dir === null && openRow.dir === null
    && /支払った/.test(repayRow.text) && /11月分/.test(carryRow.text));
  ck('消すがある行とない行でスロット幅が同じ',
    !!(repayRow && carryRow && openRow)
    && repayRow.hasDelBtn && carryRow.hasPh && openRow.hasDelBtn
    && repayRow.delW === carryRow.delW && carryRow.delW === openRow.delW && repayRow.delW >= 44);

  const rights = led.rows.map((r) => r.amtRight);
  const spread = Math.max(...rights) - Math.min(...rights);
  ck('金額の右端が行間で揃う（ずれ 1px 以内） ' + JSON.stringify(rights), spread <= 1);

  const inc = led.rows.filter((r) => /\binc\b/.test(r.amtClass));
  const dec = led.rows.filter((r) => /\bdec\b/.test(r.amtClass));
  ck('増えた分（これまでの残り）は琥珀の + ' + JSON.stringify(inc.map((r) => r.amt)),
    inc.length === 1 && inc[0].amt === '+¥1,278,000' && hex(inc[0].amtColor) === '#A16207');
  ck('減った分（反対向きの繰り越しと返した分）はティールの −',
    dec.length === 2
    && dec.some((r) => r.amt === '−¥80,000')
    && dec.some((r) => r.amt === '−¥30,000')
    && dec.every((r) => hex(r.amtColor) === '#0F766E'));
  const incC = contrast(inc[0].amtColor, inc[0].bg);
  const reC = contrast(dec[0].amtColor, dec[0].bg);
  ck('増えた分のコントラスト ≥4.5:1 ' + incC.toFixed(2), incC >= 4.5);
  ck('減った分のコントラスト ≥4.5:1 ' + reC.toFixed(2), reC >= 4.5);

  for (const width of [320, 375, 390]) {
    await p.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await sleep(200);
    const lay = await p.evaluate(() => {
      const rights = [...document.querySelectorAll('.lrow .amt')].map((el) => el.getBoundingClientRect().right);
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        spread: Math.max(...rights) - Math.min(...rights),
        dir: [...document.querySelectorAll('.lrow small.dir')].map((el) => el.textContent),
      };
    });
    ck(`台帳 ${width}px: 横スクロールなし・金額の右端が揃う ` + JSON.stringify(lay),
      lay.overflow === false && lay.spread <= 1 && lay.dir.length === 0);
    await p.screenshot({ path: path.join(SHOT_DIR, `ledger-${width}.png`) });
  }

  ck('ページエラーなし ' + (errs[0] || ''), errs.length === 0);

  await b.close();
  if (R.fails) {
    console.log(R.fails + ' failed');
    process.exit(1);
  }
  console.log('all passed');
})().catch((e) => { console.error(e); process.exit(1); });
