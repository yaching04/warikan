const assert = require('assert');
const L = require('../logic.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('50:50 の例: 2人目 ¥90,000、1人目 ¥14,000 → 1人目が2人目に ¥38,000', () => {
  const r = L.computeSettle([
    { payerId: 'kanojo', amount: 60000 },
    { payerId: 'kanojo', amount: 30000 },
    { payerId: 'yamada', amount: 4000 },
    { payerId: 'yamada', amount: 3000 },
    { payerId: 'yamada', amount: 3000 },
    { payerId: 'yamada', amount: 4000 },
  ], 50);
  assert.strictEqual(r.kanojoPaid, 90000);
  assert.strictEqual(r.yamadaPaid, 14000);
  assert.strictEqual(r.yamadaBurdenOfKanojo, 45000);
  assert.strictEqual(r.kanojoBurdenOfYamada, 7000);
  assert.strictEqual(r.net, 38000);
  assert.strictEqual(r.amount, 38000);
  assert.strictEqual(r.from, 'yamada');
  assert.strictEqual(r.to, 'kanojo');
});

t('50:50 を合計の半分で計算しても同じ答え', () => {
  const r = L.computeSettle([
    { payerId: 'kanojo', amount: 90000 },
    { payerId: 'yamada', amount: 14000 },
  ], 50);
  const half = Math.floor((90000 + 14000) * 50 / 100);
  assert.strictEqual(half, 52000);
  assert.strictEqual(90000 - half, 38000);
  assert.strictEqual(r.amount, 38000);
});

t('55:45 で端数 ¥14,001（2人目が支払）: 1人目の負担は切り捨て', () => {
  const r = L.computeSettle([{ payerId: 'kanojo', amount: 14001 }], 55);
  assert.strictEqual(L.yamadaShare(14001, 55), 7700); // Math.floor(14001*55/100)=7700
  assert.strictEqual(L.kanojoShare(14001, 55), 6301);
  assert.strictEqual(r.yamadaBurdenOfKanojo, 7700);
  assert.strictEqual(r.kanojoBurdenOfYamada, 0);
  assert.strictEqual(r.yamadaBurdenOfKanojo + L.kanojoShare(14001, 55), 14001);
  assert.strictEqual(r.net, 7700);
  assert.strictEqual(r.from, 'yamada');
  assert.strictEqual(r.to, 'kanojo');
});

t('55:45 で端数 ¥14,001（1人目が支払）: 残りは2人目の負担', () => {
  const r = L.computeSettle([{ payerId: 'yamada', amount: 14001 }], 55);
  assert.strictEqual(r.kanojoBurdenOfYamada, 6301);
  assert.strictEqual(r.yamadaShareOfOwn, 7700);
  assert.strictEqual(r.yamadaShareOfOwn + r.kanojoBurdenOfYamada, 14001);
  assert.strictEqual(r.net, -6301);
  assert.strictEqual(r.amount, 6301);
  assert.strictEqual(r.from, 'kanojo');
  assert.strictEqual(r.to, 'yamada');
});

t('55:45 で両方あるときも式の数字の差し引きと一致', () => {
  const r = L.computeSettle([
    { payerId: 'kanojo', amount: 14001 },
    { payerId: 'yamada', amount: 14001 },
  ], 55);
  assert.strictEqual(r.yamadaBurdenOfKanojo, 7700);
  assert.strictEqual(r.kanojoBurdenOfYamada, 6301);
  assert.strictEqual(r.net, 7700 - 6301);
  assert.strictEqual(r.amount, 1399);
  assert.strictEqual(r.from, 'yamada');
});

t('支払いが0件なら精算額0', () => {
  const r = L.computeSettle([], 50);
  assert.strictEqual(r.yamadaPaid, 0);
  assert.strictEqual(r.kanojoPaid, 0);
  assert.strictEqual(r.amount, 0);
  assert.strictEqual(r.net, 0);
  assert.strictEqual(r.from, null);
  assert.strictEqual(r.to, null);
});

t('未入力（amount 空）は計算に入れない', () => {
  const r = L.computeSettle([
    { payerId: 'kanojo', amount: 60000 },
    { payerId: 'kanojo', amount: null },
    { payerId: 'yamada', amount: '' },
  ], 50);
  assert.strictEqual(r.kanojoPaid, 60000);
  assert.strictEqual(r.yamadaPaid, 0);
  assert.strictEqual(r.yamadaBurdenOfKanojo, 30000);
  assert.strictEqual(r.amount, 30000);
});

