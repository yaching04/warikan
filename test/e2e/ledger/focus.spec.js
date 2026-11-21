// E2E: 台帳を開いたら見出しへ、‹ で戻ったら開くボタンへフォーカスを移す
const { sleep, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;

function focusInfo() {
  const ae = document.activeElement;
  if (!ae) return { tag: null };
  return {
    tag: ae.tagName,
    text: (ae.textContent || '').trim(),
    act: ae.getAttribute && ae.getAttribute('data-act'),
    className: ae.className,
    tabindex: ae.getAttribute && ae.getAttribute('tabindex'),
    aria: ae.getAttribute && ae.getAttribute('aria-label'),
  };
}

function onLedgerHeading(f) {
  return !!(f && f.tag === 'B' && f.text === '支払いの記録' && f.tabindex === '-1');
}

function onBackButton(f) {
  return !!(f && f.act === 'close-ledger');
}

function onOpenOrBack(f) {
  return onLedgerHeading(f) || onBackButton(f);
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

  // カードをクリックして開く
  await p.waitForSelector('.tsuke-open');
  await p.click('.tsuke-open');
  await p.waitForSelector('.tsuke-now .tsuke-lab, [data-act=close-ledger]');
  await sleep(150);
  const afterClickOpen = await p.evaluate(focusInfo);
  ck('カードで開いた直後、フォーカスは見出し（または戻る） ' + JSON.stringify(afterClickOpen),
    onOpenOrBack(afterClickOpen) && afterClickOpen.tag !== 'BODY');
  ck('カードで開いた直後のフォーカスは BODY ではない', afterClickOpen.tag !== 'BODY');

  await p.click('[data-act=close-ledger]');
  await sleep(200);
  const afterClickBack = await p.evaluate(focusInfo);
  ck('‹ で戻った直後、フォーカスは残りの支払いカードの開くボタン ' + JSON.stringify(afterClickBack),
    onTsukeOpen(afterClickBack));

  // キーボード Enter
  await p.focus('.tsuke-open');
  await p.keyboard.press('Enter');
  await sleep(250);
  const afterEnterOpen = await p.evaluate(focusInfo);
  ck('Enter で開いた直後、フォーカスは見出し（または戻る） ' + JSON.stringify(afterEnterOpen),
    onOpenOrBack(afterEnterOpen) && afterEnterOpen.tag !== 'BODY');
  await p.click('[data-act=close-ledger]');
  await sleep(200);
  const afterEnterBack = await p.evaluate(focusInfo);
  ck('Enter のあと ‹ で戻ると開くボタンにフォーカス ' + JSON.stringify(afterEnterBack),
    onTsukeOpen(afterEnterBack));

  // キーボード Space（戻した直後の開くボタンに既にフォーカスがある）
  await p.keyboard.press('Space');
  await sleep(250);
  const afterSpaceOpen = await p.evaluate(focusInfo);
  ck('Space で開いた直後、フォーカスは見出し（または戻る） ' + JSON.stringify(afterSpaceOpen),
    onOpenOrBack(afterSpaceOpen) && afterSpaceOpen.tag !== 'BODY');
  await p.click('[data-act=close-ledger]');
  await sleep(200);
  const afterSpaceBack = await p.evaluate(focusInfo);
  ck('Space のあと ‹ で戻ると開くボタンにフォーカス ' + JSON.stringify(afterSpaceBack),
    onTsukeOpen(afterSpaceBack));

  ck('ページエラーなし ' + (errs[0] || ''), errs.length === 0);


  await b.close();
  if (R.fails) {
    console.log(R.fails + ' failed');
    process.exit(1);
  }
  console.log('all passed');
})().catch((e) => { console.error(e); process.exit(1); });
