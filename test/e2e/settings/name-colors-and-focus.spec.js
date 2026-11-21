// E2E: 名前の色丸、台帳の安定した並び、確認シートのフォーカス、削除後のテーマ
const { sleep, hex, contrast, setTheme, launch, reporter, APPURL: URL } = require('../helpers');
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

const clickWipe = async (p) => {
  await p.evaluate(() => {
    const b = document.querySelector('[data-act=wipe]');
    if (b) { b.scrollIntoView({ block: 'center' }); b.focus(); b.click(); }
  });
  await sleep(200);
};
const clickDlgClose = async (p) => {
  await p.evaluate(() => {
    const b = document.querySelector('#dlg [data-act=close], #dlg button.btn.ghost');
    if (b) b.click();
  });
  await p.waitForFunction(() => !document.getElementById('dlg').open, { timeout: 2000 }).catch(() => {});
  await sleep(80);
};
const gotoTab = async (p, tab) => {
  await p.evaluate((tab) => {
    const b = document.querySelector('[data-tab="' + tab + '"]');
    if (b) b.click();
  }, tab);
  await sleep(200);
};

const clickSettle = async (p) => {
  await p.evaluate(() => {
    const b = document.querySelector('[data-act=settle]');
    if (b) { b.scrollIntoView({ block: 'center' }); b.click(); }
  });
  await sleep(200);
  const need = await p.evaluate(() => !!(document.getElementById('dlg') && document.getElementById('dlg').open && document.querySelector('[data-act=settle-anyway]')));
  if (need) {
    await p.click('[data-act=settle-anyway]');
    await sleep(200);
  }
};
const measureDots = (p) => p.evaluate(() => {
  const y = document.querySelector('[data-card=people] #nm-y');
  const k = document.querySelector('[data-card=people] #nm-k');
  const dy = y && y.parentElement && y.parentElement.querySelector('.dot');
  const dk = k && k.parentElement && k.parentElement.querySelector('.dot');
  const cs = getComputedStyle(document.documentElement);
  return {
    y: dy && getComputedStyle(dy).backgroundColor,
    k: dk && getComputedStyle(dk).backgroundColor,
    yVar: cs.getPropertyValue('--c-y').trim(),
    kVar: cs.getPropertyValue('--c-k').trim(),
    visible: !!(dy && dk && dy.getBoundingClientRect().width >= 8 && dk.getBoundingClientRect().width >= 8),
  };
});

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
  await sleep(200);

  // 1. 名前の色丸
  await gotoTab(p, 'set');
  await sleep(200);
  const dotsL = await measureDots(p);
  ck('ライト: 名前欄に色の丸がある（1人目ティール・2人目コーラル）', dotsL.visible && hex(dotsL.y) === dotsL.yVar.toUpperCase() && hex(dotsL.k) === dotsL.kVar.toUpperCase() && hex(dotsL.y) === '#14B8A6' && hex(dotsL.k) === '#F97366', JSON.stringify(dotsL));

  await setTheme(p, 'dark');
  await sleep(80);
  const dotsD = await measureDots(p);
  ck('ダーク: 名前欄に色の丸がある（1人目ティール・2人目コーラル）', dotsD.visible && hex(dotsD.y) === dotsD.yVar.toUpperCase() && hex(dotsD.k) === dotsD.kVar.toUpperCase() && hex(dotsD.y) === '#2DD4BF' && hex(dotsD.k) === '#FB8A7E', JSON.stringify(dotsD));

  // 4. ダークの「削除する」は #DC2626 白文字
  await clickWipe(p);
  await sleep(200);
  const fillDark = await p.evaluate(() => {
    const ok = [...document.querySelectorAll('#dlg button')].find((b) => b.textContent === '削除する');
    const cs = ok && getComputedStyle(ok);
    return { bg: cs && cs.backgroundColor, fg: cs && cs.color };
  });
  const fillCD = contrast(fillDark.fg, fillDark.bg);
  ck('ダークの「削除する」は #DC2626 に白文字、コントラスト 4.5 以上', hex(fillDark.bg) === '#DC2626' && hex(fillDark.fg) === '#FFFFFF' && fillCD >= 4.5, JSON.stringify(fillDark) + ' ' + fillCD.toFixed(2));

  // 3. フォーカスをシート内に閉じ込める。閉じたら開いたボタンへ
  await p.keyboard.press('Tab');
  await sleep(50);
  const t1 = await p.evaluate(() => document.activeElement && document.activeElement.textContent);
  await p.keyboard.press('Tab');
  await sleep(50);
  const t2 = await p.evaluate(() => document.activeElement && document.activeElement.textContent);
  await p.keyboard.press('Tab');
  await sleep(50);
  const t3 = await p.evaluate(() => ({
    text: document.activeElement && document.activeElement.textContent,
    inSheet: !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.sheet')),
    inDlg: !!(document.activeElement && document.getElementById('dlg').contains(document.activeElement)),
  }));
  ck('Tab は 削除する → やめる → また 削除する（シートの外に出ない）', t1 === '削除する' && t2 === 'やめる' && t3.text === '削除する' && t3.inSheet && t3.inDlg, JSON.stringify({ t1, t2, t3 }));
  await p.keyboard.down('Shift');
  await p.keyboard.press('Tab');
  await p.keyboard.up('Shift');
  await sleep(50);
  const t4 = await p.evaluate(() => ({
    text: document.activeElement && document.activeElement.textContent,
    inSheet: !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.sheet')),
  }));
  ck('Shift+Tab はやめるに戻り、シートの中に留まる', t4.text === 'やめる' && t4.inSheet, JSON.stringify(t4));

  await clickDlgClose(p);
  await sleep(80);
  const back = await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-act'));
  ck('シートを閉じたら「全てのデータを削除」にフォーカスが戻る', back === 'wipe', back);

  // ライトの塗りつぶしは #B91C1C のまま
  await setTheme(p, 'light');
  await sleep(80);
  await clickWipe(p);
  await sleep(200);
  const fillLight = await p.evaluate(() => {
    const ok = [...document.querySelectorAll('#dlg button')].find((b) => b.textContent === '削除する');
    const cs = ok && getComputedStyle(ok);
    return { bg: cs && cs.backgroundColor, fg: cs && cs.color };
  });
  ck('ライトの「削除する」は #B91C1C に白文字', hex(fillLight.bg) === '#B91C1C' && hex(fillLight.fg) === '#FFFFFF', JSON.stringify(fillLight));
  await clickDlgClose(p);
  await sleep(80);

  // ほかの確認シート（確定の取り消し）でも Tab が外に出ない
  await gotoTab(p, 'home');
  await sleep(200);
  await clickSettle(p);
  await gotoTab(p, 'hist');
  await sleep(200);
  await p.click('[data-act=unconfirm]');
  await sleep(200);
  const u1 = await p.evaluate(() => document.activeElement && (document.activeElement.textContent || document.activeElement.tagName));
  await p.keyboard.press('Tab');
  await sleep(50);
  await p.keyboard.press('Tab');
  await sleep(50);
  await p.keyboard.press('Tab');
  await sleep(50);
  const u3 = await p.evaluate(() => ({
    text: document.activeElement && document.activeElement.textContent,
    inSheet: !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.sheet')),
    buttons: [...document.querySelectorAll('#dlg .sheet button')].map((b) => b.textContent),
  }));
  ck('取り消しシートでも Tab は最後の次に先頭へ戻る', u3.inSheet && u3.buttons.length >= 2 && u3.text === u3.buttons[0], JSON.stringify({ u1, u3 }));
  await clickDlgClose(p);
  await sleep(80);
  const backUn = await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-act'));
  ck('取り消しシートを閉じると「修正」にフォーカスが戻る', backUn === 'unconfirm', backUn);

  // 2. 11月と12月を続けて確定し、作成時刻が同じでも並びが安定
  await gotoTab(p, 'home');
  await sleep(200);
  // いま12月（11月確定済み）。12月を確定
  await clickSettle(p);
  await gotoTab(p, 'set');
  await sleep(100);
  await gotoTab(p, 'home');
  await sleep(200);
  const onJan = await p.evaluate(() => (document.getElementById('mLbl') || {}).textContent);
  ck('12月を確定すると1月', /2027年1月/.test(onJan || ''), onJan);

  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    const t = 1700000000000;
    (s.ledger || []).filter((e) => e.kind === 'carry').forEach((e) => { e.createdAt = t; e.updatedAt = t; });
    S.save(s);
  });

  const readLedger = async () => {
    const open = await p.evaluate(() => !!document.querySelector('[data-act=close-ledger]'));
    if (!open) {
      const fromHome = await p.evaluate(() => {
        const body = document.querySelector('[data-card=tsuke] .tsuke-body');
        if (body) { body.click(); return 'home'; }
        return null;
      });
      if (!fromHome) {
        await gotoTab(p, 'hist');
        await sleep(200);
        await p.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find((x) => /支払いの記録を見る/.test(x.textContent));
          if (b) b.click();
        });
      }
      await sleep(250);
    }
    return p.evaluate(() => [...document.querySelectorAll('.lrow b')].map((x) => x.textContent));
  };

  const firstOrder = await readLedger();
  ck('記録は新しい月が上（12月分 → 11月分）', firstOrder[0] === '12月分' && firstOrder[1] === '11月分' && firstOrder.includes('これまでの残り'), JSON.stringify(firstOrder));

  const orders = [firstOrder.join('|')];
  for (let i = 0; i < 3; i++) {
    await p.reload({ waitUntil: 'networkidle0' });
    await sleep(200);
    const rows = await readLedger();
    orders.push(rows.join('|'));
  }
  ck('開くたびに支払いの記録の順番が変わらない', orders.every((o) => o === orders[0]), JSON.stringify(orders));

  // 5. ダークのまま削除してもダークが残る
  await p.evaluate(() => { const b = document.querySelector('[data-act=close-ledger]'); if (b) b.click(); });
  await sleep(150);
  await gotoTab(p, 'set');
  await sleep(200);
  await setTheme(p, 'dark');
  await sleep(80);
  const beforeWipe = await p.evaluate(() => localStorage.getItem('warikan-theme'));
  await clickWipe(p);
  await sleep(200);
  await p.evaluate(() => { const b = document.querySelector('[data-act=wipe-ok]'); if (b) b.click(); });
  await sleep(300);
  const afterWipe = await p.evaluate(() => ({
    stored: localStorage.getItem('warikan-theme'),
    theme: document.documentElement.getAttribute('data-theme'),
    bg: getComputedStyle(document.body).backgroundColor,
    settled: WarikanStore.lastSettledMonth(WarikanStore.load()),
    toast: document.getElementById('toast') && !document.getElementById('toast').hidden && document.getElementById('toast').textContent,
    label: document.getElementById('mLbl') && document.getElementById('mLbl').textContent,
  }));
  ck('ダークのまま削除してもテーマはダークのまま', beforeWipe === 'dark' && afterWipe.stored === 'dark' && afterWipe.theme === 'dark' && hex(afterWipe.bg) === '#1C1B1A' && afterWipe.settled === null, JSON.stringify(afterWipe));
  ck('削除後はホームに戻りトーストを出す', /2026年11月/.test(afterWipe.label || '') && afterWipe.toast === 'すべてのデータを削除しました', JSON.stringify(afterWipe));

  ck('ページエラーなし', errs.length === 0, errs.join(' | '));

  await b.close();
  if (R.fails) { console.log('\nFAILED', R.fails); process.exit(1); }
  console.log('\nAll v1.5.1 e2e passed');
})().catch((e) => { console.error(e); process.exit(1); });
