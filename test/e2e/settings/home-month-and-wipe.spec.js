// E2E: ホームの月、設定の見出し、削除、グラフ、スクリーンショット
const path = require('path');
const { VERSION, SHOT_DIR, sleep, hex, contrast, setTheme, launch, reporter, APPURL: URL } = require('../helpers');
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
  if (!S.getOpening(s)) S.setOpening(s, 'yamada', 250000);
};



const clickSettle = async (p) => {
  await p.click('[data-act=settle]');
  await sleep(200);
  const need = await p.evaluate(() => !!(document.getElementById('dlg') && document.getElementById('dlg').open && document.querySelector('[data-act=settle-anyway]')));
  if (need) {
    await p.click('[data-act=settle-anyway]');
    await sleep(200);
  }
};

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
  await sleep(250);

  const boot = await p.evaluate(() => document.getElementById('mLbl') && document.getElementById('mLbl').textContent);
  ck('確定がなければホームは実際の今月（11月）', /2026年11月/.test(boot || '') && !/🔒/.test(boot || ''), boot);
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-375-light.png') });

  // 精算すると次の月へ。タブ往復・再読み込みでも12月のまま
  await clickSettle(p);
  await p.click('[data-tab=hist]');
  await sleep(150);
  await p.click('[data-tab=home]');
  await sleep(200);
  const afterTab = await p.evaluate(() => document.getElementById('mLbl') && document.getElementById('mLbl').textContent);
  ck('タブから戻ると、最後に確定した月の次（12月）を出す', /2026年12月/.test(afterTab || '') && !/🔒/.test(afterTab || ''), afterTab);

  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  const afterReload = await p.evaluate(() => document.getElementById('mLbl') && document.getElementById('mLbl').textContent);
  ck('再読み込みしても12月を開く', /2026年12月/.test(afterReload || ''), afterReload);

  // いちばん先だった12月を確定すると、範囲を広げて1月へ
  await clickSettle(p);
  await p.click('[data-tab=set]');
  await sleep(150);
  await p.click('[data-tab=home]');
  await sleep(200);
  const jan = await p.evaluate(() => {
    const lab = document.getElementById('mLbl') && document.getElementById('mLbl').textContent;
    const next = document.querySelector('[data-act=next-m]');
    const prev = document.querySelector('[data-act=prev-m]');
    return { lab, nextDis: next && next.disabled, prevDis: prev && prev.disabled };
  });
  ck('いちばん先の12月を確定すると1月を出す', /2027年1月/.test(jan.lab || ''), JSON.stringify(jan));
  ck('1月で › は止める（これ以上はまだ広げない）', jan.nextDis === true && jan.prevDis === false, JSON.stringify(jan));
  await p.screenshot({ path: path.join(SHOT_DIR, 'jan-375-light.png') });

  // 設定
  await p.click('[data-tab=set]');
  await sleep(250);
  const set = await p.evaluate(() => {
    const main = document.getElementById('main');
    const first = main.querySelector('.card');
    const theme = first && getComputedStyle(first);
    const wipe = document.querySelector('[data-act=wipe]');
    const wcs = wipe && getComputedStyle(wipe);
    const note = [...main.querySelectorAll('.note')].pop();
    return {
      first: first && first.getAttribute('data-card'),
      titles: [...main.querySelectorAll('h2')].map((h) => h.textContent),
      visible: (main.innerText || '').replace(/\s+/g, ' '),
      ariaY: document.getElementById('nm-y') && document.getElementById('nm-y').getAttribute('aria-label'),
      ariaK: document.getElementById('nm-k') && document.getElementById('nm-k').getAttribute('aria-label'),
      themePadT: theme && theme.paddingTop,
      themePadB: theme && theme.paddingBottom,
      wipeText: wipe && wipe.textContent,
      wipeColor: wcs && wcs.color,
      wipeBorder: wcs && wcs.borderTopColor,
      wipeBg: wcs && wcs.backgroundColor,
      pageBg: getComputedStyle(document.body).backgroundColor,
      wipeBeforeNote: !!(wipe && note && wipe.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING),
      wipeInCard: !!(wipe && wipe.closest('.card')),
      ver: (main.innerText.match(/v\d+\.\d+\.\d+/) || [''])[0],
    };
  });
  ck('設定のいちばん上はテーマ切替（「表示」なし）', set.first === 'theme' && set.titles.indexOf('表示') < 0 && set.titles.indexOf('ふたり') < 0, JSON.stringify(set.titles));
  ck('テーマカードの上下余白は 16px', set.themePadT === '16px' && set.themePadB === '16px', set.themePadT + '/' + set.themePadB);
  ck('「ひとりめ」「ふたりめ」の見出しは見えず、aria-label はある', !/ひとりめ/.test(set.visible) && !/ふたりめ/.test(set.visible) && set.ariaY === 'ひとりめ' && set.ariaK === 'ふたりめ', set.visible.slice(0, 80));
  ck('設定の見出しは「残りの支払い」', set.titles.indexOf('残りの支払い') >= 0);
  ck('削除ボタンはカードの外、版のすぐ上', set.wipeText === '全てのデータを削除' && set.wipeBeforeNote && !set.wipeInCard && set.ver === 'v' + VERSION, JSON.stringify({ t: set.wipeText, before: set.wipeBeforeNote, inCard: set.wipeInCard, ver: set.ver }));
  const wipeC = contrast(set.wipeColor, set.pageBg);
  ck('ライトの削除ボタンは #B91C1C、コントラスト 4.5 以上', hex(set.wipeColor) === '#B91C1C' && hex(set.wipeBorder) === '#B91C1C' && wipeC >= 4.5, hex(set.wipeColor) + ' ' + wipeC.toFixed(2));
  await p.screenshot({ path: path.join(SHOT_DIR, 'set-375-light.png') });

  await setTheme(p, 'dark');
  await sleep(80);
  const setDark = await p.evaluate(() => {
    const wipe = document.querySelector('[data-act=wipe]');
    const wcs = getComputedStyle(wipe);
    return { color: wcs.color, border: wcs.borderTopColor, pageBg: getComputedStyle(document.body).backgroundColor };
  });
  const wipeCD = contrast(setDark.color, setDark.pageBg);
  ck('ダークの削除ボタンは #F87171、コントラスト 4.5 以上', hex(setDark.color) === '#F87171' && hex(setDark.border) === '#F87171' && wipeCD >= 4.5, hex(setDark.color) + ' ' + wipeCD.toFixed(2));
  await p.screenshot({ path: path.join(SHOT_DIR, 'set-375-dark.png') });

  // 確認シート
  await p.click('[data-act=wipe]');
  await sleep(200);
  const sheet = await p.evaluate(() => {
    const dlg = document.getElementById('dlg');
    const ok = [...dlg.querySelectorAll('button')].find((b) => b.textContent === '削除する');
    const no = [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'やめる');
    const ocs = ok && getComputedStyle(ok);
    return {
      open: dlg.open,
      title: (document.getElementById('dh') || {}).textContent,
      text: (dlg.innerText || '').replace(/\s+/g, ' '),
      okBg: ocs && ocs.backgroundColor,
      okColor: ocs && ocs.color,
      no: no && no.textContent,
    };
  });
  ck('確認シートの文言とボタン', sheet.open && /支払い・履歴・残りの支払いがすべて消えます。元には戻せません。/.test(sheet.text) && /削除する/.test(sheet.text) && sheet.no === 'やめる', JSON.stringify(sheet));
  const fillC = contrast(sheet.okColor, sheet.okBg);
  ck('削除するの塗りつぶしは白文字でコントラスト 4.5 以上', hex(sheet.okColor) === '#FFFFFF' && fillC >= 4.5, hex(sheet.okColor) + ' on ' + hex(sheet.okBg) + ' ' + fillC.toFixed(2));
  await p.screenshot({ path: path.join(SHOT_DIR, 'wipe-sheet-375-dark.png') });

  await p.click('button.btn.ghost'); // やめる
  await sleep(200);
  const canceled = await p.evaluate(() => ({
    open: document.getElementById('dlg').open,
    settled: WarikanStore.lastSettledMonth(WarikanStore.load()),
    theme: localStorage.getItem('warikan-theme'),
  }));
  ck('やめると削除しない', canceled.open === false && canceled.settled === '2026-12', JSON.stringify(canceled));

  await setTheme(p, 'light');
  await sleep(80);
  await p.click('[data-act=wipe]');
  await sleep(200);
  await p.screenshot({ path: path.join(SHOT_DIR, 'wipe-sheet-375-light.png') });
  await p.click('[data-act=wipe-ok]');
  await sleep(300);
  const wiped = await p.evaluate(() => {
    const toast = document.getElementById('toast');
    const s = WarikanStore.load();
    return {
      label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
      tab: document.querySelector('.tabs button.on') && document.querySelector('.tabs button.on').dataset.tab,
      toast: toast && !toast.hidden && toast.textContent,
      theme: document.documentElement.getAttribute('data-theme'),
      storedTheme: localStorage.getItem('warikan-theme'),
      settled: WarikanStore.lastSettledMonth(s),
      ledger: (s.ledger || []).length,
      paymentsFilled: (s.payments || []).filter((x) => x.amount != null && x.amount !== '').length,
      name: s.people.yamada.name,
    };
  });
  ck('削除後は最初のホーム（11月）に戻り、トーストを2秒出す', /2026年11月/.test(wiped.label || '') && wiped.tab === 'home' && wiped.toast === 'すべてのデータを削除しました' && wiped.settled === null && wiped.ledger === 0 && wiped.name === '自分', JSON.stringify(wiped));
  ck('ライトのまま削除するとテーマはライトのまま', wiped.theme === 'light' && wiped.storedTheme === 'light');
  await p.screenshot({ path: path.join(SHOT_DIR, 'after-wipe-375-light.png') });
  await sleep(2100);
  ck('トーストは2秒で消える', await p.evaluate(() => document.getElementById('toast').hidden) === true);

  // グラフ：切替なし、全部の合計
  await p.evaluate(seedExample, AMOUNTS);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await p.click('[data-tab=hist]');
  await sleep(300);
  const chart = await p.evaluate(() => ({
    title: document.querySelector('.chart-title') && document.querySelector('.chart-title').textContent,
    seg: !!document.querySelector('[data-card=chart] .seg, [data-act=chart-mode]'),
    sum: document.querySelector('.chart-sum') && document.querySelector('.chart-sum').textContent,
  }));
  ck('グラフに切替はなく、全部の合計を出す', !chart.seg && chart.title === '月ごとの支払い' && chart.sum === '11月 合計 ¥104,000', JSON.stringify(chart));
  await p.screenshot({ path: path.join(SHOT_DIR, 'chart-375-light.png') });
  await setTheme(p, 'dark');
  await sleep(80);
  await p.screenshot({ path: path.join(SHOT_DIR, 'chart-375-dark.png') });
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-375-dark.png') }); // will be hist; take home too
  await p.click('[data-tab=home]');
  await sleep(200);
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-375-dark.png') });

  ck('ページエラーなし', errs.length === 0, errs.join(' | '));

  await b.close();
  if (R.fails) { console.log('\nFAILED', R.fails); process.exit(1); }
  console.log('\nAll v1.5.0 e2e passed');
})().catch((e) => { console.error(e); process.exit(1); });
