const assert = require('assert');
const S = require('../store.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('items キーなしは初期の6項目', () => {
  const s = S.normalize({ version: 1, payments: [] });
  assert.strictEqual(s.items.length, 6);
  assert.ok(s.items.some((i) => i.name === '家賃'));
});
t('空の items 配列は初期値に戻さない', () => {
  const s = S.normalize({ version: 1, items: [], payments: [] });
  assert.deepStrictEqual(s.items, []);
});
t('items が null / 非配列のときは初期値', () => {
  assert.strictEqual(S.normalize({ items: null }).items.length, 6);
  assert.strictEqual(S.normalize({ items: { foo: 1 } }).items.length, 6);
});
t('項目が1つだけならそのまま残す', () => {
  const one = [{ id: 'x', name: '食費', kind: 'variable', defaultPayer: 'yamada', fixedAmount: null }];
  const s = S.normalize({ items: one, payments: [] });
  assert.strictEqual(s.items.length, 1);
  assert.strictEqual(s.items[0].name, '食費');
});

t('ledger キーなしの古いデータは空の台帳になる', () => {
  const s = S.normalize({ version: 1, payments: [], settlements: {} });
  assert.deepStrictEqual(s.ledger, []);
});

t('これまでの残りは1件だけ。0 で消える', () => {
  const s = S.defaultState();
  const a = S.setOpening(s, 'yamada', 250000);
  assert.strictEqual(a.kind, 'opening');
  assert.strictEqual(a.signed, 250000);
  assert.strictEqual(a.from, 'yamada');
  assert.strictEqual(s.ledger.length, 1);
  S.setOpening(s, 'kanojo', 8000);
  assert.strictEqual(s.ledger.length, 1);
  assert.strictEqual(S.getOpening(s).signed, -8000);
  S.setOpening(s, 'kanojo', 0);
  assert.strictEqual(S.getOpening(s), null);
  assert.strictEqual(s.ledger.length, 0);
});

t('精算で残した分は台帳に入り、clearMarks と支払い修正で消える', () => {
  const s = S.defaultState();
  S.settleMonth(s, '2026-11', { from: 'yamada', to: 'kanojo', amount: 38000, net: 38000, choice: 'partial', paid: 10000, carried: 28000 });
  assert.strictEqual(s.ledger.length, 1);
  assert.strictEqual(s.ledger[0].kind, 'carry');
  assert.strictEqual(s.ledger[0].month, '2026-11');
  assert.strictEqual(s.ledger[0].signed, 28000);
  assert.strictEqual(S.isSettled(s, '2026-11'), true);
  const removed = S.clearMarks(s, '2026-11');
  assert.strictEqual(removed, true);
  assert.strictEqual(s.ledger.length, 0);
  assert.strictEqual(S.isSettled(s, '2026-11'), false);

  S.settleMonth(s, '2026-11', { from: 'kanojo', to: 'yamada', amount: 12000, net: -12000, choice: 'carry', paid: 0, carried: 12000 });
  assert.strictEqual(s.ledger[0].signed, -12000);
  const mutated = S.onMonthMutated(s, '2026-11');
  assert.strictEqual(mutated, true);
  assert.strictEqual(s.ledger.length, 0);
});

t('全額払い・choice なしの古い精算は台帳に足さない', () => {
  const s = S.defaultState();
  S.settleMonth(s, '2026-10', { from: 'yamada', to: 'kanojo', amount: 38000, net: 38000 });
  assert.strictEqual(s.ledger.length, 0);
  S.settleMonth(s, '2026-11', { from: 'yamada', to: 'kanojo', amount: 38000, choice: 'full', paid: 38000, carried: 0 });
  assert.strictEqual(s.ledger.length, 0);
});

