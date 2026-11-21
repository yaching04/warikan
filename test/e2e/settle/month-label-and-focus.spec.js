// E2E: 精算額の月名ラベル、月送りの :focus-visible、確定済みの表示、スクリーンショット
const path = require('path');
const { SHOT_DIR, sleep, hex, contrast, setTheme, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;


const AMOUNTS = { 'item-yachin': 60000, 'item-kaimono': 30000, 'item-denki': 4000, 'item-gas': 3000, 'item-suidou': 3000, 'item-net': 4000 };

const seedExample = (map) => {
  const S = WarikanStore, s = S.load();
  const m = '2026-11';
  S.ensureMonth(s, m);
  for (const pay of s.payments.filter((x) => x.month === m && !x.extra)) {
    if (map[pay.itemId] != null) S.updatePayment(s, pay.id, { amount: map[pay.itemId] });
  }
  S.setRatio(s, 50);
  S.clearMarks(s, m);
  if (!S.getOpening(s)) S.setOpening(s, 'yamada', 250000);
};


const measureSettled = () => {
  const done = document.querySelector('.settle-done');
  const hint = document.querySelector('.settle-done-hint');
  const lab = document.querySelector('.settle-amt-lab');
  const card = document.querySelector('[data-card=settle]');
  const dcs = done && getComputedStyle(done);
  const hcs = hint && getComputedStyle(hint);
  const ccs = card && getComputedStyle(card);
  return {
    label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
    lab: lab && lab.textContent,
    done: done && done.textContent.trim(),
    hint: hint && hint.textContent.trim(),
    doneColor: dcs && dcs.color,
    doneBg: dcs && dcs.backgroundColor,
    hintColor: hcs && hcs.color,
    hintSize: hcs && hcs.fontSize,
    amt: document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent,
    compact: !!(card && card.classList.contains('compact')),
    cardBg: ccs && ccs.backgroundColor,
    pri: getComputedStyle(document.documentElement).getPropertyValue('--pri').trim(),
    sub: getComputedStyle(document.documentElement).getPropertyValue('--sub').trim(),
    settledBg: getComputedStyle(document.documentElement).getPropertyValue('--settled-bg').trim(),
    cache: typeof CACHE !== 'undefined' ? CACHE : null, // eslint-disable-line no-undef
  };
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
  await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);

  await p.evaluate(seedExample, AMOUNTS);
  await setTheme(p, 'light');
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);

  const home = await p.evaluate(() => ({
    label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
    lab: document.querySelector('.settle-amt-lab') && document.querySelector('.settle-amt-lab').textContent,
    amt: document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent,
  }));
  ck('未確定の11月のラベルは「11月分、自分が渡す額」', /2026年11月/.test(home.label || '') && home.lab === '11月分、自分が渡す額' && home.amt === '¥38,000', JSON.stringify(home));
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-375-light.png') });

  await setTheme(p, 'dark');
  await sleep(80);
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-375-dark.png') });
  await setTheme(p, 'light');
  await sleep(80);

  await p.click('[data-act=settle]');
  await sleep(200);
  // 確定直後は「11月を確定しました」。タブを往復して確定月の通常表示を見る
  await p.click('[data-tab=hist]');
  await sleep(100);
  await p.click('[data-tab=home]');
  await sleep(200);
  await p.click('[data-act=prev-m]');
  await sleep(200);

  const settled = await p.evaluate(measureSettled);
  ck('確定した11月はコンパクトカード', settled.compact && settled.amt === '¥38,000', JSON.stringify(settled));
  ck('確定表示は「🔒 11月は確定済み」', settled.done === '🔒 11月は確定済み', settled.done);
  ck('下に「修正は履歴から」', settled.hint === '修正は履歴から', settled.hint);
  ck('ヒントは小さい字', parseFloat(settled.hintSize) <= 13, settled.hintSize);

  const checkContrast = (theme, m) => {
    const doneRatio = contrast(m.doneColor, m.cardBg);
    const hintRatio = contrast(m.hintColor, m.cardBg);
    ck(`${theme} 「🔒 確定済み」のコントラストは 4.5 以上`, doneRatio >= 4.5, doneRatio.toFixed(2) + ' ' + hex(m.doneColor) + ' on ' + hex(m.cardBg));
    ck(`${theme} 「修正は履歴から」のコントラストは 4.5 以上`, hintRatio >= 4.5, hintRatio.toFixed(2) + ' ' + hex(m.hintColor) + ' on ' + hex(m.cardBg));
    ck(`${theme} ヒント色は --sub`, hex(m.hintColor) === m.sub.toUpperCase() || hex(m.hintColor) === hex(m.sub), hex(m.hintColor) + ' vs ' + m.sub);
  };
  checkContrast('ライト', settled);
  await p.screenshot({ path: path.join(SHOT_DIR, 'settled-375-light.png') });

  await setTheme(p, 'dark');
  await sleep(80);
  const settledDark = await p.evaluate(measureSettled);
  checkContrast('ダーク', settledDark);
  await p.screenshot({ path: path.join(SHOT_DIR, 'settled-375-dark.png') });
  await setTheme(p, 'light');
  await sleep(80);

  // マウス／プログラムのフォーカスでは枠なし、キーボードでは --pri の 2px
  const mouseFocus = await p.evaluate(() => {
    const btn = document.querySelector('[data-act=next-m]');
    btn.focus();
    const cs = getComputedStyle(btn);
    return {
      act: btn.dataset.act,
      focus: btn.matches(':focus'),
      visible: btn.matches(':focus-visible'),
      width: cs.outlineWidth,
      style: cs.outlineStyle,
      color: cs.outlineColor,
      offset: cs.outlineOffset,
    };
  });
  ck('プログラム／マウス相当のフォーカスでは枠なし', mouseFocus.focus && !mouseFocus.visible && (mouseFocus.style === 'none' || mouseFocus.width === '0px'), JSON.stringify(mouseFocus));

  await p.focus('[data-act=prev-m]');
  await p.keyboard.press('Tab');
  const keyFocus = await p.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    const pri = getComputedStyle(document.documentElement).getPropertyValue('--pri').trim();
    return {
      act: el && el.dataset && el.dataset.act,
      visible: el && el.matches && el.matches(':focus-visible'),
      width: cs.outlineWidth,
      style: cs.outlineStyle,
      color: cs.outlineColor,
      offset: cs.outlineOffset,
      pri,
    };
  });
  const keyColor = hex(keyFocus.color).toUpperCase();
  const priHex = keyFocus.pri.toUpperCase();
  ck('キーボードのフォーカスは next-m に :focus-visible', keyFocus.act === 'next-m' && keyFocus.visible, JSON.stringify(keyFocus));
  ck('キーボードの枠は 2px solid var(--pri)、offset 2px', keyFocus.width === '2px' && keyFocus.style === 'solid' && keyColor === priHex && keyFocus.offset === '2px', JSON.stringify(keyFocus) + ' ' + keyColor);

  // 次の月に移ったあとも、表示中の月の名前
  await p.click('[data-act=next-m]');
  await sleep(200);
  const dec = await p.evaluate(() => ({
    label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
    lab: document.querySelector('.settle-amt-lab') && document.querySelector('.settle-amt-lab').textContent,
  }));
  ck('12月に移るとラベルは12月分', /2026年12月/.test(dec.label || '') && /^12月分/.test(dec.lab || ''), JSON.stringify(dec));

  await p.click('[data-act=prev-m]');
  await sleep(200);
  const back = await p.evaluate(() => ({
    label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
    lab: document.querySelector('.settle-amt-lab') && document.querySelector('.settle-amt-lab').textContent,
    done: document.querySelector('.settle-done') && document.querySelector('.settle-done').textContent.trim(),
    amt: document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent,
    compact: !!(document.querySelector('[data-card=settle]') && document.querySelector('[data-card=settle]').classList.contains('compact')),
  }));
  ck('11月に戻るとコンパクトな確定カード', /2026年11月/.test(back.label || '') && back.done === '🔒 11月は確定済み' && back.amt === '¥38,000' && back.compact, JSON.stringify(back));

  ck('ページエラーなし', errs.length === 0, errs.join(' | '));

  await b.close();
  if (R.fails) {
    console.log('\nFAILED', R.fails);
    process.exit(1);
  }
  console.log('\nAll v1.4.1 e2e passed');
})().catch((e) => { console.error(e); process.exit(1); });
