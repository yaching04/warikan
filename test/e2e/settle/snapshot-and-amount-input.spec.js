// E2E: 精算済みのスナップショット、空の項目、金額入力、未入力の注記、月の切り替え、レイアウト
const fs = require('fs');
const path = require('path');
const { ROOT, SHOT_DIR, sleep, launch, reporter, APPURL: URL } = require('../helpers');
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
  await p.evaluate(() => localStorage.clear());
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await sleep(200);

  // (4) 未入力の注記
  const note0 = await p.evaluate(() => {
    const n = document.querySelector('.settle-progress-lab');
    return n && n.textContent;
  });
  ck('初期状態で「1/6 入力済み」（家賃は自動入力）', note0 === '1/6 入力済み');

  await p.evaluate(seedExample, AMOUNTS);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  await p.click('[data-act=toggle-steps]');
  await sleep(250);

  const filled = await p.evaluate(() => ({
    amt: document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent,
    note: document.querySelector('.settle-progress-lab') && document.querySelector('.settle-progress-lab').textContent,
    steps: [...document.querySelectorAll('.settle-step')].map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
  }));
  ck('例の金額で精算額 ¥38,000', filled.amt === '¥38,000');
  ck('全部入力すると「すべて入力済み ✓」', filled.note === 'すべて入力済み ✓');
  ck('式に途中の数字がある', filled.steps[0] && /相手が払った分/.test(filled.steps[0]) && /¥90,000/.test(filled.steps[0]));

  // (1) 精算済みはスナップショット
  await p.click('[data-act=settle]');
  await sleep(200);
  await confirmFull(p);
  await p.click('[data-tab=set]');
  await sleep(150);
  await p.evaluate(() => {
    const r = document.getElementById('ratio');
    r.value = 60;
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(100);
  const ratioTxt = await p.evaluate(() => document.getElementById('ratioRead').textContent.replace(/\s+/g, ' ').trim());
  ck('割合を 60:40 に変えた', /自分 60 : 40 相手/.test(ratioTxt));
  await p.click('[data-tab=home]');
  await sleep(250);
  await p.click('[data-act=prev-m]');
  await sleep(200);
  const afterRatio = await p.evaluate(() => ({
    amt: document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent,
    done: !!(document.querySelector('.settle-done') && /確定済み/.test(document.querySelector('.settle-done').textContent)),
    settleBtn: !!document.querySelector('[data-act=settle]'),
    steps: [...document.querySelectorAll('.settle-step')].map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
  }));
  ck('割合変更後も今月はスナップショットの ¥38,000', afterRatio.amt === '¥38,000');
  ck('割合変更では確定済みが外れない', afterRatio.done === true && afterRatio.settleBtn === false);
  ck('式も 50:50 のまま（負担 ¥45,000 / ¥7,000）',
    afterRatio.steps.some((s) => /¥45,000/.test(s)) && afterRatio.steps.some((s) => /¥7,000/.test(s)));

  await p.click('[data-tab=hist]');
  await sleep(200);
  const hist = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ck('履歴も ¥38,000 のまま', /¥38,000/.test(hist) && /精算済み/.test(hist) && !/¥48,400/.test(hist));

  // 確定した月は編集できない。履歴から取り消すと、今の割合で再計算される
  await p.click('[data-tab=home]');
  await sleep(200);
  await p.click('[data-act=prev-m]');
  await sleep(200);
  const locked = await p.evaluate(() => ({
    edit: !!document.querySelector('[data-act=edit-pay]'),
    add: !!document.querySelector('[data-act=add-pay]'),
    lock: /🔒/.test((document.getElementById('mLbl') || {}).textContent || ''),
  }));
  ck('確定した月は🔒で追加・編集できない', locked.lock && !locked.edit && !locked.add, JSON.stringify(locked));
  await p.click('[data-tab=hist]');
  await sleep(200);
  await p.click('[data-act=unconfirm]');
  await sleep(200);
  await p.click('[data-act=unconfirm-ok]');
  await sleep(200);
  await p.click('[data-tab=home]');
  await sleep(200);
  const afterEdit = await p.evaluate(() => ({
    done: !!document.querySelector('.settle-done'),
    settleBtn: !!document.querySelector('[data-act=settle]'),
    amt: document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent,
  }));
  ck('修正すると精算済みが外れる', afterEdit.done === false && afterEdit.settleBtn === true);
  ck('外れたあとは今の割合で再計算される', afterEdit.amt && afterEdit.amt !== '¥38,000');

  // 例の状態に戻して入力テストへ
  await p.evaluate(seedExample, AMOUNTS);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);

  // (3) 金額入力
  async function openKaimono() {
    const clicked = await p.evaluate(() => {
      const row = [...document.querySelectorAll('.prow')].find((r) => /買い物/.test(r.innerText));
      if (row) { row.click(); return true; }
      return false;
    });
    ck('買い物の行を開く', clicked);
    await sleep(200);
  }
  async function typeAmount(val) {
    await p.evaluate((v) => {
      const aa = document.getElementById('aa');
      aa.value = v;
      aa.dispatchEvent(new Event('input', { bubbles: true }));
    }, val);
    await p.click('#payForm button[type=submit]');
    await sleep(250);
  }

  await openKaimono();
  await typeAmount('4,000');
  ck('「4,000」が保存される', await p.evaluate(() => {
    const row = [...document.querySelectorAll('.prow')].find((r) => /買い物/.test(r.innerText));
    return row && /¥4,000/.test(row.innerText) && !document.getElementById('dlg').open;
  }));

  await openKaimono();
  await typeAmount(' 5000 ');
  ck('「 5000 」が ¥5,000 になる', await p.evaluate(() => {
    const row = [...document.querySelectorAll('.prow')].find((r) => /買い物/.test(r.innerText));
    return row && /¥5,000/.test(row.innerText);
  }));

  await openKaimono();
  await typeAmount('３０００');
  ck('全角「３０００」が ¥3,000 になる', await p.evaluate(() => {
    const row = [...document.querySelectorAll('.prow')].find((r) => /買い物/.test(r.innerText));
    return row && /¥3,000/.test(row.innerText);
  }));

  await openKaimono();
  await typeAmount('100.5');
  const dec = await p.evaluate(() => {
    const err = document.getElementById('aaErr');
    const aa = document.getElementById('aa');
    const dlg = document.getElementById('dlg');
    return {
      open: dlg.open,
      err: err && !err.hidden && err.textContent,
      vmsg: aa && aa.validationMessage,
      body: document.body.innerText,
    };
  });
  ck('「100.5」は拒否され日本語のインラインメッセージ', dec.open && dec.err === '金額は0以上の整数で入れてね');
  ck('小数を 1005 にしない（ダイアログが開いたまま）', dec.open === true);
  ck('英語のブラウザメッセージが出ない', !/Please match/i.test(dec.vmsg || '') && !/Please match/i.test(dec.body || '') && !/requested format/i.test(dec.body || ''));

  await typeAmount('-4000');
  const neg = await p.evaluate(() => {
    const err = document.getElementById('aaErr');
    return { open: document.getElementById('dlg').open, err: err && !err.hidden && err.textContent };
  });
  ck('「-4000」も日本語で拒否', neg.open && neg.err === '金額は0以上の整数で入れてね');
  await p.keyboard.press('Escape');
  await sleep(200);

  // (2) 項目を全部消して再読み込み
  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    const ids = s.items.map((i) => i.id);
    for (const id of ids) S.removeItem(s, id);
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  await p.click('[data-tab=set]');
  await sleep(200);
  const itemsAfter = await p.evaluate(() => [...document.querySelectorAll('.item .l b')].map((el) => el.textContent));
  ck('項目を全部消して再読み込みしても初期の6項目は戻らない', itemsAfter.length === 0);

  // データを初期化してレイアウト・月切り替えへ
  await p.evaluate(() => localStorage.clear());
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await sleep(200);
  await p.evaluate(seedExample, AMOUNTS);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  await p.click('[data-act=toggle-steps]');
  await sleep(250);

  // 式の2列揃え
  const align = await p.evaluate(() => {
    const yens = [...document.querySelectorAll('.settle-step .yen')].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { right: Math.round(r.right * 10) / 10, textAlign: cs.textAlign, tabular: cs.fontVariantNumeric, text: el.textContent };
    });
    const labs = [...document.querySelectorAll('.settle-step .lab')].map((el) => {
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left * 10) / 10, textAlign: getComputedStyle(el).textAlign };
    });
    return { yens, labs };
  });
  const yenRights = new Set(align.yens.map((y) => Math.round(y.right)));
  const labLefts = new Set(align.labs.map((l) => Math.round(l.left)));
  ck('金額が右揃えで桁が縦に揃う ' + JSON.stringify(align.yens),
    align.yens.length === 4 && yenRights.size === 1 && align.yens.every((y) => y.textAlign === 'right' && /tabular-nums/.test(y.tabular || '')));
  ck('ラベルが左揃え', align.labs.length === 4 && labLefts.size === 1 && align.labs.every((l) => l.textAlign === 'left'));

  // スライダーの色
  await p.click('[data-tab=set]');
  await sleep(200);
  const track = await p.evaluate(() => {
    const el = document.getElementById('ratio');
    return { ratio: el.style.getPropertyValue('--ratio') };
  });
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  ck('スライダーのバーが左ティール・右コーラル（--ratio と CSS）',
    track.ratio === '50%' && /var\(--teal\)/.test(css) && /var\(--coral\)/.test(css) && /linear-gradient\(to right/.test(css) && !/accent-color/.test(css));

  // (5) 月の切り替え: 11月を見ている状態で12月に進める
  await p.click('[data-tab=home]');
  await sleep(150);
  const beforeRoll = await p.evaluate(() => document.getElementById('mLbl') && document.getElementById('mLbl').textContent);
  ck('切り替え前は2026年11月', beforeRoll === '2026年11月');
  const rolled = await p.evaluate(() => {
    window.__warikanNow = Date.parse('2026-12-15T12:00:00+09:00');
    window.__checkMonthRoll();
    return {
      label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
      unfilled: [...document.querySelectorAll('.amt.empty')].length,
      rent: [...document.querySelectorAll('.prow')].some((r) => /家賃/.test(r.innerText) && /¥60,000/.test(r.innerText)),
    };
  });
  ck('開いたまま月が変わると新しい今月へ ' + JSON.stringify(rolled), rolled.label === '2026年12月' && rolled.rent && rolled.unfilled >= 5);

  // 過去月を見ているときは動かない
  await p.click('[data-act=prev-m]');
  await sleep(200);
  const onNov = await p.evaluate(() => document.getElementById('mLbl').textContent);
  ck('‹ で11月に戻れる', onNov === '2026年11月');
  const stayed = await p.evaluate(() => {
    window.__warikanNow = Date.parse('2027-01-15T12:00:00+09:00');
    window.__checkMonthRoll();
    return document.getElementById('mLbl').textContent;
  });
  ck('過去月を見ているときは月が変わっても動かない', stayed === '2026年11月');

  // スクショ用に11月の例＋未精算に戻す（now は2027-01なので今月は動かない。11月を表示したまま）
  await p.evaluate((map) => {
    window.__warikanNow = Date.parse('2026-11-15T12:00:00+09:00');
    const S = WarikanStore;
    const s = S.load();
    S.setRatio(s, 50);
    const m = '2026-11';
    S.ensureMonth(s, m);
    for (const pay of s.payments.filter((x) => x.month === m && !x.extra)) {
      if (map[pay.itemId] != null) S.updatePayment(s, pay.id, { amount: map[pay.itemId] });
    }
    S.clearMarks(s, m);
  }, AMOUNTS);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);

  // 未入力の注記スクショ用に買い物だけ空に
  // まず全部入ったホーム、精算済み＋割合変更、設定、未入力を撮る

  async function shots(width, height) {
    await p.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    // home filled
    await p.click('[data-tab=home]');
    await sleep(150);
    await p.screenshot({ path: path.join(SHOT_DIR, `home-${width}.png`) });
    // unfilled note: clear 買い物
    await p.evaluate(() => {
      const S = WarikanStore;
      const s = S.load();
      const pmt = s.payments.find((x) => x.month === '2026-11' && x.itemId === 'item-kaimono');
      if (pmt) S.updatePayment(s, pmt.id, { amount: null });
    });
    await p.reload({ waitUntil: 'networkidle0' });
    await sleep(200);
    await p.screenshot({ path: path.join(SHOT_DIR, `unfilled-${width}.png`) });
    await p.evaluate((map) => {
      const S = WarikanStore;
      const s = S.load();
      const pmt = s.payments.find((x) => x.month === '2026-11' && x.itemId === 'item-kaimono');
      if (pmt) S.updatePayment(s, pmt.id, { amount: map['item-kaimono'] });
    }, AMOUNTS);
    await p.reload({ waitUntil: 'networkidle0' });
    await sleep(200);
    // settle then change ratio, stay settled
    if (await p.$('[data-act=settle]')) {
      await p.click('[data-act=settle]');
      await sleep(200);
      await confirmFull(p);
    }
    await p.click('[data-tab=set]');
    await sleep(150);
    await p.evaluate(() => {
      const r = document.getElementById('ratio');
      r.value = 60;
      r.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(100);
    await p.screenshot({ path: path.join(SHOT_DIR, `set-${width}.png`) });
    await p.click('[data-tab=home]');
    await sleep(200);
    await p.screenshot({ path: path.join(SHOT_DIR, `settled-ratio-${width}.png`) });
    // reset marks and ratio for next width
    await p.evaluate(() => {
      const S = WarikanStore;
      const s = S.load();
      S.setRatio(s, 50);
      S.clearMarks(s, '2026-11');
    });
    await p.reload({ waitUntil: 'networkidle0' });
    await sleep(200);
  }
  for (const [w, h] of [[320, 568], [375, 812], [390, 844]]) await shots(w, h);

  // 金額エラーのスクショ（390）
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await openKaimono();
  await typeAmount('100.5');
  await p.screenshot({ path: path.join(SHOT_DIR, 'amount-err-390.png') });
  await p.keyboard.press('Escape');

  const shotOk = ['home', 'unfilled', 'set', 'settled-ratio'].every((k) =>
    [320, 375, 390].every((w) => fs.existsSync(path.join(SHOT_DIR, `${k}-${w}.png`))));
  ck('320/375/390 のスクショが揃っている', shotOk && fs.existsSync(path.join(SHOT_DIR, 'amount-err-390.png')));
  ck('JSエラーなし', errs.length === 0);
  if (errs.length) console.log(errs);

  await b.close();
  console.log(R.fails ? R.fails + ' FAILED' : 'ALL OK');
  process.exit(R.fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