t('支払った分は残高を減らし、確認削除できる。月の分は直接消せない', () => {
  const s = S.defaultState();
  S.setOpening(s, 'yamada', 250000);
  S.addCarry(s, '2026-11', 28000, { paid: 10000, carried: 28000 });
  const r = S.addRepayment(s, -30000);
  assert.strictEqual(r.kind, 'repayment');
  assert.strictEqual(r.from, 'yamada');
  assert.strictEqual(s.ledger.length, 3);
  const carryId = s.ledger.find((e) => e.kind === 'carry').id;
  assert.strictEqual(S.removeLedgerEntry(s, carryId), false);
  assert.strictEqual(s.ledger.length, 3);
  assert.strictEqual(S.removeLedgerEntry(s, r.id), true);
  assert.strictEqual(s.ledger.length, 2);
});


t('addRepayment は任意の month を保存し、省略時は null のまま', () => {
  const s = S.defaultState();
  const a = S.addRepayment(s, -30000);
  assert.strictEqual(a.month, null);
  const b = S.addRepayment(s, -10000, '2026-11');
  assert.strictEqual(b.month, '2026-11');
  assert.strictEqual(b.kind, 'repayment');
});


t('精算済みの月の支払いは追加・修正・削除できない', () => {
  const s = S.defaultState();
  S.addPayment(s, { month: '2026-11', itemId: 'item-denki', payerId: 'yamada', amount: 4000 });
  S.settleMonth(s, '2026-11', { from: 'yamada', to: 'kanojo', amount: 4000, net: 4000, choice: 'settled', paid: 0, carried: 4000 });
  const id = s.payments[0].id;
  assert.strictEqual(S.updatePayment(s, id, { amount: 5000 }), null);
  assert.strictEqual(s.payments[0].amount, 4000);
  assert.strictEqual(S.removePayment(s, id), false);
  assert.strictEqual(s.payments.length, 1);
  assert.strictEqual(S.addPayment(s, { month: '2026-11', itemId: 'item-gas', payerId: 'yamada', amount: 1000 }), null);
  assert.strictEqual(s.payments.length, 1);
  const before = s.payments.length;
  S.ensureMonth(s, '2026-11');
  assert.strictEqual(s.payments.length, before);
});

t('古いデータを読み込んでも台帳の残高は変わらない', () => {
  const raw = {
    version: 1,
    payments: [],
    settlements: {
      '2026-10': { marks: { yamada: 1, kanojo: 1 }, settledAt: 1, snapshot: { from: 'yamada', to: 'kanojo', amount: 38000, net: 38000 } },
      '2026-11': { marks: { yamada: 1, kanojo: 1 }, settledAt: 2, snapshot: { from: 'yamada', to: 'kanojo', amount: 38000, net: 38000, choice: 'partial', paid: 10000, carried: 28000 } },
    },
    ledger: [
      { id: 'o1', kind: 'opening', signed: 250000, amount: 250000, from: 'yamada', to: 'kanojo' },
      { id: 'c1', kind: 'carry', month: '2026-11', signed: 28000, amount: 28000, from: 'yamada', to: 'kanojo', paid: 10000, carried: 28000 },
      { id: 'r1', kind: 'repayment', signed: -30000, amount: 30000, from: 'yamada', to: 'kanojo' },
    ],
  };
  const s = S.normalize(raw);
  const L = require('../logic.js');
  assert.strictEqual(L.ledgerTotal(s.ledger), 248000);
  assert.strictEqual(s.ledger.length, 3);
  assert.strictEqual(S.isSettled(s, '2026-10'), true);
  assert.strictEqual(S.isSettled(s, '2026-11'), true);
  assert.strictEqual((s.ledger.find((e) => e.kind === 'carry') || {}).signed, 28000);
});