t('片方だけ支払い（2人目のみ）', () => {
  const r = L.computeSettle([{ payerId: 'kanojo', amount: 90000 }], 50);
  assert.strictEqual(r.yamadaPaid, 0);
  assert.strictEqual(r.kanojoPaid, 90000);
  assert.strictEqual(r.yamadaBurdenOfKanojo, 45000);
  assert.strictEqual(r.kanojoBurdenOfYamada, 0);
  assert.strictEqual(r.amount, 45000);
  assert.strictEqual(r.from, 'yamada');
});

t('片方だけ支払い（1人目のみ）', () => {
  const r = L.computeSettle([{ payerId: 'yamada', amount: 14000 }], 50);
  assert.strictEqual(r.kanojoBurdenOfYamada, 7000);
  assert.strictEqual(r.amount, 7000);
  assert.strictEqual(r.from, 'kanojo');
  assert.strictEqual(r.to, 'yamada');
});

t('丸め: どの金額・割合でも 1人目シェア+2人目シェア=合計', () => {
  const totals = [0, 1, 2, 3, 99, 100, 101, 14001, 99999, 1000001];
  const ratios = [0, 1, 45, 50, 55, 99, 100];
  for (const tot of totals) {
    for (const r of ratios) {
      const y = L.yamadaShare(tot, r);
      const k = L.kanojoShare(tot, r);
      assert.strictEqual(y + k, tot, `sum ${tot} @${r} => ${y}+${k}`);
      assert.ok(y >= 0 && k >= 0);
    }
  }
});

t('割合0は全部2人目、割合100は全部1人目', () => {
  assert.strictEqual(L.yamadaShare(1000, 0), 0);
  assert.strictEqual(L.kanojoShare(1000, 0), 1000);
  assert.strictEqual(L.yamadaShare(1000, 100), 1000);
  assert.strictEqual(L.kanojoShare(1000, 100), 0);
});

t('yen は3桁区切り、負は−¥', () => {
  assert.strictEqual(L.yen(38000), '¥38,000');
  assert.strictEqual(L.yen(0), '¥0');
  assert.strictEqual(L.yen(-7000), '−¥7,000');
});

t('month の加減とラベル', () => {
  assert.strictEqual(L.addMonth('2026-11', 1), '2026-12');
  assert.strictEqual(L.addMonth('2026-11', -1), '2026-10');
  assert.strictEqual(L.addMonth('2026-12', 1), '2027-01');
  assert.strictEqual(L.addMonth('2026-01', -1), '2025-12');
  assert.strictEqual(L.monthLabel('2026-11'), '2026年11月');
  assert.strictEqual(L.monthDiff('2026-11', '2025-11'), 12);
});

t('monthRange: 通常は今の12か月前〜翌月。最後に確定した月の次まで広げる', () => {
  assert.deepStrictEqual(L.monthRange('2026-11'), { min: '2025-11', max: '2026-12' });
  assert.deepStrictEqual(L.monthRange('2026-12'), { min: '2025-12', max: '2027-01' });
  assert.deepStrictEqual(L.monthRange('2026-12', '2026-11'), { min: '2025-12', max: '2027-01' });
  assert.deepStrictEqual(L.monthRange('2026-12', '2026-12'), { min: '2025-12', max: '2027-01' });
  assert.deepStrictEqual(L.monthRange('2026-11', '2026-12'), { min: '2025-11', max: '2027-01' });
  assert.deepStrictEqual(L.monthRange('2026-11', '2027-01'), { min: '2025-11', max: '2027-02' });
});

t('表示名: 設定の名前をそのまま使う（さんを自動では付けない）', () => {
  assert.strictEqual(L.displayName({ name: '自分' }), '自分');
  assert.strictEqual(L.displayName({ name: '相手' }), '相手');
  assert.strictEqual(L.displayName({ name: '太郎さん' }), '太郎さん');
  assert.strictEqual(L.displayName({ name: '' }), '');
  assert.strictEqual(L.displayName(null), '');
});

t('perspectiveLabel: 自分視点では相手の「自分」を「相手」と出す', () => {
  assert.strictEqual(L.perspectiveLabel('たろう', true, true), '自分');
  assert.strictEqual(L.perspectiveLabel('はなこ', false, true), 'はなこ');
  assert.strictEqual(L.perspectiveLabel('自分', true, true), '自分');
  assert.strictEqual(L.perspectiveLabel('自分', false, true), '相手');
  assert.strictEqual(L.perspectiveLabel('自分', false, false), '自分');
  assert.strictEqual(L.perspectiveLabel('相手', false, false), '相手');
});

