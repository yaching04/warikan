// E2E: 精算カードの例、未入力、精算と取り消し、履歴、設定、スクリーンショット
const fs = require('fs');
const path = require('path');
const { SHOT_DIR, sleep, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;
const confirmFull = async (p) => {
  const full = await p.$('[data-act=settle-full]');
  if (full) { await full.click(); await sleep(200); }
};

const AMOUNTS = {
  'item-yachin': 60000,
  'item-kaimono': 30000,
  'item-denki': 4000,
  'item-gas': 3000,
  'item-suidou': 3000,
  'item-net': 4000,
};

(async () => {
  const b = await launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setBypassServiceWorker(true);
  await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument(() => { window.__warikanSettleDelay = 20000; });
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
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await sleep(200);

  const boot = await p.evaluate(() => {
    const rent = [...document.querySelectorAll('.prow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    const amt = document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent;
    const unfilled = [...document.querySelectorAll('.amt.empty')].map((el) => el.textContent);
    const steps = [...document.querySelectorAll('.settle-step')].map((el) => el.innerText.replace(/\s+/g, ' ').trim());
    return { rent, amt, unfilled, steps, title: document.title, tab: document.querySelector('.tabs button.on') && document.querySelector('.tabs button.on').textContent };
  });
  ck('タイトルがわりかん', boot.title === 'わりかん');
  ck('精算タブが選ばれている', /精算/.test(boot.tab || ''));
  ck('家賃が固定 ¥60,000 で自動入力', boot.rent.some((t) => /家賃/.test(t) && /¥60,000/.test(t)));
  ck('変動費は未入力', boot.unfilled.length >= 5 && boot.unfilled.every((t) => t === '未入力'));
  ck('家賃だけなら精算は ¥30,000（自分→相手）', boot.amt === '¥30,000');

  // 例の金額を入れる
  await p.evaluate((map) => {
    const S = WarikanStore;
    const L = WarikanLogic;
    const s = S.load();
    const m = L.monthKey(new Date());
    S.ensureMonth(s, m);
    for (const pay of s.payments.filter((x) => x.month === m && !x.extra)) {
      if (map[pay.itemId] != null) S.updatePayment(s, pay.id, { amount: map[pay.itemId] });
    }
    return m;
  }, AMOUNTS);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  await p.click('[data-act=toggle-steps]');
  await sleep(250);

  const card = await p.evaluate(() => {
    const steps = [...document.querySelectorAll('.settle-step')].map((el) => el.innerText.replace(/\s+/g, ' ').trim());
    const who = document.querySelector('.settle-who') && document.querySelector('.settle-who').innerText.replace(/\s+/g, ' ').trim();
    const amt = document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent;
    const rows = [...document.querySelectorAll('.prow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    return { steps, who, amt, rows };
  });
  ck('相手が払った分 ¥90,000 と自分の負担 ¥45,000',
    card.steps.join(' ') && /相手が払った分 ¥90,000/.test(card.steps.join(' ')) && /自分の負担 ¥45,000/.test(card.steps.join(' ')));
  ck('自分が払った分 ¥14,000 と相手の負担 ¥7,000',
    /自分が払った分 ¥14,000/.test(card.steps.join(' ')) && /相手の負担 ¥7,000/.test(card.steps.join(' ')));
  ck('精算額 ¥38,000 が一線', card.amt === '¥38,000');
  ck('方向が自分 → 相手', /自分/.test(card.who) && /相手/.test(card.who) && /→/.test(card.who));
  ck('買い物 ¥30,000 が見える', card.rows.some((t) => /買い物/.test(t) && /¥30,000/.test(t)));

  // 行のタップで金額ダイアログ
  await p.click('.prow');
  await sleep(200);
  ck('支払いダイアログが開く', await p.evaluate(() => document.getElementById('dlg').open));
  const aaFocus = await p.evaluate(() => document.activeElement && (document.activeElement.id === 'aa' || document.activeElement.tagName === 'H2' || document.activeElement.id === 'dh'));
  ck('ダイアログにフォーカスがある', aaFocus);
  await p.keyboard.press('Escape');
  await sleep(200);

  // 精算
  await p.click('[data-act=settle]');
  await sleep(200);
  await confirmFull(p);
  const settled = await p.evaluate(() => ({
    confirmed: document.querySelector('.settle-confirmed') && document.querySelector('.settle-confirmed').textContent,
    btn: !!document.querySelector('[data-act=settle]'),
    add: !!document.querySelector('[data-act=add-pay]'),
    edit: !!document.querySelector('[data-act=edit-pay]'),
    lock: /🔒/.test((document.getElementById('mLbl') || {}).textContent || ''),
  }));
  ck('精算したあと「N月を確定しました」', /を確定しました/.test(settled.confirmed || ''), JSON.stringify(settled));
  ck('精算ボタンと追加・編集は出ない', settled.btn === false && settled.add === false && settled.edit === false);

  await p.click('[data-tab=hist]');
  await sleep(200);
  const hist = await p.evaluate(() => document.body.innerText);
  ck('履歴に精算済みの月と「修正」が出る', /精算済み/.test(hist) && /¥38,000/.test(hist) && /修正/.test(hist));

  // 確定した月は編集できない。履歴から取り消すと支払いを直せる
  await p.click('[data-tab=home]');
  await sleep(200);
  await p.click('[data-act=prev-m]');
  await sleep(200);
  const locked = await p.evaluate(() => ({
    edit: !!document.querySelector('[data-act=edit-pay]'),
    add: !!document.querySelector('[data-act=add-pay]'),
    lock: /🔒/.test((document.getElementById('mLbl') || {}).textContent || ''),
    dlg: document.getElementById('dlg').open,
  }));
  if (await p.$('[data-act=edit-pay]')) await p.click('[data-act=edit-pay]');
  await sleep(150);
  ck('確定した月は🔒で、行をタップしても編集できない', locked.lock && !locked.edit && !locked.add && !(await p.evaluate(() => document.getElementById('dlg').open)));

  await p.click('[data-tab=hist]');
  await sleep(200);
  await p.click('[data-act=unconfirm]');
  await sleep(200);
  ck('取り消しの確認が出る', await p.evaluate(() => document.getElementById('dlg').open && /を修正しますか/.test(document.getElementById('dlg').innerText)));
  await p.click('[data-act=unconfirm-ok]');
  await sleep(200);
  await p.click('[data-tab=home]');
  await sleep(200);
  await p.click('.prow');
  await sleep(200);
  await p.evaluate(() => { const aa = document.getElementById('aa'); aa.value = '61000'; aa.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('#payForm button[type=submit]');
  await sleep(300);
  const afterEdit = await p.evaluate(() => ({
    done: !!document.querySelector('.settle-done'),
    settleBtn: !!document.querySelector('[data-act=settle]'),
    amt: document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent,
  }));
  ck('修正すると精算済みが外れる', afterEdit.done === false && afterEdit.settleBtn === true);
  ck('家賃を ¥61,000 にすると精算額も変わる', afterEdit.amt !== '¥38,000');

  // 設定のスライダー表示
  await p.click('[data-tab=set]');
  await sleep(200);
  const set = await p.evaluate(() => ({
    ratio: document.getElementById('ratioRead') && document.getElementById('ratioRead').textContent.replace(/\s+/g, ' ').trim(),
    slider: document.getElementById('ratio') && document.getElementById('ratio').value,
    items: [...document.querySelectorAll('.item .l b')].map((el) => el.textContent),
  }));
  ck('割合の表示が「自分 50 : 50 相手」', /自分 50 : 50 相手/.test(set.ratio || ''));
  ck('スライダー初期値 50', set.slider === '50');
  ck('初期項目が6つ', set.items.filter((n) => ['家賃', '買い物', '電気', 'ガス', '水道', 'ネット'].includes(n)).length === 6);

  await p.evaluate(() => {
    const r = document.getElementById('ratio');
    r.value = 60;
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(100);
  const ratioLive = await p.evaluate(() => document.getElementById('ratioRead').textContent.replace(/\s+/g, ' ').trim());
  ck('スライダーを動かすと表示がライブ更新', /自分 60 : 40 相手/.test(ratioLive));

  await p.click('[data-tab=home]');
  await sleep(250);
  const afterRatio = await p.evaluate(() => document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent);
  ck('割合変更後に精算額が再計算される', afterRatio && afterRatio !== '¥38,000');

  // 割合を戻して例の金額に戻し、スクショ用に整える
  await p.evaluate((map) => {
    const S = WarikanStore;
    const L = WarikanLogic;
    const s = S.load();
    S.setRatio(s, 50);
    const m = L.monthKey(new Date());
    S.ensureMonth(s, m);
    for (const pay of s.payments.filter((x) => x.month === m && !x.extra)) {
      if (map[pay.itemId] != null) S.updatePayment(s, pay.id, { amount: map[pay.itemId] });
    }
    S.clearMarks(s, m);
  }, AMOUNTS);
  await p.click('[data-tab=home]');
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);

  // タップ領域
  const hits = await p.evaluate(() => {
    const row = document.querySelector('.prow');
    const tab = document.querySelector('.tabs button');
    const prev = document.querySelector('[data-act=prev-m]');
    const settle = document.querySelector('[data-act=settle]');
    const rr = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    return { row: rr(row), tab: rr(tab), prev: rr(prev), settle: rr(settle) };
  });
  ck('支払い行の高さ ≥44 ' + JSON.stringify(hits.row), hits.row.h >= 44);
  ck('タブの高さ ≥44', hits.tab.h >= 44);
  ck('月送りの高さ ≥44', hits.prev.h >= 44 && hits.prev.w >= 44);
  ck('精算ボタンの高さ ≥44', hits.settle.h >= 44);

  const amtStyle = await p.evaluate(() => {
    const el = document.getElementById('settleAmt');
    const cs = getComputedStyle(el);
    return { size: cs.fontSize, weight: cs.fontWeight, wrap: cs.whiteSpace, text: el.textContent, lines: el.getClientRects().length };
  });
  ck('精算額が 36px 太字・1行 ' + JSON.stringify(amtStyle), amtStyle.size === '36px' && Number(amtStyle.weight) >= 700 && amtStyle.wrap === 'nowrap' && amtStyle.lines === 1);

  async function shots(width, height) {
    await p.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.click('[data-tab=home]');
    await sleep(150);
    await p.screenshot({ path: path.join(SHOT_DIR, `home-${width}.png`) });
    await p.click('[data-act=settle]');
    await sleep(200);
    await confirmFull(p);
    await p.screenshot({ path: path.join(SHOT_DIR, `settled-${width}.png`) });
    await p.click('[data-tab=hist]');
    await sleep(150);
    await p.screenshot({ path: path.join(SHOT_DIR, `hist-${width}.png`) });
    await p.click('[data-tab=set]');
    await sleep(150);
    await p.screenshot({ path: path.join(SHOT_DIR, `set-${width}.png`) });
    // 戻して次の幅でも精算できるようにする
    await p.evaluate(() => {
      const S = WarikanStore;
      const L = WarikanLogic;
      S.clearMarks(S.load(), L.monthKey(new Date()));
    });
    await p.reload({ waitUntil: 'networkidle0' });
    await sleep(200);
  }
  for (const [w, h] of [[320, 568], [375, 812], [390, 844]]) await shots(w, h);
  ck('320/375/390 のスクショが揃っている', ['home', 'settled', 'hist', 'set'].every((k) =>
    [320, 375, 390].every((w) => fs.existsSync(path.join(SHOT_DIR, `${k}-${w}.png`)))));
  ck('JSエラーなし', errs.length === 0);
  if (errs.length) console.log(errs);

  await b.close();
  console.log(R.fails ? R.fails + ' FAILED' : 'ALL OK');
  process.exit(R.fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
