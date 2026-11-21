// 見た目の確認用スクリーンショット。同じ例データ・同じ時刻で主要な画面を撮る。
//   OUT=dir APPURL=http://127.0.0.1:8766/index.html node test/visual/capture.js
// 乱数と時計を固定しているので、コードが同じなら何度撮っても同じ画像になる。
const fs = require('fs');
const path = require('path');
const { launch, seedState, sleep, APPURL, NOW } = require('../e2e/helpers');

const OUT = process.env.OUT || path.join(__dirname, '..', '..', 'screenshots', 'visual');
const THEMES = (process.env.THEMES || 'light,dark').split(',');
const WIDTH = Number(process.env.WIDTH || 375);

async function shot(p, name, full) {
  await sleep(350);
  if (!full) {
    await p.screenshot({ path: path.join(OUT, name + '.png') });
    return;
  }
  // 画面全体: fullPage だと固定ヘッダーとタブバーの位置が揺れるので、ビューポートをページの高さに広げて撮る
  await p.evaluate(() => window.scrollTo(0, 0));
  const h = await p.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
  await p.setViewport({ width: WIDTH, height: Math.max(812, h), deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(300);
  await p.screenshot({ path: path.join(OUT, name + '.png') });
  await p.setViewport({ width: WIDTH, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sleep(150);
}

/* 固定のタブバーに隠れていても押せるように、DOM の click で押す */
async function tap(p, sel) {
  await p.waitForSelector(sel);
  await p.$eval(sel, (el) => el.click());
  await sleep(150);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch();
  for (const theme of THEMES) {
    const ctx = await b.createBrowserContext();
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.evaluateOnNewDocument((now) => {
      window.__warikanNow = now;
      window.__warikanSyncBackend = 'memory';
      window.__warikanSettleDelay = 0;
      const realNow = Date.now;
      let tick = 0;
      Date.now = () => now + (tick++ % 1);
      void realNow;
      let seed = 42;
      const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
      Math.random = rnd;
      if (window.crypto && crypto.getRandomValues) {
        crypto.getRandomValues = (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(rnd() * 256); return a; };
      }
      try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch (e) {}
    }, NOW);
    await p.setBypassServiceWorker(true);
    await p.emulateTimezone('Asia/Tokyo');
    await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await p.setViewport({ width: WIDTH, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.goto(APPURL, { waitUntil: 'networkidle0' });
    await seedState(p, { theme, example: true });
    await p.reload({ waitUntil: 'networkidle0' });
    const pre = theme + '-' + WIDTH + '-';

    await shot(p, pre + '01-home', true);
    await tap(p, '[data-act=toggle-steps]');
    await shot(p, pre + '02-home-steps', true);
    await tap(p, '[data-act=toggle-steps]');
    await tap(p, '[data-act=prev-m]');
    await shot(p, pre + '02b-home-settled', true);
    await tap(p, '[data-act=next-m]');
    await tap(p, '[data-act=edit-pay]');
    await shot(p, pre + '03-pay-sheet');
    await tap(p, '[data-act=close]');
    await sleep(200);
    await tap(p, '[data-act=add-pay]');
    await shot(p, pre + '04-oneoff-sheet');
    await p.keyboard.press('Escape');
    await sleep(200);
    await tap(p, '[data-act=open-ledger]');
    await shot(p, pre + '05-ledger', true);
    await tap(p, '[data-act=close-ledger]');
    await sleep(200);

    await tap(p, '[data-tab=hist]');
    await shot(p, pre + '06-history', true);
    await tap(p, '[data-act=open-hist]');
    await shot(p, pre + '07-history-detail');
    await p.keyboard.press('Escape');
    await sleep(200);

    await tap(p, '[data-tab=set]');
    await shot(p, pre + '08-settings', true);
    await tap(p, '[data-act=add-item]');
    await shot(p, pre + '10-item-sheet');
    await p.keyboard.press('Escape');
    await sleep(200);

    await tap(p, '[data-act=share-join-enter]');
    await shot(p, pre + '11-share-join-paste');
    await p.keyboard.press('Escape');
    await sleep(200);
    await tap(p, '[data-act=share-start]');
    await sleep(600);
    await shot(p, pre + '12-share-waiting', true);
    await tap(p, '[data-act=share-invite]');
    await shot(p, pre + '13-share-invite');
    await p.keyboard.press('Escape');
    await sleep(200);
    await tap(p, '[data-act=share-leave]');
    await shot(p, pre + '14-share-leave');
    await p.keyboard.press('Escape');
    await sleep(200);

    if (errs.length) console.log(theme + ' page errors: ' + errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log('saved to ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
