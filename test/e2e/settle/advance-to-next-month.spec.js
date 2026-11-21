// E2E: 確定して次の月へ、テーマ、残りの支払い、移行、スクリーンショット
const path = require('path');
const { VERSION, SHOT_DIR, sleep, hex, setTheme, launch, reporter, APPURL: URL } = require('../helpers');
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
  await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);

  // 初期はライト。端末がダークでもテーマキーがなければライト
  const bootTheme = await p.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    scheme: document.documentElement.style.colorScheme || getComputedStyle(document.documentElement).colorScheme,
    color: document.querySelector('meta[name=theme-color]') && document.querySelector('meta[name=theme-color]').content,
    stored: localStorage.getItem('warikan-theme'),
    bg: getComputedStyle(document.body).backgroundColor,
  }));
  ck('初期テーマはライト', bootTheme.theme === 'light' && bootTheme.scheme === 'light' && bootTheme.color === '#FAF8F5' && hex(bootTheme.bg) === '#FAF8F5', JSON.stringify(bootTheme));

  await p.evaluate(seedExample, AMOUNTS);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);

  const home = await p.evaluate(() => {
    const card = document.querySelector('[data-card=tsuke]');
    return {
      label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
      amt: document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent,
      tsuke: card && card.innerText.replace(/\s+/g, ' ').trim(),
      repay: card && card.querySelector('[data-act=repay]') && card.querySelector('[data-act=repay]').textContent,
    };
  });
  ck('11月・精算額 ¥38,000', /2026年11月/.test(home.label || '') && home.amt === '¥38,000');
  ck('ホームのカードは「残りの支払い」と「支払った」', /残りの支払い/.test(home.tsuke || '') && /自分 → 相手/.test(home.tsuke || '') && /¥250,000/.test(home.tsuke || '') && home.repay === '支払った');
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-375-light.png') });

  // 精算すると確定メッセージのあと、次の月へ横スライド
  await p.click('[data-act=settle]');
  await sleep(200);
  const confirmed = await p.evaluate(() => ({
    open: document.getElementById('dlg').open,
    text: document.querySelector('.settle-confirmed') && document.querySelector('.settle-confirmed').textContent,
    signed: (WarikanStore.load().ledger || []).reduce((a, e) => a + e.signed, 0),
    choice: ((WarikanStore.getSettlement(WarikanStore.load(), '2026-11') || {}).snapshot || {}).choice,
  }));
  ck('精算は1ボタンで確定し、11月を確定しましたと出す', confirmed.open === false && confirmed.text === '11月を確定しました' && confirmed.choice === 'settled' && confirmed.signed === 288000, JSON.stringify(confirmed));

  await p.waitForFunction(() => /2026年12月/.test((document.getElementById('mLbl') || {}).textContent || ''), { timeout: 3000 });
  const advanced = await p.evaluate(() => ({
    label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
    toast: document.getElementById('toast') && !document.getElementById('toast').hidden && document.getElementById('toast').textContent,
    track: !!document.querySelector('.mslide-track'),
  }));
  ck('0.6秒後に12月へ切り替わり「12月になりました」を出す', /2026年12月/.test(advanced.label || '') && advanced.toast === '12月になりました', JSON.stringify(advanced));
  await sleep(400);

  // 11月は🔒で編集できない
  await p.click('[data-act=prev-m]');
  await sleep(200);
  const locked = await p.evaluate(() => {
    const row = document.querySelector('.prow');
    if (row) row.click();
    return {
      label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
      lock: /🔒/.test((document.getElementById('mLbl') || {}).textContent || ''),
      aria: document.getElementById('mLbl') && document.getElementById('mLbl').getAttribute('aria-label'),
      add: !!document.querySelector('[data-act=add-pay]'),
      edit: !!document.querySelector('[data-act=edit-pay]'),
      open: document.getElementById('dlg').open,
      tsuke: document.querySelector('[data-card=tsuke]').innerText,
    };
  });
  ck('確定した月は月名の横に🔒、追加・編集なし', /2026年11月/.test(locked.label || '') && locked.lock && /精算済み/.test(locked.aria || '') && !locked.add && !locked.edit && !locked.open, JSON.stringify(locked));
  ck('残りの支払いには11月分が乗っている', /¥288,000/.test(locked.tsuke || ''));
  await p.screenshot({ path: path.join(SHOT_DIR, 'settled-375-light.png') });

  // 支払った（全額ボタンあり）と記録
  await p.click('[data-act=repay]');
  await sleep(200);
  const repaySheet = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('#dlg button')].find((x) => /全額/.test(x.textContent));
    return { open: document.getElementById('dlg').open, title: (document.getElementById('dh') || {}).textContent, all: btn && btn.textContent };
  });
  ck('支払ったシートに全額ボタン', repaySheet.open && repaySheet.title === '支払った' && repaySheet.all === '全額 ¥288,000', JSON.stringify(repaySheet));
  await p.evaluate(() => {
    const a = document.getElementById('repayAmt');
    a.value = '30000';
    a.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.click('#repayForm button[type=submit]');
  await sleep(300);
  ck('¥30,000 支払うと残り 258,000', await p.evaluate(() => /¥258,000/.test(document.querySelector('[data-card=tsuke]').innerText)));

  await p.click('[data-card=tsuke] .tsuke-body');
  await sleep(250);
  const ledger = await p.evaluate(() => ({
    title: document.querySelector('#top .mnav b') && document.querySelector('#top .mnav b').textContent,
    rows: [...document.querySelectorAll('.lrow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
    amts: [...document.querySelectorAll('.lrow .amt')].map((a) => ({ t: a.textContent, cls: a.className, color: getComputedStyle(a).color })),
  }));
  ck('記録画面の名前は「支払いの記録」', ledger.title === '支払いの記録');
  ck('行は11月分（アンバーの+）と支払った（ティールの−）とこれまでの残り',
    ledger.rows.length === 3
    && /支払った/.test(ledger.rows[0]) && /¥30,000/.test(ledger.rows[0])
    && /11月分/.test(ledger.rows[1]) && /\+¥38,000/.test(ledger.rows[1])
    && /これまでの残り/.test(ledger.rows[2])
    && ledger.amts[0].t === '−¥30,000' && hex(ledger.amts[0].color) === '#0F766E'
    && ledger.amts[1].t === '+¥38,000' && hex(ledger.amts[1].color) === '#A16207', JSON.stringify(ledger));
  await p.screenshot({ path: path.join(SHOT_DIR, 'ledger-375-light.png') });
  await p.click('[data-act=close-ledger]');
  await sleep(200);

  // 履歴の確定を取り消す
  await p.click('[data-tab=hist]');
  await sleep(250);
  const hist = await p.evaluate(() => ({
    text: document.body.innerText,
    unconfirm: !!document.querySelector('[data-act=unconfirm][data-month="2026-11"]'),
    badge: document.querySelector('.hbadge') && document.querySelector('.hbadge').textContent,
    link: !![...document.querySelectorAll('button')].find((b) => b.textContent === '支払いの記録を見る'),
  }));
  ck('履歴に精算済みと修正', /2026年11月/.test(hist.text) && hist.badge === '精算済み' && hist.unconfirm && hist.link);
  await p.screenshot({ path: path.join(SHOT_DIR, 'hist-375-light.png') });
  await p.click('[data-act=unconfirm][data-month="2026-11"]');
  await sleep(200);
  ck('取り消しの確認が出る', await p.evaluate(() => document.getElementById('dlg').open && /11月を修正しますか/.test(document.getElementById('dlg').innerText)));
  await p.click('[data-act=unconfirm-ok]');
  await sleep(250);
  const afterUndo = await p.evaluate(() => {
    const s = WarikanStore.load();
    return {
      settled: WarikanStore.isSettled(s, '2026-11'),
      total: (s.ledger || []).reduce((a, e) => a + e.signed, 0),
      kinds: (s.ledger || []).map((e) => e.kind),
    };
  });
  ck('取り消すと11月の分が残りから戻り、支払った分は残る', afterUndo.settled === false && afterUndo.total === 220000 && afterUndo.kinds.sort().join() === 'opening,repayment', JSON.stringify(afterUndo));

  // 設定の表示カード
  await p.click('[data-tab=set]');
  await sleep(200);
  const set = await p.evaluate(() => {
    const first = document.querySelector('#main .card');
    return {
      first: first && first.getAttribute('data-card'),
      titles: [...document.querySelectorAll('#main h2')].map((h) => h.textContent),
      theme: [...document.querySelectorAll('[data-act=theme]')].map((b) => ({ t: b.textContent, on: b.classList.contains('on'), pressed: b.getAttribute('aria-pressed') })),
      opening: document.querySelector('[data-card=opening]') && document.querySelector('[data-card=opening]').innerText,
      ver: (document.body.innerText.match(/v\d+\.\d+\.\d+/) || [''])[0],
    };
  });
  ck('設定のいちばん上は見出しなしのライト／ダーク', set.first === 'theme' && set.titles.indexOf('表示') < 0 && set.titles.indexOf('ふたり') < 0 && set.theme.length === 2 && set.theme[0].t === 'ライト' && set.theme[0].on && set.theme[1].t === 'ダーク' && !set.theme[1].on, JSON.stringify(set));
  ck('設定に「残りの支払い」がある', /残りの支払い/.test(set.opening || '') && set.ver === 'v' + VERSION);
  await p.screenshot({ path: path.join(SHOT_DIR, 'set-375-light.png') });

  await p.click('[data-theme-set=dark]');
  await sleep(200);
  const dark = await p.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    stored: localStorage.getItem('warikan-theme'),
    color: document.querySelector('meta[name=theme-color]') && document.querySelector('meta[name=theme-color]').content,
    bg: getComputedStyle(document.body).backgroundColor,
    on: [...document.querySelectorAll('[data-act=theme]')].map((b) => b.classList.contains('on') && b.dataset.themeSet),
  }));
  ck('ダークを選ぶと即反映して保存', dark.theme === 'dark' && dark.stored === 'dark' && dark.color === '#1C1B1A' && hex(dark.bg) === '#1C1B1A' && dark.on[1] === 'dark', JSON.stringify(dark));
  await p.screenshot({ path: path.join(SHOT_DIR, 'set-375-dark.png') });

  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  const persisted = await p.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    color: document.querySelector('meta[name=theme-color]') && document.querySelector('meta[name=theme-color]').content,
    bg: getComputedStyle(document.body).backgroundColor,
  }));
  ck('再読み込み後もダークが残る', persisted.theme === 'dark' && persisted.color === '#1C1B1A' && hex(persisted.bg) === '#1C1B1A', JSON.stringify(persisted));

  await p.click('[data-tab=home]');
  await sleep(200);
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-375-dark.png') });
  // 履歴・記録もダークで撮る
  await p.click('[data-card=tsuke] .tsuke-body');
  await sleep(250);
  await p.screenshot({ path: path.join(SHOT_DIR, 'ledger-375-dark.png') });
  await p.click('[data-act=close-ledger]');
  await sleep(200);
  await p.click('[data-tab=hist]');
  await sleep(250);
  await p.screenshot({ path: path.join(SHOT_DIR, 'hist-375-dark.png') });

  // 起動時、表示中の月が精算済みなら次の未精算の月を開く
  await setTheme(p, 'light');
  await p.evaluate(() => {
    const S = WarikanStore, s = S.load();
    S.ensureMonth(s, '2026-11');
    const pays = S.paymentsInMonth(s, '2026-11');
    // 11月を再確定
    const live = WarikanLogic.computeSettle(pays, s.ratioYamada);
    S.settleMonth(s, '2026-11', Object.assign({}, live, { ratioYamada: s.ratioYamada, choice: 'settled', paid: 0, carried: live.amount }));
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  const launched = await p.evaluate(() => document.getElementById('mLbl') && document.getElementById('mLbl').textContent);
  ck('起動時、11月が精算済みなら12月を開く', /2026年12月/.test(launched || ''), launched);

  // 古いデータの残高は変えない
  await p.evaluate(() => {
    localStorage.setItem('warikan-v1', JSON.stringify({
      version: 1,
      people: { yamada: { id: 'yamada', name: '自分', color: '#14B8A6' }, kanojo: { id: 'kanojo', name: '相手', color: '#F97366' } },
      ratioYamada: 50,
      items: WarikanStore.defaultItems(),
      payments: [],
      settlements: {
        '2026-10': { marks: { yamada: 1, kanojo: 1 }, settledAt: 1, snapshot: { from: 'yamada', to: 'kanojo', amount: 38000, net: 38000 } },
      },
      ledger: [
        { id: 'o1', kind: 'opening', signed: 250000, amount: 250000, from: 'yamada', to: 'kanojo' },
        { id: 'c1', kind: 'carry', month: '2026-09', signed: 28000, amount: 28000, from: 'yamada', to: 'kanojo', paid: 10000, carried: 28000 },
        { id: 'r1', kind: 'repayment', signed: -30000, amount: 30000, from: 'yamada', to: 'kanojo' },
      ],
    }));
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  const migrated = await p.evaluate(() => {
    const s = WarikanStore.load();
    return {
      total: WarikanLogic.ledgerTotal(s.ledger),
      kinds: (s.ledger || []).map((e) => e.kind).sort().join(),
      oct: WarikanStore.isSettled(s, '2026-10'),
    };
  });
  ck('古いデータを読んでも残高は 248,000 のまま（全額払いの月は足さない）', migrated.total === 248000 && migrated.kinds === 'carry,opening,repayment' && migrated.oct === true, JSON.stringify(migrated));

  // prefers-reduced-motion ではスライドなしで次の月へ
  await p.evaluate(seedExample, AMOUNTS);
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  await p.click('[data-act=settle]');
  await sleep(200);
  ck('軽減時も確定メッセージは出る', await p.evaluate(() => /11月を確定しました/.test((document.querySelector('.settle-confirmed') || {}).textContent || '')));
  await p.waitForFunction(() => /2026年12月/.test((document.getElementById('mLbl') || {}).textContent || ''), { timeout: 3000 });
  const reduced = await p.evaluate(() => ({
    label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
    toast: document.getElementById('toast') && !document.getElementById('toast').hidden && document.getElementById('toast').textContent,
    going: !!document.querySelector('.mslide-track.go'),
  }));
  ck('軽減時はスライドなしで12月になりトーストを出す', /2026年12月/.test(reduced.label || '') && reduced.toast === '12月になりました' && reduced.going === false, JSON.stringify(reduced));

  ck('ページエラーなし ' + (errs[0] || ''), errs.length === 0);

  await b.close();
  if (R.fails) { console.log(R.fails + ' failed'); process.exit(1); }
  console.log('all passed');
})().catch((e) => { console.error(e); process.exit(1); });
