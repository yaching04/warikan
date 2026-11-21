// E2E: 設定の名前を続けて入力できる、変換中は保存しない
const fs = require('fs');
const path = require('path');
const { ROOT, SHOT_DIR, VERSION, sleep, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;

(async () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  ck('変換中の入力は無視する', /nameComposing \|\| e\.isComposing/.test(app) && /compositionstart/.test(app) && /compositionend/.test(app));
  ck('設定の入力中は描画を保留する', /function settingsFieldFocused/.test(app) && /pendingSettingsRender/.test(app));

  const b = await launch();
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.evaluateOnNewDocument(() => {
    window.__warikanNow = Date.parse('2026-11-15T12:00:00+09:00');
  });
  await p.setBypassServiceWorker(true);
  await p.emulateTimezone('Asia/Tokyo');
  await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

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

  const set0 = await p.evaluate(() => ({
    y: (document.getElementById('nm-y') || {}).value,
    k: (document.getElementById('nm-k') || {}).value,
    ver: (document.body.innerText.match(/v\d+\.\d+\.\d+/) || [''])[0],
    segs: [...document.querySelectorAll('[data-act=set-me]')].map((el) => el.textContent.trim()),
  }));
  ck('設定に今の版が出る', set0.ver === 'v' + VERSION);
  ck('初期の名前が入っている', set0.y === 'たろう' && set0.k === 'はなこ', JSON.stringify(set0));

  await p.evaluate(() => {
    const el = document.getElementById('nm-y');
    el.__mark = 1;
    el.focus();
    el.select();
  });
  await p.type('#nm-y', 'あいうえお', { delay: 40 });
  await sleep(100);

  const typed = await p.evaluate(() => {
    const el = document.getElementById('nm-y');
    return {
      value: el && el.value,
      focused: document.activeElement === el,
      same: !!(el && el.__mark === 1),
      stored: WarikanStore.load().people.yamada.name,
      segs: [...document.querySelectorAll('[data-act=set-me]')].map((b) => ({ id: b.getAttribute('data-id'), name: b.textContent.trim() })),
      ratio: (document.getElementById('ratioRead') || {}).textContent,
    };
  });
  ck('連続入力した名前が全部残る', typed.value === 'あいうえお', JSON.stringify(typed));
  ck('入力中も同じ要素にフォーカスがある', typed.focused === true && typed.same === true, JSON.stringify(typed));
  ck('入力中はまだ保存しない', typed.stored === 'たろう', typed.stored);
  ck('入力中にこのスマホはのラベルが更新される',
    typed.segs.some((s) => s.id === 'yamada' && s.name === 'あいうえお'),
    JSON.stringify(typed.segs));
  ck('入力中に負担の割合の名前が更新される',
    typeof typed.ratio === 'string' && typed.ratio.indexOf('あいうえお') !== -1,
    typed.ratio);

  await p.evaluate(() => {
    const el = document.getElementById('nm-y');
    el.blur();
  });
  await sleep(150);

  const afterBlur = await p.evaluate(() => {
    const el = document.getElementById('nm-y');
    const s = WarikanStore.load();
    return {
      value: el && el.value,
      stored: s.people.yamada.name,
      k: s.people.kanojo.name,
      segs: [...document.querySelectorAll('[data-act=set-me]')].map((b) => ({ id: b.getAttribute('data-id'), name: b.textContent.trim() })),
      ratio: (document.getElementById('ratioRead') || {}).textContent,
      focused: document.activeElement === el,
    };
  });
  ck('blur 後に名前が保存される', afterBlur.stored === 'あいうえお' && afterBlur.value === 'あいうえお', JSON.stringify(afterBlur));
  ck('もうひとりの名前は変わらない', afterBlur.k === 'はなこ', afterBlur.k);
  ck('blur 後もこのスマホはのラベルが新しい名前',
    afterBlur.segs.some((s) => s.id === 'yamada' && s.name === 'あいうえお'),
    JSON.stringify(afterBlur.segs));
  ck('blur 後も負担の割合の名前が新しい名前',
    typeof afterBlur.ratio === 'string' && afterBlur.ratio.indexOf('あいうえお') !== -1,
    afterBlur.ratio);

  const comp = await p.evaluate(() => {
    const el = document.getElementById('nm-k');
    el.__mark = 2;
    el.focus();
    el.value = '';
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    el.value = 'し';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'し', isComposing: true, inputType: 'insertCompositionText' }));
    const during = {
      value: el.value,
      focused: document.activeElement === el,
      same: el.__mark === 2,
      stored: WarikanStore.load().people.kanojo.name,
    };
    el.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'はなここ' }));
    el.value = 'はなここ';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'はなここ', isComposing: true, inputType: 'insertCompositionText' }));
    el.value = 'はなこ子';
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'はなこ子' }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'はなこ子', isComposing: false, inputType: 'insertCompositionText' }));
    const after = {
      value: el.value,
      focused: document.activeElement === el,
      same: el.__mark === 2,
      stored: WarikanStore.load().people.kanojo.name,
      segs: [...document.querySelectorAll('[data-act=set-me]')].map((b) => ({ id: b.getAttribute('data-id'), name: b.textContent.trim() })),
    };
    el.blur();
    const saved = {
      stored: WarikanStore.load().people.kanojo.name,
      value: (document.getElementById('nm-k') || {}).value,
      segs: [...document.querySelectorAll('[data-act=set-me]')].map((b) => ({ id: b.getAttribute('data-id'), name: b.textContent.trim() })),
      ratio: (document.getElementById('ratioRead') || {}).textContent,
    };
    return { during, after, saved };
  });
  ck('変換中も同じ要素にフォーカスがある',
    comp.during.focused === true && comp.during.same === true && comp.during.value === 'し',
    JSON.stringify(comp.during));
  ck('変換中は名前を保存しない', comp.during.stored === 'はなこ', comp.during.stored);
  ck('変換確定後も同じ要素で全文字残る',
    comp.after.value === 'はなこ子' && comp.after.focused === true && comp.after.same === true,
    JSON.stringify(comp.after));
  ck('変換確定直後はまだ保存しない（blur 前）', comp.after.stored === 'はなこ', comp.after.stored);
  ck('変換確定後にこのスマホはのラベルが更新される',
    comp.after.segs.some((s) => s.id === 'kanojo' && s.name === 'はなこ子'),
    JSON.stringify(comp.after.segs));
  ck('変換の blur 後に名前が保存される',
    comp.saved.stored === 'はなこ子' && comp.saved.value === 'はなこ子',
    JSON.stringify(comp.saved));
  ck('変換の blur 後にラベルと割合が更新される',
    comp.saved.segs.some((s) => s.id === 'kanojo' && s.name === 'はなこ子') &&
    typeof comp.saved.ratio === 'string' && comp.saved.ratio.indexOf('はなこ子') !== -1,
    JSON.stringify(comp.saved));

  await p.screenshot({ path: path.join(SHOT_DIR, 'settings-names-375-light.png') });
  ck('ページエラーなし', errs.length === 0, errs.join(' | '));

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
