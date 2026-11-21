// README 用のスクリーンショット（375px、ライト／ダーク）を docs/screenshots/ に撮る。
//   npm start してから: node test/visual/readme-shots.js
// 例データ（たろう／はなこ）だけを使う。
const path = require('path');
const fs = require('fs');
const { launch, openPage, seedState, sleep, tap, APPURL, ROOT, NOW } = require('../e2e/helpers');

const OUT = path.join(ROOT, 'docs', 'screenshots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch();
  for (const theme of ['light', 'dark']) {
    const { page: p, ctx } = await openPage(b);
    await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await p.goto(APPURL, { waitUntil: 'networkidle0' });
    await seedState(p, { theme, example: true });
    // バックアップ済みにして、お知らせの帯を出さない
    await p.evaluate((now) => localStorage.setItem('warikan-backup-at', String(now)), NOW);
    await p.reload({ waitUntil: 'networkidle0' });
    await sleep(400);
    await p.screenshot({ path: path.join(OUT, `settle-${theme}.png`) });
    await tap(p, '[data-tab=hist]');
    await sleep(600);
    await p.screenshot({ path: path.join(OUT, `history-${theme}.png`) });
    await tap(p, '[data-tab=set]');
    await sleep(400);
    await p.screenshot({ path: path.join(OUT, `settings-${theme}.png`) });
    await ctx.close();
  }
  await b.close();
  console.log('saved to ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
