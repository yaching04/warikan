// E2E: 設定の「毎月の項目を追加」フォーム（候補を出さない、保存すると精算に出る）
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

  const btn = await p.evaluate(() => {
    const b = document.querySelector('[data-act=add-pay]');
    return b && { text: b.textContent.trim(), plus: /＋|\+/.test(b.textContent) };
  });
  ck('精算ページのボタンは「項目を追加」（記号なし）', btn && btn.text === '項目を追加' && !btn.plus, JSON.stringify(btn));

  await openMonthlyItemForm(p);
  const open = await p.evaluate(() => {
    const labels = [...document.querySelectorAll('#itemForm .f > label')].map((el) => el.textContent.trim());
    return {
      open: document.getElementById('dlg') && document.getElementById('dlg').open,
      title: document.getElementById('dh') && document.getElementById('dh').textContent,
      labels,
      chips: document.querySelectorAll('.ichip, .ichip-new, [data-new-item]').length,
      payers: [...document.querySelectorAll('#itemForm [data-payer]')].map((b) => b.textContent.replace(/\s+/g, '').trim()),
    };
  });
  ck('追加ダイアログが開く', open.open && open.title === '項目を追加');
  ck('既存の項目を選ぶ画面は出ない', open.chips === 0, JSON.stringify(open));
  ck('設定と同じ入力（名前・種類・いつも払う人）',
    open.labels[0] === '名前' && open.labels.includes('種類') && open.labels.includes('いつも払う人'),
    JSON.stringify(open.labels));
  ck('名前に「さん」は付けない', open.payers.every((t) => !/さん$/.test(t)) && open.payers.some((t) => t === '自分'), JSON.stringify(open.payers));
  await p.keyboard.press('Escape');
  await sleep(150);

  await tap(p, '[data-act=add-item]');
  await sleep(200);
  await p.evaluate(() => {
    document.getElementById('inName').value = 'カフェ';
    const kind = document.querySelector('[data-kind=variable]');
    if (kind) kind.click();
  });
  await sleep(150);
  await p.click('#itemForm button[type=submit]');
  await sleep(300);
  await backToHome(p);
  const saved = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.prow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    const rent = rows.filter((t) => /家賃/.test(t));
    const items = (WarikanStore.load().items || []).map((it) => it.name);
    return { rows, rent, items, dlg: document.getElementById('dlg').open };
  });
  ck('保存するとその月に出て、家賃の行は増えない',
    !saved.dlg && saved.items.includes('カフェ') && saved.rows.some((t) => /カフェ/.test(t)) && saved.rent.length === 1,
    JSON.stringify(saved));
  ck('JSエラーなし', errs.length === 0, errs.join(' | '));

  await b.close();
  if (R.fails) { console.log(R.fails + ' FAILED'); process.exit(1); }
  console.log('ALL OK');
})().catch((e) => { console.error(e); process.exit(1); });
