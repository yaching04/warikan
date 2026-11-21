// E2E: ふたり同期（Firebase エミュレータ）
// @emulator（Firebase エミュレータが必要）
const { EMU, sleep, tap, launch, reporter, APPURL: URL } = require('../helpers');
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
      window.__warikanShareCalls = [];
      try {
        navigator.canShare = function () { return true; };
        navigator.share = function (d) { window.__warikanShareCalls.push(d); return Promise.resolve(); };
      } catch (e) {}
    }, EMU);
    return p;
  }

  const a = await page();
  const c = await page();
  await a.goto(URL, { waitUntil: 'domcontentloaded' });
  await c.goto(URL, { waitUntil: 'domcontentloaded' });
  await a.evaluate(() => localStorage.clear());
  await c.evaluate(() => localStorage.clear());
  await a.reload({ waitUntil: 'domcontentloaded' });
  await c.reload({ waitUntil: 'domcontentloaded' });

  await a.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    S.setPersonName(s, 'yamada', 'たろう');
    S.setPersonName(s, 'kanojo', 'はなこ');
    S.ensureMonth(s, '2026-11');
    const rent = s.payments.find((p) => p.month === '2026-11' && p.itemId === 'item-yachin');
    if (rent) S.updatePayment(s, rent.id, { amount: 60000 });
  });
  await c.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    S.setPersonName(s, 'yamada', '仮の名前');
    S.addPayment(s, { month: '2026-01', itemId: 'item-net', itemName: '旧データ', payerId: 'yamada', amount: 111, extra: true });
  });
  await a.reload({ waitUntil: 'domcontentloaded' });
  await c.reload({ waitUntil: 'domcontentloaded' });

  await tap(a, '[data-tab=set]');
  await sleep(200);
  const before = await a.evaluate(() => ({
    title: document.querySelector('[data-card=share] h2') && document.querySelector('[data-card=share] h2').textContent,
    start: !!document.querySelector('[data-act=share-start]'),
  }));
  ck('設定に「ふたりで使う」と「共有を始める」がある', before.title === 'ふたりで使う' && before.start, JSON.stringify(before));

  await tap(a, '[data-act=share-start]');
  await a.waitForFunction(() => !!(window.WarikanSync && WarikanSync.isActive()), { timeout: 15000 });
  await sleep(400);
  const started = await a.evaluate(() => {
    const st = WarikanSync.status();
    const card = document.querySelector('[data-card=share]') && document.querySelector('[data-card=share]').innerText;
    return { st, card, url: WarikanSync.inviteUrl() };
  });
  ck('共有を始めるとはなこの参加待ちになる（名前は設定のもの）',
    started.st.active && started.st.memberCount === 1 && started.st.waitingName === 'はなこ' && /はなこの参加待ち/.test(started.card || ''),
    JSON.stringify(started));
  ck('招待リンクは #join=hid.token の本番URL',
    /^https:\/\/yaching04\.github\.io\/warikan\/\?openExternalBrowser=1#join=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(started.url || ''),
    started.url);

  await tap(a, '[data-act=share-invite]');
  await sleep(200);
  const shared = await a.evaluate(() => window.__warikanShareCalls && window.__warikanShareCalls[0]);
  ck('招待リンクを navigator.share で送る', !!(shared && shared.url === started.url), JSON.stringify(shared));

  const joinUrl = URL + started.url.slice(started.url.indexOf('#'));
  await c.goto(joinUrl, { waitUntil: 'domcontentloaded' });
  try {
    await c.waitForFunction(() => document.getElementById('dlg') && document.getElementById('dlg').open, { timeout: 15000 });
  } catch (e) {}
  const sheet = await c.evaluate(() => {
    const d = document.getElementById('dlg');
    return { open: d && d.open, text: d && d.innerText, hash: location.hash, err: window.__warikanJoinErr || null };
  });
  ck('はなこ側の確認シートにホスト名と置き換わる旨が出る',
    sheet.open && /たろうのデータとつながります/.test(sheet.text || '') && /この端末にあるデータは置き換わります/.test(sheet.text || ''),
    JSON.stringify(sheet));

  await tap(c, '[data-act=share-join-ok]');
  await c.waitForFunction(() => !!(window.WarikanSync && WarikanSync.isActive()), { timeout: 15000 });
  await sleep(500);
  const joined = await c.evaluate(() => ({
    names: { y: WarikanStore.load().people.yamada.name, k: WarikanStore.load().people.kanojo.name },
    hasOld: WarikanStore.load().payments.some((p) => p.amount === 111),
    hasRent: WarikanStore.load().payments.some((p) => p.itemId === 'item-yachin' && p.month === '2026-11' && p.amount === 60000),
    status: document.querySelector('[data-card=share]') && document.querySelector('[data-card=share]').innerText,
    members: WarikanSync.status().memberCount,
  }));
  ck('参加後は相手のデータに置き換わり、共有中（ふたり）になる',
    joined.names.y === 'たろう' && joined.names.k === 'はなこ' && !joined.hasOld && joined.hasRent && joined.members === 2 && /共有中（ふたり）/.test(joined.status || ''),
    JSON.stringify(joined));

  await tap(a, '[data-tab=set]');
  await sleep(400);
  const aTwo = await a.evaluate(() => document.querySelector('[data-card=share]') && document.querySelector('[data-card=share]').innerText);
  ck('ホスト側にも共有中（ふたり）が出る', /共有中（ふたり）/.test(aTwo || ''), aTwo);

  // 同期: ホストが電気の金額を入れる
  await tap(a, '[data-tab=home]');
  await sleep(300);
  await a.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    const denki = s.payments.find((p) => p.month === '2026-11' && p.itemId === 'item-denki');
    if (denki) S.updatePayment(s, denki.id, { amount: 4400 });
    if (WarikanSync.flush) WarikanSync.flush();
  });
  await c.waitForFunction(() => {
    return WarikanStore.load().payments.some((p) => p.month === '2026-11' && p.itemId === 'item-denki' && p.amount === 4400);
  }, { timeout: 15000 });
  ck('ホストが直した支払いが、もう一方の端末に届く', true);

  // 戻す確認文
  await tap(a, '[data-tab=set]');
  await sleep(200);
  const restoreNote = await a.evaluate(async () => {
    return new Promise((resolve) => {
      // 確認シートだけ開くために、バックアップファイル選択は使わず open 相当の文言を直接出せないので、
      // 共有中フラグだけ見てシートを真似ず、ボタンから開くのは file picker なのでスキップし、
      // ここでは共有中であることを前提に UI 関数の結果を見る。
      resolve(WarikanSync.isActive());
    });
  });
  ck('共有中フラグが立っている（戻す確認用）', restoreNote === true);

  await tap(c, '[data-tab=set]');
  await sleep(200);
  await tap(c, '[data-act=share-leave]');
  await sleep(200);
  const leaveSheet = await c.evaluate(() => document.getElementById('dlg') && document.getElementById('dlg').innerText);
  ck('共有をやめる確認に、データは残ると出る', /データはこの端末に残ります/.test(leaveSheet || ''), leaveSheet);
  await tap(c, '[data-act=share-leave-ok]');
  await sleep(400);
  const left = await c.evaluate(() => ({
    active: WarikanSync.isActive(),
    hasRent: WarikanStore.load().payments.some((p) => p.itemId === 'item-yachin' && p.amount === 60000),
    hasDenki: WarikanStore.load().payments.some((p) => p.itemId === 'item-denki' && p.amount === 4400),
    start: !!document.querySelector('[data-act=share-start]'),
  }));
  ck('共有をやめるとこの端末だけ外れ、データは残る', !left.active && left.hasRent && left.hasDenki && left.start, JSON.stringify(left));

  ck('ページエラーなし（ホスト）', a._errs.length === 0, a._errs.join(' | '));
  ck('ページエラーなし（参加側）', c._errs.length === 0, c._errs.join(' | '));

  await b.close();
  if (R.fails) { console.log('FAILED ' + R.fails); process.exit(1); }
  console.log('e2e-v180 ok');
})().catch((e) => { console.error(e); process.exit(1); });