t('publicName: 一人称のホスト名は出さない', () => {
  assert.strictEqual(L.publicName('たろう', '相手'), 'たろう');
  assert.strictEqual(L.publicName('自分', '相手'), '相手');
  assert.strictEqual(L.publicName('', '相手'), '相手');
  assert.strictEqual(L.publicName('自分', ''), '');
});


t('parseAmountInput: カンマ・空白・全角は整数として受ける', () => {
  assert.deepStrictEqual(L.parseAmountInput('4,000').value, 4000);
  assert.strictEqual(L.parseAmountInput('4,000').ok, true);
  assert.strictEqual(L.parseAmountInput(' 5000 ').value, 5000);
  assert.strictEqual(L.parseAmountInput('３０００').value, 3000);
  assert.strictEqual(L.parseAmountInput('１,０００').value, 1000);
  assert.strictEqual(L.parseAmountInput('0').value, 0);
});
t('parseAmountInput: 小数とマイナスは拒否し、100.5 を 1005 にしない', () => {
  const dec = L.parseAmountInput('100.5');
  assert.strictEqual(dec.ok, false);
  assert.strictEqual(dec.value, undefined);
  assert.strictEqual(dec.message, '金額は0以上の整数で入れてね');
  const neg = L.parseAmountInput('-4000');
  assert.strictEqual(neg.ok, false);
  assert.strictEqual(neg.message, '金額は0以上の整数で入れてね');
  const fw = L.parseAmountInput('１００．５');
  assert.strictEqual(fw.ok, false);
  const emp = L.parseAmountInput('   ');
  assert.strictEqual(emp.ok, false);
  assert.strictEqual(emp.empty, true);
  assert.strictEqual(emp.message, '金額を入れてね');
});
t('settleDisplay: 精算済みならスナップショットを使い、割合を変えても同じ', () => {
  const live50 = L.computeSettle([{ payerId: 'kanojo', amount: 90000 }, { payerId: 'yamada', amount: 14000 }], 50);
  const live60 = L.computeSettle([{ payerId: 'kanojo', amount: 90000 }, { payerId: 'yamada', amount: 14000 }], 60);
  assert.strictEqual(live50.amount, 38000);
  assert.notStrictEqual(live60.amount, 38000);
  const settlement = { marks: { yamada: 1, kanojo: 1 }, snapshot: Object.assign({}, live50, { ratioYamada: 50 }) };
  const shown = L.settleDisplay(live60, settlement);
  assert.strictEqual(shown.amount, 38000);
  assert.strictEqual(shown.ratioYamada, 50);
  assert.strictEqual(shown.yamadaBurdenOfKanojo, 45000);
  const unset = L.settleDisplay(live60, { marks: { yamada: null, kanojo: null } });
  assert.strictEqual(unset.amount, live60.amount);
});


t('parseAmountInput: ¥ / ￥ / 円 を除いて整数として受ける', () => {
  assert.strictEqual(L.parseAmountInput('¥4000').ok, true);
  assert.strictEqual(L.parseAmountInput('¥4000').value, 4000);
  assert.strictEqual(L.parseAmountInput('4000円').value, 4000);
  assert.strictEqual(L.parseAmountInput('￥４，０００').value, 4000);
  assert.strictEqual(L.parseAmountInput('¥ 4,000 円').value, 4000);
  assert.strictEqual(L.parseAmountInput('￥4000円').value, 4000);
});
t('parseAmountInput: 円記号だけ・記号付き小数は拒否', () => {
  const only = L.parseAmountInput('¥');
  assert.strictEqual(only.ok, false);
  assert.strictEqual(only.empty, true);
  const dec = L.parseAmountInput('¥100.5');
  assert.strictEqual(dec.ok, false);
  assert.strictEqual(dec.message, '金額は0以上の整数で入れてね');
});


t('dirFromSigned: 正は1人目 → 2人目、負は逆、0 は残りなし', () => {
  const p = L.dirFromSigned(250000);
  assert.strictEqual(p.from, 'yamada');
  assert.strictEqual(p.to, 'kanojo');
  assert.strictEqual(p.amount, 250000);
  const n = L.dirFromSigned(-8000);
  assert.strictEqual(n.from, 'kanojo');
  assert.strictEqual(n.to, 'yamada');
  assert.strictEqual(n.amount, 8000);
  const z = L.dirFromSigned(0);
  assert.strictEqual(z.from, null);
  assert.strictEqual(z.amount, 0);
});

