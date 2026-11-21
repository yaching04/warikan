/* 割り勘の計算と日付まわり。DOM に触らない純粋な関数だけを置き、ブラウザと node（テスト）の両方で使う。
   人の id は YAMADA（1人目）と KANOJO（2人目）。保存データの形に含まれるので値は変えない。 */
(function (root) {
  const YAMADA = 'yamada';
  const KANOJO = 'kanojo';

  function yen(n) {
    const v = Math.round(Number(n) || 0);
    const s = Math.abs(v).toLocaleString('ja-JP');
    return (v < 0 ? '−¥' : '¥') + s;
  }

  // 1人目の負担は切り捨て、残りは2人目の負担。合計は常に元の金額と一致する。
  function yamadaShare(total, ratioYamada) {
    const t = Math.round(Number(total) || 0);
    if (t === 0) return 0;
    const r = Number(ratioYamada);
    if (!Number.isFinite(r) || r <= 0) return 0;
    if (r >= 100) return t;
    return Math.floor((t * r) / 100);
  }

  function kanojoShare(total, ratioYamada) {
    const t = Math.round(Number(total) || 0);
    return t - yamadaShare(t, ratioYamada);
  }

  /**
   * payments: { payerId, amount }[]（amount が空の未入力は無視）
   * ratioYamada: 0〜100（1人目の負担割合）
   *
   * 計算:
   *   2人目が払った合計のうち1人目の負担 = yamadaShare(kanojoPaid)
   *   1人目が払った合計のうち2人目の負担 = kanojoShare(yamadaPaid)
   *   差し引き（正なら 1人目 → 2人目）
   */
  function computeSettle(payments, ratioYamada) {
    let yamadaPaid = 0;
    let kanojoPaid = 0;
    for (const p of payments || []) {
      if (p == null || p.amount == null || p.amount === '') continue;
      const a = Math.round(Number(p.amount));
      if (!Number.isFinite(a) || a === 0) continue;
      if (p.payerId === YAMADA) yamadaPaid += a;
      else kanojoPaid += a;
    }
    const yamadaBurdenOfKanojo = yamadaShare(kanojoPaid, ratioYamada);
    const kanojoBurdenOfYamada = kanojoShare(yamadaPaid, ratioYamada);
    const net = yamadaBurdenOfKanojo - kanojoBurdenOfYamada;
    return {
      yamadaPaid,
      kanojoPaid,
      yamadaBurdenOfKanojo,
      kanojoBurdenOfYamada,
      yamadaShareOfOwn: yamadaShare(yamadaPaid, ratioYamada),
      kanojoShareOfOwn: kanojoShare(kanojoPaid, ratioYamada),
      net,
      from: net > 0 ? YAMADA : net < 0 ? KANOJO : null,
      to: net > 0 ? KANOJO : net < 0 ? YAMADA : null,
      amount: Math.abs(net),
    };
  }

  function monthKey(d) {
    const x = d ? new Date(d) : new Date();
    const y = x.getFullYear();
    const m = x.getMonth() + 1;
    return y + '-' + String(m).padStart(2, '0');
  }

  function parseMonth(key) {
    const [y, m] = String(key).split('-').map(Number);
    return { y, m };
  }

  function monthLabel(key) {
    const { y, m } = parseMonth(key);
    return y + '年' + m + '月';
  }

  function addMonth(key, delta) {
    const { y, m } = parseMonth(key);
    const d = new Date(y, m - 1 + delta, 1);
    return monthKey(d);
  }

  function monthDiff(a, b) {
    const pa = parseMonth(a);
    const pb = parseMonth(b);
    return (pa.y - pb.y) * 12 + (pa.m - pb.m);
  }

  function clampMonth(key, minKey, maxKey) {
    if (key < minKey) return minKey;
    if (key > maxKey) return maxKey;
    return key;
  }

  function monthRange(nowKey, lastSettledKey) {
    const min = addMonth(nowKey, -12);
    let max = addMonth(nowKey, 1);
    if (lastSettledKey) {
      const after = addMonth(lastSettledKey, 1);
      if (after > max) max = after;
    }
    return { min, max };
  }

  function displayName(person) {
    return (person && person.name) || '';
  }

  /* 共有中など「自分」視点のときの表示名。
     設定の名前が「自分」だと、相手側まで「自分」になって紛らわしいので「相手」と出す。 */
  function perspectiveLabel(name, isSelf, hasMe) {
    if (hasMe && isSelf) return '自分';
    const n = name || '';
    if (hasMe && n === '自分') return '相手';
    return n;
  }

  /* 招待のホスト名など、一人称だと文がおかしくなるときの表示。空か「自分」なら fallback。 */
  function publicName(name, fallback) {
    const n = String(name || '').trim();
    if (!n || n === '自分') return fallback || '';
    return n;
  }

  function isFilled(p) {
    if (!p || p.amount == null || p.amount === '') return false;
    const a = Number(p.amount);
    return Number.isFinite(a);
  }

  /* 金額入力: 全角数字は半角に、カンマ・空白・¥/￥/円は除く。小数・マイナスは受けない。 */
  function parseAmountInput(raw) {
    let s = String(raw == null ? '' : raw);
    s = s.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30));
    s = s.replace(/[．。]/g, '.');
    s = s.replace(/[－−–—]/g, '-');
    s = s.replace(/[,，、\s\u3000]/g, '');
    s = s.replace(/[¥￥円]/g, '');
    if (s === '') return { ok: false, empty: true, message: '金額を入れてね' };
    if (!/^\d+$/.test(s)) return { ok: false, empty: false, message: '金額は0以上の整数で入れてね' };
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      return { ok: false, empty: false, message: '金額は0以上の整数で入れてね' };
    }
    return { ok: true, value: n, message: '' };
  }

  /* 精算済みの月は、保存したスナップショット（割合と結果）をそのまま出す。 */
  function settleDisplay(live, settlement) {
    if (settlement && settlement.marks && settlement.marks.yamada && settlement.marks.kanojo && settlement.snapshot) {
      return settlement.snapshot;
    }
    return live;
  }

  /* 残りの支払いの符号: 正は「1人目 → 2人目」（1人目が渡す側）、負は逆。0 は残りなし。 */
  function dirFromSigned(signed) {
    const n = Math.round(Number(signed) || 0);
    if (n > 0) return { from: YAMADA, to: KANOJO, amount: n, signed: n };
    if (n < 0) return { from: KANOJO, to: YAMADA, amount: -n, signed: n };
    return { from: null, to: null, amount: 0, signed: 0 };
  }

  function signedFromDir(from, amount) {
    const a = Math.round(Number(amount) || 0);
    if (!a || (from !== YAMADA && from !== KANOJO)) return 0;
    return from === YAMADA ? a : -a;
  }

  function ledgerTotal(entries) {
    let s = 0;
    for (const e of entries || []) s += Math.round(Number(e && e.signed) || 0);
    return s;
  }

  /* 精算の分け方。paid が精算額と同じなら全額払いとして扱う。 */
  function settleChoice(choice, settleAmount, paidAmount) {
    const abs = Math.abs(Math.round(Number(settleAmount) || 0));
    if (choice === 'carry') return { choice: 'carry', paid: 0, carried: abs };
    if (choice === 'partial') {
      const paid = Math.round(Number(paidAmount) || 0);
      const carried = abs - paid;
      if (paid <= 0) return { choice: 'partial', paid: 0, carried: abs };
      if (carried <= 0) return { choice: 'full', paid: abs, carried: 0 };
      return { choice: 'partial', paid, carried };
    }
    return { choice: 'full', paid: abs, carried: 0 };
  }

  /* その月の精算の向きに合わせて、残りの支払いを符号付きにする。 */
  function carrySigned(settleNet, carriedAbs) {
    const dir = dirFromSigned(settleNet);
    const a = Math.abs(Math.round(Number(carriedAbs) || 0));
    if (!dir.from || !a) return 0;
    return signedFromDir(dir.from, a);
  }

  /* 支払った分は、いまの残りを減らす向き。 */
  function repaymentSigned(currentBalance, amount) {
    const bal = Math.round(Number(currentBalance) || 0);
    const a = Math.abs(Math.round(Number(amount) || 0));
    if (!bal || !a) return 0;
    return bal > 0 ? -a : a;
  }

  function validatePartialPaid(raw, settleAmount) {
    const parsed = parseAmountInput(raw);
    if (!parsed.ok) return parsed;
    const max = Math.abs(Math.round(Number(settleAmount) || 0));
    if (parsed.value < 1 || parsed.value > max) {
      return { ok: false, empty: false, message: max ? '金額は¥1〜' + yen(max) + 'で入れてね' : '金額を入れてね' };
    }
    return parsed;
  }

  function validateRepayment(raw, balanceAbs) {
    const parsed = parseAmountInput(raw);
    if (!parsed.ok) return parsed;
    const max = Math.abs(Math.round(Number(balanceAbs) || 0));
    if (max <= 0) return { ok: false, empty: false, message: '残りの支払いはありません' };
    if (parsed.value < 1 || parsed.value > max) {
      return { ok: false, empty: false, message: '金額は¥1〜' + yen(max) + 'で入れてね' };
    }
    return parsed;
  }

  /* 古い精算（choice なし）は全額払ったとみなす。 */
  function settleKind(snapshot) {
    if (!snapshot || !snapshot.choice || snapshot.choice === 'full') return 'full';
    return snapshot.choice === 'partial' || snapshot.choice === 'carry' ? snapshot.choice : 'full';
  }

  function settleKindLabel(snapshot) {
    if (!snapshot) return '未精算';
    return '精算済み';
  }

  /* 履歴リスト右上の短い印。精算カードの長い表示（settleKindLabel）とは別。 */
  function histStatus(snapshot) {
    if (!snapshot) return { key: 'none', label: '未精算' };
    return { key: 'full', label: '精算済み' };
  }

  function previousFilledAmount(payments, itemId, month) {
    if (!itemId || !month) return null;
    const prev = addMonth(month, -1);
    const p = (payments || []).find((x) => x.month === prev && x.itemId === itemId && !x.extra && isFilled(x));
    return p ? p.amount : null;
  }

  function repaymentMonth(entry) {
    if (!entry) return null;
    if (entry.month) return entry.month;
    if (!entry.createdAt) return null;
    const d = new Date(entry.createdAt);
    if (isNaN(d.getTime())) return null;
    return monthKey(d);
  }

  function sortLedgerChrono(entries) {
    return (entries || []).slice().sort((a, b) => {
      const ao = a.kind === 'opening' ? 0 : 1;
      const bo = b.kind === 'opening' ? 0 : 1;
      if (ao !== bo) return ao - bo;
      const at = Number(a.createdAt) || 0;
      const bt = Number(b.createdAt) || 0;
      if (at !== bt) return at - bt;
      const am = a.month || '';
      const bm = b.month || '';
      if (am !== bm) return am < bm ? -1 : 1;
      const ak = a.kind || '';
      const bk = b.kind || '';
      if (ak !== bk) return ak < bk ? -1 : 1;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  /* 台帳の +/− と色は、行の矢印ではなく、その時点の累計の絶対値の増減で決める。
     |直後| > |直前| なら残りが増えた（inc）。|直後| < |直前|、またはゼロをまたいで絶対値が同じなら減った（dec）。
     向きが反転しても内訳は分けず、この比較だけで1つの符号にする。 */
  function ledgerAbsEffect(before, after) {
    const b = Math.abs(Math.round(Number(before) || 0));
    const a = Math.abs(Math.round(Number(after) || 0));
    return a > b ? 'inc' : 'dec';
  }

  function ledgerWithRunning(entries) {
    const chrono = sortLedgerChrono(entries);
    let run = 0;
    const rows = chrono.map((e) => {
      const delta = Math.round(Number(e.signed) || 0);
      const before = run;
      run += delta;
      return { entry: e, before, after: run, delta, effect: ledgerAbsEffect(before, run) };
    });
    return { total: run, rows: rows.slice().reverse() };
  }

  function formatLedgerWhen(entry) {
    if (!entry) return '';
    if (entry.kind === 'opening') return 'これまでの残り';
    if (entry.kind === 'carry' && entry.month) return parseMonth(entry.month).m + '月分';
    const d = new Date(entry.createdAt || 0);
    if (isNaN(d.getTime())) return entry.kind === 'repayment' ? '支払った' : '';
    if (entry.kind === 'repayment') return (d.getMonth() + 1) + '/' + d.getDate() + ' 支払った';
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function lastMonths(nowKey, n, lastSettledKey) {
    let end = nowKey;
    if (lastSettledKey && lastSettledKey > end) end = lastSettledKey;
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push(addMonth(end, -i));
    return out;
  }

  function monthlyTotals(payments, items, months) {
    return months.map((m) => {
      let yamada = 0, kanojo = 0, has = false;
      for (const p of payments || []) {
        if (!p || p.month !== m || !isFilled(p)) continue;
        const a = Math.round(Number(p.amount) || 0);
        has = true;
        if (p.payerId === YAMADA) yamada += a; else kanojo += a;
      }
      return { month: m, yamada, kanojo, total: yamada + kanojo, has };
    });
  }

  const api = {
    YAMADA, KANOJO, yen, yamadaShare, kanojoShare, computeSettle,
    monthKey, parseMonth, monthLabel, addMonth, monthDiff, clampMonth, monthRange,
    displayName, perspectiveLabel, publicName, isFilled, parseAmountInput, settleDisplay,
    dirFromSigned, signedFromDir, ledgerTotal, settleChoice, carrySigned, repaymentSigned,
    validatePartialPaid, validateRepayment, settleKind, settleKindLabel, histStatus,
    previousFilledAmount, repaymentMonth, lastMonths, monthlyTotals,
    sortLedgerChrono, ledgerWithRunning, ledgerAbsEffect, formatLedgerWhen,
  };
  root.WarikanLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