t('lastSettledMonth は確定したいちばん先の月。reset は初期状態に戻す', () => {
  const s = S.defaultState();
  assert.strictEqual(S.lastSettledMonth(s), null);
  S.settleMonth(s, '2026-11', { from: 'yamada', to: 'kanojo', amount: 38000, net: 38000, choice: 'settled', paid: 0, carried: 38000 });
  S.settleMonth(s, '2026-12', { from: 'yamada', to: 'kanojo', amount: 0, net: 0, choice: 'settled', paid: 0, carried: 0 });
  assert.strictEqual(S.lastSettledMonth(s), '2026-12');
  const fresh = S.reset();
  assert.strictEqual(S.lastSettledMonth(fresh), null);
  assert.deepStrictEqual(fresh.payments, []);
  assert.deepStrictEqual(fresh.settlements, {});
  assert.deepStrictEqual(fresh.ledger, []);
  assert.strictEqual(fresh.people.yamada.name, '自分');
  assert.strictEqual(fresh.people.kanojo.name, '相手');
  assert.strictEqual(fresh.ratioYamada, 50);
  assert.strictEqual(fresh.items.length, 6);
});

t('normalize は保存済みの名前を初期名で上書きしない', () => {
  const raw = S.defaultState();
  raw.people.yamada.name = 'たろう';
  raw.people.kanojo.name = 'はなこ';
  const s = S.normalize(raw);
  assert.strictEqual(s.people.yamada.name, 'たろう');
  assert.strictEqual(s.people.kanojo.name, 'はなこ');
  const legacy = S.normalize({
    version: 1,
    people: {
      yamada: { id: 'yamada', name: 'たろう', color: '#14B8A6' },
      kanojo: { id: 'kanojo', name: 'はなこ', color: '#F97366' },
    },
    payments: [],
    items: raw.items,
    settlements: {},
    ledger: [],
  });
  assert.strictEqual(legacy.people.yamada.name, 'たろう');
  assert.strictEqual(legacy.people.kanojo.name, 'はなこ');
});



t('設定の固定額は未確定の今月・未来月に反映し、確定済みと手入力は残す', () => {
  const prevNow = global.__warikanNow;
  global.__warikanNow = Date.parse('2026-11-15T12:00:00+09:00');
  try {
    const s = S.defaultState();
    S.ensureMonth(s, '2026-10');
    S.ensureMonth(s, '2026-11');
    S.ensureMonth(s, '2026-12');
    const oct = s.payments.find((p) => p.month === '2026-10' && p.itemId === 'item-yachin');
    const nov = s.payments.find((p) => p.month === '2026-11' && p.itemId === 'item-yachin');
    const dec = s.payments.find((p) => p.month === '2026-12' && p.itemId === 'item-yachin');
    assert.strictEqual(oct.amount, 60000);
    assert.strictEqual(nov.amount, 60000);
    assert.strictEqual(dec.amount, 60000);

    S.settleMonth(s, '2026-10', { from: 'kanojo', to: 'yamada', amount: 30000, net: -30000, choice: 'settled', paid: 0, carried: 30000 });
    S.updatePayment(s, dec.id, { amount: 62000 });

    const item = S.updateItem(s, 'item-yachin', { name: '家賃', kind: 'fixed', defaultPayer: 'kanojo', fixedAmount: 65000 });
    assert.strictEqual(item.fixedAmount, 65000);
    assert.ok(item.updatedAt);
    assert.strictEqual(item.updatedBy, 'yamada');

    assert.strictEqual(s.payments.find((p) => p.id === oct.id).amount, 60000);
    assert.strictEqual(s.payments.find((p) => p.id === oct.id).itemName, '家賃');
    const nov2 = s.payments.find((p) => p.id === nov.id);
    assert.strictEqual(nov2.amount, 65000);
    assert.strictEqual(nov2.updatedBy, 'yamada');
    assert.ok(nov2.updatedAt);
    assert.strictEqual(s.payments.find((p) => p.id === dec.id).amount, 62000);
  } finally {
    global.__warikanNow = prevNow;
  }
});

