// E2E: LINE のアプリ内ブラウザでは参加せず案内する。招待URLに openExternalBrowser=1。
// 古いデータでも設定の固定額が精算に反映される（共有オフ / メモリバックエンドの共有オン）。
const fs = require('fs');
const path = require('path');
const { ROOT, SHOT_DIR, sleep, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;
const LINE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 Line/15.0.2';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

function legacyState() {
  return {
    version: 1,
    people: {
      yamada: { id: 'yamada', name: 'たろう', color: '#14B8A6' },
      kanojo: { id: 'kanojo', name: 'はなこ', color: '#F97366' },
    },
    ratioYamada: 50,
    items: [
      { id: 'item-yachin', name: '家賃', kind: 'fixed', defaultPayer: 'kanojo', fixedAmount: '65000' },
      { id: 'item-kaimono', name: '買い物', kind: 'variable', defaultPayer: 'kanojo', fixedAmount: null },
      { id: 'item-denki', name: '電気', kind: 'variable', defaultPayer: 'yamada', fixedAmount: null },
      { id: 'item-gas', name: 'ガス', kind: 'variable', defaultPayer: 'yamada', fixedAmount: null },
      { id: 'item-suidou', name: '水道', kind: 'variable', defaultPayer: 'yamada', fixedAmount: null },
      { id: 'item-net', name: 'ネット', kind: 'variable', defaultPayer: 'yamada', fixedAmount: null },
    ],
    payments: [
      { id: 'plk10ya', month: '2026-10', itemName: '家賃', payerId: 'kanojo', amount: '¥60,000' },
      { id: 'p-2026-11-item-yachin', month: '2026-11', itemId: 'item-yachin', itemName: '家賃', payerId: 'kanojo', amount: '60000' },
      { id: 'plk10km', month: '2026-10', itemId: 'item-kaimono', itemName: '買い物', payerId: 'kanojo', amount: null },
      { id: 'plk11km', month: '2026-11', itemId: 'item-kaimono', itemName: '買い物', payerId: 'kanojo', amount: null },
    ],
    settlements: {
      '2026-09': { marks: { yamada: 1, kanojo: 1 }, settledAt: 1, snapshot: null },
    },
    ledger: [],
  };
}

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
    await p.evaluateOnNewDocument(() => { window.__warikanNow = Date.parse('2026-11-15T12:00:00+09:00'); });
    return p;
  }

  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  ck('使用済み招待の案内は共有をやめる→始める', /この招待はもう使われています[\s\S]*共有をやめる[\s\S]*共有を始める/.test(app));

  // --- 招待URLと parseJoinHash ---
  const p0 = await page(SAFARI);
  await p0.goto(URL, { waitUntil: 'domcontentloaded' });
  const urls = await p0.evaluate(() => {
    const url = WarikanSync.inviteUrl('hidhidhidhidhidh', 'tokentokentokento');
    const parsedHash = WarikanSync.parseJoinHash('#join=hidhidhidhidhidh.tokentokentokento');
    const parsedFull = WarikanSync.parseJoinHash(url);
    return { url, parsedHash, parsedFull };
  });
  ck('招待URLはハッシュの前に openExternalBrowser=1 がある',
    /^https:\/\/yaching04\.github\.io\/warikan\/\?openExternalBrowser=1#join=/.test(urls.url), urls.url);
  ck('parseJoinHash はクエリ付きURLも読む',
    urls.parsedFull && urls.parsedFull.hid === 'hidhidhidhidhidh' && urls.parsedFull.token === 'tokentokentokento',
    JSON.stringify(urls));
  await p0.close();

  // --- LINE UA で #join を開くと案内シート（参加しない） ---
  const line = await page(LINE);
  await line.goto(URL + '?openExternalBrowser=1#join=abcabcabcabcabca.toktoktoktoktokt', { waitUntil: 'networkidle0' });
  await sleep(400);
  const sheet = await line.evaluate(() => {
    const d = document.querySelector('dialog[open] .sheet');
    if (!d) return null;
    return { title: (d.querySelector('h2') || {}).textContent, text: d.innerText, kind: d.getAttribute('data-inapp-join') };
  });
  ck('LINE内では参加確認ではなく案内シートが出る',
    sheet && sheet.kind === 'line' && /LINEの中で開いています/.test(sheet.title || '') && /Safariで開いてから参加してね/.test(sheet.text)
    && /ブラウザで開く/.test(sheet.text) && /リンクをコピー/.test(sheet.text)
    && !/共有に参加しますか/.test(sheet.text),
    JSON.stringify(sheet));
  await line.screenshot({ path: path.join(SHOT_DIR, 'line-join-sheet.png') });
  const copied = await line.evaluate(async () => {
    const btn = document.querySelector('[data-act=copy-join-link]');
    if (!btn) return { ok: false };
    const url = btn.getAttribute('data-url') || '';
    btn.click();
    return { ok: true, url };
  });
  ck('コピーするリンクにも openExternalBrowser=1 がある',
    copied.ok && /openExternalBrowser=1#join=/.test(copied.url), JSON.stringify(copied));
  ck('LINE内では参加処理を始めていない', await line.evaluate(() => !WarikanSync.isActive()));
  ck('ページエラーなし（LINE）', line._errs.length === 0, line._errs.join(' | '));
  await line.close();

  // すでに参加済みのセッションが LINE 内にあるときはバナー
  const line2 = await page(LINE);
  await line2.goto(URL, { waitUntil: 'domcontentloaded' });
  await line2.evaluate(async () => {
    const db = WarikanSync.createMemoryDb();
    WarikanSync.useBackend(new WarikanSync.MemoryBackend(db));
    await WarikanSync.startShare();
  });
  await line2.evaluate(() => document.querySelector('[data-tab=set]').click());
  await sleep(200);
  const banner = await line2.evaluate(() => {
    const el = document.querySelector('[data-inapp-banner]');
    return el ? el.innerText : '';
  });
  ck('LINE内で参加済みならSafariへ誘導するバナーが出る',
    /LINEの中で開いています/.test(banner) && /Safari/.test(banner), banner);
  await line2.close();

  // --- 共有オフ: 古いデータで設定の固定額を変え、精算（未確定の10月）に反映 ---
  const off = await page(SAFARI);
  await off.goto(URL, { waitUntil: 'networkidle0' });
  await off.evaluate((st) => {
    localStorage.clear();
    localStorage.setItem(WarikanStore.KEY, JSON.stringify(st));
  }, legacyState());
  await off.reload({ waitUntil: 'networkidle0' });
  await sleep(300);
  const before = await off.evaluate(() => {
    const month = document.querySelector('.mnav') && document.querySelector('.mnav').innerText;
    const rows = [...document.querySelectorAll('.prow')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    const y = (WarikanStore.load().payments || []).find((p) => p.month === '2026-10' && p.itemId === 'item-yachin');
    return { month, rows, oct: y && y.amount };
  });
  ck('精算の最初の未確定月は10月で、家賃はまだ ¥60,000',
    /10月/.test(before.month || '') && before.oct === 60000 && before.rows.some((t) => /家賃/.test(t) && /¥60,000/.test(t)),
    JSON.stringify(before));

  await off.evaluate(() => document.querySelector('[data-tab=set]').click());
  await sleep(200);
  await off.evaluate(() => document.querySelector('[data-act=edit-item][data-id=item-yachin]').click());
  await sleep(250);
  await off.evaluate(() => {
    const amt = document.getElementById('inAmt');
    amt.value = '70000';
    amt.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await off.click('#itemForm button[type=submit]');
  await sleep(400);
  await off.evaluate(() => document.querySelector('[data-tab=home]').click());
  await sleep(300);
  const after = await off.evaluate(() => {
    const rows = [...document.querySelectorAll('.prow')].map((r) => {
      const amt = r.querySelector('.amt');
      return { text: r.innerText.replace(/\s+/g, ' ').trim(), amt: amt && amt.textContent };
    });
    const payments = WarikanStore.load().payments;
    const oct = payments.find((p) => p.month === '2026-10' && p.itemId === 'item-yachin');
    const nov = payments.find((p) => p.month === '2026-11' && p.itemId === 'item-yachin');
    return { rows, oct: oct && oct.amount, nov: nov && nov.amount };
  });
  ck('設定変更後、精算の10月の家賃が ¥70,000 になる',
    after.oct === 70000 && after.rows.some((r) => /家賃/.test(r.text) && r.amt === '¥70,000'),
    JSON.stringify(after));
  ck('11月の行にも ¥70,000 が入る', after.nov === 70000, String(after.nov));
  await off.screenshot({ path: path.join(SHOT_DIR, 'legacy-settle-off.png') });
  ck('ページエラーなし（共有オフ）', off._errs.length === 0, off._errs.join(' | '));
  await off.close();

  // --- 共有オン（メモリバックエンド）: 同じ操作が同期の上書きで消えない ---
  const on = await page(SAFARI);
  on.setDefaultTimeout(10000);
  await on.goto(URL, { waitUntil: 'domcontentloaded' });
  await on.evaluate((st) => {
    localStorage.clear();
    localStorage.setItem(WarikanStore.KEY, JSON.stringify(st));
  }, legacyState());
  await on.reload({ waitUntil: 'domcontentloaded' });
  await sleep(300);
  const shared = await Promise.race([
    on.evaluate(async () => {
      try { await WarikanSync.leave({ forget: true }); } catch (e) {}
      const db = WarikanSync.createMemoryDb();
      WarikanSync.useBackend(new WarikanSync.MemoryBackend(db));
      await WarikanSync.startShare();
      const active = WarikanSync.isActive();
      document.querySelector('[data-tab=set]').click();
      const btn = document.querySelector('[data-act=edit-item][data-id=item-yachin]');
      if (!btn) throw new Error('missing edit-item 家賃');
      btn.click();
      const amt = document.getElementById('inAmt');
      if (!amt) throw new Error('missing inAmt');
      amt.value = '72000';
      amt.dispatchEvent(new Event('input', { bubbles: true }));
      const form = document.getElementById('itemForm');
      if (!form) throw new Error('missing itemForm');
      if (form.requestSubmit) form.requestSubmit();
      else form.querySelector('button[type=submit]').click();
      await new Promise((r) => setTimeout(r, 500));
      document.querySelector('[data-tab=home]').click();
      const rows = [...document.querySelectorAll('.prow')].map((r) => {
        const a = r.querySelector('.amt');
        return { text: r.innerText.replace(/\s+/g, ' ').trim(), amt: a && a.textContent };
      });
      const payments = WarikanStore.load().payments;
      const oct = payments.find((p) => p.month === '2026-10' && p.itemId === 'item-yachin');
      const nov = payments.find((p) => p.month === '2026-11' && p.itemId === 'item-yachin');
      return { active, rows, oct: oct && oct.amount, nov: nov && nov.amount, stillActive: WarikanSync.isActive() };
    }),
    sleep(15000).then(() => { throw new Error('共有オンの操作が15秒以内に終わらなかった'); }),
  ]);
  ck('メモリバックエンドで共有を始められる', shared && shared.active === true, JSON.stringify(shared && shared.active));
  ck('共有中でも精算の家賃が ¥72,000 のまま残る',
    shared.active && shared.oct === 72000 && shared.nov === 72000
    && shared.rows.some((r) => /家賃/.test(r.text) && r.amt === '¥72,000'),
    JSON.stringify(shared));
  ck('ページエラーなし（共有オン）', on._errs.length === 0, on._errs.join(' | '));

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