t('signedFromDir と ledgerTotal', () => {
  assert.strictEqual(L.signedFromDir('yamada', 250000), 250000);
  assert.strictEqual(L.signedFromDir('kanojo', 8000), -8000);
  assert.strictEqual(L.ledgerTotal([{ signed: 250000 }, { signed: 38000 }, { signed: -30000 }]), 258000);
  assert.strictEqual(L.ledgerTotal(undefined), 0);
});

t('settleChoice: 全額・全部残り・一部・一部が満額なら全額', () => {
  assert.deepStrictEqual(L.settleChoice('full', 38000), { choice: 'full', paid: 38000, carried: 0 });
  assert.deepStrictEqual(L.settleChoice('carry', 38000), { choice: 'carry', paid: 0, carried: 38000 });
  assert.deepStrictEqual(L.settleChoice('partial', 38000, 10000), { choice: 'partial', paid: 10000, carried: 28000 });
  assert.deepStrictEqual(L.settleChoice('partial', 38000, 38000), { choice: 'full', paid: 38000, carried: 0 });
  assert.deepStrictEqual(L.settleChoice('partial', 38000, 0), { choice: 'partial', paid: 0, carried: 38000 });
});

t('carrySigned はその月の精算の向きに従う', () => {
  assert.strictEqual(L.carrySigned(38000, 28000), 28000);
  assert.strictEqual(L.carrySigned(-12000, 12000), -12000);
  assert.strictEqual(L.carrySigned(0, 1000), 0);
});

t('repaymentSigned はいまの残高を減らす向き', () => {
  assert.strictEqual(L.repaymentSigned(278000, 30000), -30000);
  assert.strictEqual(L.repaymentSigned(-8000, 3000), 3000);
  assert.strictEqual(L.repaymentSigned(0, 1000), 0);
});

t('validatePartialPaid / validateRepayment', () => {
  const ok = L.validatePartialPaid('10,000', 38000);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.value, 10000);
  const yen = L.validatePartialPaid('¥10,000', 38000);
  assert.strictEqual(yen.ok, true);
  assert.strictEqual(yen.value, 10000);
  const empty = L.validatePartialPaid('', 38000);
  assert.strictEqual(empty.ok, false);
  assert.strictEqual(empty.message, '金額を入れてね');
  const over = L.validatePartialPaid('38001', 38000);
  assert.strictEqual(over.ok, false);
  assert.strictEqual(over.message, '金額は¥1〜¥38,000で入れてね');
  const zero = L.validatePartialPaid('0', 38000);
  assert.strictEqual(zero.ok, false);
  const dec = L.validatePartialPaid('10.5', 38000);
  assert.strictEqual(dec.ok, false);
  assert.strictEqual(dec.message, '金額は0以上の整数で入れてね');
  const ro = L.validateRepayment('30000', 278000);
  assert.strictEqual(ro.ok, true);
  const roOver = L.validateRepayment('278001', 278000);
  assert.strictEqual(roOver.ok, false);
  assert.strictEqual(roOver.message, '金額は¥1〜¥278,000で入れてね');
  const none = L.validateRepayment('1', 0);
  assert.strictEqual(none.ok, false);
  assert.strictEqual(none.message, '残りの支払いはありません');
});

t('settleKind / settleKindLabel: 古いスナップショットは全額払い', () => {
  assert.strictEqual(L.settleKind(null), 'full');
  assert.strictEqual(L.settleKind({ amount: 38000 }), 'full');
  assert.strictEqual(L.settleKind({ choice: 'full' }), 'full');
  assert.strictEqual(L.settleKind({ choice: 'partial', carried: 28000 }), 'partial');
  assert.strictEqual(L.settleKind({ choice: 'carry' }), 'carry');
  assert.strictEqual(L.settleKindLabel({}), '精算済み');
  assert.strictEqual(L.settleKindLabel({ choice: 'carry' }), '精算済み');
  assert.strictEqual(L.settleKindLabel({ choice: 'partial', carried: 28000 }), '精算済み');
  assert.strictEqual(L.settleKindLabel({ choice: 'settled' }), '精算済み');
});

