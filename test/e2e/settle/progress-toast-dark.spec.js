// E2E: 入力の進捗、未入力シート、トースト、履歴の印、返す全額、ダークモード
const path = require('path');
const { SHOT_DIR, sleep, setTheme, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;


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
  const m = L.monthKey(new Date());
  S.ensureMonth(s, m);
  for (const pay of s.payments.filter((x) => x.month === m && !x.extra)) {
    if (map[pay.itemId] != null) S.updatePayment(s, pay.id, { amount: map[pay.itemId] });
  }
  return m;
};
const contrast = (fg, bg) => {
  const toRgb = (c) => {
    const s = String(c).trim();
    const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      let h = hex[1];
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
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
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
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await sleep(200);

  const boot = await p.evaluate(() => {
    const card = document.querySelector('[data-card=settle]');
    const tsuke = document.querySelector('[data-card=tsuke]');
    const fill = document.querySelector('[data-act=fill-missing]');
    const settle = document.querySelector('[data-act=settle]');
    const metas = [...document.querySelectorAll('meta[name=theme-color]')].map((m) => ({
      content: m.getAttribute('content'), media: m.getAttribute('media'),
    }));
    return {
      lab: card && card.querySelector('.settle-amt-lab') && card.querySelector('.settle-amt-lab').textContent,
      progress: card && card.querySelector('.settle-progress-lab') && card.querySelector('.settle-progress-lab').textContent,
      bar: !!(card && card.querySelector('.settle-bar')),
      fillText: fill && fill.textContent,
      fillPri: fill && fill.className,
      settleText: settle && settle.textContent,
      settleGhost: settle && /ghost/.test(settle.className),
      hint: tsuke && tsuke.innerText.replace(/\s+/g, ' ').trim(),
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      metas,
    };
  });
  ck('金額の上に「11月分、自分が渡す額」', boot.lab === '11月分、自分が渡す額');
  ck('初期は 1/6 入力済みとバー', boot.progress === '1/6 入力済み' && boot.bar === true);
  ck('主ボタンは「未入力を入れる（5件）」', boot.fillText === '未入力を入れる（5件）' && !/ghost/.test(boot.fillPri || ''));
  ck('精算するは枠線ボタン', boot.settleText === '精算する' && boot.settleGhost === true);
  ck('初回の残りの支払いカードに入力する（案内文は出さない）', /入力する/.test(boot.hint || '') && !/これまでの残りがあれば入れてね/.test(boot.hint || ''));
  ck('初期の color-scheme は light', boot.colorScheme === 'light');
  ck('初期の theme-color はライト', boot.metas.some((m) => m.content === '#FAF8F5') && boot.metas.every((m) => !m.media));

  await p.screenshot({ path: path.join(SHOT_DIR, 'home-incomplete-375-light.png') });

  // 未入力のまま精算すると確認
  await p.click('[data-act=settle]');
  await sleep(200);
  const confirm = await p.evaluate(() => {
    const dlg = document.getElementById('dlg');
    return { open: dlg && dlg.open, text: dlg && dlg.innerText.replace(/\s+/g, ' ').trim() };
  });
  ck('未入力のまま精算すると確認が出る', confirm.open && /未入力が5件あります。このまま精算しますか？/.test(confirm.text || ''));
  await p.keyboard.press('Escape');
  await sleep(200);

  // 先月の電気を入れてプレースホルダを確認
  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    S.ensureMonth(s, '2026-10');
    const pay = s.payments.find((x) => x.month === '2026-10' && x.itemId === 'item-denki');
    if (pay) S.updatePayment(s, pay.id, { amount: 4000 });
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);

  await p.evaluate(() => {
    const row = [...document.querySelectorAll('.prow')].find((r) => /電気/.test(r.innerText));
    if (row) row.click();
  });
  await sleep(200);
  const fillSheet = await p.evaluate(() => {
    const dlg = document.getElementById('dlg');
    const aa = document.getElementById('aa');
    const h2 = dlg && dlg.querySelector('h2');
    const meta = dlg && dlg.querySelector('.fill-meta');
    return {
      open: dlg && dlg.open,
      title: h2 && h2.textContent,
      meta: meta && meta.innerText.replace(/\s+/g, ' ').trim(),
      itemInput: !!(dlg && dlg.querySelector('#payItem, [data-item], select')),
      payerPick: !!(dlg && dlg.querySelector('[data-pick]')),
      inputmode: aa && aa.getAttribute('inputmode'),
      focus: document.activeElement && document.activeElement.id,
      placeholder: aa && aa.getAttribute('placeholder'),
    };
  });
  ck('未入力行は「電気の金額を入れる」', fillSheet.title === '電気の金額を入れる');
  ck('項目と払った人はテキストだけ', /電気/.test(fillSheet.meta || '') && /自分/.test(fillSheet.meta || '') && !fillSheet.itemInput && !fillSheet.payerPick);
  ck('金額欄にフォーカスし inputmode=numeric', fillSheet.focus === 'aa' && fillSheet.inputmode === 'numeric');
  ck('プレースホルダは「先月 ¥4,000」', fillSheet.placeholder === '先月 ¥4,000');

  await p.evaluate(() => {
    const aa = document.getElementById('aa');
    aa.value = '4000';
    aa.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.click('#fillForm button[type=submit]');
  await sleep(250);
  const afterSave = await p.evaluate(() => {
    const dlg = document.getElementById('dlg');
    const toast = document.getElementById('toast');
    const cs = toast ? getComputedStyle(toast) : {};
    const tabs = document.querySelector('.tabs');
    const tr = toast && toast.getBoundingClientRect();
    const tabR = tabs && tabs.getBoundingClientRect();
    return {
      title: dlg && dlg.querySelector('h2') && dlg.querySelector('h2').textContent,
      close: !!(dlg && [...dlg.querySelectorAll('button')].some((b) => b.textContent === '閉じる')),
      toast: toast && !toast.hidden && toast.textContent,
      toastRole: toast && toast.getAttribute('role'),
      toastSize: cs.fontSize,
      toastRadius: cs.borderRadius,
      toastBg: cs.backgroundColor,
      toastColor: cs.color,
      gap: tr && tabR ? Math.round(tabR.top - tr.bottom) : null,
    };
  });
  ck('保存後は「次：ガス」と閉じる', afterSave.title === '次：ガス' && afterSave.close === true);
  ck('トースト「電気 ¥4,000 を保存しました」', afterSave.toast === '電気 ¥4,000 を保存しました' && afterSave.toastRole === 'status');
  ck('トーストは 14px・半径 12・タブの上', afterSave.toastSize === '14px' && afterSave.toastRadius === '12px' && afterSave.gap >= 14 && afterSave.gap <= 18);
  await p.screenshot({ path: path.join(SHOT_DIR, 'toast-375-light.png') });
  await p.click('[data-act=close]');
  await sleep(200);

  // 全部入れて完了表示
  await p.evaluate(seedExample, AMOUNTS);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  const complete = await p.evaluate(() => {
    const lab = document.querySelector('.settle-progress-lab');
    const bar = document.querySelector('.settle-bar');
    const fill = document.querySelector('[data-act=fill-missing]');
    const settle = document.querySelector('[data-act=settle]');
    return {
      lab: lab && lab.textContent,
      done: lab && /done/.test(lab.className),
      bar: !!bar,
      fill: !!fill,
      settleText: settle && settle.textContent,
      settlePri: settle && !/ghost/.test(settle.className),
    };
  });
  ck('全部入ると「すべて入力済み ✓」でバーなし', complete.lab === 'すべて入力済み ✓' && complete.bar === false && complete.done === true);
  ck('全部入ると「精算する」が主ボタン', complete.fill === false && complete.settleText === '精算する' && complete.settlePri === true);
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-complete-375-light.png') });

  await p.click('[data-act=settle]');
  await sleep(200);
  const choice = await p.evaluate(() => {
    const dlg = document.getElementById('dlg');
    const text = document.querySelector('.settle-confirmed') && document.querySelector('.settle-confirmed').textContent;
    const signed = (WarikanStore.load().ledger || []).reduce((a, e) => a + (e.signed || 0), 0);
    return { open: dlg && dlg.open, text, signed };
  });
  ck('精算はシートを出さず確定し、額が残りに足される', choice.open === false && /を確定しました/.test(choice.text || '') && choice.signed === 38000, JSON.stringify(choice));
  await p.screenshot({ path: path.join(SHOT_DIR, 'settle-sheet-375-light.png') });
  await p.click('[data-tab=hist]');
  await sleep(150);
  await p.click('[data-act=unconfirm]');
  await sleep(150);
  await p.click('[data-act=unconfirm-ok]');
  await sleep(200);

  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    S.setOpening(s, 'yamada', 260000);
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await p.click('[data-act=settle]');
  await sleep(200);
  const afterSettle = await p.evaluate(() => {
    const signed = (WarikanStore.load().ledger || []).reduce((a, e) => a + (e.signed || 0), 0);
    return { signed, text: document.querySelector('[data-card=tsuke]').innerText };
  });
  ck('確定後の残りは 260,000+38,000=298,000', afterSettle.signed === 298000 && /¥298,000/.test(afterSettle.text || ''), JSON.stringify(afterSettle));
  await p.click('[data-tab=hist]');
  await sleep(150);
  await p.click('[data-tab=home]');
  await sleep(200);

  await p.click('[data-act=repay]');
  await sleep(200);
  const repaySheet = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('#dlg button')].find((x) => /全額/.test(x.textContent));
    return { text: btn && btn.textContent, open: document.getElementById('dlg').open };
  });
  ck('支払ったシートに「全額 ¥298,000」', repaySheet.open && repaySheet.text === '全額 ¥298,000', JSON.stringify(repaySheet));
  await p.screenshot({ path: path.join(SHOT_DIR, 'repay-sheet-375-light.png') });
  await p.click('[data-act=repay-all]');
  await sleep(100);
  await p.evaluate(() => {
    const aa = document.getElementById('repayAmt');
    aa.value = '30000';
    aa.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.click('#repayForm button[type=submit]');
  await sleep(250);
  const repayToast = await p.evaluate(() => {
    const t = document.getElementById('toast');
    return t && !t.hidden && t.textContent;
  });
  ck('返済トースト「¥30,000 を支払いました」', repayToast === '¥30,000 を支払いました');

  await p.click('[data-tab=hist]');
  await sleep(200);
  const hist = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.hrow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    const badge = document.querySelector('.hbadge');
    const cs = badge ? getComputedStyle(badge) : {};
    return {
      rows,
      badge: badge && badge.textContent,
      badgeH: badge ? Math.round(badge.getBoundingClientRect().height) : 0,
      badgeSize: cs.fontSize,
      badgeWeight: cs.fontWeight,
      radius: cs.borderRadius,
      link: !![...document.querySelectorAll('button')].find((b) => b.textContent === '支払いの記録を見る'),
    };
  });
  const monthRow = hist.rows.find((t) => /2026年11月/.test(t)) || '';
  const repayRow = hist.rows.find((t) => /支払った/.test(t)) || '';
  ck('履歴の印は 精算済み・22px・12px 太字・完全な丸',
    hist.badge === '精算済み' && hist.badgeH === 22 && hist.badgeSize === '12px' && Number(hist.badgeWeight) >= 700 && parseFloat(hist.radius) >= 11);
  ck('履歴2行目は「自分 → 相手 ¥38,000」', /自分 → 相手 ¥38,000/.test(monthRow));
  ck('修正がある', /修正/.test(monthRow) || await p.evaluate(() => !!document.querySelector('[data-act=unconfirm]')));

  ck('支払ったの行がある', /支払った −¥30,000/.test(repayRow) && hist.link === true);
  await p.screenshot({ path: path.join(SHOT_DIR, 'history-375-light.png') });

  await p.click('.hrow-repay');
  await sleep(250);
  const ledger = await p.evaluate(() => ({
    heading: document.querySelector('#top .mnav b') && document.querySelector('#top .mnav b').textContent,
    hash: location.hash,
  }));
  ck('返済行をタップすると台帳が開く', ledger.heading === '支払いの記録' && ledger.hash === '#tsuke');
  await p.click('[data-act=close-ledger]');
  await sleep(200);

  // コントラストとダーク

  const contrastPairs = await p.evaluate(() => {
    const read = (sel, colorProp, bgFrom) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const bgEl = bgFrom ? (el.closest(bgFrom) || document.querySelector(bgFrom) || el) : el;
      return { fg: cs[colorProp || 'color'], bg: getComputedStyle(bgEl).backgroundColor, text: el.textContent };
    };
    return {
      ink: read('body', 'color', 'body'),
      sub: read('.settle-amt-lab', 'color', 'body'),
      tsuke: read('.tsuke-lab', 'color', '.card.tsuke'),
    };
  });

  await setTheme(p, 'dark');
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  const dark = await p.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const val = (n) => root.getPropertyValue(n).trim();
    const card = document.querySelector('.card:not(.settled):not(.tsuke)');
    const tsuke = document.querySelector('[data-card=tsuke]');
    const lab = document.querySelector('.settle-amt-lab');
    return {
      vars: {
        bg: val('--bg'), card: val('--card'), ink: val('--ink'), sub: val('--sub'),
        line: val('--line'), teal: val('--teal'), coral: val('--coral'), priInk: val('--pri-ink'),
        ambBg: val('--amb-bg'), amb: val('--amb'),
      },
      bg: getComputedStyle(document.body).backgroundColor,
      card: card && getComputedStyle(card).backgroundColor,
      ink: getComputedStyle(document.body).color,
      sub: lab && getComputedStyle(lab).color,
      line: card && getComputedStyle(card).borderColor,
      tsukeBg: tsuke && getComputedStyle(tsuke).backgroundColor,
      tsukeFg: tsuke && getComputedStyle(tsuke.querySelector('.tsuke-lab') || tsuke).color,
    };
  });
  const hexish = (c) => {
    const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return c;
    return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  const v = (s) => String(s || '').toUpperCase();
  ck('ダーク背景 #1C1B1A', v(dark.vars.bg) === '#1C1B1A' && hexish(dark.bg) === '#1C1B1A');
  ck('ダークカード #262422', v(dark.vars.card) === '#262422' && hexish(dark.card) === '#262422');
  ck('ダーク本文 #F3F0EC', v(dark.vars.ink) === '#F3F0EC' && hexish(dark.ink) === '#F3F0EC');
  ck('ダーク副文 #A8A29E', v(dark.vars.sub) === '#A8A29E' && hexish(dark.sub) === '#A8A29E');
  ck('ダーク線 #3A3734', v(dark.vars.line) === '#3A3734' && hexish(dark.line) === '#3A3734');
  ck('ダークティール #2DD4BF', v(dark.vars.teal) === '#2DD4BF');
  ck('ダークコーラル #FB8A7E', v(dark.vars.coral) === '#FB8A7E');
  ck('ダーク主ボタン文字 #1C1B1A', v(dark.vars.priInk) === '#1C1B1A');
  ck('ダーク残りの支払いカード #3A2F1C / #FBBF24', v(dark.vars.ambBg) === '#3A2F1C' && v(dark.vars.amb) === '#FBBF24' && hexish(dark.tsukeBg) === '#3A2F1C' && hexish(dark.tsukeFg) === '#FBBF24');

  const pairs = [
    ['本文', dark.ink, dark.bg],
    ['副文', dark.sub, dark.bg],
    ['副文カード', dark.sub, dark.card],
    ['主ボタン', dark.vars.priInk, dark.vars.teal],
    ['残りカード', dark.tsukeFg, dark.tsukeBg],
    ['ライト本文', contrastPairs.ink.fg, contrastPairs.ink.bg],
    ['ライト副文', contrastPairs.sub.fg, contrastPairs.sub.bg],
    ['ライト残り', contrastPairs.tsuke.fg, contrastPairs.tsuke.bg],
  ];
  for (const [name, fg, bg] of pairs) {
    const r = contrast(fg, bg);
    ck('コントラスト ' + name + ' ≥4.5:1 (' + r.toFixed(2) + ')', r >= 4.5, fg + ' on ' + bg);
  }

  await p.click('[data-tab=home]');
  await sleep(150);
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-complete-375-dark.png') });
  await p.click('[data-tab=hist]');
  await sleep(150);
  await p.screenshot({ path: path.join(SHOT_DIR, 'history-375-dark.png') });

  await p.setViewport({ width: 320, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.click('[data-tab=home]');
  await sleep(150);
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-complete-320-dark.png') });
  await setTheme(p, 'light');
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-complete-320-light.png') });

  // 未入力の 320 / dark incomplete
  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    const m = WarikanLogic.monthKey(new Date());
    S.clearMarks(s, m);
    for (const pay of s.payments.filter((x) => x.month === m && x.itemId !== 'item-yachin' && !x.extra)) {
      S.updatePayment(s, pay.id, { amount: null });
    }
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-incomplete-320-light.png') });
  await setTheme(p, 'dark');
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-incomplete-320-dark.png') });
  await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.screenshot({ path: path.join(SHOT_DIR, 'home-incomplete-375-dark.png') });

  ck('ページエラーなし', errs.length === 0, errs.join(' | '));

  await b.close();
  if (R.fails) {
    console.log('FAILED ' + R.fails);
    process.exit(1);
  }
  console.log('e2e-v120 ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
