// E2E: 支払いが属する月の精算済みを外す、¥/円つきの金額入力
const { sleep, launch, reporter, APPURL: URL } = require('../helpers');
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
  const s = S.load();
  const m = '2026-11';
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
  await p.evaluate(seedExample, AMOUNTS);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);

  ck('例の金額で ¥38,000', await p.evaluate(() => document.getElementById('settleAmt').textContent) === '¥38,000');
  await p.click('[data-act=settle]');
  await sleep(200);
  await confirmFull(p);
  const just = await p.evaluate(() => ({
    confirmed: document.querySelector('.settle-confirmed') && document.querySelector('.settle-confirmed').textContent,
    edit: !!document.querySelector('[data-act=edit-pay]'),
  }));
  ck('11月を確定した', /11月を確定しました/.test(just.confirmed || '') && !just.edit, JSON.stringify(just));

  // タブを切って自動切替を止め、確定した11月を見る
  await p.click('[data-tab=hist]');
  await sleep(150);
  await p.click('[data-tab=home]');
  await sleep(200);
  await p.click('[data-act=prev-m]');
  await sleep(200);
  const locked = await p.evaluate(() => {
    const row = [...document.querySelectorAll('.prow')].find((r) => /買い物/.test(r.innerText));
    if (row) row.click();
    return {
      label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
      lock: /🔒/.test((document.getElementById('mLbl') || {}).textContent || ''),
      edit: !!document.querySelector('[data-act=edit-pay]'),
      add: !!document.querySelector('[data-act=add-pay]'),
      open: document.getElementById('dlg').open,
      settled: WarikanStore.isSettled(WarikanStore.load(), '2026-11'),
    };
  });
  ck('確定した11月は🔒で編集できない', /2026年11月/.test(locked.label || '') && locked.lock && !locked.edit && !locked.add && !locked.open && locked.settled, JSON.stringify(locked));

  // 未精算の月なら、ダイアログを開いたまま月が変わっても、保存先は支払いの属する月
  await p.click('[data-tab=hist]');
  await sleep(150);
  await p.click('[data-act=unconfirm]');
  await sleep(150);
  await p.click('[data-act=unconfirm-ok]');
  await sleep(200);
  await p.click('[data-tab=home]');
  await sleep(200);
  const opened = await p.evaluate(() => {
    const row = [...document.querySelectorAll('.prow')].find((r) => /買い物/.test(r.innerText));
    if (row) { row.click(); return true; }
    return false;
  });
  ck('未精算の11月で買い物の編集を開く', opened && await p.evaluate(() => document.getElementById('dlg').open));
  await sleep(200);

  const rolled = await p.evaluate(() => {
    window.__warikanNow = Date.parse('2026-12-15T12:00:00+09:00');
    window.__checkMonthRoll();
    return {
      label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
      open: document.getElementById('dlg').open,
      aa: document.getElementById('aa') && document.getElementById('aa').value,
    };
  });
  ck('ダイアログを開いたまま12月へ切り替わる', /2026年12月/.test(rolled.label || '') && rolled.open === true);

  await p.evaluate(() => {
    const aa = document.getElementById('aa');
    aa.value = '11111';
    aa.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.click('#payForm button[type=submit]');
  await sleep(300);

  const afterSave = await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    const pay = s.payments.find((x) => x.month === '2026-11' && x.itemId === 'item-kaimono');
    return {
      label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
      novAmount: pay && pay.amount,
      novSettled: S.isSettled(s, '2026-11'),
      decSettled: S.isSettled(s, '2026-12'),
      dlg: document.getElementById('dlg').open,
    };
  });
  ck('保存先は11月のまま ¥11,111 ' + JSON.stringify(afterSave), afterSave.novAmount === 11111 && afterSave.dlg === false);
  ck('未精算のまま（表示中の12月の精算には触れない）', afterSave.novSettled === false && afterSave.decSettled === false);

  await p.click('[data-act=prev-m]');
  await sleep(250);
  const back = await p.evaluate(() => ({
    label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
    amt: document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent,
    done: !!document.querySelector('.settle-done'),
    settleBtn: !!document.querySelector('[data-act=settle]'),
    kaimono: ([...document.querySelectorAll('.prow')].find((r) => /買い物/.test(r.innerText)) || {}).innerText,
  }));
  ck('11月に戻ると再計算されている ' + JSON.stringify({ amt: back.amt, done: back.done }),
    /2026年11月/.test(back.label || '') && back.done === false && back.settleBtn === true && back.amt !== '¥38,000' && /¥11,111/.test(back.kaimono || ''));

  // ¥ / 円 の入力
  await p.evaluate(() => { window.__warikanNow = Date.parse('2026-11-15T12:00:00+09:00'); });
  await p.evaluate(seedExample, AMOUNTS);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);

  async function openKaimono() {
    const ok = await p.evaluate(() => {
      const row = [...document.querySelectorAll('.prow')].find((r) => /買い物/.test(r.innerText));
      if (row) { row.click(); return true; }
      return false;
    });
    await sleep(200);
    return ok;
  }
  async function saveAmount(val) {
    await p.evaluate((v) => {
      const aa = document.getElementById('aa');
      aa.value = v;
      aa.dispatchEvent(new Event('input', { bubbles: true }));
    }, val);
    await p.click('#payForm button[type=submit]');
    await sleep(250);
  }
  function kaimonoYen() {
    return p.evaluate(() => {
      const row = [...document.querySelectorAll('.prow')].find((r) => /買い物/.test(r.innerText));
      return row ? row.innerText.replace(/\s+/g, ' ').trim() : '';
    });
  }

  ck('買い物を開く（¥4000）', await openKaimono());
  await saveAmount('¥4000');
  ck('「¥4000」が ¥4,000 になる', /¥4,000/.test(await kaimonoYen()) && await p.evaluate(() => !document.getElementById('dlg').open));

  ck('買い物を開く（4000円）', await openKaimono());
  await saveAmount('4000円');
  ck('「4000円」が ¥4,000 になる', /¥4,000/.test(await kaimonoYen()));

  ck('買い物を開く（￥４，０００）', await openKaimono());
  await saveAmount('￥４，０００');
  ck('「￥４，０００」が ¥4,000 になる', /¥4,000/.test(await kaimonoYen()));
  ck('JSエラーなし', errs.length === 0);
  if (errs.length) console.log(errs);

  await b.close();
  console.log(R.fails ? R.fails + ' FAILED' : 'ALL OK');
  process.exit(R.fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