t('ledgerWithRunning: これまでの残りを先頭にし、新しい順で残りを付ける', () => {
  const entries = [
    { id: 'r1', kind: 'repayment', signed: -30000, amount: 30000, createdAt: 300 },
    { id: 'c1', kind: 'carry', signed: 28000, amount: 28000, createdAt: 200, month: '2026-11' },
    { id: 'o1', kind: 'opening', signed: 250000, amount: 250000, createdAt: 9999 },
  ];
  const { total, rows } = L.ledgerWithRunning(entries);
  assert.strictEqual(total, 248000);
  assert.strictEqual(rows[0].entry.id, 'r1');
  assert.strictEqual(rows[0].after, 248000);
  assert.strictEqual(rows[1].entry.id, 'c1');
  assert.strictEqual(rows[1].after, 278000);
  assert.strictEqual(rows[2].entry.id, 'o1');
  assert.strictEqual(rows[2].after, 250000);
  assert.strictEqual(rows[2].before, 0);
  assert.strictEqual(rows[2].effect, 'inc');
  assert.strictEqual(rows[1].before, 250000);
  assert.strictEqual(rows[1].effect, 'inc');
  assert.strictEqual(rows[0].before, 278000);
  assert.strictEqual(rows[0].effect, 'dec');
});

t('ledgerAbsEffect: 絶対値の増減。ゼロ越えは分けず、同額反転は dec', () => {
  assert.strictEqual(L.ledgerAbsEffect(0, 1278000), 'inc');
  assert.strictEqual(L.ledgerAbsEffect(1278000, 1198000), 'dec');
  assert.strictEqual(L.ledgerAbsEffect(1198000, 1168000), 'dec');
  // 反対向きの繰り越しで残高は減る
  assert.strictEqual(L.ledgerAbsEffect(1278000, 1278000 - 80000), 'dec');
  // ゼロをまたぐが |直後| のほうが小さい
  assert.strictEqual(L.ledgerAbsEffect(100000, -80000), 'dec');
  // ゼロをまたいで |直後| のほうが大きい
  assert.strictEqual(L.ledgerAbsEffect(50000, -150000), 'inc');
  // 同じ大きさで符号だけ反転
  assert.strictEqual(L.ledgerAbsEffect(100000, -100000), 'dec');
  assert.strictEqual(L.ledgerAbsEffect(-8000, 8000), 'dec');
  // ゼロに戻す
  assert.strictEqual(L.ledgerAbsEffect(38000, 0), 'dec');
});

t('ledgerWithRunning の effect は累計の絶対値に従う（行の矢印ではない）', () => {
  const { rows } = L.ledgerWithRunning([
    { id: 'o', kind: 'opening', signed: 1278000, amount: 1278000, createdAt: 1 },
    { id: 'c', kind: 'carry', signed: -80000, amount: 80000, createdAt: 2, month: '2026-11' },
    { id: 'r', kind: 'repayment', signed: -30000, amount: 30000, createdAt: 3 },
  ]);
  const by = (id) => rows.find((x) => x.entry.id === id);
  assert.strictEqual(by('o').effect, 'inc');
  assert.strictEqual(by('c').effect, 'dec');
  assert.strictEqual(by('c').before, 1278000);
  assert.strictEqual(by('c').after, 1198000);
  assert.strictEqual(by('r').effect, 'dec');
  const flip = L.ledgerWithRunning([
    { id: 'o', kind: 'opening', signed: 50000, amount: 50000, createdAt: 1 },
    { id: 'c', kind: 'carry', signed: -200000, amount: 200000, createdAt: 2, month: '2026-11' },
  ]);
  assert.strictEqual(flip.total, -150000);
  assert.strictEqual(flip.rows[0].effect, 'inc');
  assert.strictEqual(flip.rows[0].after, -150000);
});


t('sortLedgerChrono: 作成時刻が同じでも月で安定して並ぶ', () => {
  const entries = [
    { id: 'z', kind: 'carry', signed: 1000, amount: 1000, createdAt: 50, month: '2026-12' },
    { id: 'a', kind: 'carry', signed: 2000, amount: 2000, createdAt: 50, month: '2026-11' },
    { id: 'o', kind: 'opening', signed: 100, amount: 100, createdAt: 50 },
  ];
  const chrono = L.sortLedgerChrono(entries).map((e) => e.id);
  assert.deepStrictEqual(chrono, ['o', 'a', 'z']);
  const { rows } = L.ledgerWithRunning(entries);
  assert.deepStrictEqual(rows.map((r) => r.entry.id), ['z', 'a', 'o']);
  const again = L.ledgerWithRunning(entries.slice().reverse());
  assert.deepStrictEqual(again.rows.map((r) => r.entry.id), ['z', 'a', 'o']);
});

