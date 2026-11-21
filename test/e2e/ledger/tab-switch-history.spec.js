// E2E: 台帳表示中のタブ切替は積んだ履歴を pop する。v1.1.5 の履歴・フォーカスも回帰
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
  await p.evaluate(() => history.back());
  await sleep(250);
  const viaBack = await p.evaluate(pageInfo);
  ck('ブラウザの戻るで台帳が閉じる ' + JSON.stringify({ hash: viaBack.hash, ledger: viaBack.ledger }),
    viaBack.hash !== '#tsuke' && viaBack.ledger === false && viaBack.home === true && viaBack.title === 'わりかん');
  ck('ブラウザの戻るでもフォーカスは開くボタン ' + JSON.stringify(viaBack.focus), onTsukeOpen(viaBack.focus));

  await p.evaluate(() => history.forward());
  await sleep(250);
  const viaFwd = await p.evaluate(pageInfo);
  ck('進むと台帳が再び開く', viaFwd.hash === '#tsuke' && viaFwd.ledger === true && viaFwd.heading === true);
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
  ck('履歴タブからの1回目の戻るは no-op ではなくアプリを離れる（今月を飛ばした死んだエントリではない） ' + JSON.stringify(histBack),
    histBack.title === 'warikan-dummy-prev' && histBack.hasTabs === false);

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
  ck('設定タブからの1回目の戻るもアプリを離れる（死んだエントリではない） ' + JSON.stringify(setBack),
    setBack.title === 'warikan-dummy-prev' && setBack.hasTabs === false);

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
  await backOnce();
  const reloadBack = await p.evaluate(awayInfo);
  ck('#tsuke 再読み込み後、タブからの戻る1回目は下にホームがあるためアプリに留まる ' + JSON.stringify(reloadBack),
    reloadBack.title === 'わりかん' && reloadBack.hasTabs === true);

  ck('ページエラーなし ' + (errs[0] || ''), errs.length === 0);

  await b.close();
  if (R.fails) {
    console.log(R.fails + ' failed');
    process.exit(1);
  }
  console.log('all passed');
})().catch((e) => { console.error(e); process.exit(1); });
