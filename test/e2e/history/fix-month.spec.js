// E2E: 履歴の「修正」で確定を外し、その月の精算ページへ進む。「この月を開く」は出さない。
const fs = require('fs');
const path = require('path');
const { ROOT, SHOT_DIR, sleep, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;

(async () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  ck('「この月を開く」と goto-month がない', !/この月を開く/.test(app) && !/goto-month/.test(app));
  ck('履歴のボタンは「修正」', /data-act="unconfirm"[^>]*>修正</.test(app));
  ck('案内は「修正は履歴から」', /修正は履歴から/.test(app) && !/取り消しは履歴から/.test(app));

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
    S.ensureMonth(s, '2026-11');
    const fill = { 'item-kaimono': 8000, 'item-denki': 4000, 'item-gas': 3000, 'item-suidou': 2000, 'item-net': 5000 };
    for (const pay of s.payments.filter((x) => x.month === '2026-11' && !x.extra)) {
      if (fill[pay.itemId] != null) S.updatePayment(s, pay.id, { amount: fill[pay.itemId] });
    }
    localStorage.setItem(S.KEY, JSON.stringify(s));
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);

  const ready = await p.evaluate(() => ({
    label: (document.getElementById('mLbl') || {}).textContent,
    settle: !!document.querySelector('[data-act=settle]'),
  }));
  ck('11月を精算できる', /2026年11月/.test(ready.label || '') && ready.settle, JSON.stringify(ready));
  await p.click('[data-act=settle]');
  await sleep(400);

  await p.click('[data-tab=hist]');
  await sleep(250);
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('[data-tab]')].find((b) => b.dataset.tab === 'home');
    if (btn) btn.click();
  });
  await sleep(250);
  const onDec = await p.evaluate(() => /2026年12月/.test((document.getElementById('mLbl') || {}).textContent || ''));
  if (onDec) {
    await p.click('[data-act=prev-m]');
    await sleep(250);
  }
  const settledCard = await p.evaluate(() => {
    const hint = document.querySelector('.settle-done-hint');
    return {
      label: (document.getElementById('mLbl') || {}).textContent,
      done: document.querySelector('.settle-done') && document.querySelector('.settle-done').textContent,
      hint: hint && hint.textContent,
      compact: !!document.querySelector('.settle.compact'),
    };
  });
  ck('確定済みカードの案内は「修正は履歴から」',
    /2026年11月/.test(settledCard.label || '') && /確定済み/.test(settledCard.done || '') && settledCard.hint === '修正は履歴から',
    JSON.stringify(settledCard));

  await p.click('[data-tab=hist]');
  await sleep(250);
  const hist = await p.evaluate(() => {
    const btn = document.querySelector('[data-act=unconfirm][data-month="2026-11"]');
    const cs = btn && getComputedStyle(btn);
    return {
      text: document.body.innerText,
      label: btn && btn.textContent.trim(),
      outline: !!(cs && cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.borderWidth === '0px'),
      hasGoto: /この月を開く/.test(document.body.innerText),
    };
  });
  ck('履歴に小さく「修正」がある', hist.label === '修正' && /精算済み/.test(hist.text), JSON.stringify(hist));
  ck('履歴一覧に「この月を開く」は出ない', hist.hasGoto === false);
  await p.screenshot({ path: path.join(SHOT_DIR, 'hist-375-light.png') });

  await p.evaluate(() => {
    const row = [...document.querySelectorAll('.hrow')].find((r) => /11月/.test(r.innerText));
    if (row) row.click();
  });
  await sleep(200);
  const detail = await p.evaluate(() => {
    const dlg = document.getElementById('dlg');
    const acts = dlg ? [...dlg.querySelectorAll('.acts button')].map((b) => ({ act: b.getAttribute('data-act'), t: b.textContent.trim() })) : [];
    return { open: !!(dlg && dlg.open), text: dlg && dlg.innerText, acts };
  });
  ck('詳細シートは「閉じる」だけ',
    detail.open && /2026年11月の精算/.test(detail.text || '') &&
    detail.acts.length === 1 && detail.acts[0].act === 'close' && detail.acts[0].t === '閉じる' &&
    !/この月を開く/.test(detail.text || ''),
    JSON.stringify(detail));
  await p.click('[data-act=close]');
  await sleep(200);

  await p.click('[data-act=unconfirm][data-month="2026-11"]');
  await sleep(200);
  const confirm = await p.evaluate(() => {
    const dlg = document.getElementById('dlg');
    const btns = dlg ? [...dlg.querySelectorAll('button')].map((b) => ({ act: b.getAttribute('data-act'), t: b.textContent.trim(), cls: b.className })) : [];
    return { open: !!(dlg && dlg.open), text: dlg && dlg.innerText.replace(/\s+/g, ' ').trim(), btns };
  });
  const okBtn = confirm.btns.find((b) => b.act === 'unconfirm-ok');
  const cancelBtn = confirm.btns.find((b) => b.act === 'close');
  ck('確認は「11月を修正しますか？」',
    confirm.open && /11月を修正しますか？/.test(confirm.text || '') && /確定が外れて、金額を直せるようになります/.test(confirm.text || ''),
    confirm.text);
  ck('確認のボタンは「修正する」と「やめる」',
    okBtn && okBtn.t === '修正する' && cancelBtn && cancelBtn.t === 'やめる' && okBtn.cls.split(' ').includes('btn') && !okBtn.cls.split(' ').includes('danger'),
    JSON.stringify(confirm.btns));
  await p.screenshot({ path: path.join(SHOT_DIR, 'confirm-375-light.png') });

  await p.click('[data-act=close]');
  await sleep(200);
  const stayed = await p.evaluate(() => ({
    hist: !!(document.querySelector('#tabs button.on') && document.querySelector('#tabs button.on').dataset.tab === 'hist'),
    settled: WarikanStore.isSettled(WarikanStore.load(), '2026-11'),
    btn: !!document.querySelector('[data-act=unconfirm][data-month="2026-11"]'),
  }));
  ck('「やめる」なら履歴のまま確定も残る', stayed.hist && stayed.settled && stayed.btn, JSON.stringify(stayed));

  await p.click('[data-act=unconfirm][data-month="2026-11"]');
  await sleep(200);
  await p.click('[data-act=unconfirm-ok]');
  await sleep(300);
  const after = await p.evaluate(() => ({
    tab: document.querySelector('#tabs button.on') && document.querySelector('#tabs button.on').dataset.tab,
    label: (document.getElementById('mLbl') || {}).textContent,
    settle: !!document.querySelector('[data-act=settle]'),
    done: !!document.querySelector('.settle-done'),
    lock: /🔒/.test((document.getElementById('mLbl') || {}).textContent || ''),
    settled: WarikanStore.isSettled(WarikanStore.load(), '2026-11'),
  }));
  ck('修正すると11月の精算ページへ進む',
    after.tab === 'home' && /2026年11月/.test(after.label || '') && after.settle === true && after.done === false && !after.lock && after.settled === false,
    JSON.stringify(after));
  await p.screenshot({ path: path.join(SHOT_DIR, 'settle-after-375-light.png') });

  await p.click('[data-act=settle]');
  await sleep(400);
  const resettled = await p.evaluate(() => WarikanStore.isSettled(WarikanStore.load(), '2026-11'));
  ck('いつもの「精算する」で再確定できる', resettled === true);

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
