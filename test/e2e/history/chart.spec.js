// E2E: 履歴の「月ごとの支払い」棒グラフ
const path = require('path');
const { SHOT_DIR, sleep, hex, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;

// 11月: 自分 14,000 / 相手 90,000（家賃60,000含む）。10月: 101,000。9月: データなし。8月: 家賃だけ。
const seed = () => {
  const mk = (id, month, itemId, payerId, amount) => ({ id, month, itemId, payerId, amount, extra: false, updatedAt: 1, itemName: '' });
  const pays = [
    mk('a1', '2026-11', 'item-yachin', 'kanojo', 60000), mk('a2', '2026-11', 'item-kaimono', 'kanojo', 30000),
    mk('a3', '2026-11', 'item-denki', 'yamada', 4000), mk('a4', '2026-11', 'item-gas', 'yamada', 3000),
    mk('a5', '2026-11', 'item-suidou', 'yamada', 3000), mk('a6', '2026-11', 'item-net', 'yamada', 4000),
    mk('b1', '2026-10', 'item-yachin', 'kanojo', 60000), mk('b2', '2026-10', 'item-kaimono', 'kanojo', 27000),
    mk('b3', '2026-10', 'item-denki', 'yamada', 14000),
    mk('c1', '2026-08', 'item-yachin', 'kanojo', 60000),
    mk('d1', '2026-07', 'item-kaimono', 'kanojo', 20000), mk('d2', '2026-07', 'item-denki', 'yamada', 5000),
  ];
  const s = WarikanStore.load();
  s.payments = pays;
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

  for (const scheme of ['light', 'dark']) {
    for (const width of [375, 320]) {
      const tag = `${width}-${scheme}`;
      await p.setViewport({ width, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await p.goto(URL, { waitUntil: 'networkidle0' });
      await p.evaluate((scheme) => { localStorage.clear(); localStorage.setItem('warikan-theme', scheme); }, scheme);
      await p.reload({ waitUntil: 'networkidle0' });
      await p.evaluate(seed);
      await p.reload({ waitUntil: 'networkidle0' });
      await p.evaluate(() => document.querySelector('[data-tab=hist]').click());
      await sleep(450);

      const c = await p.evaluate(() => {
        const card = document.querySelector('[data-card=chart]');
        const main = document.getElementById('main');
        const bars = [...document.querySelectorAll('.cbar')];
        const rb = (el) => el.getBoundingClientRect();
        const stack = (b) => b.querySelector('.cbar-stack');
        return {
          first: main.firstElementChild === card,
          title: card && card.querySelector('h2').textContent,
          seg: [...card.querySelectorAll('.seg button')].map((x) => x.textContent),
          labels: bars.map((b) => b.querySelector('.cbar-lab').textContent),
          curBold: getComputedStyle(bars[5].querySelector('.cbar-lab')).fontWeight,
          curColor: getComputedStyle(bars[5].querySelector('.cbar-lab')).color,
          otherColor: getComputedStyle(bars[0].querySelector('.cbar-lab')).color,
          labSize: getComputedStyle(bars[0].querySelector('.cbar-lab')).fontSize,
          plotH: Math.round(rb(bars[5].querySelector('.cbar-plot')).height),
          heights: bars.map((b) => (stack(b) ? Math.round(rb(stack(b)).height) : 0)),
          widths: bars.map((b) => Math.round(rb(b.querySelector('.cbar-plot')).width)),
          tap: bars.map((b) => ({ w: Math.round(rb(b).width), h: Math.round(rb(b).height) })),
          stubH: (() => { const s = bars[3].querySelector('.cbar-stub'); return s ? Math.round(rb(s).height) : -1; })(),
          pressed: bars.map((b) => b.getAttribute('aria-pressed')),
          aria5: bars[5].getAttribute('aria-label'),
          opac0: getComputedStyle(bars[0].querySelector('.cbar-plot')).opacity,
          opac5: getComputedStyle(bars[5].querySelector('.cbar-plot')).opacity,
          yColor: getComputedStyle(bars[5].querySelector('.cbar-y')).backgroundColor,
          kColor: getComputedStyle(bars[5].querySelector('.cbar-k')).backgroundColor,
          kTop: bars[5].querySelector('.cbar-k').getBoundingClientRect().top < bars[5].querySelector('.cbar-y').getBoundingClientRect().top,
          gap: Math.round(rb(bars[5].querySelector('.cbar-y')).top - rb(bars[5].querySelector('.cbar-k')).bottom),
          kRadius: getComputedStyle(bars[5].querySelector('.cbar-k')).borderTopLeftRadius + '/' + getComputedStyle(bars[5].querySelector('.cbar-k')).borderBottomLeftRadius,
          base: getComputedStyle(document.querySelector('.chart-bars')).borderBottomColor,
          baseW: getComputedStyle(document.querySelector('.chart-bars')).borderBottomWidth,
          sum: card.querySelector('.chart-sum').textContent,
          diff: card.querySelector('.chart-diff') && card.querySelector('.chart-diff').textContent,
          diffColor: card.querySelector('.chart-diff') && getComputedStyle(card.querySelector('.chart-diff')).color,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          hist: !!document.querySelector('.hlist, .empty'),
        };
      });
      ck(`${tag} 履歴の先頭に「月ごとの支払い」`, c.first && c.title === '月ごとの支払い' && c.hist);
      ck(`${tag} すべて｜変わる項目だけの切替はない`, !c.seg.length);
      ck(`${tag} 6か月 6月〜11月 古い順`, c.labels.join(',') === '6月,7月,8月,9月,10月,11月');
      ck(`${tag} 月ラベル 12px、今月は太字で本文色`, c.labSize === '12px' && Number(c.curBold) >= 700 && c.curColor !== c.otherColor);
      ck(`${tag} グラフの高さ 140px、最大の月がいっぱい`, c.plotH === 140 && Math.max(...c.heights) === 140 && c.heights[5] === 140, JSON.stringify(c.heights));
      ck(`${tag} 棒の幅は最大 28px`, c.widths.every((w) => w <= 28 && w > 0), JSON.stringify(c.widths));
      ck(`${tag} 棒はタップ領域 ≥44px（高さ）`, c.tap.every((x) => x.h >= 44), JSON.stringify(c.tap));
      ck(`${tag} データのない月（9月）は 4px の灰色`, c.stubH === 4);
      ck(`${tag} 今月が選ばれ他は 60%`, c.pressed.join() === 'false,false,false,false,false,true' && c.opac0 === '0.6' && c.opac5 === '1');
      ck(`${tag} aria-label`, c.aria5 === '11月 合計104,000円', c.aria5);
      const want = scheme === 'light' ? ['#14B8A6', '#F97366', '#ECE8E3'] : ['#2DD4BF', '#FB8A7E', '#3A3734'];
      ck(`${tag} 色 自分 ${want[0]} 下・相手 ${want[1]} 上、間 2px`, hex(c.yColor) === want[0] && hex(c.kColor) === want[1] && c.kTop && c.gap === 2, c.gap);
      ck(`${tag} 上の角だけ 6px`, c.kRadius === '6px/0px', c.kRadius);
      ck(`${tag} 基線 1px ${want[2]}`, hex(c.base) === want[2] && c.baseW === '1px');
      ck(`${tag} 1行目「11月 合計 ¥104,000」`, c.sum === '11月 合計 ¥104,000', c.sum);
      ck(`${tag} 2行目「先月より +¥3,000」琥珀`, c.diff === '先月より +¥3,000' && hex(c.diffColor) === (scheme === 'light' ? '#92560A' : '#FBBF24'), c.diff + ' ' + hex(c.diffColor));
      ck(`${tag} 横スクロールなし`, !c.overflow);
      await p.screenshot({ path: path.join(SHOT_DIR, `chart-all-${tag}.png`) });


      // 10月を選ぶ（減った）
      await p.evaluate(() => document.querySelectorAll('.cbar')[4].click());
      await sleep(150);
      const s = await p.evaluate(() => ({
        pressed: [...document.querySelectorAll('.cbar')].map((b) => b.getAttribute('aria-pressed')).join(),
        sum: document.querySelector('.chart-sum').textContent,
        diff: document.querySelector('.chart-diff') && document.querySelector('.chart-diff').textContent,
        focus: document.activeElement && document.activeElement.dataset.month,
      }));
      ck(`${tag} 10月を選ぶ（9月にデータがないので「先月のデータなし」）`, s.pressed === 'false,false,false,false,true,false' && s.sum === '10月 合計 ¥101,000' && s.diff === '先月のデータなし' && s.focus === '2026-10', s.sum);
      await p.screenshot({ path: path.join(SHOT_DIR, `chart-selected-oct-${tag}.png`) });
      // 8月→7月より +35,000、7月を選ぶと8月比… 8月選択
      await p.evaluate(() => document.querySelectorAll('.cbar')[2].click());
      await sleep(150);
      const d = await p.evaluate(() => { const e = document.querySelector('.chart-diff'); return e && { t: e.textContent, c: getComputedStyle(e).color }; });
      ck(`${tag} 8月は先月より +¥35,000`, d && d.t === '先月より +¥35,000');
      // 減少: 7月の買い物を増やして 8月を減少に
      await p.evaluate(() => { const s = WarikanStore.load(); s.payments.find((x) => x.id === 'd1').amount = 90000; localStorage.setItem('warikan-v1', JSON.stringify(s)); });
      await p.reload({ waitUntil: 'networkidle0' });
      await p.evaluate(() => document.querySelector('[data-tab=hist]').click());
      await sleep(150);
      await p.evaluate(() => document.querySelectorAll('.cbar')[2].click());
      await sleep(150);
      const dn = await p.evaluate(() => { const e = document.querySelector('.chart-diff'); return e && { t: e.textContent, c: getComputedStyle(e).color }; });
      ck(`${tag} 減ったときは「−¥35,000」ティール`, dn && dn.t === '先月より −¥35,000' && hex(dn.c) === (scheme === 'light' ? '#0F766E' : '#2DD4BF'), dn && dn.t + ' ' + hex(dn.c));
    }
  }

  // 動きを減らす設定ではアニメなし
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await p.reload({ waitUntil: 'networkidle0' });
  await p.evaluate(() => document.querySelector('[data-tab=hist]').click());
  await sleep(50);
  const anim = await p.evaluate(() => getComputedStyle(document.querySelector('.cbar-stack')).animationName);
  ck('動きを減らす設定ではアニメなし', anim === 'none', anim);
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await p.reload({ waitUntil: 'networkidle0' });
  await p.evaluate(() => document.querySelector('[data-tab=hist]').click());
  await sleep(50);
  const anim2 = await p.evaluate(() => { const s = getComputedStyle(document.querySelector('.cbar-stack')); return s.animationName + ' ' + s.animationDuration; });
  ck('初回は下から 0.3s で伸びる', anim2 === 'cgrow 0.3s', anim2);

  // 今日が11月でも、11月と12月を精算したらグラフに12月が出る
  await p.evaluateOnNewDocument(() => { window.__warikanSettleDelay = 0; });
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    const fill = (m, map) => {
      S.ensureMonth(s, m);
      for (const pay of s.payments.filter((x) => x.month === m && !x.extra)) {
        if (map[pay.itemId] != null) S.updatePayment(s, pay.id, { amount: map[pay.itemId] });
      }
    };
    const amt = { 'item-yachin': 60000, 'item-kaimono': 30000, 'item-denki': 4000, 'item-gas': 3000, 'item-suidou': 3000, 'item-net': 4000 };
    fill('2026-11', amt);
    fill('2026-12', amt);
    S.setRatio(s, 50);
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await p.evaluate(() => { window.__warikanSettleDelay = 0; const b = document.querySelector('[data-act=settle]'); if (b) b.click(); });
  await sleep(250);
  const afterNov = await p.evaluate(() => ({
    settled: WarikanStore.isSettled(WarikanStore.load(), '2026-11'),
    label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
  }));
  if (!/2026年12月/.test(afterNov.label || '')) {
    await p.evaluate(() => { const b = document.querySelector('[data-act=next-m]'); if (b && !b.disabled) b.click(); });
    await sleep(150);
  }
  await p.evaluate(() => { const b = document.querySelector('[data-act=settle]'); if (b) b.click(); });
  await sleep(250);
  const settled = await p.evaluate(() => ({
    nov: WarikanStore.isSettled(WarikanStore.load(), '2026-11'),
    dec: WarikanStore.isSettled(WarikanStore.load(), '2026-12'),
  }));
  await p.evaluate(() => document.querySelector('[data-tab=hist]').click());
  await sleep(300);
  const hist = await p.evaluate(() => {
    const labels = [...document.querySelectorAll('.cbar-lab')].map((el) => el.textContent.trim());
    const months = [...document.querySelectorAll('.cbar')].map((el) => el.dataset.month);
    const list = [...document.querySelectorAll('.hrow .l b')].map((el) => el.textContent.trim());
    const selected = document.querySelector('.cbar.on, .cbar[aria-pressed="true"]');
    const sum = document.querySelector('.chart-sum') && document.querySelector('.chart-sum').textContent;
    return {
      labels, months, list,
      canPickDec: !!document.querySelector('.cbar[data-month="2026-12"]'),
      selectedMonth: selected && selected.dataset.month,
      sum,
    };
  });
  ck('11月と12月を精算するとグラフに12月が出る（今日は11月）',
    settled.nov && settled.dec && hist.labels.includes('12月') && hist.months.includes('2026-12') && hist.canPickDec,
    JSON.stringify({ settled, hist }));
  ck('履歴の一覧にも12月が出る',
    hist.list.some((t) => /2026年12月/.test(t)),
    JSON.stringify(hist.list));
  ck('今日が11月のときに11月と12月を精算すると、12月が初めから選ばれている',
    hist.selectedMonth === '2026-12' && /12月 合計/.test(hist.sum || ''),
    JSON.stringify({ selectedMonth: hist.selectedMonth, sum: hist.sum }));
  await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.evaluate(() => localStorage.setItem('warikan-theme', 'light'));
  await p.reload({ waitUntil: 'networkidle0' });
  await p.evaluate(() => document.querySelector('[data-tab=hist]').click());
  await sleep(450);
  const afterReload = await p.evaluate(() => {
    const selected = document.querySelector('.cbar.on, .cbar[aria-pressed="true"]');
    return selected && selected.dataset.month;
  });
  ck('再読み込み後も12月が初めから選ばれている', afterReload === '2026-12', afterReload);
  await p.screenshot({ path: path.join(SHOT_DIR, 'chart-375-light.png') });
  if (hist.canPickDec) {
    await p.evaluate(() => document.querySelector('.cbar[data-month="2026-12"]').click());
    await sleep(150);
    const det = await p.evaluate(() => document.querySelector('.chart-sum') && document.querySelector('.chart-sum').textContent);
    ck('12月の棒を選ぶと内訳が出る', /12月 合計/.test(det || ''), det);
  }

  ck('ページエラーなし', errs.length === 0, errs.join(' | '));
  await b.close();
  if (R.fails) { console.log('FAILED ' + R.fails); process.exit(1); }
  console.log('e2e-v130 ok');
})().catch((e) => { console.error(e); process.exit(1); });