t('未入力の固定額は新しい設定に合わせ、名前と払う人も条件つきで更新する', () => {
  const prevNow = global.__warikanNow;
  const prevSync = global.WarikanSync;
  global.__warikanNow = Date.parse('2026-11-15T12:00:00+09:00');
  global.WarikanSync = { me() { return 'kanojo'; } };
  try {
    const s = S.defaultState();
    S.ensureMonth(s, '2026-11');
    S.ensureMonth(s, '2026-12');
    const yachin = s.payments.find((p) => p.month === '2026-11' && p.itemId === 'item-yachin');
    S.updatePayment(s, yachin.id, { amount: null });
    const shopNov = s.payments.find((p) => p.month === '2026-11' && p.itemId === 'item-kaimono');
    const shopDec = s.payments.find((p) => p.month === '2026-12' && p.itemId === 'item-kaimono');
    S.updatePayment(s, shopNov.id, { payerId: 'yamada' });

    S.updateItem(s, 'item-yachin', { name: 'アパート代', kind: 'fixed', defaultPayer: 'kanojo', fixedAmount: 70000 });
    const y2 = s.payments.find((p) => p.id === yachin.id);
    assert.strictEqual(y2.amount, 70000);
    assert.strictEqual(y2.itemName, 'アパート代');
    assert.strictEqual(y2.updatedBy, 'kanojo');

    S.updateItem(s, 'item-kaimono', { name: '買い物代', kind: 'variable', defaultPayer: 'kanojo', fixedAmount: null });
    assert.strictEqual(s.payments.find((p) => p.id === shopNov.id).payerId, 'yamada');
    assert.strictEqual(s.payments.find((p) => p.id === shopNov.id).itemName, '買い物代');
    assert.strictEqual(s.payments.find((p) => p.id === shopDec.id).payerId, 'kanojo');
    assert.strictEqual(s.payments.find((p) => p.id === shopDec.id).itemName, '買い物代');

    S.updateItem(s, 'item-kaimono', { name: '買い物代', kind: 'variable', defaultPayer: 'yamada', fixedAmount: null });
    assert.strictEqual(s.payments.find((p) => p.id === shopNov.id).payerId, 'yamada');
    assert.strictEqual(s.payments.find((p) => p.id === shopDec.id).payerId, 'yamada');
    assert.strictEqual(s.payments.find((p) => p.id === shopDec.id).updatedBy, 'kanojo');
  } finally {
    global.__warikanNow = prevNow;
    global.WarikanSync = prevSync;
  }
});



/* v1.x / 共有開始前の保存データを模したフィクスチャ。
   - 固定額が文字列（"60000" / "¥60,000"）
   - 支払いから itemId が欠け、itemName か古い id だけがある
   - extra フィールドなし
   - 設定の固定額はすでに 65000 に変わっているが、精算の支払いは 60000 のまま（v2.0.3 以前は設定保存が項目だけを更新することがあった）
   - 未確定の過去月（10月）が精算画面に出る */
function legacySharedState() {
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
    settlements: {},
    ledger: [],
  };
}

function v203MatcherWouldUpdate(p, item, prevFixed, fromMonth) {
  if (!p || p.extra || p.itemId !== item.id) return false;
  if (typeof p.month !== 'string' || p.month < fromMonth) return false;
  const unentered = p.amount == null || p.amount === '';
  const matchesOld = !unentered && prevFixed != null && Math.round(Number(p.amount)) === prevFixed;
  return unentered || matchesOld;
}

t('normalize は古い支払いの金額を数値にし、欠けた itemId を補う', () => {
  const s = S.normalize(legacySharedState());
  const oct = s.payments.find((p) => p.month === '2026-10' && p.itemName === '家賃');
  const nov = s.payments.find((p) => p.month === '2026-11' && (p.itemId === 'item-yachin' || p.itemName === '家賃'));
  assert.strictEqual(s.items.find((i) => i.id === 'item-yachin').fixedAmount, 65000);
  assert.strictEqual(typeof oct.amount, 'number');
  assert.strictEqual(oct.amount, 60000);
  assert.strictEqual(oct.itemId, 'item-yachin');
  assert.strictEqual(oct.extra, false);
  assert.strictEqual(nov.amount, 60000);
  assert.strictEqual(nov.itemId, 'item-yachin');
});