t('formatLedgerWhen', () => {
  assert.strictEqual(L.formatLedgerWhen({ kind: 'opening' }), 'これまでの残り');
  assert.strictEqual(L.formatLedgerWhen({ kind: 'carry', month: '2026-11' }), '11月分');
  const ts = Date.parse('2026-11-14T10:00:00+09:00');
  assert.strictEqual(L.formatLedgerWhen({ kind: 'repayment', createdAt: ts }), '11/14 支払った');
});

t('histStatus: 未精算・精算済み（古い choice も精算済み）', () => {
  assert.deepStrictEqual(L.histStatus(null), { key: 'none', label: '未精算' });
  assert.deepStrictEqual(L.histStatus(undefined), { key: 'none', label: '未精算' });
  assert.deepStrictEqual(L.histStatus({ choice: 'full' }), { key: 'full', label: '精算済み' });
  assert.deepStrictEqual(L.histStatus({ choice: 'partial', carried: 28000 }), { key: 'full', label: '精算済み' });
  assert.deepStrictEqual(L.histStatus({ choice: 'carry' }), { key: 'full', label: '精算済み' });
  assert.deepStrictEqual(L.histStatus({ choice: 'settled' }), { key: 'full', label: '精算済み' });
});

t('previousFilledAmount: 前の月の同じ項目、なければ null', () => {
  const pays = [
    { month: '2026-10', itemId: 'item-denki', amount: 4000 },
    { month: '2026-10', itemId: 'item-gas', amount: null },
    { month: '2026-11', itemId: 'item-denki', amount: 4500 },
  ];
  assert.strictEqual(L.previousFilledAmount(pays, 'item-denki', '2026-11'), 4000);
  assert.strictEqual(L.previousFilledAmount(pays, 'item-gas', '2026-11'), null);
  assert.strictEqual(L.previousFilledAmount(pays, 'item-denki', '2026-10'), null);
  assert.strictEqual(L.previousFilledAmount(pays, 'item-denki', ''), null);
});

t('repaymentMonth: month があればそれを、なければ createdAt の月', () => {
  assert.strictEqual(L.repaymentMonth({ month: '2026-11', createdAt: '2026-10-01T00:00:00+09:00' }), '2026-11');
  assert.strictEqual(L.repaymentMonth({ month: null, createdAt: '2026-10-15T12:00:00+09:00' }), '2026-10');
  assert.strictEqual(L.repaymentMonth({ kind: 'repayment' }), null);
});

t('lastMonths: 今月を含む6か月、古い順', () => {
  assert.deepStrictEqual(L.lastMonths('2026-11', 6), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepStrictEqual(L.lastMonths('2026-02', 3), ['2025-12', '2026-01', '2026-02']);
  assert.deepStrictEqual(L.lastMonths('2026-11', 6, '2026-12'), ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
  assert.deepStrictEqual(L.lastMonths('2026-11', 6, '2026-10'), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepStrictEqual(L.lastMonths('2026-11', 6, null), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
});

t('monthlyTotals: 月ごとの合計と人ごとの内訳、未入力は数えない', () => {
  const items = [
    { id: 'item-yachin', kind: 'fixed' },
    { id: 'item-denki', kind: 'variable' },
  ];
  const pays = [
    { month: '2026-11', itemId: 'item-yachin', payerId: 'kanojo', amount: 60000 },
    { month: '2026-11', itemId: 'item-kaimono', payerId: 'kanojo', amount: 30000 },
    { month: '2026-11', itemId: 'item-denki', payerId: 'yamada', amount: 14000 },
    { month: '2026-11', itemId: 'item-gas', payerId: 'yamada', amount: null },
    { month: '2026-10', itemId: 'item-denki', payerId: 'yamada', amount: 0 },
  ];
  const r = L.monthlyTotals(pays, items, ['2026-09', '2026-10', '2026-11']);
  assert.deepStrictEqual(r[2], { month: '2026-11', yamada: 14000, kanojo: 90000, total: 104000, has: true });
  assert.strictEqual(r[0].has, false);
  assert.strictEqual(r[0].total, 0);
  assert.strictEqual(r[1].has, true);
  assert.strictEqual(r[1].total, 0);
});

console.log(n + ' passed');
