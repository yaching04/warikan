const assert = require('assert');

const store = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};
global.window = global;

const S = require('../store.js');
const Sync = require('../sync.js');

function makeState(patch) {
  const s = S.normalize(S.defaultState());
  s.people.yamada.name = 'たろう';
  s.people.kanojo.name = 'はなこ';
  if (patch) Object.assign(s, patch);
  return s;
}

function client(db, state, extraHooks) {
  const box = { state: state || makeState(), notices: [], conflicts: [] };
  const backend = new Sync.MemoryBackend(db);
  const c = Sync.createClient({
    backend,
    ephemeral: true,
    hooks: Object.assign({
      getState: () => box.state,
      replaceState: (next) => { box.state = S.normalize(next); },
      onStatus: () => {},
      onRemoteNotice: (ev) => { box.notices = box.notices.concat(ev || []); },
      onPaymentConflict: (ev) => { box.conflicts.push(ev); },
    }, extraHooks || {}),
  });
  box.sync = c;
  return box;
}

let fails = 0;
function t(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    console.log('ok - ' + name);
  }).catch((e) => {
    fails++;
    console.log('FAIL - ' + name);
    console.log(e && e.stack || e);
  });
}

(async () => {
  await t('parseJoinHash: hid.token を読む。点や不正は拒否。クエリ付きURLも読む', () => {
    assert.deepStrictEqual(Sync.parseJoinHash('#join=abc123.def456'), { hid: 'abc123', token: 'def456' });
    assert.deepStrictEqual(
      Sync.parseJoinHash('https://yaching04.github.io/warikan/?openExternalBrowser=1#join=abc123.def456'),
      { hid: 'abc123', token: 'def456' }
    );
    assert.strictEqual(Sync.parseJoinHash('#join=abc.def.ghi'), null);
    assert.strictEqual(Sync.parseJoinHash('#tsuke'), null);
    assert.strictEqual(Sync.parseJoinHash(''), null);
  });

  await t('parseJoinInput: URL でも hid.token でも、前後の文言や空白があっても読む', () => {
    const hid = 'hidhidhidhidhidh';
    const tok = 'tokentokentokento';
    const url = 'https://yaching04.github.io/warikan/?openExternalBrowser=1#join=' + hid + '.' + tok;
    assert.deepStrictEqual(Sync.parseJoinInput(url), { hid: hid, token: tok });
    assert.deepStrictEqual(Sync.parseJoinInput('  ' + hid + '.' + tok + '  '), { hid: hid, token: tok });
    assert.deepStrictEqual(Sync.parseJoinInput('これ ' + url + ' よろしく'), { hid: hid, token: tok });
    assert.deepStrictEqual(Sync.parseJoinInput('コードは ' + hid + '.' + tok + ' だよ'), { hid: hid, token: tok });
    assert.deepStrictEqual(Sync.parseJoinInput('#join=' + hid + '.' + tok), { hid: hid, token: tok });
    assert.strictEqual(Sync.parseJoinInput('https://yaching04.github.io/warikan/'), null);
    assert.strictEqual(Sync.parseJoinInput('これはリンクじゃない'), null);
    assert.strictEqual(Sync.parseJoinInput(''), null);
  });

  await t('setMe: 端末の warikan-me を優先し、共有のメンバーは変えない', async () => {
    localStorage.removeItem('warikan-me');
    const db = Sync.createMemoryDb();
    const a = client(db, makeState());
    await a.sync.startShare();
    assert.strictEqual(a.sync.me(), 'yamada');
    assert.strictEqual(Sync.setMe('kanojo'), 'kanojo');
    assert.strictEqual(localStorage.getItem('warikan-me'), 'kanojo');
    assert.strictEqual(a.sync.me(), 'kanojo');
    assert.strictEqual(a.sync.status().hostPersonId, 'yamada');
    localStorage.removeItem('warikan-me');
    assert.strictEqual(a.sync.me(), 'yamada');
  });

  await t('isInAppBrowser: LINE / Instagram / Facebook を見分け、Safari は対象外', () => {
    const line = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 Line/15.0.2';
    const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
    const ig = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 192.168.1.2.111';
    const fb = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/10.0.0]';
    assert.strictEqual(Sync.isInAppBrowser(line), 'line');
    assert.strictEqual(Sync.isInAppBrowser(safari), null);
    assert.strictEqual(Sync.isInAppBrowser(ig), 'instagram');
    assert.strictEqual(Sync.isInAppBrowser(fb), 'facebook');
  });

  await t('共有オフなら notifyLocal は何もしない', () => {
    const c = Sync.createClient({ ephemeral: true });
    assert.strictEqual(c.isActive(), false);
    c.notifyLocal(makeState());
  });

  const db = Sync.createMemoryDb();
  const a = client(db);
  await t('共有を始めるとアップロードされ、相手の参加待ちになる', async () => {
    a.state.payments = [{ id: 'p1', month: '2026-11', itemId: 'item-yachin', itemName: '家賃', payerId: 'kanojo', amount: 60000, extra: false, updatedAt: 1 }];
    await a.sync.startShare();
    assert.strictEqual(a.sync.isActive(), true);
    assert.strictEqual(a.sync.me(), 'yamada');
    const st = a.sync.status();
    assert.strictEqual(st.me, 'yamada');
    assert.strictEqual(st.memberCount, 1);
    assert.strictEqual(st.waitingName, 'はなこ');
    assert.ok(st.hid && st.token);
    assert.ok(a.sync.inviteUrl().startsWith('https://yaching04.github.io/warikan/?openExternalBrowser=1#join='));
  });

  const invite = Sync.parseJoinHash('#' + a.sync.inviteUrl().split('#')[1]);
  const b = client(db, makeState({ payments: [{ id: 'local-only', month: '2026-01', itemId: 'item-net', itemName: '旧', payerId: 'yamada', amount: 1, extra: false }] }));

  await t('招待を読むとホストの名前が取れる', async () => {
    const inv = await b.sync.peekInvite(invite.hid, invite.token);
    assert.strictEqual(inv.hostName, 'たろう');
  });

  await t('間違った token では参加できない', async () => {
    let err = null;
    try { await b.sync.join(invite.hid, 'deadbeefdeadbeefdeadbeefdeadbeef'); }
    catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(b.sync.isActive(), false);
    assert.strictEqual(b.state.payments[0].id, 'local-only');
  });

  await t('参加すると相手のデータに置き換わり、共有中（ふたり）になる', async () => {
    await b.sync.join(invite.hid, invite.token);
    assert.strictEqual(b.sync.isActive(), true);
    assert.strictEqual(b.sync.me(), 'kanojo');
    assert.strictEqual(b.sync.status().me, 'kanojo');
    assert.strictEqual(b.sync.status().memberCount, 2);
    assert.strictEqual(a.sync.me(), 'yamada');
    assert.ok(b.state.payments.some((p) => p.id === 'p1' && p.amount === 60000));
    assert.ok(!b.state.payments.some((p) => p.id === 'local-only'));
    assert.strictEqual(a.sync.status().memberCount, 2);
  });

  await t('別の支払いを同時に直しても片方は消えない', async () => {
    a.state.payments.push({ id: 'pa', month: '2026-11', itemId: 'item-denki', itemName: '電気', payerId: 'yamada', amount: 4000, extra: false, updatedAt: 2 });
    b.state.payments.push({ id: 'pb', month: '2026-11', itemId: 'item-gas', itemName: 'ガス', payerId: 'yamada', amount: 3000, extra: false, updatedAt: 2 });
    a.sync.notifyLocal(a.state);
    b.sync.notifyLocal(b.state);
    await a.sync.flush();
    await b.sync.flush();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(a.state.payments.some((p) => p.id === 'pa'));
    assert.ok(a.state.payments.some((p) => p.id === 'pb'), JSON.stringify(a.state.payments.map((p) => p.id)));
    assert.ok(b.state.payments.some((p) => p.id === 'pa'));
    assert.ok(b.state.payments.some((p) => p.id === 'pb'));
    assert.ok(a.state.payments.some((p) => p.id === 'p1'));
  });

  await t('精算は transaction で二重にならず、台帳の残りが2件にならない', async () => {
    const month = '2026-11';
    const snap = { from: 'yamada', to: 'kanojo', amount: 38000, choice: 'settled', paid: 0, carried: 38000 };
    S.settleMonth(a.state, month, snap);
    a.sync.notifyLocal(a.state);
    S.settleMonth(b.state, month, snap);
    b.sync.notifyLocal(b.state);
    await a.sync.flush();
    await b.sync.flush();
    await new Promise((r) => setTimeout(r, 20));
    const carries = (a.state.ledger || []).filter((e) => e.kind === 'carry' && e.month === month);
    const carriesB = (b.state.ledger || []).filter((e) => e.kind === 'carry' && e.month === month);
    assert.strictEqual(carries.length, 1, JSON.stringify(carries));
    assert.strictEqual(carriesB.length, 1, JSON.stringify(carriesB));
    assert.ok(S.isSettled(a.state, month));
    assert.ok(S.isSettled(b.state, month));
  });

  await t('3人目は参加できない', async () => {
    const c = client(db);
    let err = null;
    try { await c.sync.join(invite.hid, invite.token); }
    catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(c.sync.isActive(), false);
  });

  await t('共有をやめるとこの端末だけ外れ、データは残る', async () => {
    const ids = b.state.payments.map((p) => p.id).sort();
    await b.sync.leave();
    assert.strictEqual(b.sync.isActive(), false);
    assert.strictEqual(b.sync.me(), 'kanojo');
    assert.strictEqual(b.sync.status().canReconnect, true);
    assert.strictEqual(b.sync.status().left, true);
    assert.deepStrictEqual(b.state.payments.map((p) => p.id).sort(), ids);
    assert.strictEqual(a.sync.isActive(), true);
  });

  await t('もう一度つなぐと同じ世帯に戻り、切断中のローカルは共有データで置き換わる', async () => {
    b.state.payments.push({ id: 'local-while-left', month: '2026-02', itemId: 'item-net', itemName: '切断中', payerId: 'kanojo', amount: 9, extra: true, updatedAt: 9 });
    a.state.payments.push({ id: 'cloud-while-left', month: '2026-11', itemId: 'item-sui', itemName: '水道', payerId: 'yamada', amount: 2000, extra: false, updatedAt: Date.now(), updatedBy: 'yamada' });
    a.sync.notifyLocal(a.state);
    await a.sync.flush();
    const res = await b.sync.reconnect();
    assert.strictEqual(res && res.ok, true, JSON.stringify(res));
    assert.strictEqual(b.sync.isActive(), true);
    assert.strictEqual(b.sync.me(), 'kanojo');
    assert.ok(b.state.payments.some((p) => p.id === 'cloud-while-left'));
    assert.ok(!b.state.payments.some((p) => p.id === 'local-while-left'));
  });

  await t('相手の変更は通知され、自分の書き込みと初回は通知しない', async () => {
    b.notices = [];
    a.notices = [];
    const denki = a.state.payments.find((p) => p.id === 'pa') || a.state.payments.find((p) => p.itemName === '電気');
    assert.ok(denki, 'denki exists');
    denki.amount = 4100;
    denki.updatedAt = Date.now();
    denki.updatedBy = 'yamada';
    a.sync.notifyLocal(a.state);
    await a.sync.flush();
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(a.notices.length === 0, JSON.stringify(a.notices));
    assert.ok(b.notices.some((e) => e.kind === 'pay-edit' || e.kind === 'pay-input'), JSON.stringify(b.notices));
    assert.ok(b.notices.every((e) => e.writer === 'yamada'), JSON.stringify(b.notices));
  });

  await t('同じ支払いの updatedAt が変わっていたら conflict になる', async () => {
    const pay = a.state.payments.find((p) => p.id === 'pb') || a.state.payments.find((p) => p.itemName === 'ガス');
    assert.ok(pay);
    const stale = pay.updatedAt;
    const fromB = Object.assign({}, pay, { amount: 9999, updatedAt: Date.now() + 10, updatedBy: 'kanojo' });
    const okB = await b.sync.commitPayment(stale, fromB);
    assert.ok(okB && okB.ok, JSON.stringify(okB));
    await new Promise((r) => setTimeout(r, 20));
    const res = await a.sync.commitPayment(stale, Object.assign({}, pay, { amount: 111, updatedAt: Date.now() + 20, updatedBy: 'yamada' }));
    assert.strictEqual(res && res.ok, false, JSON.stringify(res));
    assert.ok(res && res.conflict);
    assert.strictEqual(res.remote.amount, 9999);
  });

  await t('ログインの uid が変わっていたら auth-lost になる', async () => {
    await b.sync.leave();
    assert.strictEqual(b.sync.status().canReconnect, true);
    b.sync.useBackend(new Sync.MemoryBackend(db));
    const res = await b.sync.reconnect();
    assert.strictEqual(res && res.ok, false, JSON.stringify(res));
    assert.strictEqual(res.reason, 'auth-lost');
    assert.strictEqual(b.sync.isActive(), false);
  });

  await t('me はセッションに保存され、再読込後もホストと参加側で残る', async () => {
    const db2 = Sync.createMemoryDb();
    const boxA = { state: makeState() };
    const hooksA = {
      getState: () => boxA.state,
      replaceState: (n) => { boxA.state = S.normalize(n); },
      onStatus: () => {},
    };
    const backendA = new Sync.MemoryBackend(db2);
    const host = Sync.createClient({
      backend: backendA,
      sessionKey: 'warikan-sync-v1-me-host',
      hooks: hooksA,
    });
    await host.startShare();
    assert.strictEqual(host.me(), 'yamada');
    const raw = JSON.parse(localStorage.getItem('warikan-sync-v1-me-host'));
    assert.strictEqual(raw.me, 'yamada');
    const host2 = Sync.createClient({
      backend: backendA,
      sessionKey: 'warikan-sync-v1-me-host',
      hooks: hooksA,
    });
    const resumed = await host2.resume();
    assert.strictEqual(resumed, true);
    assert.strictEqual(host2.me(), 'yamada');
    assert.strictEqual(host2.isActive(), true);

    const invite2 = Sync.parseJoinHash('#' + host2.inviteUrl().split('#')[1]);
    const boxB = { state: makeState() };
    const hooksB = {
      getState: () => boxB.state,
      replaceState: (n) => { boxB.state = S.normalize(n); },
      onStatus: () => {},
    };
    const backendB = new Sync.MemoryBackend(db2);
    const join = Sync.createClient({
      backend: backendB,
      sessionKey: 'warikan-sync-v1-me-join',
      hooks: hooksB,
    });
    await join.join(invite2.hid, invite2.token);
    assert.strictEqual(join.me(), 'kanojo');
    assert.strictEqual(JSON.parse(localStorage.getItem('warikan-sync-v1-me-join')).me, 'kanojo');
    const join2 = Sync.createClient({
      backend: backendB,
      sessionKey: 'warikan-sync-v1-me-join',
      hooks: hooksB,
    });
    await join2.resume();
    assert.strictEqual(join2.me(), 'kanojo');
    assert.strictEqual(join2.isActive(), true);
  });

  await t('v2.0.2: 参加の失敗を種類ごとに分ける', async () => {
    const db3 = Sync.createMemoryDb();
    const host = client(db3);
    await host.sync.startShare();
    const inv = host.sync.status();
    let err = null;
    try { await host.sync.join(inv.hid, inv.token); } catch (e) { err = e; }
    assert.strictEqual(Sync.classifyJoinError(err).kind, 'own');
    const bad = client(db3);
    err = null;
    try { await bad.sync.join(inv.hid, 'deadbeefdeadbeefdeadbeefdeadbeef'); } catch (e) { err = e; }
    assert.strictEqual(Sync.classifyJoinError(err).kind, 'invalid');
    /* 1回目：書き込みは通ったが画面への反映で落ちた → もう一度でちゃんと参加できる */
    let boom = true;
    const g = client(db3, null, { replaceState: (n) => { if (boom) { boom = false; throw new Error('render broke'); } g.state = S.normalize(n); } });
    err = null;
    try { await g.sync.join(inv.hid, inv.token); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.step, 'apply');
    assert.strictEqual(g.sync.isActive(), false);
    await g.sync.join(inv.hid, inv.token);
    assert.strictEqual(g.sync.isActive(), true);
    assert.strictEqual(g.sync.me(), 'kanojo');
    const third = client(db3);
    err = null;
    try { await third.sync.join(inv.hid, inv.token); } catch (e) { err = e; }
    const c = Sync.classifyJoinError(err);
    assert.strictEqual(c.kind, 'used');
    assert.strictEqual(c.code, 'invite-used');
    assert.strictEqual(Sync.classifyJoinError({ code: 'unavailable' }).kind, 'network');
    assert.strictEqual(Sync.classifyJoinError({ code: 'permission-denied', step: 'fetch' }).kind, 'permission');
    assert.strictEqual(Sync.classifyJoinError({ code: 'firestore/permission-denied' }).code, 'permission-denied');
    assert.strictEqual(Sync.memberRole({ a: { joinedAt: 1 } }, 'a'), 'host');
    assert.strictEqual(Sync.memberRole({ a: { joinedAt: 5 }, b: { joinedAt: 2 } }, 'a'), 'member');
    assert.strictEqual(Sync.memberRole({ a: { joinedAt: 1 } }, 'b'), 'none');
  });

  await t('ホストが共有をやめて新しく始めると、新しい招待で参加できる', async () => {
    const db4 = Sync.createMemoryDb();
    const host = client(db4);
    await host.sync.startShare();
    const oldInv = host.sync.status();
    const joiner = client(db4);
    await joiner.sync.join(oldInv.hid, oldInv.token);
    assert.strictEqual(joiner.sync.me(), 'kanojo');
    await host.sync.leave();
    await host.sync.startShare();
    const fresh = host.sync.status();
    assert.ok(fresh.hid && fresh.hid !== oldInv.hid);
    const next = client(db4);
    await next.sync.join(fresh.hid, fresh.token);
    assert.strictEqual(next.sync.isActive(), true);
    assert.strictEqual(next.sync.me(), 'kanojo');
    let err = null;
    const late = client(db4);
    try { await late.sync.join(oldInv.hid, oldInv.token); } catch (e) { err = e; }
    assert.strictEqual(Sync.classifyJoinError(err).kind, 'used');
  });

  if (fails) {
    console.log('FAILED ' + fails);
    process.exit(1);
  }
  console.log('sync.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
