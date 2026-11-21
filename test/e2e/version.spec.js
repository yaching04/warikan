// E2E: 版の表記が package.json・app.js・sw.js・設定画面でそろっている
const { VERSION, CACHE_NAME, readSource, launch, openPage, seedState, reporter, APPURL, sleep } = require('./helpers');
const R = reporter();
const ck = R.ck;

(async () => {
  const app = readSource('app.js');
  const sw = readSource('sw.js');
  ck('app.js の APP_VERSION が package.json と同じ', app.includes("const APP_VERSION = '" + VERSION + "';"), VERSION);
  ck('sw.js のキャッシュ名が版に合っている', sw.includes("const CACHE = '" + CACHE_NAME + "';"), CACHE_NAME);
  ck('store.js のバックアップの既定の版が同じ', readSource('store.js').includes("version: info.version || '" + VERSION + "'"));
  ck('CHANGELOG に今の版がある', readSource('CHANGELOG.md').includes('v' + VERSION));

  const b = await launch();
  const { page: p, errs } = await openPage(b);
  await p.goto(APPURL, { waitUntil: 'networkidle0' });
  await seedState(p);
  await p.reload({ waitUntil: 'networkidle0' });
  await p.click('[data-tab=set]');
  await sleep(250);
  const shown = await p.evaluate(() => document.body.innerText);
  ck('設定に v' + VERSION + ' が出る', shown.includes('v' + VERSION));
  ck('ページエラーなし', errs.length === 0, errs.join(' | '));
  await b.close();
  R.done();
})().catch((e) => { console.error(e); process.exit(1); });
