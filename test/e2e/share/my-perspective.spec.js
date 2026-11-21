// E2E: 共有中は自分視点。v2.0.1 は精算の支払いを自分の分が先。共有オフもひとりめが先。
// @emulator（Firebase エミュレータが必要）
const fs = require('fs');
const path = require('path');
const { SHOT_DIR, EMU, sleep, tap, launch, reporter, APPURL: URL } = require('../helpers');
const R = reporter();
const ck = R.ck;

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
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

  async function shot(p, name) {
    await p.screenshot({ path: path.join(SHOT_DIR, name) });
  }
  async function setTheme(p, scheme) {
    await p.evaluate((v) => {
      localStorage.setItem('warikan-theme', v);
      document.documentElement.setAttribute('data-theme', v);
    }, scheme);
    await sleep(80);
  }
  async function goMonthNov(p) {
    await p.evaluate(() => {
      for (let i = 0; i < 6; i++) {
        const mon = document.querySelector('.mmon');
        const t = mon ? mon.textContent : '';
        if (/11/.test(t)) return;
        const prev = document.querySelector('[data-act=prev-m]');
        if (prev && !prev.disabled) prev.click();
      }
    });
    await sleep(150);
  }
  const inspect = () => {
    const hex = (c) => {
      const m = String(c || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return String(c || '').replace(/\s/g, '').toUpperCase();
      return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
    };
    const tsuke = document.querySelector('[data-card=tsuke]');
    const who = tsuke && (tsuke.querySelector('.tsuke-who-full') || tsuke.querySelector('.tsuke-who'));
    const amt = tsuke && tsuke.querySelector('.tsuke-amt');
    const main = tsuke && tsuke.querySelector('.tsuke-main');
    const repayBtn = tsuke && tsuke.querySelector('[data-act=repay]');
    const whoCS = who && getComputedStyle(who);
    const wr = who && who.getBoundingClientRect();
    const ar = amt && amt.getBoundingClientRect();
    const ellipsized = !!(who && whoCS.textOverflow === 'ellipsis' && who.scrollWidth > who.clientWidth + 1);
    const tabOn = document.querySelector('.tabs button.on');
    const ratio = document.getElementById('ratioRead');
    const names = Array.from(document.querySelectorAll('.names input')).map((el) => ({ id: el.dataset.id, aria: el.getAttribute('aria-label'), value: el.value }));
    const css = getComputedStyle(document.documentElement);
    return {
      meAttr: document.documentElement.getAttribute('data-me'),
      pri: css.getPropertyValue('--pri').trim().toUpperCase(),
      tabColor: tabOn ? hex(getComputedStyle(tabOn).color) : null,
      tsukeText: tsuke ? tsuke.innerText.replace(/\s+/g, ' ').trim() : '',
      tsukeWho: who ? who.textContent.trim() : '',
      tsukeColor: who ? hex(getComputedStyle(who).color) : null,
      tsukeBg: tsuke ? hex(getComputedStyle(tsuke).backgroundColor) : null,
      tsukeAmt: amt ? amt.textContent.trim() : '',
      tsukeRecv: !!(tsuke && tsuke.classList.contains('recv')),
      stacked: !!(main && main.classList.contains('stack')),
      repayLabel: repayBtn ? repayBtn.textContent.trim() : '',
      whoLines: who ? who.getClientRects().length : 0,
      whoEllipsis: ellipsized,
      whoFits: !!(who && who.scrollWidth <= who.clientWidth + 1),
      amtBelow: !!(wr && ar && wr.bottom <= ar.top + 2 && ar.left <= wr.left + 8),
      amtRight: !!(wr && ar && ar.left >= wr.right - 4 && wr.top < ar.bottom && ar.top < wr.bottom),
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      ratio: ratio ? ratio.textContent.trim() : '',
      names,
      body: document.body.innerText,
      syncMe: window.WarikanSync && WarikanSync.me && WarikanSync.me(),
      active: !!(window.WarikanSync && WarikanSync.isActive && WarikanSync.isActive()),
      session: (() => { try { return JSON.parse(localStorage.getItem('warikan-sync-v1') || 'null'); } catch (e) { return null; } })(),
    };
  };

  // ----- 共有オフはこれまでどおり -----
  const off = await page();
  await off.goto(URL, { waitUntil: 'domcontentloaded' });
  await off.evaluate(() => localStorage.clear());
  await off.reload({ waitUntil: 'domcontentloaded' });
  await off.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    S.setPersonName(s, 'yamada', 'たろう');
    S.setPersonName(s, 'kanojo', 'はなこ');
    S.setOpening(s, 'yamada', 250000);
    S.ensureMonth(s, '2026-11');
  });
  await off.reload({ waitUntil: 'domcontentloaded' });
  await sleep(300);
  await tap(off, '[data-tab=home]');
  await sleep(200);
  const offHome = await off.evaluate(inspect);
  ck('共有オフの残りの支払い: たろう → はなこ（一人称にしない）',
    /残りの支払い/.test(offHome.tsukeText) && /たろう → はなこ/.test(offHome.tsukeText) && /¥250,000/.test(offHome.tsukeText) && !/に払う|から受け取る/.test(offHome.tsukeText),
    offHome.tsukeText);
  ck('共有オフの残りカードはアンバーのまま',
    offHome.tsukeBg === '#FFF8E8' && offHome.tsukeColor === '#A16207' && !offHome.tsukeRecv,
    JSON.stringify({ bg: offHome.tsukeBg, color: offHome.tsukeColor, recv: offHome.tsukeRecv }));
  ck('共有オフに data-me は付かず、アクセントは緑 #0F766E',
    !offHome.meAttr && offHome.pri === '#0F766E' && offHome.tabColor === '#0F766E' && offHome.syncMe == null,
    JSON.stringify({ meAttr: offHome.meAttr, pri: offHome.pri, tab: offHome.tabColor, syncMe: offHome.syncMe }));
  ck('共有オフの一覧に「自分」は出ない',
    !/自分/.test(offHome.body), offHome.body.includes('自分') ? 'found' : '');
  ck('共有オフの残りはこれまでどおり横並びで「支払った」',
    !offHome.stacked && offHome.amtRight && !offHome.amtBelow && offHome.repayLabel === '支払った' && !/受け取った/.test(offHome.tsukeText),
    JSON.stringify({ stacked: offHome.stacked, amtRight: offHome.amtRight, amtBelow: offHome.amtBelow, repay: offHome.repayLabel }));

  const payNames = (page) => page.evaluate(() => [...document.querySelectorAll('.prow .name')].map((el) => el.textContent.trim()));
  const offPays = await payNames(off);
  ck('共有オフの支払いはひとりめが払う項目が先（電気・ガス・水道・ネット、その後家賃・買い物）',
    offPays.join(',') === '電気,ガス,水道,ネット,家賃,買い物',
    JSON.stringify(offPays));
  const offHeads = await off.evaluate(() => [...document.querySelectorAll('.phead')].map((el) => el.textContent.trim()));
  ck('共有オフの見出しは設定の名前（たろう／はなこ）',
    offHeads.length === 2 && /^たろうが払う ¥/.test(offHeads[0] || '') && /^はなこが払う ¥/.test(offHeads[1] || ''),
    JSON.stringify(offHeads));
  await tap(off, '[data-act=fill-missing]');
  try { await off.waitForFunction(() => document.getElementById('dlg') && document.getElementById('dlg').open, { timeout: 5000 }); } catch (e) {}
  const offFill = await off.evaluate(() => {
    const d = document.getElementById('dlg');
    const b = d && d.querySelector('.fill-meta b');
    return { open: !!(d && d.open), name: b && b.textContent.trim() };
  });
  ck('共有オフの未入力もひとりめの項目が先（電気）', offFill.open && offFill.name === '電気', JSON.stringify(offFill));
  await tap(off, '[data-act=close]');
  await sleep(200);

  await off.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    const rent = s.payments.find((x) => x.month === '2026-11' && x.itemId === 'item-yachin');
    if (rent) S.updatePayment(s, rent.id, { payerId: 'yamada' });
  });
  await off.reload({ waitUntil: 'domcontentloaded' });
  await sleep(300);
  await tap(off, '[data-tab=home]');
  await sleep(200);
  const offMoved = await payNames(off);
  ck('共有オフで払う人を変えると、その項目は自分のグループへ（もとの相対順のまま）',
    offMoved.join(',') === '家賃,電気,ガス,水道,ネット,買い物',
    JSON.stringify(offMoved));
  const offStored = await off.evaluate(() => {
    const s = WarikanStore.load();
    return (s.items || []).map((it) => it.name);
  });
  ck('保存されている項目の順は変えない',
    offStored.join(',') === '家賃,買い物,電気,ガス,水道,ネット',
    JSON.stringify(offStored));

  await tap(off, '[data-tab=set]');
  await sleep(200);
  const offSet = await off.evaluate(inspect);
  ck('共有オフの名前は左がたろう（ひとりめ）、割合もたろうが左',
    offSet.names[0] && offSet.names[0].id === 'yamada' && offSet.names[0].aria === 'ひとりめ' &&
    offSet.names[1] && offSet.names[1].id === 'kanojo' && /たろう 50 : 50 はなこ/.test(offSet.ratio),
    JSON.stringify({ names: offSet.names, ratio: offSet.ratio }));
  const offSetItems = await off.evaluate(() => [...document.querySelectorAll('.item .l b')].map((el) => el.textContent.trim()));
  ck('設定の項目一覧の順はそのまま（家賃が先頭）',
    offSetItems.slice(0, 6).join(',') === '家賃,買い物,電気,ガス,水道,ネット',
    JSON.stringify(offSetItems));

  // ----- 2端末で共有 -----
  const host = await page();
  const join = await page();
  await host.goto(URL, { waitUntil: 'domcontentloaded' });
  await join.goto(URL, { waitUntil: 'domcontentloaded' });
  await host.evaluate(() => localStorage.clear());
  await join.evaluate(() => localStorage.clear());
  await host.reload({ waitUntil: 'domcontentloaded' });
  await join.reload({ waitUntil: 'domcontentloaded' });

  await host.evaluate(() => {
    const S = WarikanStore;
    const s = S.load();
    S.setPersonName(s, 'yamada', 'たろう');
    S.setPersonName(s, 'kanojo', 'はなこ');
    S.ensureMonth(s, '2026-11');
    s.payments.filter((p) => p.month === '2026-11').forEach((p) => {
      S.updatePayment(s, p.id, { amount: p.itemId === 'item-yachin' ? 76000 : 0 });
    });
  });
  await host.reload({ waitUntil: 'domcontentloaded' });

  await tap(host, '[data-tab=set]');
  await sleep(200);
  await tap(host, '[data-act=share-start]');
  await host.waitForFunction(() => !!(window.WarikanSync && WarikanSync.isActive()), { timeout: 15000 });
  await sleep(400);
  const started = await host.evaluate(() => ({
    me: WarikanSync.me(),
    session: JSON.parse(localStorage.getItem('warikan-sync-v1') || 'null'),
    url: WarikanSync.inviteUrl(),
  }));
  ck('ホストの me は yamada でセッションに保存される',
    started.me === 'yamada' && started.session && started.session.me === 'yamada',
    JSON.stringify(started));

  const joinUrl = URL + started.url.slice(started.url.indexOf('#'));
  await join.goto(joinUrl, { waitUntil: 'domcontentloaded' });
  try {
    await join.waitForFunction(() => document.getElementById('dlg') && document.getElementById('dlg').open, { timeout: 15000 });
  } catch (e) {}
  await tap(join, '[data-act=share-join-ok]');
  await join.waitForFunction(() => !!(window.WarikanSync && WarikanSync.isActive()), { timeout: 15000 });
  await sleep(500);
  const joinedMe = await join.evaluate(() => ({
    me: WarikanSync.me(),
    session: JSON.parse(localStorage.getItem('warikan-sync-v1') || 'null'),
    members: WarikanSync.status().memberCount,
  }));
  ck('参加側の me は kanojo でセッションに保存される',
    joinedMe.me === 'kanojo' && joinedMe.session && joinedMe.session.me === 'kanojo' && joinedMe.members === 2,
    JSON.stringify(joinedMe));

  await host.evaluate(() => {
    const S = WarikanStore;
    const L = WarikanLogic;
    const s = S.load();
    S.ensureMonth(s, '2026-11');
    s.payments.filter((p) => p.month === '2026-11').forEach((p) => {
      S.updatePayment(s, p.id, { amount: p.itemId === 'item-yachin' ? 76000 : 0 });
    });
    const pays = s.payments.filter((p) => p.month === '2026-11');
    const r = L.computeSettle(pays, s.ratioYamada);
    S.settleMonth(s, '2026-11', Object.assign({}, r, { ratioYamada: s.ratioYamada, choice: 'settled', paid: 0, carried: r.amount }));
    if (WarikanSync.flush) WarikanSync.flush();
  });
  await join.waitForFunction(() => {
    return WarikanStore.load().settlements && WarikanStore.load().settlements['2026-11'] &&
      WarikanStore.load().settlements['2026-11'].snapshot &&
      WarikanStore.load().settlements['2026-11'].snapshot.choice === 'settled';
  }, { timeout: 15000 });
  await host.reload({ waitUntil: 'domcontentloaded' });
  await join.reload({ waitUntil: 'domcontentloaded' });
  await host.waitForFunction(() => !!(window.WarikanSync && WarikanSync.isActive() && WarikanSync.me()), { timeout: 15000 });
  await join.waitForFunction(() => !!(window.WarikanSync && WarikanSync.isActive() && WarikanSync.me()), { timeout: 15000 });
  await sleep(500);

  async function checkPhone(p, role) {
    await setTheme(p, 'light');
    await tap(p, '[data-tab=home]');
    await sleep(250);
    const home = await p.evaluate(inspect);
    if (role === 'host') {
      ck('ホストの残り: はなこに払う ¥38,000（アンバー）',
        /はなこに払う/.test(home.tsukeWho + home.tsukeText) && /¥38,000/.test(home.tsukeText) &&
        home.tsukeColor === '#A16207' && home.tsukeBg === '#FFF8E8' && !home.tsukeRecv &&
        !/たろう →|はなこ →|から受け取る/.test(home.tsukeText),
        JSON.stringify({ who: home.tsukeWho, text: home.tsukeText, color: home.tsukeColor, bg: home.tsukeBg, recv: home.tsukeRecv }));
      ck('ホストのアクセントは緑（person 1）',
        home.meAttr === 'yamada' && home.pri === '#0F766E' && home.tabColor === '#0F766E' && home.syncMe === 'yamada',
        JSON.stringify({ meAttr: home.meAttr, pri: home.pri, tab: home.tabColor, me: home.syncMe }));
    } else {
      ck('参加側の残り: たろうから受け取る ¥38,000（グリーン）',
        /たろうから受け取る/.test(home.tsukeWho + home.tsukeText) && /¥38,000/.test(home.tsukeText) &&
        home.tsukeColor === '#0F766E' && home.tsukeBg === '#F0FDFA' && home.tsukeRecv &&
        !/に払う|→/.test(home.tsukeText),
        JSON.stringify({ who: home.tsukeWho, text: home.tsukeText, color: home.tsukeColor, bg: home.tsukeBg, recv: home.tsukeRecv }));
      ck('参加側のアクセントはコーラル #C2473A',
        home.meAttr === 'kanojo' && home.pri === '#C2473A' && home.tabColor === '#C2473A' && home.syncMe === 'kanojo',
        JSON.stringify({ meAttr: home.meAttr, pri: home.pri, tab: home.tabColor, me: home.syncMe }));
    }
    async function checkStack(width) {
      await p.setViewport({ width, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await tap(p, '[data-tab=home]');
      await sleep(200);
      const lay = await p.evaluate(inspect);
      ck(role + 'の残りは ' + width + 'px で上に文言・下に金額、省略しない',
        lay.stacked && lay.amtBelow && !lay.amtRight && lay.whoLines === 1 && !lay.whoEllipsis && lay.whoFits && !lay.pageOverflow &&
        (role === 'host' ? lay.tsukeWho === 'はなこに払う' : lay.tsukeWho === 'たろうから受け取る') &&
        lay.tsukeAmt === '¥38,000',
        JSON.stringify({ width, who: lay.tsukeWho, amt: lay.tsukeAmt, stacked: lay.stacked, below: lay.amtBelow, right: lay.amtRight, lines: lay.whoLines, ellipsis: lay.whoEllipsis, fits: lay.whoFits, overflow: lay.pageOverflow }));
    }
    await checkStack(375);
    await checkStack(320);
    await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await sleep(150);
    const repayHome = await p.evaluate(inspect);
    if (role === 'host') {
      ck('ホストのボタンは「支払った」', repayHome.repayLabel === '支払った', repayHome.repayLabel);
    } else {
      ck('参加側のボタンは「受け取った」', repayHome.repayLabel === '受け取った', repayHome.repayLabel);
    }
    await tap(p, '[data-act=repay]');
    try { await p.waitForFunction(() => document.getElementById('dlg') && document.getElementById('dlg').open, { timeout: 5000 }); } catch (e) {}
    const sheet = await p.evaluate(() => {
      const d = document.getElementById('dlg');
      const line = d && d.querySelector('.remain-line');
      const yen = d && d.querySelector('.remain-yen');
      const nr = line && line.getBoundingClientRect();
      const yr = yen && yen.getBoundingClientRect();
      return {
        open: d && d.open,
        title: d && d.querySelector('h2') && d.querySelector('h2').textContent.trim(),
        label: d && d.querySelector('label[for=repayAmt]') && d.querySelector('label[for=repayAmt]').textContent.trim(),
        submit: d && d.querySelector('button[type=submit]') && d.querySelector('button[type=submit]').textContent.trim(),
        line: line && line.textContent.trim(),
        yen: yen && yen.textContent.trim(),
        stacked: !!(nr && yr && nr.bottom <= yr.top + 2),
      };
    });
    if (role === 'host') {
      ck('ホストの確認シートは「支払った」で文言が上・金額が下',
        sheet.open && sheet.title === '支払った' && sheet.label === '支払った金額' && sheet.submit === '支払った' &&
        sheet.line === 'はなこに払う' && sheet.yen === '¥38,000' && sheet.stacked,
        JSON.stringify(sheet));
    } else {
      ck('参加側の確認シートは「受け取った」で文言が上・金額が下',
        sheet.open && sheet.title === '受け取った' && sheet.label === '受け取った金額' && sheet.submit === '受け取った' &&
        sheet.line === 'たろうから受け取る' && sheet.yen === '¥38,000' && sheet.stacked,
        JSON.stringify(sheet));
    }
    await tap(p, '[data-act=close]');
    await sleep(200);

    // 支払いの who: 家賃ははなこ払い。ホストは「はなこ」、参加側は「自分」
    const whoPay = await p.evaluate(() => {
      const texts = Array.from(document.querySelectorAll('.who')).map((el) => el.textContent.replace(/\s+/g, ' ').trim());
      return texts;
    });
    if (role === 'host') {
      ck('ホストの支払い行に「はなこ」があり、自分の名前は「自分」',
        whoPay.some((t) => /はなこ/.test(t)) && !whoPay.some((t) => /たろう/.test(t)),
        JSON.stringify(whoPay));
    } else {
      ck('参加側の支払い行は「自分」（はなこの代わり）',
        whoPay.some((t) => /自分/.test(t)) && !whoPay.some((t) => /はなこ/.test(t)),
        JSON.stringify(whoPay));
    }

    const names = await p.evaluate(() => [...document.querySelectorAll('.prow .name')].map((el) => el.textContent.trim()));
    const heads = await p.evaluate(() => [...document.querySelectorAll('.phead')].map((el) => el.textContent.trim()));
    if (role === 'host') {
      ck('ホストの支払いは自分が払う項目が先（電気・ガス・水道・ネット、その後家賃・買い物）',
        names.join(',') === '電気,ガス,水道,ネット,家賃,買い物',
        JSON.stringify(names));
      ck('ホストの見出しは自分が払う／はなこが払う',
        heads.length === 2 && /^自分が払う ¥/.test(heads[0] || '') && /^はなこが払う ¥/.test(heads[1] || ''),
        JSON.stringify(heads));
    } else {
      ck('参加側の支払いは自分が払う項目が先（家賃・買い物、その後電気・ガス・水道・ネット）',
        names.join(',') === '家賃,買い物,電気,ガス,水道,ネット',
        JSON.stringify(names));
      ck('参加側の見出しは自分が払う／たろうが払う',
        heads.length === 2 && /^自分が払う ¥/.test(heads[0] || '') && /^たろうが払う ¥/.test(heads[1] || ''),
        JSON.stringify(heads));
    }
    const fillBtn = await p.evaluate(() => !!document.querySelector('[data-act=fill-missing]'));
    if (fillBtn) {
      await tap(p, '[data-act=fill-missing]');
      try { await p.waitForFunction(() => document.getElementById('dlg') && document.getElementById('dlg').open, { timeout: 5000 }); } catch (e) {}
      const fill = await p.evaluate(() => {
        const d = document.getElementById('dlg');
        const b = d && d.querySelector('.fill-meta b');
        return { open: !!(d && d.open), name: b && b.textContent.trim() };
      });
      const expect = role === 'host' ? '電気' : '買い物';
      ck(role + 'の未入力も自分が払う項目が先（' + expect + '）',
        fill.open && fill.name === expect, JSON.stringify(fill));
      await tap(p, '[data-act=close]');
      await sleep(200);
    }

    await tap(p, '[data-tab=set]');
    await sleep(200);
    const setv = await p.evaluate(inspect);
    if (role === 'host') {
      ck('ホストの並びは自分が左（自分 / はなこ）',
        setv.names[0] && setv.names[0].id === 'yamada' && setv.names[0].value === 'たろう' &&
        /^自分 50 : 50 はなこ$/.test(setv.ratio),
        JSON.stringify({ names: setv.names, ratio: setv.ratio }));
    } else {
      ck('参加側の並びは自分が左（はなこ / たろう）、スライダーも反転',
        setv.names[0] && setv.names[0].id === 'kanojo' && setv.names[0].value === 'はなこ' &&
        setv.names[1] && setv.names[1].id === 'yamada' &&
        /^自分 50 : 50 たろう$/.test(setv.ratio),
        JSON.stringify({ names: setv.names, ratio: setv.ratio }));
    }

    await tap(p, '[data-tab=home]');
    await sleep(200);
    await goMonthNov(p);
    const settle = await p.evaluate(() => {
      const text = (document.querySelector('.card.settle, [data-card=settle], main') || document.body).innerText;
      return { text, amt: document.getElementById('settleAmt') && document.getElementById('settleAmt').textContent };
    });
    if (role === 'host') {
      ck('ホストの精算は「自分」が渡し側（たろうとは書かない）',
        /自分/.test(settle.text) && !/たろう/.test(settle.text) && /はなこ/.test(settle.text),
        settle.text.replace(/\s+/g, ' ').slice(0, 240));
    } else {
      ck('参加側の精算は「自分」（はなことは書かない）',
        /自分/.test(settle.text) && !/はなこ/.test(settle.text) && /たろう/.test(settle.text),
        settle.text.replace(/\s+/g, ' ').slice(0, 240));
    }

    // 再読込しても me が残る
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !!(window.WarikanSync && WarikanSync.me() && document.documentElement.getAttribute('data-me') === WarikanSync.me()), { timeout: 15000 });
    const afterReload = await p.evaluate(() => ({ me: WarikanSync.me(), attr: document.documentElement.getAttribute('data-me') }));
    ck(role + 'は再読込後も me が残る',
      afterReload.me === (role === 'host' ? 'yamada' : 'kanojo') && afterReload.attr === afterReload.me,
      JSON.stringify(afterReload));
  }

  await checkPhone(host, 'host');
  await checkPhone(join, 'join');

  // ダークのアクセントと受け取り色
  await setTheme(join, 'dark');
  await tap(join, '[data-tab=home]');
  await sleep(200);
  const joinDark = await join.evaluate(inspect);
  ck('参加側ダークのアクセントは #FB8A7E、受け取りは緑',
    joinDark.pri === '#FB8A7E' && joinDark.tabColor === '#FB8A7E' &&
    joinDark.tsukeColor === '#2DD4BF' && joinDark.tsukeBg === '#134E4A' && joinDark.tsukeRecv,
    JSON.stringify({ pri: joinDark.pri, tab: joinDark.tabColor, color: joinDark.tsukeColor, bg: joinDark.tsukeBg }));
  await setTheme(host, 'dark');
  await tap(host, '[data-tab=home]');
  await sleep(200);
  const hostDark = await host.evaluate(inspect);
  ck('ホストダークのアクセントは緑 #2DD4BF、払う側はアンバー',
    hostDark.pri === '#2DD4BF' && hostDark.tabColor === '#2DD4BF' &&
    hostDark.tsukeColor === '#FBBF24' && hostDark.tsukeBg === '#3A2F1C' && !hostDark.tsukeRecv,
    JSON.stringify({ pri: hostDark.pri, tab: hostDark.tabColor, color: hostDark.tsukeColor, bg: hostDark.tsukeBg }));

  async function shotTsuke(p, name, width, scheme) {
    await p.setViewport({ width, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await setTheme(p, scheme);
    await tap(p, '[data-tab=home]');
    await sleep(200);
    await p.evaluate(() => {
      const el = document.querySelector('[data-card=tsuke]');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await sleep(120);
    await shot(p, name);
  }
  await shotTsuke(host, 'host-home-375-light.png', 375, 'light');
  await shotTsuke(join, 'join-home-375-light.png', 375, 'light');
  await shotTsuke(join, 'join-home-375-dark.png', 375, 'dark');
  await shotTsuke(join, 'join-home-320-light.png', 320, 'light');
  await join.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await setTheme(join, 'light');

  // トーストはスクショのあと（残高を変える）
  await tap(join, '[data-act=repay]');
  try { await join.waitForFunction(() => document.getElementById('dlg') && document.getElementById('dlg').open, { timeout: 5000 }); } catch (e) {}
  await join.evaluate(() => { const i = document.getElementById('repayAmt'); if (i) i.value = '1,000'; });
  await tap(join, '#repayForm button[type=submit]');
  await sleep(300);
  const toast = await join.evaluate(() => {
    const t = document.getElementById('toast');
    return t && t.textContent;
  });
  ck('参加側のトーストは「受け取りました」',
    toast && /¥1,000 を受け取りました/.test(toast), toast);

  ck('ページエラーなし（共有オフ）', off._errs.length === 0, off._errs.join(' | '));
  ck('ページエラーなし（ホスト）', host._errs.length === 0, host._errs.join(' | '));
  ck('ページエラーなし（参加側）', join._errs.length === 0, join._errs.join(' | '));

  await b.close();
  if (R.fails) { console.log('FAILED ' + R.fails); process.exit(1); }
  console.log('e2e-v190 ok');
})().catch((e) => { console.error(e); process.exit(1); });
