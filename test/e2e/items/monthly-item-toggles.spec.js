// E2E: 毎月の項目フォームの種類・払う人の切替。キャンセルでは追加しない
const { sleep, tap, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;

/* 設定の「毎月の項目を追加」フォームを開く（v2.0.6 から精算ページの追加はその月だけの別フォーム） */
async function openMonthlyItemForm(p) {
  await tap(p, '[data-tab=set]');
  await sleep(250);
  await tap(p, '[data-act=add-item]');
  await sleep(250);
}

(async () => {
  const b = await launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setBypassServiceWorker(true);
  await p.emulateTimezone('Asia/Tokyo');
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate(() => localStorage.clear());
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await sleep(200);

  await openMonthlyItemForm(p);
  const init = await p.evaluate(() => {
    const wrap = document.getElementById('fixWrap');
    return {
      title: document.getElementById('dh') && document.getElementById('dh').textContent,
      kind: [...document.querySelectorAll('#itemForm [data-kind].on')].map((b) => b.dataset.kind),
      payer: [...document.querySelectorAll('#itemForm [data-payer].on')].map((b) => b.dataset.payer),
      fixHidden: !!(wrap && wrap.hidden),
    };
  });
  ck('最初は変動で、固定の金額欄は隠れる', init.title === '項目を追加' && init.kind[0] === 'variable' && init.payer[0] === 'kanojo' && init.fixHidden, JSON.stringify(init));

  await p.evaluate(() => { const b = document.querySelector('[data-kind=fixed]'); if (b) b.click(); });
  await sleep(200);
  const fixed = await p.evaluate(() => {
    const wrap = document.getElementById('fixWrap');
    const amt = document.getElementById('inAmt');
    return {
      kind: [...document.querySelectorAll('#itemForm [data-kind].on')].map((b) => b.dataset.kind),
      hidden: !!(wrap && wrap.hidden),
      value: amt && amt.value,
      placeholder: amt && amt.placeholder,
    };
  });
  ck('固定にすると金額欄が出て、空＋「例：4,000」', fixed.kind[0] === 'fixed' && !fixed.hidden && fixed.value === '' && fixed.placeholder === '例：4,000', JSON.stringify(fixed));

  await p.evaluate(() => { const b = document.querySelector('[data-payer=yamada]'); if (b) b.click(); });
  await sleep(150);
  const payer = await p.evaluate(() => [...document.querySelectorAll('#itemForm [data-payer].on')].map((b) => b.dataset.payer));
  ck('いつも払う人を1人目に変えられる', payer[0] === 'yamada', JSON.stringify(payer));

  await p.evaluate(() => { document.getElementById('inName').value = '捨てる項目'; });
  await p.evaluate(() => { const b = document.querySelector('#itemForm [data-act=close]'); if (b) b.click(); });
  await sleep(200);
  const cancelled = await p.evaluate(() => {
    const items = (WarikanStore.load().items || []).map((it) => it.name);
    const rows = [...document.querySelectorAll('.prow')].map((r) => r.innerText);
    return { items, has: items.includes('捨てる項目') || rows.some((t) => /捨てる項目/.test(t)), open: document.getElementById('dlg').open };
  });
  ck('キャンセルでは項目を追加しない', !cancelled.open && !cancelled.has, JSON.stringify(cancelled));
  ck('JSエラーなし', errs.length === 0, errs.join(' | '));
  await b.close();
  if (R.fails) { console.log(R.fails + ' FAILED'); process.exit(1); }
  console.log('ALL OK');
})().catch((e) => { console.error(e); process.exit(1); });
