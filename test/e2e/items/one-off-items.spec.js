// E2E: 精算の「項目を追加」はその月だけ。設定の「毎月の項目を追加」は毎月。
const fs = require('fs');
const path = require('path');
const { VERSION, ROOT, SHOT_DIR, sleep, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;

(async () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  ck('精算の追加は openOneOff', /'add-pay': \(\) => \{[^\n]*openOneOff\(null\)/.test(app) && !/'add-pay':[^\n]*openItem\(null\)/.test(app));
  ck('設定のボタンは「毎月の項目を追加」', /data-act="add-item">毎月の項目を追加</.test(app));
  ck('「今月だけ」タグや案内は出さない', !/今月だけ/.test(app) && !/毎月の項目は設定から追加/.test(app));

  const b = await launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setBypassServiceWorker(true);
  await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument(() => { window.__warikanNow = Date.parse('2026-11-15T12:00:00+09:00'); });
  await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('warikan-theme', 'light');
    const S = WarikanStore;
    const s = S.defaultState();
    S.ensureMonth(s, '2026-11');
    const fill = { 'item-kaimono': 8000, 'item-denki': 4000, 'item-gas': 3000, 'item-suidou': 2000, 'item-net': 5000 };
    for (const pay of s.payments.filter((x) => x.month === '2026-11' && !x.extra)) {
      if (fill[pay.itemId] != null) S.updatePayment(s, pay.id, { amount: fill[pay.itemId] });
    }
    localStorage.setItem(S.KEY, JSON.stringify(s));
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);

  const home = await p.evaluate(() => {
    const btn = document.querySelector('[data-act=add-pay]');
    const amt = document.getElementById('settleAmt');
    return {
      label: (document.getElementById('mLbl') || {}).textContent,
      add: btn && btn.textContent.trim(),
      settle: amt && amt.textContent,
      settleAmt: amt && Number(amt.dataset.amt),
    };
  });
  ck('11月の精算に「項目を追加」がある', /2026年11月/.test(home.label || '') && home.add === '項目を追加', JSON.stringify(home));

  await p.click('[data-act=add-pay]');
  await sleep(250);
  const sheet = await p.evaluate(() => {
    const dlg = document.getElementById('dlg');
    const labels = [...document.querySelectorAll('#oneOffForm .f > label, #itemForm .f > label')].map((el) => el.textContent.trim());
    const kinds = [...document.querySelectorAll('[data-kind]')].map((el) => el.textContent.trim());
    return {
      open: !!(dlg && dlg.open),
      title: (document.getElementById('dh') || {}).textContent,
      labels,
      kinds,
      form: !!(document.getElementById('oneOffForm') && !document.getElementById('itemForm')),
      text: dlg && dlg.innerText,
    };
  });
  ck('精算のシートは「項目を追加」で、固定／変動は出ない',
    sheet.open && sheet.title === '項目を追加' && sheet.form &&
    sheet.labels[0] === '名前' && sheet.labels.includes('金額') && sheet.labels.includes('払った人') &&
    !sheet.labels.includes('種類') && !sheet.labels.includes('いつも払う人') && sheet.kinds.length === 0 &&
    !/今月だけ/.test(sheet.text || '') && !/毎月の項目は設定から追加/.test(sheet.text || ''),
    JSON.stringify(sheet));
  await p.screenshot({ path: path.join(SHOT_DIR, 'oneoff-sheet-375-light.png') });

  await p.type('#inName', '旅行');
  await p.click('#inAmt');
  await p.type('#inAmt', '3000');
  const payerId = await p.evaluate(() => {
    const on = document.querySelector('#oneOffForm [data-payer].on');
    const pick = on || document.querySelector('#oneOffForm [data-payer]');
    return pick && pick.getAttribute('data-payer');
  });
  ck('払った人が選べる', !!payerId, String(payerId));
  await p.click('#oneOffForm button[type=submit]');
  await sleep(300);

  const afterAdd = await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    const extras = s.payments.filter((x) => x.extra);
    const travel = extras.find((x) => x.itemName === '旅行');
    const rows = [...document.querySelectorAll('.prow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    const amt = document.getElementById('settleAmt');
    return {
      travel: travel && { month: travel.month, extra: travel.extra, itemId: travel.itemId, amount: travel.amount, name: travel.itemName },
      items: (s.items || []).map((it) => it.name),
      rows,
      hasTag: /今月だけ/.test(document.body.innerText),
      settle: amt && amt.textContent,
      settleAmt: amt && Number(amt.dataset.amt),
    };
  });
  ck('旅行がその月の支払いに出る',
    afterAdd.travel && afterAdd.travel.month === '2026-11' && afterAdd.travel.extra === true &&
    afterAdd.travel.itemId == null && afterAdd.travel.amount === 3000 &&
    afterAdd.rows.some((t) => /旅行/.test(t) && /¥3,000/.test(t)),
    JSON.stringify(afterAdd));
  ck('精算の合計に旅行が入る',
    afterAdd.settleAmt === home.settleAmt + 1500 || afterAdd.settleAmt === Math.abs(home.settleAmt - 1500) ||
    (typeof afterAdd.settleAmt === 'number' && afterAdd.settleAmt !== home.settleAmt),
    'before=' + home.settleAmt + ' after=' + afterAdd.settleAmt);
  // At 50:50, adding 3000 paid by one person changes the net by 1500.
  const expectedNet = await p.evaluate(() => {
    const s = WarikanStore.load();
    return WarikanLogic.computeSettle(s.payments.filter((x) => x.month === '2026-11'), s.ratioYamada).amount;
  });
  ck('精算額が計算どおり（旅行込み）', afterAdd.settleAmt === expectedNet && expectedNet !== home.settleAmt,
    'ui=' + afterAdd.settleAmt + ' logic=' + expectedNet + ' before=' + home.settleAmt);

  await p.click('[data-tab=set]');
  await sleep(250);
  const settings = await p.evaluate(() => {
    const btn = document.querySelector('[data-act=add-item]');
    const names = [...document.querySelectorAll('.item .l b')].map((el) => el.textContent.trim());
    return { add: btn && btn.textContent.trim(), names, ver: (document.body.innerText.match(/v\d+\.\d+\.\d+/) || [''])[0] };
  });
  ck('設定の追加は「毎月の項目を追加」', settings.add === '毎月の項目を追加', JSON.stringify(settings));
  ck('旅行は設定の項目に出ない', settings.names.includes('旅行') === false && settings.names.length >= 1, JSON.stringify(settings.names));
  ck('設定に今の版が出る', settings.ver === 'v' + VERSION);

  await p.click('[data-act=add-item]');
  await sleep(250);
  const monthlySheet = await p.evaluate(() => {
    const labels = [...document.querySelectorAll('#itemForm .f > label')].map((el) => el.textContent.trim());
    return {
      open: !!(document.getElementById('itemForm')),
      title: (document.getElementById('dh') || {}).textContent,
      labels,
      hasKinds: document.querySelectorAll('[data-kind]').length === 2,
    };
  });
  ck('設定のフォームは毎月の項目（種類あり）',
    monthlySheet.open && monthlySheet.title === '項目を追加' && monthlySheet.labels.includes('種類') &&
    monthlySheet.labels.includes('いつも払う人') && monthlySheet.hasKinds,
    JSON.stringify(monthlySheet));
  await p.type('#inName', '保険');
  await p.click('#itemForm button[type=submit]');
  await sleep(300);

  const afterMonthly = await p.evaluate(() => {
    const s = WarikanStore.load();
    return {
      hasItem: (s.items || []).some((it) => it.name === '保険' && !it.extra),
      names: [...document.querySelectorAll('.item .l b')].map((el) => el.textContent.trim()),
      nov: s.payments.filter((x) => x.month === '2026-11' && x.itemName === '保険' && !x.extra).length,
    };
  });
  ck('設定で追加した保険は毎月の項目になる',
    afterMonthly.hasItem && afterMonthly.names.includes('保険') && afterMonthly.nov >= 1,
    JSON.stringify(afterMonthly));

  await p.click('[data-tab=home]');
  await sleep(250);
  const stillNov = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.prow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    return {
      label: (document.getElementById('mLbl') || {}).textContent,
      hasTravel: rows.some((t) => /旅行/.test(t)),
      hasIns: rows.some((t) => /保険/.test(t)),
    };
  });
  if (!/2026年11月/.test(stillNov.label || '')) {
    await p.click('[data-act=prev-m]');
    await sleep(250);
  }
  const novRows = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.prow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    return {
      label: (document.getElementById('mLbl') || {}).textContent,
      hasTravel: rows.some((t) => /旅行/.test(t) && /¥3,000/.test(t)),
      hasIns: rows.some((t) => /保険/.test(t)),
    };
  });
  ck('11月には旅行も保険もある', /2026年11月/.test(novRows.label || '') && novRows.hasTravel && novRows.hasIns, JSON.stringify(novRows));

  await p.click('[data-act=next-m]');
  await sleep(250);
  const dec = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.prow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    const s = WarikanStore.load();
    return {
      label: (document.getElementById('mLbl') || {}).textContent,
      rows,
      hasTravel: rows.some((t) => /旅行/.test(t)) || s.payments.some((x) => x.month === '2026-12' && x.itemName === '旅行'),
      hasIns: rows.some((t) => /保険/.test(t)),
    };
  });
  ck('12月には旅行は出ず、保険は出る', /2026年12月/.test(dec.label || '') && dec.hasTravel === false && dec.hasIns === true, JSON.stringify(dec));

  // edit + delete one-off on November
  await p.click('[data-act=prev-m]');
  await sleep(250);
  await p.evaluate(() => {
    const row = [...document.querySelectorAll('.prow')].find((r) => /旅行/.test(r.innerText));
    if (row) row.click();
  });
  await sleep(250);
  const editSheet = await p.evaluate(() => {
    return {
      title: (document.getElementById('dh') || {}).textContent,
      form: !!document.getElementById('oneOffForm'),
      name: (document.getElementById('inName') || {}).value,
      amt: (document.getElementById('inAmt') || {}).value,
      del: !![...document.querySelectorAll('[data-act=del-pay]')].length,
    };
  });
  ck('旅行を開くと今月だけの項目を編集できる',
    editSheet.form && editSheet.title === '項目の編集' && editSheet.name === '旅行' && editSheet.amt === '3000' && editSheet.del,
    JSON.stringify(editSheet));
  await p.click('[data-act=close]');
  await sleep(150);

  ck('ページエラーなし', errs.length === 0, errs.join(' | '));
  await b.close();
  if (R.fails) {
    console.log(R.fails + ' failed');
    process.exit(1);
  }
  console.log('all passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