t('v2.0.3 の判定は古い・食い違った行を更新できない', () => {
  const raw = legacySharedState();
  const item = raw.items.find((i) => i.id === 'item-yachin');
  const prevFixed = item.fixedAmount; // '65000' のまま（Number にすると 65000）
  const nov = raw.payments.find((p) => p.month === '2026-11');
  const oct = raw.payments.find((p) => p.month === '2026-10' && p.itemName === '家賃');
  /* 文字列 "60000" は Number で 60000 になるが、設定はすでに 65000 なので「元の固定額と同じ」にならない */
  assert.strictEqual(v203MatcherWouldUpdate(nov, item, Math.round(Number(prevFixed)), '2026-11'), false);
  /* itemId がなく、10月は今月より前なのでどちらでも弾かれる */
  assert.strictEqual(v203MatcherWouldUpdate(oct, item, 65000, '2026-11'), false);
  /* カンマ付き "¥60,000" は Number が NaN になり、同じ金額でも一致しない */
  const commaPay = { itemId: 'item-yachin', month: '2026-11', amount: '¥60,000' };
  assert.strictEqual(v203MatcherWouldUpdate(commaPay, item, 60000, '2026-11'), false);
});

t('古いデータでも設定の固定額は未確定の過去月・今月に反映する', () => {
  const prevNow = global.__warikanNow;
  global.__warikanNow = Date.parse('2026-11-15T12:00:00+09:00');
  try {
    const s = S.normalize(legacySharedState());
    S.updateItem(s, 'item-yachin', { name: '家賃', kind: 'fixed', defaultPayer: 'kanojo', fixedAmount: 70000 });
    const oct = s.payments.find((p) => p.month === '2026-10' && p.itemId === 'item-yachin');
    const nov = s.payments.find((p) => p.month === '2026-11' && p.itemId === 'item-yachin');
    assert.strictEqual(oct.amount, 70000);
    assert.strictEqual(nov.amount, 70000);
    assert.ok(!oct.amountManual);
    assert.ok(!nov.amountManual);
  } finally {
    global.__warikanNow = prevNow;
  }
});

t('精算で手入力した金額は設定変更で上書きしない', () => {
  const prevNow = global.__warikanNow;
  global.__warikanNow = Date.parse('2026-11-15T12:00:00+09:00');
  try {
    const s = S.defaultState();
    S.ensureMonth(s, '2026-11');
    const nov = s.payments.find((p) => p.month === '2026-11' && p.itemId === 'item-yachin');
    S.updatePayment(s, nov.id, { amount: 62000 });
    assert.strictEqual(nov.amountManual, true);
    S.updateItem(s, 'item-yachin', { name: '家賃', kind: 'fixed', defaultPayer: 'kanojo', fixedAmount: 70000 });
    assert.strictEqual(s.payments.find((p) => p.id === nov.id).amount, 62000);
  } finally {
    global.__warikanNow = prevNow;
  }
});


t('精算の追加（extra）はその月だけ。設定の項目には入らない', () => {
  const s = S.defaultState();
  S.ensureMonth(s, '2026-11');
  const beforeItems = s.items.length;
  const p = S.addPayment(s, { month: '2026-11', itemId: null, itemName: '旅行', payerId: 'yamada', amount: 3000, extra: true });
  assert.ok(p);
  assert.strictEqual(p.extra, true);
  assert.strictEqual(p.itemId, null);
  assert.strictEqual(p.itemName, '旅行');
  assert.strictEqual(p.amount, 3000);
  assert.strictEqual(s.items.length, beforeItems);
  assert.ok(!s.items.some((it) => it && it.name === '旅行'));
  S.ensureMonth(s, '2026-12');
  assert.strictEqual(s.payments.filter((x) => x.month === '2026-12' && (x.extra || x.itemName === '旅行')).length, 0);
  assert.strictEqual(s.payments.filter((x) => x.month === '2026-11' && x.extra && x.itemName === '旅行').length, 1);
});

