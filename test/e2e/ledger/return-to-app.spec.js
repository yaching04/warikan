// E2E: アプリ内へ戻って #tsuke がなければ今月を出す。戻るたびに画面が変わる。戻る途中の開き直しも hash と一致
const { sleep, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;

function pageInfo() {
  const ae = document.activeElement;
  const focus = !ae ? { tag: null } : {
    tag: ae.tagName,
    text: (ae.textContent || '').replace(/\s+/g, ' ').trim(),
    act: ae.getAttribute && ae.getAttribute('data-act'),
    className: ae.className,
    tabindex: ae.getAttribute && ae.getAttribute('tabindex'),
    aria: ae.getAttribute && ae.getAttribute('aria-label'),
  };
  const amt = document.querySelector('.tsuke-now .tsuke-amt');
  const dlg = document.getElementById('dlg');
  return {
    hash: location.hash,
    path: location.pathname,
    host: location.host,
    state: history.state,
    len: history.length,
    ledger: !!document.querySelector('[data-act=close-ledger]'),
    heading: !!(document.querySelector('#top .mnav b') && document.querySelector('#top .mnav b').textContent === '支払いの記録'),
    home: !!document.querySelector('.tsuke-open'),
    title: document.title,
    tab: (document.querySelector('.tabs button.on') && document.querySelector('.tabs button.on').dataset.tab) || null,
    amt: amt && amt.textContent,
    dlg: !!(dlg && dlg.open),
    focus,
  };
}

function onHeading(f) {
  return !!(f && f.tag === 'B' && f.text === '支払いの記録' && f.tabindex === '-1');
}
function onOpenOrBack(f) {
  return onHeading(f) || !!(f && f.act === 'close-ledger');
}
function onTsukeOpen(f) {
  return !!(f && f.tag === 'BUTTON' && f.act === 'open-ledger' && /\btsuke-open\b/.test(f.className || ''));
}

function screenKey(info) {
  if (info.title && info.title !== 'わりかん') return 'away:' + info.title;
  if (info.hasTabs === false) return 'away:' + (info.title || '');
  if (info.ledger) return 'ledger';
  return 'tab:' + (info.tab || (info.home ? 'home' : '?'));
}
function visibleChanged(before, after) {
  return screenKey(before) !== screenKey(after);
}

(async () => {
  const b = await launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setBypassServiceWorker(true);
  await p.emulateTimezone('Asia/Tokyo');
  await p.evaluateOnNewDocument(() => { window.__warikanNow = Date.parse('2026-11-15T12:00:00+09:00'); });
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
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);
  await p.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    S.setOpening(s, 'yamada', 278000);
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(200);

  const base = await p.evaluate(pageInfo);
  ck('初期はホームで #tsuke なし', base.home === true && base.ledger === false && base.hash !== '#tsuke');

  await p.waitForSelector('.tsuke-open');
  await p.click('.tsuke-open');
  await p.waitForSelector('[data-act=close-ledger]');
  await sleep(150);
  const opened = await p.evaluate(pageInfo);
  ck('開くと #tsuke を積み、state は tsuke ' + JSON.stringify({ hash: opened.hash, state: opened.state, len: opened.len }),
    opened.hash === '#tsuke' && opened.state && opened.state.warikan === 'tsuke' && opened.ledger === true && opened.len === base.len + 1);
  ck('開いた直後のフォーカスは見出し ' + JSON.stringify(opened.focus), onOpenOrBack(opened.focus));

  await p.click('[data-act=close-ledger]');
  await sleep(200);
  const closed = await p.evaluate(pageInfo);
  ck('‹ で閉じると hash が外れホームに戻る ' + JSON.stringify({ hash: closed.hash, len: closed.len, home: closed.home }),
    closed.hash !== '#tsuke' && closed.ledger === false && closed.home === true);
  ck('‹ で閉じたあとフォーカスは開くボタン ' + JSON.stringify(closed.focus), onTsukeOpen(closed.focus));

  // 開いて閉じても履歴は増えない
  await p.click('.tsuke-open');
  await p.waitForSelector('[data-act=close-ledger]');
  await sleep(100);
  await p.click('[data-act=close-ledger]');
  await sleep(200);
  const cycled = await p.evaluate(pageInfo);
  ck('開閉を繰り返しても履歴が積もり続けない ' + JSON.stringify({ base: base.len, cycled: cycled.len }),
    cycled.len === base.len + 1 && cycled.hash !== '#tsuke' && cycled.home === true);

  // ブラウザの戻るは ‹ と同じ
  await p.click('.tsuke-open');
  await p.waitForSelector('[data-act=close-ledger]');
  await sleep(100);
  const beforeViaBack = await p.evaluate(pageInfo);
  await p.evaluate(() => history.back());
  await sleep(250);
  const viaBack = await p.evaluate(pageInfo);
  ck('ブラウザの戻るで台帳が閉じる（画面は台帳→今月） ' + JSON.stringify({ from: screenKey(beforeViaBack), to: screenKey(viaBack) }),
    viaBack.hash !== '#tsuke' && viaBack.ledger === false && viaBack.home === true && viaBack.tab === 'home' && viaBack.title === 'わりかん'
      && visibleChanged(beforeViaBack, viaBack));
  ck('ブラウザの戻るでもフォーカスは開くボタン ' + JSON.stringify(viaBack.focus), onTsukeOpen(viaBack.focus));

  await p.evaluate(() => history.forward());
  await sleep(250);
  const viaFwd = await p.evaluate(pageInfo);
  ck('進むと台帳が再び開く（画面は今月→台帳） ' + JSON.stringify({ from: screenKey(viaBack), to: screenKey(viaFwd) }),
    viaFwd.hash === '#tsuke' && viaFwd.ledger === true && viaFwd.heading === true && visibleChanged(viaBack, viaFwd));
  ck('進んで開いた直後のフォーカスは見出し ' + JSON.stringify(viaFwd.focus), onOpenOrBack(viaFwd.focus));

  // 二重に閉じてもアプリの外へ出ない
  await p.evaluate(() => {
    const btn = document.querySelector('[data-act=close-ledger]');
    if (btn) btn.click();
    const btn2 = document.querySelector('[data-act=close-ledger]');
    if (btn2) btn2.click();
  });
  await sleep(250);
  const noLeave = await p.evaluate(pageInfo);
  ck('二重に閉じてもアプリに留まる', noLeave.title === 'わりかん' && noLeave.home === true && noLeave.ledger === false && noLeave.hash !== '#tsuke');

  // #tsuke のまま再読み込みすると台帳が開く。‹ は replace なので外へ出ない
  await p.click('.tsuke-open');
  await p.waitForSelector('[data-act=close-ledger]');
  await sleep(100);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  const reloaded = await p.evaluate(pageInfo);
  ck('#tsuke の再読み込みで台帳が開く ' + JSON.stringify({ hash: reloaded.hash, ledger: reloaded.ledger }),
    reloaded.hash === '#tsuke' && reloaded.ledger === true && reloaded.heading === true);
  await p.click('[data-act=close-ledger]');
  await sleep(250);
  const afterReloadBack = await p.evaluate(pageInfo);
  ck('#tsuke 再読み込み後の ‹ はホームに戻り、アプリに留まる ' + JSON.stringify({ hash: afterReloadBack.hash, path: afterReloadBack.path }),
    afterReloadBack.hash !== '#tsuke' && afterReloadBack.home === true && afterReloadBack.ledger === false && afterReloadBack.title === 'わりかん');
  ck('そのときフォーカスは開くボタン ' + JSON.stringify(afterReloadBack.focus), onTsukeOpen(afterReloadBack.focus));

  // 台帳で「返す」を確定したあと、フォーカスは見出し（BODY ではない）
  await p.click('.tsuke-open');
  await p.waitForSelector('[data-act=repay]');
  await sleep(100);
  await p.click('[data-act=repay]');
  await sleep(200);
  await p.evaluate(() => {
    const a = document.getElementById('repayAmt');
    a.value = '30,000';
    a.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.click('#repayForm button[type=submit]');
  await sleep(300);
  const afterRepay = await p.evaluate(pageInfo);
  ck('台帳で返したあと残高は ¥248,000 で台帳のまま ' + JSON.stringify({ amt: afterRepay.amt, hash: afterRepay.hash, dlg: afterRepay.dlg }),
    afterRepay.amt === '¥248,000' && afterRepay.ledger === true && afterRepay.hash === '#tsuke' && afterRepay.dlg === false);
  ck('返す確定直後のフォーカスは見出し（BODY ではない） ' + JSON.stringify(afterRepay.focus),
    onOpenOrBack(afterRepay.focus) && afterRepay.focus.tag !== 'BODY');

  const DUMMY = 'data:text/html;charset=utf-8,' + encodeURIComponent('<title>warikan-dummy-prev</title><h1>dummy</h1>');
  async function bootFromDummy() {
    await p.goto(DUMMY, { waitUntil: 'domcontentloaded' });
    await p.goto(URL, { waitUntil: 'networkidle0' });
    await sleep(200);
  }
  async function backOnce() {
    const left = p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 2000 }).catch(() => null);
    await p.evaluate(() => history.back());
    await left;
    await sleep(200);
  }
  function awayInfo() {
    const on = document.querySelector('.tabs button.on');
    return {
      title: document.title,
      href: location.href,
      hasTabs: !!document.querySelector('[data-tab]'),
      tab: on && on.dataset.tab,
      ledger: !!document.querySelector('[data-act=close-ledger]'),
      hash: location.hash,
    };
  }

  // 台帳（このセッションで push）→ 履歴 → Back：死んだエントリがなく、1回目でページが変わる
  await bootFromDummy();
  await p.waitForSelector('.tsuke-open');
  await p.click('.tsuke-open');
  await p.waitForSelector('[data-act=close-ledger]');
  await sleep(150);
  await p.click('[data-tab=hist]');
  await sleep(250);
  const toHist = await p.evaluate(pageInfo);
  ck('台帳から履歴へ切ると台帳が閉じ、履歴タブのままアプリに留まる ' + JSON.stringify({ tab: toHist.tab, hash: toHist.hash, ledger: toHist.ledger }),
    toHist.tab === 'hist' && toHist.ledger === false && toHist.hash !== '#tsuke' && toHist.title === 'わりかん');
  await backOnce();
  const histBack = await p.evaluate(awayInfo);
  ck('履歴タブからの1回目の戻るは画面が変わり、アプリを離れる ' + JSON.stringify({ from: screenKey(toHist), to: screenKey(histBack) }),
    histBack.title === 'warikan-dummy-prev' && histBack.hasTabs === false && visibleChanged(toHist, histBack));

  // 台帳 → 設定 → Back
  await bootFromDummy();
  await p.waitForSelector('.tsuke-open');
  await p.click('.tsuke-open');
  await p.waitForSelector('[data-act=close-ledger]');
  await sleep(150);
  await p.click('[data-tab=set]');
  await sleep(250);
  const toSet = await p.evaluate(pageInfo);
  ck('台帳から設定へ切ると台帳が閉じ、設定タブのままアプリに留まる ' + JSON.stringify({ tab: toSet.tab, hash: toSet.hash, ledger: toSet.ledger }),
    toSet.tab === 'set' && toSet.ledger === false && toSet.hash !== '#tsuke' && toSet.title === 'わりかん');
  await backOnce();
  const setBack = await p.evaluate(awayInfo);
  ck('設定タブからの1回目の戻るも画面が変わり、アプリを離れる ' + JSON.stringify({ from: screenKey(toSet), to: screenKey(setBack) }),
    setBack.title === 'warikan-dummy-prev' && setBack.hasTabs === false && visibleChanged(toSet, setBack));

  // #tsuke 再読み込み（replaceState 案件）→ タブ → Back：タブ切替自体では外へ出ない
  await bootFromDummy();
  await p.waitForSelector('.tsuke-open');
  await p.click('.tsuke-open');
  await p.waitForSelector('[data-act=close-ledger]');
  await sleep(100);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  ck('#tsuke 再読み込みで台帳が開いている', await p.evaluate(() => location.hash === '#tsuke' && !!document.querySelector('[data-act=close-ledger]')));
  await p.click('[data-tab=hist]');
  await sleep(250);
  const reloadTab = await p.evaluate(pageInfo);
  ck('#tsuke 再読み込み後のタブ切替は replaceState でアプリに留まる ' + JSON.stringify({ tab: reloadTab.tab, hash: reloadTab.hash, title: reloadTab.title }),
    reloadTab.tab === 'hist' && reloadTab.ledger === false && reloadTab.hash !== '#tsuke' && reloadTab.title === 'わりかん');
  const beforeReloadBack = await p.evaluate(pageInfo);
  await backOnce();
  const reloadBack = await p.evaluate(pageInfo);
  ck('#tsuke 再読み込み後、履歴からの戻る1回目は今月へ変わりアプリに留まる ' + JSON.stringify({ from: screenKey(beforeReloadBack), to: screenKey(reloadBack) }),
    reloadBack.title === 'わりかん' && reloadBack.tab === 'home' && reloadBack.ledger === false && reloadBack.home === true
      && visibleChanged(beforeReloadBack, reloadBack));
  ck('そのときフォーカスは開くボタン ' + JSON.stringify(reloadBack.focus), onTsukeOpen(reloadBack.focus));
  const beforeReloadBack2 = reloadBack;
  await backOnce();
  const reloadBack2 = await p.evaluate(awayInfo);
  ck('#tsuke 再読み込み後、今月からの戻る2回目はアプリを離れる ' + JSON.stringify({ from: screenKey(beforeReloadBack2), to: screenKey(reloadBack2) }),
    reloadBack2.title === 'warikan-dummy-prev' && reloadBack2.hasTabs === false && visibleChanged(beforeReloadBack2, reloadBack2));

  // 同じ経路を設定タブでも
  await bootFromDummy();
  await p.waitForSelector('.tsuke-open');
  await p.click('.tsuke-open');
  await p.waitForSelector('[data-act=close-ledger]');
  await sleep(100);
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  await p.click('[data-tab=set]');
  await sleep(250);
  const reloadSet = await p.evaluate(pageInfo);
  ck('#tsuke 再読み込み後の設定タブ切替はアプリに留まる',
    reloadSet.tab === 'set' && reloadSet.ledger === false && reloadSet.hash !== '#tsuke' && reloadSet.title === 'わりかん');
  await backOnce();
  const reloadSetBack = await p.evaluate(pageInfo);
  ck('#tsuke 再読み込み後、設定からの戻る1回目は今月へ変わる ' + JSON.stringify({ from: screenKey(reloadSet), to: screenKey(reloadSetBack) }),
    reloadSetBack.title === 'わりかん' && reloadSetBack.tab === 'home' && reloadSetBack.ledger === false && reloadSetBack.home === true
      && visibleChanged(reloadSet, reloadSetBack));
  ck('設定から戻ったときもフォーカスは開くボタン ' + JSON.stringify(reloadSetBack.focus), onTsukeOpen(reloadSetBack.focus));
  await backOnce();
  const reloadSetBack2 = await p.evaluate(awayInfo);
  ck('#tsuke 再読み込み後、設定経路の戻る2回目はアプリを離れる ' + JSON.stringify({ from: screenKey(reloadSetBack), to: screenKey(reloadSetBack2) }),
    reloadSetBack2.title === 'warikan-dummy-prev' && reloadSetBack2.hasTabs === false && visibleChanged(reloadSetBack, reloadSetBack2));

  // 履歴→今月→開く を history.back 完了前に同期実行しても hash と画面が一致する
  await bootFromDummy();
  await p.waitForSelector('.tsuke-open');
  await p.click('.tsuke-open');
  await p.waitForSelector('[data-act=close-ledger]');
  await sleep(200);
  await p.evaluate(() => {
    document.querySelector('[data-tab=hist]').click();
    document.querySelector('[data-tab=home]').click();
    document.querySelector('.tsuke-open').click();
  });
  await sleep(500);
  const raced = await p.evaluate(pageInfo);
  ck('履歴→今月→開くを同期しても台帳は #tsuke のまま ' + JSON.stringify({ hash: raced.hash, ledger: raced.ledger, tab: raced.tab }),
    raced.ledger === true && raced.hash === '#tsuke' && raced.heading === true && raced.title === 'わりかん');
  const beforeRaceBack = raced;
  await backOnce();
  const raceBack = await p.evaluate(awayInfo);
  ck('そのあと戻る1回目は今月（アプリを飛ばさない） ' + JSON.stringify({ from: screenKey(beforeRaceBack), to: screenKey(raceBack) }),
    raceBack.title === 'わりかん' && raceBack.hasTabs === true && raceBack.tab === 'home' && raceBack.ledger === false
      && visibleChanged(beforeRaceBack, raceBack));

  ck('ページエラーなし ' + (errs[0] || ''), errs.length === 0);

  await b.close();
  if (R.fails) {
    console.log(R.fails + ' failed');
    process.exit(1);
  }
  console.log('all passed');
})().catch((e) => { console.error(e); process.exit(1); });
