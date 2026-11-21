// E2E: 招待リンクで参加、iOS Safari の案内、このスマホは
const fs = require('fs');
const path = require('path');
const { VERSION, ROOT, SHOT_DIR, sleep, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

(async () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const sync = fs.readFileSync(path.join(ROOT, 'sync.js'), 'utf8');
  ck('招待リンクで参加ボタンがある', /data-act="share-join-enter"/.test(app) && /招待リンクで参加/.test(app));
  ck('このスマホはの選択がある', /このスマホは/.test(app) && /data-act="set-me"/.test(app));
  ck('parseJoinInput がある', /function parseJoinInput/.test(sync));
  ck('権限エラーは共有をやめる→始める', /権限エラーで参加できませんでした[\s\S]*共有をやめる[\s\S]*共有を始める/.test(app));

  const b = await launch();
  async function page(opts) {
    const ctx = await b.createBrowserContext();
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p._errs = errs;
    if (opts && opts.ua) await p.setUserAgent(opts.ua);
    await p.evaluateOnNewDocument((standalone) => {
      window.__warikanNow = Date.parse('2026-11-15T12:00:00+09:00');
      if (standalone) {
        Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
      }
    }, !!(opts && opts.standalone));
    await p.setBypassServiceWorker(true);
    await p.emulateTimezone('Asia/Tokyo');
    await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    return p;
  }

  const p = await page();
  await p.goto(URL, { waitUntil: 'networkidle0' });
  await p.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('warikan-theme', 'light');
    const S = WarikanStore;
    const s = S.defaultState();
    s.people.yamada.name = 'たろう';
    s.people.kanojo.name = 'はなこ';
    S.ensureMonth(s, '2026-11');
    localStorage.setItem(S.KEY, JSON.stringify(s));
  });
  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);

  await p.click('[data-tab=set]');
  await sleep(250);
  const set0 = await p.evaluate(() => {
    const joinBtn = document.querySelector('[data-act=share-join-enter]');
    const meBtns = [...document.querySelectorAll('[data-act=set-me]')].map((el) => ({
      id: el.getAttribute('data-id'),
      name: el.textContent.trim(),
      on: el.classList.contains('on'),
    }));
    const lab = (document.querySelector('.me-lab') || {}).textContent;
    const note = (document.querySelector('.me-note') || {}).textContent;
    const ver = (document.body.innerText.match(/v\d+\.\d+\.\d+/) || [''])[0];
    return { join: joinBtn && joinBtn.textContent.trim(), meBtns, lab, note, ver };
  });
  ck('設定に「招待リンクで参加」がある（未共有）', set0.join === '招待リンクで参加', JSON.stringify(set0));
  ck('「このスマホは」が名前の下にある',
    set0.lab === 'このスマホは' &&
    set0.meBtns.length === 2 &&
    set0.meBtns[0].id === 'yamada' && set0.meBtns[0].name === 'たろう' &&
    set0.meBtns[1].id === 'kanojo' && set0.meBtns[1].name === 'はなこ' &&
    set0.note === 'この端末で使う人を選んでね',
    JSON.stringify(set0));
  ck('設定に今の版が出る', set0.ver === 'v' + VERSION);

  // --- 自分の選択 ---
  await p.click('[data-act=set-me][data-id=kanojo]');
  await sleep(200);
  const afterMe = await p.evaluate(() => {
    const on = [...document.querySelectorAll('[data-act=set-me]')].filter((el) => el.classList.contains('on')).map((el) => el.getAttribute('data-id'));
    const items = [...document.querySelectorAll('.item .l')].map((el) => el.innerText.replace(/\s+/g, ' ').trim());
    const meStored = localStorage.getItem('warikan-me');
    const ratio = (document.getElementById('ratioRead') || {}).textContent;
    const bg = getComputedStyle(document.querySelector('[data-act=set-me][data-id=kanojo]')).backgroundColor;
    return { on, items, meStored, ratio, bg };
  });
  ck('はなこを選ぶと選択が切り替わる', afterMe.on.length === 1 && afterMe.on[0] === 'kanojo' && afterMe.meStored === 'kanojo', JSON.stringify(afterMe));
  ck('選んだ側がその人の色で塗られる', afterMe.bg === 'rgb(249, 115, 102)' || /rgb\(/.test(afterMe.bg || ''), afterMe.bg);
  ck('設定の「自分」ラベルが切り替わる',
    afterMe.items.some((t) => /自分/.test(t)) && afterMe.ratio && /自分/.test(afterMe.ratio),
    JSON.stringify({ items: afterMe.items, ratio: afterMe.ratio }));

  await p.click('[data-tab=home]');
  await sleep(250);
  const homeMe = await p.evaluate(() => {
    const heads = [...document.querySelectorAll('.phead')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    const rows = [...document.querySelectorAll('.prow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    return { heads, rows, hasJibun: heads.some((t) => /自分が払う/.test(t)) || rows.some((t) => /自分/.test(t)) };
  });
  ck('精算ページの「自分」が切り替わる', homeMe.hasJibun === true, JSON.stringify({ heads: homeMe.heads, rows: homeMe.rows.slice(0, 6) }));

  await p.reload({ waitUntil: 'networkidle0' });
  await sleep(250);
  const persisted = await p.evaluate(() => {
    const heads = [...document.querySelectorAll('.phead')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    const rows = [...document.querySelectorAll('.prow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    return {
      me: localStorage.getItem('warikan-me'),
      hasJibun: heads.some((t) => /自分が払う/.test(t)) || rows.some((t) => /自分/.test(t)),
    };
  });
  ck('自分の選択は再読み込み後も残る', persisted.me === 'kanojo' && persisted.hasJibun === true, JSON.stringify(persisted));

  await p.click('[data-tab=set]');
  await sleep(200);
  await p.click('[data-act=share-join-enter]');
  await sleep(250);
  const pasteSheet = await p.evaluate(() => {
    const dlg = document.getElementById('dlg');
    const ta = document.getElementById('joinInput');
    const cs = ta ? getComputedStyle(ta) : null;
    return {
      open: !!(dlg && dlg.open),
      title: (document.getElementById('dh') || {}).textContent,
      hasInput: !!ta,
      mono: !!(cs && /mono|menlo|consolas|courier/i.test(cs.fontFamily)),
      height: ta ? Math.round(ta.getBoundingClientRect().height) : 0,
      joinBtn: !![...document.querySelectorAll('[data-act=share-join-paste]')].length,
      text: dlg && dlg.innerText,
    };
  });
  ck('招待リンクの貼り付けシートが開く',
    pasteSheet.open && pasteSheet.title === '招待リンクで参加' && pasteSheet.hasInput &&
    pasteSheet.joinBtn && pasteSheet.mono && pasteSheet.height >= 80,
    JSON.stringify(pasteSheet));
  await p.screenshot({ path: path.join(SHOT_DIR, 'paste-join-sheet-375-light.png') });

  await p.evaluate(() => {
    const ta = document.getElementById('joinInput');
    ta.value = 'これはリンクじゃない';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const noDetect = await p.evaluate(() => {
    const hint = document.querySelector('[data-join-detected]');
    return { hidden: !hint || hint.hidden, hid: (document.getElementById('joinInput') || {}).getAttribute('data-hid') };
  });
  ck('不正な文言では読み取らない', noDetect.hidden === true && !noDetect.hid, JSON.stringify(noDetect));
  await p.click('[data-act=share-join-paste]');
  await sleep(250);
  const invalid = await p.evaluate(() => {
    const d = document.querySelector('dialog[open] .sheet');
    return d && {
      kind: d.getAttribute('data-join-error'),
      title: (d.querySelector('h2') || {}).textContent,
      text: d.innerText,
    };
  });
  ck('無効なリンクは日本語のエラーになる',
    invalid && invalid.kind === 'invalid-link' &&
    invalid.title === 'このリンクは読み取れませんでした' &&
    /そのまま貼ってね/.test(invalid.text || ''),
    JSON.stringify(invalid));

  await p.click('dialog[open] [data-act=share-join-enter]');
  await sleep(250);
  await p.evaluate(() => {
    WarikanSync.peekInvite = function () {
      return Promise.resolve({ hostName: 'たろう', hostPersonId: 'yamada' });
    };
    const ta = document.getElementById('joinInput');
    ta.value = 'これ ' + 'https://yaching04.github.io/warikan/?openExternalBrowser=1#join=hidhidhidhidhidh.tokentokentokento' + ' よろしく';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const detected = await p.evaluate(() => {
    const hint = document.querySelector('[data-join-detected]');
    const ta = document.getElementById('joinInput');
    return {
      shown: hint && !hint.hidden && /読み取りました/.test(hint.textContent || ''),
      hid: ta && ta.getAttribute('data-hid'),
      token: ta && ta.getAttribute('data-token'),
    };
  });
  ck('全文URL（前後の文言つき）を自動で読み取る',
    detected.shown && detected.hid === 'hidhidhidhidhidh' && detected.token === 'tokentokentokento',
    JSON.stringify(detected));
  await p.click('[data-act=share-join-paste]');
  await sleep(350);
  const confirmUrl = await p.evaluate(() => {
    const d = document.querySelector('dialog[open] .sheet');
    return d && { title: (d.querySelector('h2') || {}).textContent, text: d.innerText };
  });
  ck('全文URLの貼り付けで参加確認に進む',
    confirmUrl && confirmUrl.title === '共有に参加しますか？' && /たろうのデータとつながります/.test(confirmUrl.text || ''),
    JSON.stringify(confirmUrl));
  await p.click('[data-act=close]');
  await sleep(200);

  await p.click('[data-act=share-join-enter]');
  await sleep(200);
  await p.evaluate(() => {
    WarikanSync.peekInvite = function () {
      return Promise.resolve({ hostName: 'たろう', hostPersonId: 'yamada' });
    };
    const ta = document.getElementById('joinInput');
    ta.value = '  hidhidhidhidhidh.tokentokentokento  ';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const detectedBare = await p.evaluate(() => {
    const ta = document.getElementById('joinInput');
    const hint = document.querySelector('[data-join-detected]');
    return { hid: ta && ta.getAttribute('data-hid'), shown: hint && !hint.hidden };
  });
  ck('hid.token だけでも読み取る', detectedBare.hid === 'hidhidhidhidhidh' && detectedBare.shown, JSON.stringify(detectedBare));
  await p.click('[data-act=share-join-paste]');
  await sleep(350);
  const confirmBare = await p.evaluate(() => {
    const d = document.querySelector('dialog[open] .sheet');
    return d && { title: (d.querySelector('h2') || {}).textContent };
  });
  ck('hid.token の貼り付けで参加確認に進む', confirmBare && confirmBare.title === '共有に参加しますか？', JSON.stringify(confirmBare));
  ck('ページエラーなし（設定）', p._errs.length === 0, p._errs.join(' | '));
  await p.close();

  // --- iOS Safari: ホーム画面案内 ---
  const ios = await page({ ua: IPHONE, standalone: false });
  await ios.goto(URL, { waitUntil: 'networkidle0' });
  await ios.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('warikan-theme', 'light');
  });
  await ios.evaluate(() => {
    location.hash = 'join=' + 'hidhidhidhidhidh.tokentokentokento';
  });
  await sleep(400);
  const iosSheet = await ios.evaluate(() => {
    const d = document.querySelector('dialog[open] .sheet');
    if (!d) return null;
    const acts = [...d.querySelectorAll('[data-act]')].map((el) => el.textContent.trim());
    return { kind: d.getAttribute('data-ios-join') != null ? 'ios' : (d.getAttribute('data-inapp-join') || 'other'), title: (d.querySelector('h2') || {}).textContent, text: d.innerText, acts };
  });
  ck('iOS Safari（standalone ではない）では案内シートが出る',
    iosSheet && iosSheet.kind === 'ios' &&
    iosSheet.title === 'ホーム画面のアプリで使う？' &&
    /ホーム画面に追加/.test(iosSheet.text || '') &&
    /招待リンクで参加/.test(iosSheet.text || '') &&
    iosSheet.acts.includes('リンクをコピー') &&
    iosSheet.acts.includes('Safariでこのまま参加') &&
    iosSheet.acts.includes('閉じる') &&
    !/共有に参加しますか/.test(iosSheet.text || ''),
    JSON.stringify(iosSheet));
  ck('ページエラーなし（iOS Safari）', ios._errs.length === 0, ios._errs.join(' | '));
  await ios.close();

  // --- standalone ならそのまま参加へ ---
  const stand = await page({ ua: IPHONE, standalone: true });
  await stand.goto(URL, { waitUntil: 'networkidle0' });
  await stand.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('warikan-theme', 'light');
    WarikanSync.peekInvite = function () {
      return Promise.resolve({ hostName: 'たろう', hostPersonId: 'yamada' });
    };
  });
  await stand.evaluate(() => {
    location.hash = 'join=' + 'hidhidhidhidhidh.tokentokentokento';
  });
  await sleep(400);
  const standSheet = await stand.evaluate(() => {
    const d = document.querySelector('dialog[open] .sheet');
    if (!d) return null;
    return {
      ios: d.hasAttribute('data-ios-join'),
      inapp: d.getAttribute('data-inapp-join'),
      title: (d.querySelector('h2') || {}).textContent,
      text: d.innerText,
    };
  });
  ck('standalone では案内を出さず参加確認に進む',
    standSheet && standSheet.ios === false && !standSheet.inapp &&
    standSheet.title === '共有に参加しますか？',
    JSON.stringify(standSheet));
  ck('ページエラーなし（standalone）', stand._errs.length === 0, stand._errs.join(' | '));
  await stand.close();

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