t('extra の支払いは normalize しても残し、同名の項目に結びつけない', () => {
  const s = S.normalize({
    version: 1,
    payments: [
      { id: 'px', month: '2026-11', itemId: null, itemName: '家賃', payerId: 'yamada', amount: 1234, extra: true },
    ],
  });
  const p = s.payments.find((x) => x.id === 'px');
  assert.ok(p);
  assert.strictEqual(p.extra, true);
  assert.ok(!p.itemId);
  assert.strictEqual(p.itemName, '家賃');
  assert.strictEqual(p.amount, 1234);
});

t('設定の項目変更は extra の行を触らない', () => {
  const prevNow = global.__warikanNow;
  global.__warikanNow = Date.parse('2026-11-15T12:00:00+09:00');
  try {
    const s = S.defaultState();
    S.ensureMonth(s, '2026-11');
    const extra = S.addPayment(s, { month: '2026-11', itemId: null, itemName: '家賃', payerId: 'yamada', amount: 1111, extra: true });
    S.updateItem(s, 'item-yachin', { name: '家賃', kind: 'fixed', defaultPayer: 'kanojo', fixedAmount: 70000 });
    const still = s.payments.find((x) => x.id === extra.id);
    assert.strictEqual(still.amount, 1111);
    assert.strictEqual(still.itemName, '家賃');
    assert.strictEqual(still.payerId, 'yamada');
    assert.strictEqual(still.extra, true);
    assert.ok(!still.itemId);
    const rent = s.payments.find((x) => x.month === '2026-11' && x.itemId === 'item-yachin' && !x.extra);
    assert.strictEqual(rent.amount, 70000);
  } finally {
    global.__warikanNow = prevNow;
  }
});

t('確定済みの月には extra を追加・編集・削除できない', () => {
  const s = S.defaultState();
  S.ensureMonth(s, '2026-11');
  const extra = S.addPayment(s, { month: '2026-11', itemId: null, itemName: '旅行', payerId: 'kanojo', amount: 2000, extra: true });
  S.settleMonth(s, '2026-11', { from: 'yamada', to: 'kanojo', amount: 1, net: 1 });
  assert.strictEqual(S.addPayment(s, { month: '2026-11', itemId: null, itemName: '別', payerId: 'yamada', amount: 1, extra: true }), null);
  assert.strictEqual(S.updatePayment(s, extra.id, { amount: 9999 }), null);
  assert.strictEqual(S.removePayment(s, extra.id), false);
  const still = s.payments.find((x) => x.id === extra.id);
  assert.strictEqual(still.amount, 2000);
  assert.strictEqual(still.itemName, '旅行');
});

t('未確定なら extra の編集と削除ができる', () => {
  const s = S.defaultState();
  const extra = S.addPayment(s, { month: '2026-11', itemId: null, itemName: '旅行', payerId: 'kanojo', amount: 2000, extra: true });
  const updated = S.updatePayment(s, extra.id, { itemName: '出張', amount: 4500, payerId: 'yamada' });
  assert.strictEqual(updated.itemName, '出張');
  assert.strictEqual(updated.amount, 4500);
  assert.strictEqual(updated.payerId, 'yamada');
  assert.strictEqual(updated.extra, true);
  assert.strictEqual(S.removePayment(s, extra.id), true);
  assert.ok(!s.payments.some((x) => x.id === extra.id));
});

t('ensureMonth は extra を複製せず、金額なしでも保存できる', () => {
  const s = S.defaultState();
  S.ensureMonth(s, '2026-11');
  const p = S.addPayment(s, { month: '2026-11', itemId: null, itemName: 'メモ', payerId: 'yamada', amount: null, extra: true });
  assert.strictEqual(p.amount, null);
  assert.strictEqual(p.extra, true);
  const before = s.payments.filter((x) => x.month === '2026-11' && x.extra).length;
  S.ensureMonth(s, '2026-11');
  S.ensureMonth(s, '2026-12');
  assert.strictEqual(s.payments.filter((x) => x.month === '2026-11' && x.extra).length, before);
  assert.strictEqual(s.payments.filter((x) => x.month === '2026-12' && x.extra).length, 0);
});

console.log(n + ' passed');
