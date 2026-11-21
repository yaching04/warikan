// E2E: 毎月の項目フォームと支払い入力のプレースホルダ（未入力・固定金額）
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
async function backToHome(p) {
  await tap(p, '[data-tab=home]');
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
  const add = await p.evaluate(() => {
    const labels = [...document.querySelectorAll('#itemForm .f > label')].map((el) => el.textContent.trim());
    const name = document.getElementById('inName');
    const wrap = document.getElementById('fixWrap');
    return {
      title: document.getElementById('dh') && document.getElementById('dh').textContent,
      labels,
      chips: document.querySelectorAll('.ichip, .ichip-new').length,
      nameValue: name && name.value,
      fixHidden: !!(wrap && wrap.hidden),
    };
  });
  ck('設定の「毎月の項目を追加」は名前・種類・いつも払う人のフォーム', add.title === '項目を追加' && add.chips === 0 && add.labels[0] === '名前' && add.labels.includes('種類') && add.labels.includes('いつも払う人') && add.nameValue === '' && add.fixHidden, JSON.stringify(add));
  await p.keyboard.press('Escape');
  await sleep(150);
  await backToHome(p);

  // 未入力の行を開く
  await p.evaluate(() => {
    const row = [...document.querySelectorAll('.prow')].find((r) => /買い物/.test(r.innerText) && /未入力/.test(r.innerText));
    if (row) row.click();
  });
  await sleep(200);
  const unfilled = await p.evaluate(() => {
    const aa = document.getElementById('aa');
    return { value: aa.value, placeholder: aa.placeholder, title: document.getElementById('dh').textContent };
  });
  ck('未入力の行は「買い物の金額を入れる」（金額は空、プレースホルダは先月か空）', unfilled.value === '' && unfilled.title === '買い物の金額を入れる' && (unfilled.placeholder === '' || /^先月 /.test(unfilled.placeholder)));
  await p.keyboard.press('Escape');
  await sleep(150);

  // 家賃（実額あり）は値が残る
  await p.evaluate(() => {
    const row = [...document.querySelectorAll('.prow')].find((r) => /家賃/.test(r.innerText));
    if (row) row.click();
  });
  await sleep(200);
  const rent = await p.evaluate(() => {
    const aa = document.getElementById('aa');
    return { value: aa.value, placeholder: aa.placeholder };
  });
  ck('家賃など実額がある欄は値を残す', rent.value === '60000');
  await p.keyboard.press('Escape');
  await sleep(150);

  // 設定の固定金額
  await p.click('[data-tab=set]');
  await sleep(200);
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('[data-act=edit-item]')].find((b) => {
      const item = b.closest('.item');
      return item && /家賃/.test(item.innerText);
    });
    if (btn) btn.click();
  });
  await sleep(200);
  const fix = await p.evaluate(() => {
    const el = document.getElementById('inAmt');
    return el && { value: el.value, placeholder: el.placeholder };
  });
  ck('設定の家賃は固定金額 ¥60,000 を残す', fix && fix.value === '60000');
  await p.keyboard.press('Escape');
  await sleep(150);

  await p.click('[data-act=add-item]');
  await sleep(200);
  await p.evaluate(() => {
    const b = document.querySelector('[data-kind=fixed]');
    if (b) b.click();
  });
  await sleep(150);
  const newFix = await p.evaluate(() => {
    const el = document.getElementById('inAmt');
    return el && { value: el.value, placeholder: el.placeholder };
  });
  ck('新しい固定項目の金額は空＋「例：4,000」', newFix && newFix.value === '' && newFix.placeholder === '例：4,000');
  await p.keyboard.press('Escape');
  ck('JSエラーなし', errs.length === 0);
  if (errs.length) console.log(errs);

  await b.close();
  console.log(R.fails ? R.fails + ' FAILED' : 'ALL OK');
  process.exit(R.fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
