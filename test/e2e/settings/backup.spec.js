// E2E: バックアップ共有・戻す、お知らせ「今すぐ保存」、設定注記の2行
const fs = require('fs');
const path = require('path');
const { SHOT_DIR, VERSION, sleep, hex, setTheme, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;
const TMP = '/tmp/warikan-bak';
fs.mkdirSync(TMP, { recursive: true });
const contrast = (fg, bg) => {
  const toRgb = (c) => {
    const s = String(c).trim();
    const hx = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hx) {
      let h = hx[1];
      if (h.length === 3) h = h.split('').map((x) => x + x).join('');
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return null;
  };
  const lum = (c) => {
    const rgb = toRgb(c);
    if (!rgb) return 0;
    const [r, g, b] = rgb.map((v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

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
};
const gotoTab = async (p, tab) => {
  await p.evaluate((tab) => {
    const b = document.querySelector('[data-tab="' + tab + '"]');
    if (b) b.click();
  }, tab);
  await sleep(200);
};
const showHome = async (p) => {
  await gotoTab(p, 'hist');
  await gotoTab(p, 'home');
};
const readShare = (p) => p.evaluate(async () => {
  const calls = window.__warikanShareCalls || [];
  const d = calls[calls.length - 1];
  const f = d && d.files && d.files[0];
  if (!f) return { n: calls.length };
  return { n: calls.length, name: f.name, title: d.title, text: await f.text(), type: f.type };
});
const metaState = (p) => p.evaluate(() => {
  const btn = document.querySelector('[data-act=backup-restore]');
  const save = document.querySelector('[data-act=backup-save]');
  const meta = document.querySelector('.backup-meta');
  const unset = meta && meta.querySelector('.unset');
  const card = document.querySelector('[data-card=backup]');
  const wipe = document.querySelector('[data-act=wipe]');
  const note = [...document.querySelectorAll('#main > .note, #main p.note')].pop();
  const cs = unset ? getComputedStyle(unset) : (meta ? getComputedStyle(meta) : null);
  const bg = card ? getComputedStyle(card).backgroundColor : getComputedStyle(document.body).backgroundColor;
  const sub = meta && !unset ? getComputedStyle(meta).color : null;
  return {
    restore: btn && btn.textContent.trim(),
    save: save && save.textContent.trim(),
    hasSave: !!save,
    saveOutline: !!(save && save.classList.contains('ghost') && !save.classList.contains('text')),
    restoreText: !!(btn && btn.classList.contains('text')),
    saveBeforeRestore: !!(save && btn && (save.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING)),
    saveInCard: !!(save && btn && save.closest('[data-card=backup]') && btn.closest('[data-card=backup]')),
    text: meta && meta.textContent.replace(/\s+/g, ' ').trim(),
    hint: meta && (meta.querySelector('.backup-meta-hint') || {}).textContent,
    status: meta && (meta.querySelector('.backup-meta-status') || {}).textContent,
    hintLines: meta && meta.querySelector('.backup-meta-hint') && meta.querySelector('.backup-meta-hint').getClientRects().length,
    statusLines: meta && meta.querySelector('.backup-meta-status') && meta.querySelector('.backup-meta-status').getClientRects().length,
    twoLines: !!(meta && meta.querySelector('.backup-meta-hint') && meta.querySelector('.backup-meta-status') &&
      meta.querySelector('.backup-meta-status').getBoundingClientRect().top >= meta.querySelector('.backup-meta-hint').getBoundingClientRect().bottom - 1),
    unset: !!(unset && unset.textContent.trim() === 'まだ保存していません'),
    fg: cs && cs.color,
    sub,
    bg,
    size: cs && cs.fontSize,
    beforeWipe: !!(card && wipe && (card.compareDocumentPosition(wipe) & Node.DOCUMENT_POSITION_FOLLOWING)),
    wipeBeforeNote: !!(wipe && note && (wipe.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING)),
  };
});
const nagState = (p) => p.evaluate(() => {
  const n = document.querySelector('.backup-nag');
  const toast = document.getElementById('toast');
  const toastAct = !!(toast && toast.querySelector('[data-act], button, .toast-act'));
  if (!n) return { shown: false, toastAct };
  const cs = getComputedStyle(n);
  const msg = n.querySelector('.backup-nag-msg');
  const go = n.querySelector('.backup-nag-go');
  const mcs = msg && getComputedStyle(msg);
  const gcs = go && getComputedStyle(go);
  const pri = getComputedStyle(document.documentElement).getPropertyValue('--pri').trim();
  const nr = n.getBoundingClientRect();
  const mr = msg && msg.getBoundingClientRect();
  const gr = go && go.getBoundingClientRect();
  return {
    shown: true,
    text: ((msg && msg.textContent) || n.textContent).replace(/\s+/g, ' ').trim(),
    go: go && go.textContent.replace(/\s+/g, ' ').trim(),
    goColor: gcs && gcs.color,
    pri,
    color: cs.color,
    bg: cs.backgroundColor,
    first: document.getElementById('main').firstElementChild === n,
    toastAct,
    oneLine: !!(mr && gr && Math.abs((mr.top + mr.bottom) / 2 - (gr.top + gr.bottom) / 2) <= 2 && nr.height <= 48),
    msgEllipsis: !!(mcs && mcs.overflow === 'hidden' && mcs.textOverflow === 'ellipsis' && mcs.whiteSpace === 'nowrap' && mcs.minWidth === '0px'),
    goNowrap: !!(gcs && gcs.whiteSpace === 'nowrap'),
  };
});
const openPay = async (p, name) => {
  await p.evaluate((name) => {
    const b = [...document.querySelectorAll('[data-act=edit-pay]')].find((el) => el.textContent.includes(name));
    if (b) b.click();
  }, name);
  await sleep(200);
};
const closeDlg = async (p) => {
  await p.evaluate(() => { const b = document.querySelector('#dlg [data-act=close]'); if (b) b.click(); });
  await sleep(150);
};

const OLD_BACKUP = {
  version: 1,
  payments: [],
  settlements: {
    '2026-10': { marks: { yamada: 1, kanojo: 1 }, settledAt: 1, snapshot: { from: 'yamada', to: 'kanojo', amount: 38000, net: 38000 } },
    '2026-11': { marks: { yamada: 1, kanojo: 1 }, settledAt: 2, snapshot: { from: 'yamada', to: 'kanojo', amount: 38000, net: 38000, choice: 'partial', paid: 10000, carried: 28000 } },
  },
  ledger: [
    { id: 'o1', kind: 'opening', signed: 250000, amount: 250000, from: 'yamada', to: 'kanojo' },
    { id: 'c1', kind: 'carry', month: '2026-11', signed: 28000, amount: 28000, from: 'yamada', to: 'kanojo', paid: 10000, carried: 28000 },
    { id: 'r1', kind: 'repayment', signed: -30000, amount: 30000, from: 'yamada', to: 'kanojo' },
  ],
};

(async () => {
  const b = await launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setBypassServiceWorker(true);
  await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument(() => {
    window.__warikanNow = Date.parse('2026-11-15T12:00:00+09:00');
    window.__warikanSettleDelay = 20000;
    window.__warikanShareAbort = false;
    window.__warikanShareCalls = [];
    try {
      navigator.canShare = function (d) { return !!(d && d.files && d.files.length); };
      navigator.share = function (d) {
        window.__warikanShareCalls.push(d);
        if (window.__warikanShareAbort) {
          return Promise.reject(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }));
        }
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
  await sleep(200);

  const nag0 = await nagState(p);
  ck('未保存でも精算済みの月がなければホームお知らせは出ない', !nag0.shown, JSON.stringify(nag0));

  await p.evaluate(() => { const b = document.querySelector('[data-act=next-m]'); if (b && !b.disabled) b.click(); });
  await sleep(200);
  await openPay(p, '電気');
  const phDenki = await p.evaluate(() => {
    const aa = document.getElementById('aa');
    const cs = aa && getComputedStyle(aa, '::placeholder');
    return aa && { value: aa.value, placeholder: aa.placeholder, color: cs && cs.color };
  });
  ck('変動費の金額欄は先月をプレースホルダに出し、値は自動で入れない',
    phDenki && phDenki.value === '' && phDenki.placeholder === '先月 ¥4,000',
    JSON.stringify(phDenki));
  await closeDlg(p);
  await p.evaluate(() => { const b = document.querySelector('[data-act=prev-m]'); if (b && !b.disabled) b.click(); });
  await sleep(200);
  await openPay(p, '電気');
  const phNov = await p.evaluate(() => {
    const aa = document.getElementById('aa');
    return aa && { value: aa.value, placeholder: aa.placeholder };
  });
  ck('先月がなければプレースホルダは空のまま、今の金額は残す',
    phNov && phNov.value !== '' && Number(String(phNov.value).replace(/[^0-9]/g, '')) === 4000 && phNov.placeholder === '',
    JSON.stringify(phNov));
  await closeDlg(p);

  await gotoTab(p, 'set');
  await p.evaluate(() => { const c = document.querySelector('[data-card=backup]'); if (c) c.scrollIntoView({ block: 'center' }); });
  await sleep(80);
  const uiL = await metaState(p);
  const unsetC = contrast(uiL.fg, uiL.bg);
  ck('設定に枠線の「バックアップを保存」と、その下の「バックアップから戻す」がある',
    uiL.save === 'バックアップを保存' && uiL.restore === 'バックアップから戻す' && uiL.hasSave &&
    uiL.saveOutline && uiL.restoreText && uiL.saveBeforeRestore && uiL.saveInCard && uiL.beforeWipe && uiL.wipeBeforeNote,
    JSON.stringify(uiL));
  ck('未保存の説明はアンバーの「まだ保存していません」（13px、コントラスト 4.5 以上）',
    uiL.unset && /精算すると自動で保存します/.test(uiL.text || '') && uiL.size === '13px' && unsetC >= 4.5,
    JSON.stringify(uiL) + ' ' + unsetC.toFixed(2));
  ck('設定の注記は2行で、375px で1文字だけ落ちない',
    uiL.hint === '精算すると自動で保存します。' && uiL.status === 'まだ保存していません' &&
    uiL.twoLines && uiL.hintLines === 1 && uiL.statusLines === 1,
    JSON.stringify({ hint: uiL.hint, status: uiL.status, twoLines: uiL.twoLines, hintLines: uiL.hintLines, statusLines: uiL.statusLines }));
  await p.screenshot({ path: path.join(SHOT_DIR, 'set-card-375-light.png') });

  await setTheme(p, 'dark');
  await sleep(80);
  await p.evaluate(() => { const c = document.querySelector('[data-card=backup]'); if (c) c.scrollIntoView({ block: 'center' }); });
  const uiD = await metaState(p);
  const unsetCD = contrast(uiD.fg, uiD.bg);
  ck('ダークでも未保存はアンバーでコントラスト 4.5 以上',
    uiD.unset && /精算すると自動で保存します/.test(uiD.text || '') && unsetCD >= 4.5,
    JSON.stringify(uiD) + ' ' + unsetCD.toFixed(2));
  await p.screenshot({ path: path.join(SHOT_DIR, 'set-card-375-dark.png') });
  await setTheme(p, 'light');
  await sleep(80);

  await p.evaluate(() => { window.__warikanShareAbort = true; window.__warikanShareCalls = []; });
  await p.evaluate(() => { const b = document.querySelector('[data-act=backup-save]'); if (b) b.click(); });
  await sleep(200);
  const manualAbort = await p.evaluate(async () => {
    const calls = window.__warikanShareCalls || [];
    const d = calls[calls.length - 1];
    const f = d && d.files && d.files[0];
    return {
      last: localStorage.getItem('warikan-backup-at'),
      n: calls.length,
      name: f && f.name,
      app: f && JSON.parse(await f.text()).app,
    };
  });
  ck('設定の保存をキャンセルしても最後の保存は更新しない',
    manualAbort.n >= 1 && manualAbort.name === 'warikan-backup-20261115.json' && manualAbort.app === 'warikan' && !manualAbort.last,
    JSON.stringify(manualAbort));

  // 共有キャンセルでも精算は確定し、最後の保存は更新しない
  await gotoTab(p, 'home');
  await p.evaluate(() => { window.__warikanShareAbort = true; window.__warikanShareCalls = []; });
  await p.evaluate(() => { const b = document.querySelector('[data-act=settle]'); if (b) b.click(); });
  await sleep(250);
  const afterAbort = await p.evaluate(() => ({
    settled: WarikanStore.isSettled(WarikanStore.load(), '2026-11'),
    last: localStorage.getItem('warikan-backup-at'),
    calls: (window.__warikanShareCalls || []).length,
    text: document.body.innerText,
  }));
  const shareAbort = await readShare(p);
  ck('精算すると共有が呼ばれる（キャンセル時も）',
    afterAbort.calls >= 1 && shareAbort.name === 'warikan-backup-20261115.json',
    JSON.stringify({ afterAbort, shareAbort: { n: shareAbort.n, name: shareAbort.name } }));
  ck('共有をキャンセルしても精算は確定し、最後の保存は更新しない',
    afterAbort.settled === true && !afterAbort.last && /確定しました/.test(afterAbort.text || ''),
    JSON.stringify(afterAbort));

  const nagL = await nagState(p);
  const nagHexL = { fg: hex(nagL.color), bg: hex(nagL.bg) };
  const nagCL = nagL.shown ? contrast(nagL.color, nagL.bg) : 0;
  ck('精算済みで未保存ならホームにお知らせは「まだバックアップを保存していません」（ライトは #92560A / #FDF3E1）',
    nagL.shown && nagL.text === 'まだバックアップを保存していません' && nagL.first &&
    nagHexL.fg === '#92560A' && nagHexL.bg === '#FDF3E1' && nagCL >= 4.5 && !nagL.toastAct,
    JSON.stringify({ nagL, nagHexL, nagCL }));
  const goHexL = hex(nagL.goColor);
  const priHexL = (nagL.pri || '').toUpperCase();
  ck('お知らせの右端に「今すぐ保存 ›」（--pri）があり、375px で1行',
    nagL.go === '今すぐ保存 ›' && nagL.oneLine && nagL.msgEllipsis && nagL.goNowrap && goHexL === priHexL,
    JSON.stringify({ go: nagL.go, oneLine: nagL.oneLine, msgEllipsis: nagL.msgEllipsis, goHexL, priHexL }));
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-nag-375-light.png') });

  await setTheme(p, 'dark');
  await sleep(80);
  const nagD = await nagState(p);
  const nagHexD = { fg: hex(nagD.color), bg: hex(nagD.bg) };
  const nagCD = nagD.shown ? contrast(nagD.color, nagD.bg) : 0;
  const goHexD = hex(nagD.goColor);
  const priHexD = (nagD.pri || '').toUpperCase();
  ck('ダークのお知らせは既存バッジの色（#FBBF24 / #3A2F1C）',
    nagD.shown && nagD.text === 'まだバックアップを保存していません' &&
    nagHexD.fg === '#FBBF24' && nagHexD.bg === '#3A2F1C' && nagCD >= 4.5,
    JSON.stringify({ nagD, nagHexD, nagCD }));
  ck('ダークでも「今すぐ保存 ›」は --pri で1行',
    nagD.go === '今すぐ保存 ›' && nagD.oneLine && goHexD === priHexD,
    JSON.stringify({ go: nagD.go, oneLine: nagD.oneLine, goHexD, priHexD }));
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-nag-375-dark.png') });
  await setTheme(p, 'light');
  await sleep(80);

  const nagCalls = await p.evaluate(() => (window.__warikanShareCalls || []).length);
  await p.evaluate(() => { const b = document.querySelector('.backup-nag'); if (b) b.click(); });
  await sleep(200);
  const nagTap = await p.evaluate(() => ({
    last: localStorage.getItem('warikan-backup-at'),
    n: (window.__warikanShareCalls || []).length,
    shown: !!document.querySelector('.backup-nag'),
  }));
  ck('お知らせをタップしてキャンセルしても確定は維持し、最後の保存は更新しない',
    nagTap.n > nagCalls && !nagTap.last && nagTap.shown && afterAbort.settled,
    JSON.stringify({ nagCalls, nagTap }));

  await gotoTab(p, 'set');
  const stillUnset = await metaState(p);
  ck('キャンセル後も「まだ保存していません」のまま', stillUnset.unset, stillUnset.text);

  // 確定を取り消して、成功する保存をやり直す
  await gotoTab(p, 'hist');
  await p.evaluate(() => { const b = document.querySelector('[data-act=unconfirm]'); if (b) b.click(); });
  await sleep(200);
  await p.evaluate(() => { const b = document.querySelector('[data-act=unconfirm-ok]'); if (b) b.click(); });
  await sleep(200);
  await gotoTab(p, 'home');
  await sleep(150);
  await p.evaluate(() => {
    const lab = (document.getElementById('mLbl') || {}).textContent || '';
    const next = document.querySelector('[data-act=next-m]');
    if (/2026年10月/.test(lab) && next && !next.disabled) next.click();
  });
  await sleep(150);
  await p.evaluate(() => { window.__warikanShareAbort = false; window.__warikanShareCalls = []; });
  const canSettle = await p.evaluate(() => ({
    label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
    settle: !!document.querySelector('[data-act=settle]'),
  }));
  ck('取り消し後は11月を精算できる', /2026年11月/.test(canSettle.label || '') && canSettle.settle, JSON.stringify(canSettle));
  await p.evaluate(() => { const b = document.querySelector('[data-act=settle]'); if (b) b.click(); });
  await sleep(250);
  const shareOk = await readShare(p);
  let parsed = null;
  try { parsed = shareOk.text ? JSON.parse(shareOk.text) : null; } catch (e) { parsed = { err: e.message }; }
  const settledOk = await p.evaluate(() => ({
    settled: WarikanStore.isSettled(WarikanStore.load(), '2026-11'),
    last: localStorage.getItem('warikan-backup-at'),
    pays: (WarikanStore.load().payments || []).length,
  }));
  ck('精算すると正しい JSON で share が呼ばれる',
    shareOk.name === 'warikan-backup-20261115.json' && parsed && parsed.app === 'warikan' && parsed.version === VERSION &&
    parsed.exportedAt && parsed.state && parsed.state.settlements && parsed.state.settlements['2026-11'] &&
    Array.isArray(parsed.state.payments) && parsed.state.payments.length >= 6 && settledOk.settled,
    JSON.stringify({ name: shareOk.name, keys: parsed && Object.keys(parsed), pays: parsed && parsed.state && parsed.state.payments && parsed.state.payments.length }));
  await gotoTab(p, 'set');
  const savedMeta = await metaState(p);
  const savedC = contrast(savedMeta.sub, savedMeta.bg);
  ck('成功すると「最後の保存：11月15日」になり、コントラスト 4.5 以上',
    /最後の保存：11月15日/.test(savedMeta.text || '') && !savedMeta.unset && savedC >= 4.5,
    savedMeta.text + ' ' + savedC.toFixed(2));
  await p.evaluate(() => localStorage.setItem('warikan-backup-at', String(Date.parse('2025-12-01T12:00:00+09:00'))));
  await gotoTab(p, 'home');
  await gotoTab(p, 'set');
  const yearMeta = await metaState(p);
  ck('去年の保存は年を付けて「最後の保存：2025年12月1日」',
    yearMeta.status === '最後の保存：2025年12月1日',
    yearMeta.status);
  await p.evaluate(() => localStorage.setItem('warikan-backup-at', String(window.__warikanNow)));
  await gotoTab(p, 'home');
  await gotoTab(p, 'set');
  ck('保存後の注記も2行で、375px で1文字だけ落ちない',
    savedMeta.hint === '精算すると自動で保存します。' && savedMeta.status === '最後の保存：11月15日' &&
    savedMeta.twoLines && savedMeta.hintLines === 1 && savedMeta.statusLines === 1,
    JSON.stringify({ hint: savedMeta.hint, status: savedMeta.status, twoLines: savedMeta.twoLines, hintLines: savedMeta.hintLines, statusLines: savedMeta.statusLines }));
  await gotoTab(p, 'home');
  const nagGone = await nagState(p);
  ck('保存した直後はホームお知らせが出ない', !nagGone.shown, JSON.stringify(nagGone));

  await p.evaluate(() => {
    localStorage.setItem('warikan-backup-at', String(window.__warikanNow - 35 * 24 * 60 * 60 * 1000));
  });
  await showHome(p);
  const nag35 = await nagState(p);
  ck('最後の保存から35日以上ならお知らせが出る', nag35.shown && nag35.text === 'バックアップが1か月以上前です', JSON.stringify(nag35));
  await p.evaluate(() => {
    localStorage.setItem('warikan-backup-at', String(window.__warikanNow - 34 * 24 * 60 * 60 * 1000));
  });
  await showHome(p);
  const nag34 = await nagState(p);
  ck('34日前の保存ではお知らせは出ない', !nag34.shown, JSON.stringify(nag34));
  await p.evaluate(() => {
    localStorage.setItem('warikan-backup-at', String(window.__warikanNow - 35 * 24 * 60 * 60 * 1000));
  });
  await showHome(p);
  await p.evaluate(() => { window.__warikanShareAbort = false; window.__warikanShareCalls = []; });
  await p.evaluate(() => { const b = document.querySelector('.backup-nag'); if (b) b.click(); });
  await sleep(200);
  const nagSaved = await p.evaluate(() => ({
    shown: !!document.querySelector('.backup-nag'),
    last: localStorage.getItem('warikan-backup-at'),
    n: (window.__warikanShareCalls || []).length,
    now: String(window.__warikanNow),
  }));
  ck('お知らせから保存すると共有され、お知らせが消える',
    nagSaved.n >= 1 && !nagSaved.shown && String(nagSaved.last) === nagSaved.now,
    JSON.stringify(nagSaved));
  await gotoTab(p, 'set');

  const goodPath = path.join(TMP, 'good.json');
  fs.writeFileSync(goodPath, shareOk.text);
  const agedPath = path.join(TMP, 'aged.json');
  const aged = JSON.parse(shareOk.text);
  aged.exportedAt = new Date(Date.parse('2026-11-15T12:00:00+09:00') - 40 * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(agedPath, JSON.stringify(aged));
  const badPath = path.join(TMP, 'bad.json');
  fs.writeFileSync(badPath, JSON.stringify({ foo: 1 }));
  const oldPath = path.join(TMP, 'old.json');
  fs.writeFileSync(oldPath, JSON.stringify(OLD_BACKUP));

  // 確認シート（ライト／ダーク）
  const chooserP = p.waitForFileChooser({ timeout: 3000 });
  await p.evaluate(() => { const b = document.querySelector('[data-act=backup-restore]'); if (b) b.click(); });
  const chooser = await chooserP;
  await chooser.accept([goodPath]);
  await sleep(250);
  const sheet = await p.evaluate(() => {
    const dlg = document.getElementById('dlg');
    return {
      open: dlg && dlg.open,
      text: dlg && dlg.innerText.replace(/\s+/g, ' ').trim(),
      ok: !!(dlg && dlg.querySelector('[data-act=restore-ok]')),
      close: !!(dlg && [...dlg.querySelectorAll('button')].some((b) => b.textContent === 'やめる')),
    };
  });
  ck('戻す確認シートに説明・保存日・件数と「戻す」「やめる」がある',
    sheet.open && /いまのデータは、ファイルの内容に置き換わります/.test(sheet.text || '') &&
    /2026年11月15日/.test(sheet.text || '') && /支払い：\d+件/.test(sheet.text || '') &&
    sheet.ok && sheet.close,
    JSON.stringify(sheet));
  await p.screenshot({ path: path.join(SHOT_DIR, 'restore-sheet-375-light.png') });
  await setTheme(p, 'dark');
  await sleep(80);
  await p.screenshot({ path: path.join(SHOT_DIR, 'restore-sheet-375-dark.png') });
  await setTheme(p, 'light');
  await sleep(80);

  // やめるでデータは変わらない
  const beforeCancel = await p.evaluate(() => ({
    settled: WarikanStore.isSettled(WarikanStore.load(), '2026-11'),
    pays: (WarikanStore.load().payments || []).length,
    name: WarikanStore.load().people.yamada.name,
  }));
  await p.evaluate(() => { const b = document.querySelector('#dlg [data-act=close]'); if (b) b.click(); });
  await sleep(200);
  const afterCancel = await p.evaluate(() => ({
    open: document.getElementById('dlg').open,
    settled: WarikanStore.isSettled(WarikanStore.load(), '2026-11'),
    pays: (WarikanStore.load().payments || []).length,
    name: WarikanStore.load().people.yamada.name,
  }));
  ck('「やめる」でデータは変わらない',
    !afterCancel.open && afterCancel.settled === beforeCancel.settled && afterCancel.pays === beforeCancel.pays && afterCancel.name === beforeCancel.name,
    JSON.stringify({ beforeCancel, afterCancel }));

  // 不正なファイル
  await p.evaluate(() => { WarikanStore.setPersonName(WarikanStore.load(), 'yamada', '変更後'); });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await gotoTab(p, 'set');
  const chooserBad = p.waitForFileChooser({ timeout: 3000 });
  await p.evaluate(() => { const b = document.querySelector('[data-act=backup-restore]'); if (b) b.click(); });
  await (await chooserBad).accept([badPath]);
  await sleep(300);
  const rejected = await p.evaluate(() => ({
    toast: document.getElementById('toast') && !document.getElementById('toast').hidden && document.getElementById('toast').textContent,
    dlg: document.getElementById('dlg').open,
    name: WarikanStore.load().people.yamada.name,
    settled: WarikanStore.isSettled(WarikanStore.load(), '2026-11'),
  }));
  ck('不正なファイルは拒み、データを変えない',
    rejected.toast === 'このファイルは読み込めませんでした' && !rejected.dlg && rejected.name === '変更後' && rejected.settled,
    JSON.stringify(rejected));

  // 正しいファイルを戻す
  const chooserOk = p.waitForFileChooser({ timeout: 3000 });
  await p.evaluate(() => { const b = document.querySelector('[data-act=backup-restore]'); if (b) b.click(); });
  await (await chooserOk).accept([goodPath]);
  await sleep(250);
  await p.evaluate(() => { const b = document.querySelector('[data-act=restore-ok]'); if (b) b.click(); });
  await sleep(300);
  const restored = await p.evaluate(() => ({
    tab: document.querySelector('.tabs button.on') && document.querySelector('.tabs button.on').dataset.tab,
    name: WarikanStore.load().people.yamada.name,
    settled: WarikanStore.isSettled(WarikanStore.load(), '2026-11'),
    toast: document.getElementById('toast') && !document.getElementById('toast').hidden && document.getElementById('toast').textContent,
  }));
  ck('戻すと normalize してホームを描き、トーストを出す',
    restored.tab === 'home' && restored.name === '自分' && restored.settled && restored.toast === 'バックアップから戻しました',
    JSON.stringify(restored));
  const restoredNag = await p.evaluate(() => !!document.querySelector('.backup-nag'));
  ck('戻した直後はホームお知らせが出ない', !restoredNag);
  await gotoTab(p, 'set');
  const restoredMeta = await metaState(p);
  ck('戻したあとの最後の保存はファイルの保存日',
    /最後の保存：11月15日/.test(restoredMeta.text || '') && !restoredMeta.unset,
    restoredMeta.text || restoredMeta.status);

  // exportedAt が35日以上前のファイルから戻す
  const chooserAged = p.waitForFileChooser({ timeout: 3000 });
  await p.evaluate(() => { const b = document.querySelector('[data-act=backup-restore]'); if (b) b.click(); });
  await (await chooserAged).accept([agedPath]);
  await sleep(250);
  await p.evaluate(() => { const b = document.querySelector('[data-act=restore-ok]'); if (b) b.click(); });
  await sleep(300);
  const agedHome = await p.evaluate(() => ({
    tab: document.querySelector('.tabs button.on') && document.querySelector('.tabs button.on').dataset.tab,
    nag: document.querySelector('.backup-nag') && document.querySelector('.backup-nag').innerText,
    last: localStorage.getItem('warikan-backup-at'),
    restored: localStorage.getItem('warikan-backup-restored-at'),
    now: String(window.__warikanNow),
  }));
  ck('35日以上前のファイルから戻した直後はホームお知らせが出ない',
    agedHome.tab === 'home' && !agedHome.nag && agedHome.restored === agedHome.now,
    JSON.stringify(agedHome));
  await gotoTab(p, 'set');
  const agedMeta = await metaState(p);
  ck('古いファイルから戻しても最後の保存はファイルの日付（10月6日）',
    /最後の保存：10月6日/.test(agedMeta.text || '') && !agedMeta.unset && !/まだ保存していません/.test(agedMeta.text || ''),
    agedMeta.text || agedMeta.status);
  await p.evaluate(() => {
    localStorage.setItem('warikan-backup-restored-at', String(window.__warikanNow - 35 * 24 * 60 * 60 * 1000));
  });
  await gotoTab(p, 'home');
  const agedNagLater = await nagState(p);
  ck('戻してから35日以上たつとお知らせが出る（最後の保存はファイルの日付のまま）',
    agedNagLater.shown && agedNagLater.text === 'バックアップが1か月以上前です',
    JSON.stringify(agedNagLater));
  await gotoTab(p, 'set');
  const agedMetaLater = await metaState(p);
  ck('35日後も最後の保存は10月6日のまま',
    /最後の保存：10月6日/.test(agedMetaLater.text || ''),
    agedMetaLater.text || agedMetaLater.status);

  // 古い形式：残高は 248,000 のまま
  const chooserOld = p.waitForFileChooser({ timeout: 3000 });
  await gotoTab(p, 'set');
  await p.evaluate(() => { const b = document.querySelector('[data-act=backup-restore]'); if (b) b.click(); });
  await (await chooserOld).accept([oldPath]);
  await sleep(250);
  const oldSheet = await p.evaluate(() => document.getElementById('dlg') && document.getElementById('dlg').innerText);
  ck('古い形式の確認シートが開く', /いまのデータは、ファイルの内容に置き換わります/.test(oldSheet || '') && /支払い：0件/.test(oldSheet || ''), oldSheet && oldSheet.replace(/\s+/g, ' '));
  await p.evaluate(() => { const b = document.querySelector('[data-act=restore-ok]'); if (b) b.click(); });
  await sleep(300);
  const oldRestored = await p.evaluate(() => {
    const s = WarikanStore.load();
    return {
      total: WarikanLogic.ledgerTotal(s.ledger),
      len: (s.ledger || []).length,
      oct: WarikanStore.isSettled(s, '2026-10'),
      nov: WarikanStore.isSettled(s, '2026-11'),
      carry: ((s.ledger || []).find((e) => e.kind === 'carry') || {}).signed,
    };
  });
  ck('古い形式を戻しても残高は同じ（248,000）',
    oldRestored.total === 248000 && oldRestored.len === 3 && oldRestored.oct && oldRestored.nov && oldRestored.carry === 28000,
    JSON.stringify(oldRestored));

  ck('ページエラーなし', errs.length === 0, errs.join(' | '));
  const shots = ['set-card-375-light.png', 'set-card-375-dark.png', 'home-nag-375-light.png', 'home-nag-375-dark.png'];
  ck('375px のライト／ダークのスクショが揃っている', shots.every((f) => fs.existsSync(path.join(SHOT_DIR, f))), shots.join(', '));

  await b.close();
  if (R.fails) { console.log('\nFAILED', R.fails); process.exit(1); }
  console.log('\nAll v1.7.1 e2e passed');
})().catch((e) => { console.error(e); process.exit(1); });
