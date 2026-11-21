// E2E: 再接続、相手の変更通知、衝突、見出し、未入力、コンパクト確定
// @emulator（Firebase エミュレータが必要）
const path = require('path');
const { SHOT_DIR, EMU, sleep, tap, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;

(async () => {
  const b = await launch();
  async function page() {
    const ctx = await b.createBrowserContext();
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p._errs = errs;
    await p.setBypassServiceWorker(true);
    await p.emulateTimezone('Asia/Tokyo');
    await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.evaluateOnNewDocument((emu) => {
      window.__warikanNow = Date.parse('2026-11-15T12:00:00+09:00');
      window.__warikanFirebaseEmulator = emu;
      window.__warikanSettleDelay = 20000;
      window.__warikanShareCalls = [];
      try {
        navigator.canShare = function () { return true; };
        navigator.share = function (d) { window.__warikanShareCalls.push(d); return Promise.resolve(); };
      } catch (e) {}
    }, EMU);
    return p;
  }

  async function setTheme(p, theme) {
    await p.evaluate((v) => {
      localStorage.setItem('warikan-theme', v);
      document.documentElement.setAttribute('data-theme', v);
      document.documentElement.style.colorScheme = v;
    }, theme);
  }

  const host = await page();
  const join = await page();
  await host.goto(URL, { waitUntil: 'domcontentloaded' });
  await join.goto(URL, { waitUntil: 'domcontentloaded' });
  await host.evaluate(() => localStorage.clear());
  await join.evaluate(() => localStorage.clear());
  await host.reload({ waitUntil: 'domcontentloaded' });
  await join.reload({ waitUntil: 'domcontentloaded' });

  await host.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    S.setPersonName(s, 'yamada', 'たろう');
    S.setPersonName(s, 'kanojo', 'はなこ');
    S.ensureMonth(s, '2026-11');
    const rent = s.payments.find((p) => p.month === '2026-11' && p.itemId === 'item-yachin');
    if (rent) S.updatePayment(s, rent.id, { amount: 60000 });
    const denki = s.payments.find((p) => p.month === '2026-11' && p.itemId === 'item-denki');
    if (denki) S.updatePayment(s, denki.id, { amount: 0 });
  });
  await host.reload({ waitUntil: 'domcontentloaded' });
  await sleep(300);
  await tap(host, '[data-tab=home]');
  await sleep(200);

  const offUi = await host.evaluate(() => {
    const heads = [...document.querySelectorAll('.phead')].map((el) => el.textContent.trim());
    const rows = [...document.querySelectorAll('.prow')].map((r) => {
      const amt = r.querySelector('.amt');
      return {
        name: r.querySelector('.name') && r.querySelector('.name').textContent.trim(),
        amt: amt && amt.textContent.trim(),
        empty: !!(amt && amt.classList.contains('empty')),
        color: amt && getComputedStyle(amt).color,
      };
    });
    return { heads, rows };
  });
  ck('共有オフの見出しは設定の名前',
    offUi.heads.length === 2 && /^たろうが払う ¥/.test(offUi.heads[0] || '') && /^はなこが払う ¥/.test(offUi.heads[1] || ''),
    JSON.stringify(offUi.heads));
  const denkiRow = offUi.rows.find((r) => r.name === '電気');
  const gasRow = offUi.rows.find((r) => r.name === 'ガス');
  ck('¥0 と入れた電気は ¥0 と出す', denkiRow && denkiRow.amt === '¥0' && !denkiRow.empty, JSON.stringify(denkiRow));
  ck('未入力のガスは灰色の「未入力」（ライト #78716C）',
    gasRow && gasRow.amt === '未入力' && gasRow.empty && gasRow.color === 'rgb(120, 113, 108)',
    JSON.stringify(gasRow));

  await tap(host, '.prow');
  try { await host.waitForFunction(() => document.getElementById('dlg') && document.getElementById('dlg').open, { timeout: 5000 }); } catch (e) {}
  await host.keyboard.press('Escape');
  await sleep(40);
  const ghost = await host.evaluate(() => ({
    ghost: !!document.querySelector('.dlg-ghost'),
    open: !!(document.getElementById('dlg') && document.getElementById('dlg').open),
  }));
  ck('Escでシートが下に滑って閉じる（.dlg-ghost）', ghost.ghost && !ghost.open, JSON.stringify(ghost));
  await sleep(280);

  // コンパクト確定カード（共有オフの11月）
  await tap(host, '[data-act=settle]');
  await sleep(200);
  const miss = await host.evaluate(() => document.getElementById('dlg') && document.getElementById('dlg').open);
  if (miss) {
    await tap(host, '[data-act=settle-anyway]');
    await sleep(300);
  }
  await tap(host, '[data-tab=hist]');
  await sleep(150);
  await tap(host, '[data-tab=home]');
  await sleep(200);
  await tap(host, '[data-act=prev-m]');
  await sleep(250);
  const compact = await host.evaluate(() => {
    const card = document.querySelector('[data-card=settle]');
    const done = document.querySelector('.settle-done');
    const hint = document.querySelector('.settle-done-hint');
    const list = document.querySelector('.plist');
    const rec = card && card.getBoundingClientRect();
    const listR = list && list.getBoundingClientRect();
    const remainEl = document.querySelector('[data-card=tsuke]') || document.querySelector('.tsuke') || document.querySelector('[data-card=ledger]') || document.querySelector('#main .card:nth-of-type(2)');
    const remR = remainEl && remainEl.getBoundingClientRect();
    return {
      compact: !!(card && card.classList.contains('compact')),
      done: done && done.textContent.trim(),
      amt: document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent,
      hint: hint && hint.textContent.trim(),
      listTop: listR && listR.top,
      remainBottom: remR && remR.bottom,
      cardBottom: rec && rec.bottom,
      vh: window.innerHeight,
    };
  });
  ck('確定カードは「🔒 11月は確定済み」と金額の1行',
    compact.compact && compact.done === '🔒 11月は確定済み' && compact.amt && compact.hint === '修正は履歴から',
    JSON.stringify(compact));
  ck('375pxで確定カードの下に一覧が見える',
    compact.listTop != null && compact.listTop < 812,
    JSON.stringify(compact));
  await setTheme(host, 'light');
  await host.screenshot({ path: path.join(SHOT_DIR, 'settled-compact.png') });

  // 履歴詳細にも未入力 / ¥0
  await tap(host, '[data-act=goto-hist]');
  await sleep(250);
  await host.evaluate(() => {
    const btn = [...document.querySelectorAll('[data-act=open-hist]')].find((el) => el.getAttribute('data-month') === '2026-11');
    if (btn) btn.click();
  });
  try { await host.waitForFunction(() => document.getElementById('dlg') && document.getElementById('dlg').open, { timeout: 8000 }); } catch (e) {}
  await sleep(200);
  const histOpen = await host.evaluate(() => {
    const rows = [...document.querySelectorAll('#dlg .prow')].map((r) => {
      const amt = r.querySelector('.amt');
      return { name: r.querySelector('.name') && r.querySelector('.name').textContent.trim(), amt: amt && amt.textContent.trim(), empty: !!(amt && amt.classList.contains('empty')) };
    });
    return { open: !!(document.getElementById('dlg') && document.getElementById('dlg').open), rows };
  });
  const hDenki = (histOpen.rows || []).find((r) => r.name === '電気');
  const hGas = (histOpen.rows || []).find((r) => r.name === 'ガス');
  ck('履歴詳細でも ¥0 と未入力を区別する',
    histOpen.open && hDenki && hDenki.amt === '¥0' && !hDenki.empty && hGas && hGas.amt === '未入力' && hGas.empty,
    JSON.stringify(histOpen));
  if (histOpen.open) {
    const closeBtn = await host.$('[data-act=close]');
    if (closeBtn) await tap(host, '[data-act=close]');
    await sleep(200);
  }

  // 確定を取り消して共有テスト用に11月を戻す
  await tap(host, '[data-tab=hist]');
  await sleep(200);
  const unconfirm = await host.evaluate(() => {
    const btn = document.querySelector('[data-act=unconfirm], [data-act=unsettle], .h-unconfirm');
    if (btn) { btn.click(); return 'clicked'; }
    return 'missing';
  });
  await sleep(200);
  const unconfirmSheet = await host.evaluate(() => document.getElementById('dlg') && document.getElementById('dlg').open);
  if (unconfirmSheet) {
    const ok = await host.evaluate(() => {
      const btn = document.querySelector('[data-act=unconfirm-ok], [data-act=unsettle-ok], [data-act=hist-unconfirm-ok]');
      if (btn) { btn.click(); return btn.getAttribute('data-act'); }
      const cands = [...document.querySelectorAll('#dlg button')].map((b) => b.textContent.trim());
      const target = [...document.querySelectorAll('#dlg button')].find((b) => /修正する|取り消す|確定を/.test(b.textContent));
      if (target) { target.click(); return target.textContent.trim(); }
      return cands;
    });
    await sleep(400);
    ck('確定取り消し操作', typeof ok === 'string' && ok !== 'missing', JSON.stringify(ok));
  } else {
    ck('確定取り消しボタンがある', unconfirm !== 'missing', unconfirm);
  }
  await tap(host, '[data-tab=home]');
  await sleep(200);
  const monthNow = await host.evaluate(() => document.getElementById('mLbl') && document.getElementById('mLbl').textContent);
  if (monthNow && /12月/.test(monthNow)) {
    await tap(host, '[data-act=prev-m]');
    await sleep(200);
  }

  // 共有開始
  await tap(host, '[data-tab=set]');
  await sleep(200);
  await tap(host, '[data-act=share-start]');
  await host.waitForFunction(() => !!(window.WarikanSync && WarikanSync.isActive()), { timeout: 15000 });
  await sleep(400);
  const started = await host.evaluate(() => ({ url: WarikanSync.inviteUrl(), st: WarikanSync.status() }));
  ck('ホストが共有を始めた', !!(started.st && started.st.active && started.url), JSON.stringify(started.st));

  await join.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    S.setPersonName(s, 'yamada', '仮');
    S.setPersonName(s, 'kanojo', 'はなこ');
  });
  const joinUrl = URL + started.url.slice(started.url.indexOf('#'));
  await join.goto(joinUrl, { waitUntil: 'domcontentloaded' });
  try { await join.waitForFunction(() => document.getElementById('dlg') && document.getElementById('dlg').open, { timeout: 15000 }); } catch (e) {}
  await tap(join, '[data-act=share-join-ok]');
  await join.waitForFunction(() => !!(window.WarikanSync && WarikanSync.isActive()), { timeout: 15000 });
  await sleep(600);

  async function shotSettle(p, name) {
    await tap(p, '[data-tab=home]');
    await sleep(250);
    const lab = await p.evaluate(() => document.getElementById('mLbl') && document.getElementById('mLbl').textContent);
    if (lab && /12月/.test(lab)) { await tap(p, '[data-act=prev-m]'); await sleep(200); }
    await setTheme(p, 'light');
    await p.screenshot({ path: path.join(SHOT_DIR, name + '-375-light.png') });
    await setTheme(p, 'dark');
    await p.screenshot({ path: path.join(SHOT_DIR, name + '-375-dark.png') });
    await setTheme(p, 'light');
  }
  await shotSettle(host, 'host-settle');
  await shotSettle(join, 'join-settle');

  const shareHeads = await join.evaluate(() => [...document.querySelectorAll('.phead')].map((el) => el.textContent.trim()));
  ck('参加側の見出しは自分が払う／たろうが払う',
    shareHeads.length === 2 && /^自分が払う ¥/.test(shareHeads[0] || '') && /^たろうが払う ¥/.test(shareHeads[1] || ''),
    JSON.stringify(shareHeads));

  // 通知 + フラッシュ: ホストがガスを入力
  await tap(join, '[data-tab=home]');
  await sleep(200);
  await join.evaluate(() => { window.__warikanRemoteNotices = []; });
  const wrote = await host.evaluate(async () => {
    const S = WarikanStore;
    const s = S.load();
    const gas = s.payments.find((p) => p.month === '2026-11' && p.itemId === 'item-gas');
    if (gas) S.updatePayment(s, gas.id, { amount: 3000 });
    if (WarikanSync.flush) await WarikanSync.flush();
    const after = S.load().payments.find((p) => p.month === '2026-11' && p.itemId === 'item-gas');
    return { me: WarikanSync.me(), amount: after && after.amount, by: after && after.updatedBy };
  });
  ck('ホストがガスを ¥3,000 で保存する', wrote.amount === 3000 && wrote.by === 'yamada', JSON.stringify(wrote));
  try {
    await join.waitForFunction(() => {
      return WarikanStore.load().payments.some((p) => p.month === '2026-11' && p.itemId === 'item-gas' && p.amount === 3000);
    }, { timeout: 15000 });
  } catch (e) {}
  try {
    await join.waitForFunction(() => {
      const t = document.getElementById('toast');
      return t && !t.hidden && /たろうがガスを入力しました/.test(t.textContent || '');
    }, { timeout: 8000 });
  } catch (e) {}
  const notice = await join.evaluate(() => {
    const t = document.getElementById('toast');
    const flash = document.querySelector('.prow.flash');
    const row = [...document.querySelectorAll('.prow')].find((r) => /ガス/.test(r.innerText));
    const gas = WarikanStore.load().payments.find((p) => p.month === '2026-11' && p.itemId === 'item-gas');
    return {
      text: t && !t.hidden && t.textContent,
      who: t && t.getAttribute('data-who'),
      remote: t && t.classList.contains('toast-remote'),
      flash: !!(flash || (row && row.classList.contains('flash'))),
      flashWho: (flash || row) && (flash || row).getAttribute('data-flash-who'),
      gasAmt: gas && gas.amount,
      gasBy: gas && gas.updatedBy,
      me: WarikanSync.me(),
      notices: window.__warikanRemoteNotices || [],
    };
  });
  ck('相手の入力トーストが出る',
    notice.text && /たろうがガスを入力しました/.test(notice.text) && notice.remote && notice.who === 'yamada',
    JSON.stringify(notice));
  ck('該当行の左端がフラッシュする', notice.flash, JSON.stringify(notice));
  await join.screenshot({ path: path.join(SHOT_DIR, 'toast-flash.png') });

  // 衝突: ホストが買い物シートを開いたあと、参加側が先に保存
  const kaimonoId = await host.evaluate(() => {
    const s = WarikanStore.load();
    const p = s.payments.find((x) => x.month === '2026-11' && x.itemId === 'item-kaimono');
    return p && p.id;
  });
  await tap(host, '[data-tab=home]');
  await sleep(200);
  const opened = await host.evaluate((id) => {
    const lab = document.getElementById('mLbl') && document.getElementById('mLbl').textContent;
    if (lab && /12月/.test(lab)) {
      const prev = document.querySelector('[data-act=prev-m]');
      if (prev) prev.click();
    }
    const btn = document.querySelector('.prow[data-id="' + id + '"]');
    if (btn) btn.click();
    return { id, hasBtn: !!btn };
  }, kaimonoId);
  try { await host.waitForFunction(() => document.getElementById('dlg') && document.getElementById('dlg').open, { timeout: 8000 }); } catch (e) {}
  await sleep(200);
  const sheetAt = await host.evaluate(() => document.getElementById('dlg') && document.getElementById('dlg').innerText);
  ck('ホストが買い物の編集シートを開く', opened.hasBtn && /買い物/.test(sheetAt || ''), JSON.stringify({ opened, sheetAt }));
  const joinWrote = await join.evaluate(async () => {
    const S = WarikanStore;
    const s = S.load();
    const p = s.payments.find((x) => x.month === '2026-11' && x.itemId === 'item-kaimono');
    if (p) S.updatePayment(s, p.id, { amount: 2500 });
    if (WarikanSync.flush) await WarikanSync.flush();
    const after = S.load().payments.find((x) => x.month === '2026-11' && x.itemId === 'item-kaimono');
    return { amount: after && after.amount, at: after && after.updatedAt };
  });
  ck('参加側が先に買い物を ¥2,500 で保存する', joinWrote.amount === 2500, JSON.stringify(joinWrote));
  try {
    await host.waitForFunction(() => {
      const p = WarikanStore.load().payments.find((x) => x.month === '2026-11' && x.itemId === 'item-kaimono');
      return p && p.amount === 2500;
    }, { timeout: 15000 });
  } catch (e) {}
  await sleep(200);
  await host.evaluate(() => {
    const aa = document.querySelector('#aa');
    if (aa) {
      aa.focus();
      aa.value = '1800';
      aa.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  const saveBtn = await host.$('#dlg button[type=submit]');
  if (saveBtn) await saveBtn.click();
  else await host.evaluate(() => {
    const form = document.querySelector('#dlg form');
    if (form && form.requestSubmit) form.requestSubmit();
  });
  try {
    await host.waitForFunction(() => {
      const d = document.getElementById('dlg');
      return d && d.open && /先に変えました/.test(d.innerText || '');
    }, { timeout: 15000 });
  } catch (e) {}
  const conflict = await host.evaluate(() => {
    const d = document.getElementById('dlg');
    return { open: d && d.open, text: d && d.innerText, theirs: !!(d && d.querySelector('[data-act=conflict-theirs]')), mine: !!(d && d.querySelector('[data-act=conflict-mine]')) };
  });
  ck('衝突シートで両方の金額と選択が出る',
    conflict.open && /はなこが先に変えました/.test(conflict.text || '') && /¥2,500/.test(conflict.text || '') && /¥1,800/.test(conflict.text || '') && conflict.theirs && conflict.mine,
    JSON.stringify(conflict));
  await host.screenshot({ path: path.join(SHOT_DIR, 'conflict-sheet.png') });
  await tap(host, '[data-act=conflict-theirs]');
  try {
    await host.waitForFunction(() => {
      const p = WarikanStore.load().payments.find((x) => x.month === '2026-11' && x.itemId === 'item-kaimono');
      return p && p.amount === 2500;
    }, { timeout: 8000 });
  } catch (e) {}
  const kept = await host.evaluate(() => {
    const p = WarikanStore.load().payments.find((x) => x.month === '2026-11' && x.itemId === 'item-kaimono');
    return p && p.amount;
  });
  ck('相手のままにすると参加側の金額が残る', kept === 2500, String(kept));

  // 再接続
  await tap(join, '[data-tab=set]');
  await sleep(200);
  await tap(join, '[data-act=share-leave]');
  await sleep(200);
  await tap(join, '[data-act=share-leave-ok]');
  await sleep(500);
  const left = await join.evaluate(() => ({
    active: WarikanSync.isActive(),
    can: WarikanSync.status().canReconnect,
    btn: !!document.querySelector('[data-act=share-reconnect]'),
    label: document.querySelector('[data-act=share-reconnect]') && document.querySelector('[data-act=share-reconnect]').textContent.trim(),
  }));
  ck('共有をやめたあと「もう一度つなぐ」が出る', !left.active && left.can && left.btn && left.label === 'もう一度つなぐ', JSON.stringify(left));
  await join.screenshot({ path: path.join(SHOT_DIR, 'reconnect-button.png') });

  await join.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    S.addPayment(s, { month: '2026-02', itemId: 'item-net', itemName: '切断中', payerId: 'kanojo', amount: 99, extra: true });
  });
  await tap(join, '[data-act=share-reconnect]');
  try { await join.waitForFunction(() => document.getElementById('dlg') && document.getElementById('dlg').open, { timeout: 8000 }); } catch (e) {}
  const reconSheet = await join.evaluate(() => document.getElementById('dlg') && document.getElementById('dlg').innerText);
  ck('再接続の確認に置き換えとバックアップの案内が出る',
    /つながっているデータで、この端末のデータを置き換えます/.test(reconSheet || '') && /バックアップ/.test(reconSheet || ''),
    reconSheet);
  await tap(join, '[data-act=share-reconnect-ok]');
  await join.waitForFunction(() => !!(window.WarikanSync && WarikanSync.isActive()), { timeout: 15000 });
  await sleep(600);
  const reconnected = await join.evaluate(() => ({
    active: WarikanSync.isActive(),
    me: WarikanSync.me(),
    stash: !!localStorage.getItem('warikan-reconnect-backup'),
    hasLocal: WarikanStore.load().payments.some((p) => p.itemName === '切断中'),
    hasGas: WarikanStore.load().payments.some((p) => p.month === '2026-11' && p.itemId === 'item-gas' && p.amount === 3000),
  }));
  ck('もう一度つなぐと共有データに戻り、切断中のローカルは置き換わる',
    reconnected.active && reconnected.me === 'kanojo' && reconnected.stash && !reconnected.hasLocal && reconnected.hasGas,
    JSON.stringify(reconnected));

  // 同じ月をほぼ同時に精算しても、確定と台帳は1件だけ
  const settleOnce = () => {
    const S = WarikanStore;
    const L = WarikanLogic;
    const s = S.load();
    const month = '2026-11';
    if (S.isSettled(s, month)) return { already: true, amount: (S.getSettlement(s, month) && S.getSettlement(s, month).snapshot && S.getSettlement(s, month).snapshot.amount) };
    S.ensureMonth(s, month);
    const live = L.computeSettle(S.paymentsInMonth(s, month), s.ratioYamada);
    const snap = Object.assign({}, live, { ratioYamada: s.ratioYamada, choice: 'settled', paid: 0, carried: live.amount });
    S.settleMonth(s, month, snap);
    return { already: false, amount: live.amount };
  };
  const flushPage = (page) => page.evaluate(async () => { if (WarikanSync.flush) await WarikanSync.flush(); });
  await Promise.all([
    host.evaluate(settleOnce).then(() => flushPage(host)),
    join.evaluate(settleOnce).then(() => flushPage(join)),
  ]);
  const waitSettled = (page) => page.waitForFunction(() => {
    const s = WarikanStore.load();
    return WarikanStore.isSettled(s, '2026-11');
  }, { timeout: 15000 }).catch(() => {});
  await Promise.all([waitSettled(host), waitSettled(join)]);
  await sleep(800);
  const settleRace = async (page) => page.evaluate(() => {
    const s = WarikanStore.load();
    const rec = WarikanStore.getSettlement(s, '2026-11');
    const carries = (s.ledger || []).filter((e) => e.kind === 'carry' && e.month === '2026-11');
    return {
      settled: WarikanStore.isSettled(s, '2026-11'),
      amount: rec && rec.snapshot && rec.snapshot.amount,
      carries: carries.length,
      signed: carries.map((e) => e.signed),
    };
  });
  const raceH = await settleRace(host);
  const raceJ = await settleRace(join);
  ck('同じ月をほぼ同時に精算しても確定は1件で、両方の端末が一致する',
    raceH.settled && raceJ.settled && raceH.carries === 1 && raceJ.carries === 1 &&
    raceH.amount === raceJ.amount && String(raceH.signed) === String(raceJ.signed),
    JSON.stringify({ raceH, raceJ }));

  ck('ページエラーなし（ホスト）', host._errs.length === 0, host._errs.join(' | '));
  ck('ページエラーなし（参加側）', join._errs.length === 0, join._errs.join(' | '));

  await b.close();
  if (R.fails) { console.log('FAILED ' + R.fails); process.exit(1); }
  console.log('e2e-v200 ok');
})().catch((e) => { console.error(e); process.exit(1); });
