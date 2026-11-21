// E2E: 設定の固定額を変えると精算に反映される。金額の桁幅が揃う。
const path = require('path');
const { SHOT_DIR, sleep, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;

(async () => {
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
    const S = WarikanStore;
    const s = S.defaultState();
    S.setPersonName(s, 'yamada', 'たろう');
    S.setPersonName(s, 'kanojo', 'はなこ');
    S.ensureMonth(s, '2026-11');
    S.ensureMonth(s, '2026-12');
    const fill = { 'item-kaimono': 8000, 'item-denki': 4000, 'item-gas': 3000, 'item-suidou': 7000, 'item-net': 4000 };
    for (const pay of s.payments.filter((x) => x.month === '2026-11' && !x.extra)) {
      if (fill[pay.itemId] != null) S.updatePayment(s, pay.id, { amount: fill[pay.itemId] });
    }
    localStorage.setItem(S.KEY, JSON.stringify(s));
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);

  const before = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.prow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    return rows;
  });
  ck('変更前の精算は家賃が ¥60,000', before.some((t) => /家賃/.test(t) && /¥60,000/.test(t)), JSON.stringify(before));

  await p.evaluate(() => document.querySelector('[data-tab=set]').click());
  await sleep(200);
  await p.evaluate(() => {
    const btn = document.querySelector('[data-act=edit-item][data-id=item-yachin]');
    if (!btn) throw new Error('missing edit-item 家賃');
    btn.click();
  });
  await sleep(250);
  const form = await p.evaluate(() => {
    const dlg = document.getElementById('dlg');
    const amt = document.getElementById('inAmt');
    return { open: !!(dlg && dlg.open), title: (document.getElementById('dh') || {}).textContent, amt: amt && amt.value };
  });
  ck('設定から家賃の編集が開く', form.open && form.title === '項目の編集' && String(form.amt) === '60000', JSON.stringify(form));

  await p.evaluate(() => {
    const amt = document.getElementById('inAmt');
    amt.value = '65000';
    amt.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.click('#itemForm button[type=submit]');
  await sleep(350);

  const inSet = await p.evaluate(() => {
    const items = [...document.querySelectorAll('.item')].map((el) => el.innerText.replace(/\s+/g, ' ').trim());
    const it = (WarikanStore.load().items || []).find((x) => x.id === 'item-yachin');
    return { items, amt: it && it.fixedAmount, dlg: document.getElementById('dlg').open };
  });
  ck('設定の家賃が ¥65,000 になる', !inSet.dlg && inSet.amt === 65000 && inSet.items.some((t) => /家賃/.test(t) && /¥65,000/.test(t)), JSON.stringify(inSet));

  await p.evaluate(() => document.querySelector('[data-tab=home]').click());
  await sleep(300);

  const after = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.prow')].map((r) => {
      const amt = r.querySelector('.amt');
      return { text: r.innerText.replace(/\s+/g, ' ').trim(), amt: amt && amt.textContent };
    });
    const style = getComputedStyle(document.body).fontVariantNumeric;
    const payments = WarikanStore.load().payments;
    const nov = payments.find((x) => x.month === '2026-11' && x.itemId === 'item-yachin' && !x.extra);
    const dec = payments.find((x) => x.month === '2026-12' && x.itemId === 'item-yachin' && !x.extra);
    return { rows, style, nov: nov && nov.amount, dec: dec && dec.amount };
  });
  ck('精算の今月の家賃が ¥65,000 になる',
    after.nov === 65000 && after.rows.some((r) => /家賃/.test(r.text) && r.amt === '¥65,000'),
    JSON.stringify(after.rows));
  ck('すでに行がある未来の月（12月）にも反映される', after.dec === 65000, String(after.dec));
  ck('body に tabular-nums が付いている', /tabular-nums/.test(after.style || ''), after.style);

  const four = await p.evaluate(() => {
    const amts = [...document.querySelectorAll('.prow .amt')].filter((el) => /¥\d,\d{3}$/.test(el.textContent.trim()));
    const widths = amts.map((el) => ({ t: el.textContent.trim(), w: Math.round(el.getBoundingClientRect().width * 100) / 100 }));
    return widths;
  });
  const uniqueW = [...new Set(four.map((x) => x.w))];
  ck('同じ桁の金額の幅が揃う', four.length >= 2 && uniqueW.length === 1, JSON.stringify(four));

  await p.evaluate(() => {
    const t = document.getElementById('toast');
    if (t) t.hidden = true;
    const list = document.querySelector('.plist');
    if (list) list.scrollIntoView({ block: 'start' });
  });
  await sleep(150);
  await p.screenshot({ path: path.join(SHOT_DIR, 'settle-aligned-375-light.png') });

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
