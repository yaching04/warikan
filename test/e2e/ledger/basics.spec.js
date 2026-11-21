// E2E: 残りの支払い（これまでの残り・精算の選択・一部/全部残り・返す・台帳・移行・スクショ）
const path = require('path');
const { SHOT_DIR, VERSION_RE, sleep, launch, reporter, APPURL: URL } = require('../helpers');
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
const seedExample = (map) => {
  const S = WarikanStore;
  const L = WarikanLogic;
  const s = S.load();
  const m = L.monthKey(window.__warikanNow != null ? new Date(window.__warikanNow) : new Date());
  S.ensureMonth(s, m);
  for (const pay of s.payments.filter((x) => x.month === m && !x.extra)) {
    if (map[pay.itemId] != null) S.updatePayment(s, pay.id, { amount: map[pay.itemId] });
  }
  S.setRatio(s, 50);
  S.clearMarks(s, m);
  return m;
};
const oldState = {
  version: 1,
  people: {
    yamada: { id: 'yamada', name: '自分', color: '#14B8A6' },
    kanojo: { id: 'kanojo', name: '相手', color: '#F97366' },
  },
  ratioYamada: 50,
  payments: [],
  settlements: {
    '2026-10': {
      marks: { yamada: 1, kanojo: 1 },
      settledAt: 1,
      snapshot: {
        from: 'yamada', to: 'kanojo', amount: 38000, net: 38000, ratioYamada: 50,
        kanojoPaid: 90000, yamadaPaid: 14000, yamadaBurdenOfKanojo: 45000, kanojoBurdenOfYamada: 7000,
      },
    },
  },
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
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate((data) => { localStorage.clear(); localStorage.setItem('warikan-v1', JSON.stringify(data)); }, oldState);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);

  const migrated = await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    return {
      ledger: Array.isArray(s.ledger) ? s.ledger.length : -1,
      card: document.querySelector('[data-card=tsuke]') && document.querySelector('[data-card=tsuke]').innerText,
      settledOct: S.isSettled(s, '2026-10'),
    };
  });
  ck('古いデータに台帳がなくても読み込める（残高0）', migrated.ledger === 0);
  ck('残りの支払いカードは「残りなし」', /残りなし/.test(migrated.card || '') && !/¥/.test(migrated.card || ''));
  ck('以前に精算した月は印が残る', migrated.settledOct === true);

  await p.click('[data-tab=hist]');
  await sleep(200);
  const histOld = await p.evaluate(() => document.querySelector('.hrow') && document.querySelector('.hrow').innerText);
  ck('履歴の古い精算は「精算済み ✓」', /2026年10月/.test(histOld || '') && /精算済み/.test(histOld || '') && !/ツケ/.test(histOld || ''));

  await p.click('[data-tab=set]');
  await sleep(200);
  const setOpen = await p.evaluate(() => ({
    card: document.querySelector('[data-card=opening]') && document.querySelector('[data-card=opening]').innerText,
    ver: document.body.innerText,
  }));
  ck('設定に「残りの支払い」がある', /残りの支払い/.test(setOpen.card || '') && /まだありません/.test(setOpen.card || ''));
  ck('設定に今の版が出る', VERSION_RE.test(setOpen.ver || ''));

  await p.click('[data-act=edit-opening]');
  await sleep(200);
  ck('残りの支払いのダイアログが開く（novalidate）', await p.evaluate(() => {
    const f = document.getElementById('openForm');
    return !!(document.getElementById('dlg').open && f && f.noValidate);
  }));
  await p.click('[data-open-from=yamada]');
  await p.evaluate(() => {
    const a = document.getElementById('openAmt');
    a.value = '250,000';
    a.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.click('#openForm button[type=submit]');
  await sleep(300);
  const afterOpenSet = await p.evaluate(() => document.querySelector('[data-card=opening]').innerText);
  ck('設定にこれまでの残り ¥250,000 が出る', /自分 → 相手/.test(afterOpenSet) && /¥250,000/.test(afterOpenSet));

  await p.click('[data-tab=home]');
  await sleep(250);
  const homeTsuke = await p.evaluate(() => {
    const card = document.querySelector('[data-card=tsuke]');
    const cs = getComputedStyle(card);
    const line = getComputedStyle(card.querySelector('.tsuke-who') || card.querySelector('.tsuke-lab'));
    const hex = (c) => {
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return c;
      return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
    };
    const repay = card.querySelector('[data-act=repay]');
    const rr = repay.getBoundingClientRect();
    return {
      text: card.innerText.replace(/\s+/g, ' ').trim(),
      bg: hex(cs.backgroundColor),
      color: hex(line.color),
      repayH: Math.round(rr.height),
    };
  });
  ck('ホームの残りの支払いカード: 自分 → 相手 ¥250,000',
    /残りの支払い/.test(homeTsuke.text) && /自分 → 相手/.test(homeTsuke.text) && /¥250,000/.test(homeTsuke.text) && /支払った/.test(homeTsuke.text));
  ck('残りの支払いカードは落ち着いた琥珀色（赤ではない） ' + homeTsuke.bg + ' ' + homeTsuke.color,
    homeTsuke.bg === '#FFF8E8' && homeTsuke.color === '#A16207');
  ck('「支払った」の高さ ≥44', homeTsuke.repayH >= 44);

  for (const width of [320, 375, 390]) {
    await p.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.click('[data-tab=home]');
    await sleep(200);
    await p.screenshot({ path: path.join(SHOT_DIR, `home-${width}.png`) });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    ck(`ホーム ${width}px で横スクロールしない`, overflow === false);
  }
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await p.evaluate(seedExample, AMOUNTS);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  ck('例の金額で精算額 ¥38,000（残りは残る）', await p.evaluate(() => {
    const amt = document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent;
    const t = document.querySelector('[data-card=tsuke]').innerText;
    return amt === '¥38,000' && /¥250,000/.test(t);
  }));

  await p.click('[data-act=settle]');
  await sleep(250);
  const confirmed = await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    return {
      open: document.getElementById('dlg').open,
      text: document.querySelector('.settle-confirmed') && document.querySelector('.settle-confirmed').textContent,
      tsuke: document.querySelector('[data-card=tsuke]').innerText.replace(/\s+/g, ' '),
      signed: (s.ledger || []).reduce((a, e) => a + e.signed, 0),
      choice: ((S.getSettlement(s, '2026-11') || {}).snapshot || {}).choice,
    };
  });
  ck('精算は選択肢を出さず確定する', confirmed.open === false && /11月を確定しました/.test(confirmed.text || ''), JSON.stringify(confirmed));
  ck('確定すると精算額が残りの支払いに足される（250,000+38,000=288,000）', /¥288,000/.test(confirmed.tsuke) && confirmed.signed === 288000 && confirmed.choice === 'settled');
  await p.screenshot({ path: path.join(SHOT_DIR, 'settle-choice-390.png') });
  await p.setViewport({ width: 320, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(100);
  await p.screenshot({ path: path.join(SHOT_DIR, 'settle-choice-320.png') });
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  // タブを切って自動切替を止め、確定した月を見る
  await p.click('[data-tab=hist]');
  await sleep(200);
  const hist = await p.evaluate(() => document.body.innerText);
  ck('履歴に11月の精算済みと「修正」が出る', /2026年11月/.test(hist) && /精算済み/.test(hist) && /修正/.test(hist));
  ck('履歴に10月の全額払いも残る', /2026年10月/.test(hist) && /精算済み/.test(hist));
  await p.screenshot({ path: path.join(SHOT_DIR, 'hist-390.png') });
  await p.setViewport({ width: 320, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(100);
  await p.screenshot({ path: path.join(SHOT_DIR, 'hist-320.png') });
  const overflowHist = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  ck('履歴 320px で横スクロールしない', overflowHist === false);
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await p.evaluate(() => {
    const row = [...document.querySelectorAll('.hrow')].find((r) => /11月/.test(r.innerText));
    if (row) row.click();
  });
  await sleep(200);
  ck('履歴の詳細にも精算済みと出る', await p.evaluate(() => /精算済み/.test(document.getElementById('dlg').innerText)));
  await p.click('[data-act=close]');
  await sleep(150);

  await p.click('[data-tab=home]');
  await sleep(200);
  await p.click('[data-act=prev-m]');
  await sleep(200);
  const locked = await p.evaluate(() => ({
    lock: /🔒/.test((document.getElementById('mLbl') || {}).textContent || ''),
    edit: !!document.querySelector('[data-act=edit-pay]'),
    add: !!document.querySelector('[data-act=add-pay]'),
    label: (document.getElementById('mLbl') || {}).textContent,
  }));
  ck('確定した11月は🔒で追加・編集できない', /2026年11月/.test(locked.label || '') && locked.lock && !locked.edit && !locked.add, JSON.stringify(locked));
  await p.setViewport({ width: 320, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(150);
  await p.screenshot({ path: path.join(SHOT_DIR, 'partial-320.png') });
  const overflowPartial = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  ck('確定した月の表示が 320px で横にはみ出さない', overflowPartial === false);
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.screenshot({ path: path.join(SHOT_DIR, 'partial-390.png') });

  // 修正すると、その月の分が残りから戻る
  await p.click('[data-tab=hist]');
  await sleep(200);
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('[data-act=unconfirm]')].find((b) => b.dataset.month === '2026-11');
    if (btn) btn.click();
  });
  await sleep(200);
  ck('取り消しの確認が出る', await p.evaluate(() => document.getElementById('dlg').open && /を修正しますか/.test(document.getElementById('dlg').innerText)));
  await p.click('[data-act=unconfirm-ok]');
  await sleep(250);
  await p.click('[data-tab=home]');
  await sleep(200);
  const undid = await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    return {
      btn: !!document.querySelector('[data-act=settle]'),
      done: !!document.querySelector('.settle-done'),
      lock: /🔒/.test((document.getElementById('mLbl') || {}).textContent || ''),
      ledger: (s.ledger || []).map((e) => e.kind),
      total: (s.ledger || []).reduce((a, e) => a + e.signed, 0),
    };
  });
  ck('修正すると精算もその月の残りも戻る（これまでの残りは残る）',
    undid.btn === true && undid.done === false && !undid.lock && undid.total === 250000 && undid.ledger.length === 1 && undid.ledger[0] === 'opening', JSON.stringify(undid));

  // もう一度確定して、支払った操作へ
  await p.evaluate(seedExample, AMOUNTS);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  await p.click('[data-act=settle]');
  await sleep(250);
  await p.click('[data-tab=hist]');
  await sleep(150);
  await p.click('[data-tab=home]');
  await sleep(200);

  const fullViaPartial = await p.evaluate(() => {
    const L = WarikanLogic;
    return L.settleChoice('partial', 38000, 38000).choice === 'full' && L.settleChoice('partial', 38000, 38000).carried === 0;
  });
  ck('（互換）一部払いが精算額ちょうどなら全額扱いになる計算は残る', fullViaPartial === true);

  await p.click('[data-act=repay]');
  await sleep(200);
  ck('支払ったダイアログ（novalidate）', await p.evaluate(() => {
    const f = document.getElementById('repayForm');
    return !!(document.getElementById('dlg').open && f && f.noValidate);
  }));
  await p.evaluate(() => {
    const a = document.getElementById('repayAmt');
    a.value = '288001';
    a.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.click('#repayForm button[type=submit]');
  await sleep(200);
  ck('支払った超過は範囲エラー', await p.evaluate(() => /金額は¥1〜¥288,000で入れてね/.test(document.getElementById('repayErr').textContent)));
  await p.evaluate(() => {
    const a = document.getElementById('repayAmt');
    a.value = '30,000';
    a.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.click('#repayForm button[type=submit]');
  await sleep(300);
  const repaid = await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    return {
      tsuke: document.querySelector('[data-card=tsuke]').innerText.replace(/\s+/g, ' '),
      total: (s.ledger || []).reduce((a, e) => a + e.signed, 0),
    };
  });
  ck('¥30,000 支払うと残高 258,000', /¥258,000/.test(repaid.tsuke) && repaid.total === 258000, JSON.stringify(repaid));

  await p.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; });
  await p.click('[data-card=tsuke] .tsuke-body');
  await sleep(250);
  const ledger = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.lrow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    return {
      title: document.getElementById('top').innerText,
      now: document.querySelector('.tsuke-now') && document.querySelector('.tsuke-now').textContent,
      rows,
      dels: document.querySelectorAll('[data-act=del-ledger]').length,
    };
  });
  ck('台帳画面の見出しと残りの支払い', /支払いの記録/.test(ledger.title) && /残りの支払い/.test(ledger.now || '') && /自分 → 相手/.test(ledger.now || '') && /¥258,000/.test(ledger.now || ''));
  ck('台帳は新しい順（支払った → 11月分 → これまでの残り）',
    ledger.rows.length === 3
    && /支払った/.test(ledger.rows[0]) && /¥30,000/.test(ledger.rows[0]) && /残り 自分 → 相手 ¥258,000/.test(ledger.rows[0])
    && /11月分/.test(ledger.rows[1]) && /\+¥38,000/.test(ledger.rows[1])
    && /これまでの残り/.test(ledger.rows[2]), JSON.stringify(ledger.rows));
  ck('消せるのはこれまでの残りと支払った分の2件（月の分は消せない）', ledger.dels === 2);
  for (const width of [320, 375, 390]) {
    await p.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await sleep(150);
    await p.screenshot({ path: path.join(SHOT_DIR, `ledger-${width}.png`) });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    ck(`台帳 ${width}px で横スクロールしない`, overflow === false);
  }
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await p.click('[data-act=del-ledger]');
  await sleep(200);
  ck('記録を消す確認が出る', await p.evaluate(() => /この記録を消しますか？/.test(document.getElementById('dlg').innerText)));
  await p.click('[data-act=del-ledger-ok]');
  await sleep(250);
  const afterDel = await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    return {
      now: document.querySelector('.tsuke-now') && document.querySelector('.tsuke-now').textContent,
      rows: document.querySelectorAll('.lrow').length,
      total: (s.ledger || []).reduce((a, e) => a + e.signed, 0),
      kinds: (s.ledger || []).map((e) => e.kind),
    };
  });
  ck('支払った分を消すと残高が 288,000 に戻る', /¥288,000/.test(afterDel.now || '') && afterDel.total === 288000 && afterDel.rows === 2 && afterDel.kinds.includes('opening') && afterDel.kinds.includes('carry'), JSON.stringify(afterDel));

  await p.click('[data-act=close-ledger]');
  await sleep(200);
  ck('台帳を閉じるとホームに戻る', await p.evaluate(() => !!document.querySelector('[data-card=settle]') && !!document.querySelector('[data-card=tsuke]')));

  // 精算額が 0 のときはそのまま確定（台帳には足さない）
  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    const m = '2026-12';
    S.ensureMonth(s, m);
    S.clearMarks(s, m);
    window.__warikanNow = Date.parse('2026-12-15T12:00:00+09:00');
    window.__checkMonthRoll();
  });
  await sleep(250);
  await p.evaluate(() => ({
    label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
    amt: document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent,
  }));
  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    for (const pay of S.paymentsInMonth(s, '2026-12')) S.updatePayment(s, pay.id, { amount: 0 });
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  await p.evaluate(() => {
    window.__warikanNow = Date.parse('2026-12-15T12:00:00+09:00');
    window.__checkMonthRoll();
  });
  await sleep(200);
  const zeroAmt = await p.evaluate(() => document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent);
  ck('12月を支払い0にして精算額 ¥0', zeroAmt === '¥0');
  const beforeZero = await p.evaluate(() => (WarikanStore.load().ledger || []).reduce((a, e) => a + e.signed, 0));
  await p.click('[data-act=settle]');
  await sleep(250);
  const zeroSettle = await p.evaluate(() => ({
    open: document.getElementById('dlg').open,
    confirmed: document.querySelector('.settle-confirmed') && document.querySelector('.settle-confirmed').textContent,
    choice: ((WarikanStore.getSettlement(WarikanStore.load(), '2026-12') || {}).snapshot || {}).choice,
    total: (WarikanStore.load().ledger || []).reduce((a, e) => a + e.signed, 0),
  }));
  ck('精算額0も選択肢なしで確定し、残高は変わらない', zeroSettle.open === false && /12月を確定しました/.test(zeroSettle.confirmed || '') && zeroSettle.choice === 'settled' && zeroSettle.total === beforeZero, JSON.stringify(zeroSettle));

  // 2人目向きの残り: 11月の支払いを入れ替えて再精算はしない。opening を逆向きに編集
  await p.click('[data-tab=set]');
  await sleep(200);
  await p.screenshot({ path: path.join(SHOT_DIR, 'set-390.png') });
  await p.setViewport({ width: 320, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(100);
  await p.screenshot({ path: path.join(SHOT_DIR, 'set-320.png') });
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  const dir = await p.evaluate(() => {
    const L = WarikanLogic;
    return L.carrySigned(-38000, 38000) === -38000 && L.dirFromSigned(-38000).from === 'kanojo';
  });
  ck('2人目が払う側の月の残りは2人目の借りとして残る', dir === true);

  ck('ページエラーなし ' + (errs[0] || ''), errs.length === 0);

  await b.close();
  if (R.fails) {
    console.log(R.fails + ' failed');
    process.exit(1);
  }
  console.log('all passed');
})().catch((e) => { console.error(e); process.exit(1); });
