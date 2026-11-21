// E2E: グラフの切替レイアウト、内訳2行、データなしの月、カード高さ一定、focus-visible、aria-live
const path = require('path');
const { SHOT_DIR, sleep, hex, setTheme, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;



// 6月 ¥104,000、7月 なし、8月 家賃のみ、9月 なし、10月 ¥101,000、11月 ¥104,000
const seed = () => {
  const mk = (id, month, itemId, payerId, amount) => ({ id, month, itemId, payerId, amount, extra: false, updatedAt: 1, itemName: '' });
  const s = WarikanStore.load();
  s.payments = [
    mk('j1', '2026-06', 'item-yachin', 'kanojo', 60000), mk('j2', '2026-06', 'item-kaimono', 'kanojo', 30000), mk('j3', '2026-06', 'item-denki', 'yamada', 14000),
    mk('c1', '2026-08', 'item-yachin', 'kanojo', 60000),
    mk('b1', '2026-10', 'item-yachin', 'kanojo', 60000), mk('b2', '2026-10', 'item-kaimono', 'kanojo', 27000), mk('b3', '2026-10', 'item-denki', 'yamada', 14000),
    mk('a1', '2026-11', 'item-yachin', 'kanojo', 60000), mk('a2', '2026-11', 'item-kaimono', 'kanojo', 30000), mk('a3', '2026-11', 'item-denki', 'yamada', 14000),
  ];
  localStorage.setItem('warikan-v1', JSON.stringify(s));
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

  const detail = () => p.evaluate(() => {
    const card = document.querySelector('[data-card=chart]');
    const q = (s) => card.querySelector(s);
    return {
      h: Math.round(card.getBoundingClientRect().height),
      sum: q('.chart-sum').textContent,
      sumW: getComputedStyle(q('.chart-sum')).fontWeight,
      who: q('.chart-who').textContent,
      diff: q('.chart-diff').textContent,
      diffC: getComputedStyle(q('.chart-diff')).color,
      sub: getComputedStyle(document.body).getPropertyValue('--sub').trim(),
    };
  });
  const pick = async (i) => { await p.evaluate((i) => document.querySelectorAll('.cbar')[i].click(), i); await sleep(120); };

  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 375, 320]) {
      const tag = `${width}-${scheme}`;
      await p.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await p.goto(URL, { waitUntil: 'networkidle0' });
      await p.evaluate((scheme) => { localStorage.clear(); localStorage.setItem('warikan-theme', scheme); }, scheme);
      await p.reload({ waitUntil: 'networkidle0' });
      await p.evaluate(seed);
      await p.reload({ waitUntil: 'networkidle0' });
      await p.evaluate(() => document.querySelector('[data-tab=hist]').click());
      await sleep(400);

      const lay = await p.evaluate(() => {
        const card = document.querySelector('[data-card=chart]');
        const pairs = [...card.querySelectorAll('.chart-who .pair')].map((x) => ({ ws: getComputedStyle(x).whiteSpace, lines: Math.round(x.getBoundingClientRect().height / 20) }));
        const dots = [...card.querySelectorAll('.chart-who .dot')].map((x) => getComputedStyle(x).backgroundColor);
        const live = card.querySelector('.chart-detail');
        return { noSeg: !card.querySelector('.seg') && !card.querySelector('[data-act=chart-mode]'), pairs, dots, live: live && live.getAttribute('aria-live'),
          hasDiff: !!(live && live.querySelector('.chart-diff')), overflow: document.documentElement.scrollWidth > window.innerWidth };
      });
      ck(`${tag} すべて｜変わる項目だけの切替はない`, lay.noSeg);
      ck(`${tag} 名前と金額は nowrap`, lay.pairs.length === 2 && lay.pairs.every((x) => x.ws === 'nowrap' && x.lines === 1), JSON.stringify(lay.pairs));
      const want = scheme === 'light' ? ['#14B8A6', '#F97366'] : ['#2DD4BF', '#FB8A7E'];
      ck(`${tag} ●の色は各人の色`, hex(lay.dots[0]) === want[0] && hex(lay.dots[1]) === want[1]);
      ck(`${tag} 内訳と差分に aria-live=polite`, lay.live === 'polite' && lay.hasDiff);
      ck(`${tag} 横スクロールなし`, !lay.overflow);

      const d11 = await detail();
      ck(`${tag} 1行目 太字「11月 合計 ¥104,000」`, d11.sum === '11月 合計 ¥104,000' && Number(d11.sumW) >= 700, d11.sum);
      ck(`${tag} 2行目「● 自分 ¥14,000　● 相手 ¥90,000」`, d11.who === '自分 ¥14,000　相手 ¥90,000', d11.who);
      ck(`${tag} 3行目「先月より +¥3,000」`, d11.diff === '先月より +¥3,000');
      await p.screenshot({ path: path.join(SHOT_DIR, `chart-${tag}.png`) });

      await pick(1); // 7月 データなし（6月は¥104,000）
      const d7 = await detail();
      ck(`${tag} データなしの7月: −¥104,000 を出さず「この月のデータなし」灰色`, d7.diff === 'この月のデータなし' && hex(d7.diffC) === d7.sub.toUpperCase() && d7.sum === '7月 合計 ¥0', d7.diff + ' / ' + d7.sum);
      await p.screenshot({ path: path.join(SHOT_DIR, `chart-empty-selected-${tag}.png`) });
      await pick(4); // 10月, 9月なし
      const d10 = await detail();
      ck(`${tag} 前月がデータなしの10月:「先月のデータなし」灰色`, d10.diff === '先月のデータなし' && hex(d10.diffC) === d10.sub.toUpperCase());
      await p.screenshot({ path: path.join(SHOT_DIR, `chart-empty-prev-${tag}.png`) });
      await pick(0); // 6月: 前月(5月)は範囲外
      const d6 = await detail();
      ck(`${tag} 範囲先頭の6月も「先月のデータなし」`, d6.diff === '先月のデータなし');
      await pick(2); const d8 = await detail();
      ck(`${tag} カードの高さが月を選んでも変わらない`, [d11.h, d7.h, d10.h, d6.h, d8.h].every((h) => h === d11.h), [d11.h, d7.h, d10.h, d6.h, d8.h].join(','));
    }
  }

  // focus-visible: タップ（マウス）では輪郭なし、キーボードでは 2px --pri
  await setTheme(p, 'light');
  await p.reload({ waitUntil: 'networkidle0' });
  await p.setViewport({ width: 375, height: 844, deviceScaleFactor: 2, isMobile: false, hasTouch: false });
  await p.reload({ waitUntil: 'networkidle0' });
  await p.evaluate(() => document.querySelector('[data-tab=hist]').click());
  await sleep(300);
  const bar = await p.$$('.cbar');
  await bar[4].click();
  await sleep(150);
  const mouse = await p.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { m: a.dataset.month, fv: a.matches(':focus-visible'), style: cs.outlineStyle, w: cs.outlineWidth }; });
  ck('タップ後は focus-visible でなく輪郭なし（黒い四角なし）', mouse.m === '2026-10' && !mouse.fv && (mouse.style === 'none' || mouse.w === '0px'), JSON.stringify(mouse));
  await p.screenshot({ path: path.join(SHOT_DIR, 'focus-tap-375-light.png') });
  await p.keyboard.press('Tab');
  await p.keyboard.down('Shift'); await p.keyboard.press('Tab'); await p.keyboard.up('Shift');
  await sleep(100);
  const kb = await p.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { cls: a.className, fv: a.matches(':focus-visible'), style: cs.outlineStyle, w: cs.outlineWidth, c: cs.outlineColor, off: cs.outlineOffset, r: cs.borderRadius, pri: getComputedStyle(document.body).getPropertyValue('--pri').trim() }; });
  ck('キーボードでは 2px solid --pri、offset 2px、角丸 8px', /cbar/.test(kb.cls) && kb.fv && kb.style === 'solid' && kb.w === '2px' && hex(kb.c) === kb.pri.toUpperCase() && kb.off === '2px' && kb.r === '8px', JSON.stringify(kb));
  await p.screenshot({ path: path.join(SHOT_DIR, 'focus-keyboard-375-light.png') });

  // aria-live の器とカードは月の選択・切替で入れ替わらない
  await p.evaluate(() => { window.__live = document.querySelector('.chart-detail'); window.__card = document.querySelector('[data-card=chart]'); window.__bar = document.querySelectorAll('.cbar')[3]; });
  await p.evaluate(() => document.querySelectorAll('.cbar')[1].click());
  await sleep(100);
  const id1 = await p.evaluate(() => ({
    live: document.querySelector('.chart-detail') === window.__live, card: document.querySelector('[data-card=chart]') === window.__card,
    bar: document.querySelectorAll('.cbar')[3] === window.__bar, focus: document.activeElement === document.querySelectorAll('.cbar')[1],
    pressed: [...document.querySelectorAll('.cbar')].map((x) => x.getAttribute('aria-pressed')).join(),
    op: getComputedStyle(document.querySelectorAll('.cbar')[5].querySelector('.cbar-plot')).opacity,
    text: window.__live.querySelector('.chart-sum').textContent,
  }));
  ck('月を選んでも aria-live の器・カード・棒は同じノード', id1.live && id1.card && id1.bar, JSON.stringify(id1));
  ck('選んだ棒にフォーカス、aria-pressed と不透明度をその場で更新', id1.focus && id1.pressed === 'false,true,false,false,false,false' && id1.op === '0.6' && id1.text === '7月 合計 ¥0', JSON.stringify(id1));
  await p.evaluate(() => document.querySelectorAll('.cbar')[2].click());
  await sleep(100);
  const id2 = await p.evaluate(() => ({
    live: document.querySelector('.chart-detail') === window.__live, card: document.querySelector('[data-card=chart]') === window.__card,
    bar: document.querySelectorAll('.cbar')[3] === window.__bar,
    focus: document.activeElement === document.querySelectorAll('.cbar')[2],
    anim: getComputedStyle(document.querySelector('.cbar-stack') || document.body).animationName,
    sel: document.querySelector('.cbar[aria-pressed=true]') && document.querySelector('.cbar[aria-pressed=true]').dataset.month,
    text: window.__live.querySelector('.chart-sum').textContent,
  }));
  ck('別の月を選んでも aria-live の器とカードは同じノード', id2.live && id2.card && id2.bar, JSON.stringify(id2));
  ck('選んだ月は維持され、棒は伸び直さない', id2.focus && id2.sel === '2026-08' && id2.anim === 'none' && id2.text === '8月 合計 ¥60,000', JSON.stringify(id2));

  // 再読み込みで選択は今月に戻る
  await p.reload({ waitUntil: 'networkidle0' });
  await p.evaluate(() => document.querySelector('[data-tab=hist]').click());
  await sleep(200);
  const reset = await p.evaluate(() => ({ sel: document.querySelector('.cbar[aria-pressed=true]') && document.querySelector('.cbar[aria-pressed=true]').dataset.month, noSeg: !document.querySelector('.seg') }));
  ck('再読み込みで今月に戻る', reset.sel === '2026-11' && reset.noSeg, JSON.stringify(reset));

  ck('ページエラーなし', errs.length === 0, errs.join(' | '));
  await b.close();
  if (R.fails) { console.log('FAILED ' + R.fails); process.exit(1); }
  console.log('e2e-v131 ok');
})().catch((e) => { console.error(e); process.exit(1); });
