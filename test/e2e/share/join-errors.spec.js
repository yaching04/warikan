// E2E: 参加できない理由を出す・途中で止まった参加のやり直し・使用済み/自分の招待/無効リンク
// @emulator（Firebase エミュレータが必要）
// PROD=1 で本番 Firestore に対して実行（テスト用の世帯が残る）
const path = require('path');
const { SHOT_DIR, sleep, tap, launch, reporter, APPURL: URL, EMU: EMU_DEFAULT } = require('../helpers');
const R = reporter();
const ck = R.ck;
const PROD = process.env.PROD === '1';
const EMU = PROD ? null : EMU_DEFAULT;
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

async function waitFor(p, fn, arg, ms) {
  const end = Date.now() + (ms || 20000);
  while (Date.now() < end) {
    const v = await p.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    await sleep(200);
  }
  return null;
}
const sheet = () => { const d = document.querySelector('dialog[open] .sheet'); return d ? { title: d.querySelector('h2').textContent, text: d.textContent, kind: d.getAttribute('data-join-error') } : null; };

(async () => {
  const b = await launch();
  async function page(ua) {
    const ctx = await b.createBrowserContext();
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p._errs = errs;
    if (ua) await p.setUserAgent(ua);
    await p.setBypassServiceWorker(true);
    await p.emulateTimezone('Asia/Tokyo');
    await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.evaluateOnNewDocument((emu, standalone) => {
      if (emu) window.__warikanFirebaseEmulator = emu;
      // iPhone はホーム画面のアプリとして開いた想定（Safari のままだと v2.0.7 の案内シートが先に出る）
      if (standalone) { try { Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }); } catch (e) {} }
      window.__warikanShareCalls = [];
      try {
        navigator.canShare = function () { return true; };
        navigator.share = function (d) { window.__warikanShareCalls.push(d); return Promise.resolve(); };
      } catch (e) {}
    }, EMU, !!(ua && /iPhone/.test(ua)));
    return p;
  }

  const host = await page();
  await host.goto(URL, { waitUntil: 'domcontentloaded' });
  await host.evaluate(() => localStorage.clear());
  await host.reload({ waitUntil: 'domcontentloaded' });
  await host.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    S.setPersonName(s, 'yamada', 'たろう');
    S.setPersonName(s, 'kanojo', 'はなこ');
    S.ensureMonth(s, '2026-11');
  });
  await host.reload({ waitUntil: 'domcontentloaded' });
  await sleep(500);
  const inviteUrl = await host.evaluate(async () => { await WarikanSync.startShare(); return WarikanSync.inviteUrl(); });
  ck('ホストが招待を作れる', /#join=/.test(inviteUrl || ''), inviteUrl);
  const hash = inviteUrl.slice(inviteUrl.indexOf('#'));
  console.log('household', hash.slice(6).split('.')[0]);

  // 1) iPhone Safari の UA。1回目は書き込み後の反映で落とす → 理由とコードが出る → もう一度で参加できる
  const join = await page(SAFARI);
  await join.goto(URL + hash, { waitUntil: 'domcontentloaded' });
  const conf = await waitFor(join, sheet);
  ck('参加の確認が出て、ホスト名は設定から', conf && /共有に参加しますか/.test(conf.title) && /たろうのデータ/.test(conf.text), conf && conf.text);
  await join.evaluate(() => {
    const S = WarikanStore;
    const orig = S.normalize;
    let once = true;
    S.normalize = function (x) { if (once) { once = false; throw new Error('test apply failure'); } return orig.apply(this, arguments); };
  });
  await tap(join, '[data-act=share-join-ok]');
  const e1 = await waitFor(join, () => { const d = document.querySelector('dialog[open] .sheet[data-join-error]'); return d ? { title: d.querySelector('h2').textContent, text: d.textContent, retry: !!d.querySelector('[data-act=share-join-ok]') } : null; });
  ck('途中で失敗すると理由とコード（apply）が出る', e1 && /参加できませんでした/.test(e1.title) && /コード: unknown（apply）/.test(e1.text) && e1.retry, e1 && e1.text);
  await join.screenshot({ path: path.join(SHOT_DIR, 'join-error-retry.png') });
  await tap(join, '[data-act=share-join-ok]');
  const ok = await waitFor(join, () => WarikanSync.isActive() && WarikanSync.me());
  ck('もう一度ためすと参加できる（すでにメンバーなら書き込まない）', ok === 'kanojo', ok);
  ck('参加側に「さん」がない', await join.evaluate(() => !/さん/.test(document.body.textContent)));

  // 2) 3人目（例：別のブラウザで開いた）→ 使用済み
  const third = await page(SAFARI);
  await third.goto(URL + hash, { waitUntil: 'domcontentloaded' });
  await waitFor(third, () => !!document.querySelector('[data-act=share-join-ok]'));
  await tap(third, '[data-act=share-join-ok]');
  const e2 = await waitFor(third, () => { const d = document.querySelector('dialog[open] .sheet[data-join-error]'); return d ? { kind: d.getAttribute('data-join-error'), title: d.querySelector('h2').textContent, text: d.textContent } : null; });
  ck('ふたりそろった招待は「もう使われています」とホストへの案内', e2 && e2.kind === 'used' && /たろうに、設定の「共有をやめる」→「共有を始める」/.test(e2.text) && /invite-used/.test(e2.text), e2 && e2.text);
  await third.screenshot({ path: path.join(SHOT_DIR, 'join-error-used.png') });

  // 3) ホストが自分のリンクを開いた
  await host.goto(URL + hash, { waitUntil: 'domcontentloaded' });
  await waitFor(host, () => !!document.querySelector('[data-act=share-join-ok]'));
  await tap(host, '[data-act=share-join-ok]');
  const e3 = await waitFor(host, () => { const d = document.querySelector('dialog[open] .sheet[data-join-error]'); return d ? { kind: d.getAttribute('data-join-error'), text: d.textContent } : null; });
  ck('自分の招待リンクは「相手の携帯で開いてね」', e3 && e3.kind === 'own' && /相手の携帯で開いてね/.test(e3.text), e3 && e3.text);
  ck('ホストの共有はそのまま', await host.evaluate(() => WarikanSync.isActive() && WarikanSync.me() === 'yamada'));

  // 4) 壊れた/古いリンク → 確認を出さずに理由
  const bad = await page(SAFARI);
  const badHash = hash.replace(/\.[0-9a-f]+$/, '.deadbeefdeadbeefdeadbeefdeadbeef');
  await bad.goto(URL + badHash, { waitUntil: 'domcontentloaded' });
  const e4 = await waitFor(bad, () => { const d = document.querySelector('dialog[open] .sheet[data-join-error]'); return d ? { kind: d.getAttribute('data-join-error'), text: d.textContent } : null; });
  ck('無効なリンクは「この招待リンクは使えません」', e4 && e4.kind === 'invalid' && /使えません/.test(e4.text), e4 && e4.text);
  await bad.screenshot({ path: path.join(SHOT_DIR, 'join-error-invalid.png') });

  for (const [n, p] of [['host', host], ['join', join], ['third', third], ['bad', bad]]) ck('pageerror なし ' + n, p._errs.length === 0, p._errs.join(' | '));
  await b.close();
  if (R.fails) { console.log('FAILED ' + R.fails); process.exit(1); }
  console.log('e2e-v202 ok');
})().catch((e) => { console.error(e); process.exit(1); });
