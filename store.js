/* データの読み書きはすべてこのモジュール経由（localStorage の 'warikan-v1'）。
   ふたりで使うときは sync.js が save() の通知を受けて Firestore に送る。
   同期で項目ごとに新しい方を選べるよう、支払い・項目・台帳の1件ごとに id と updatedAt を持つ。
   人の id は 'yamada'（1人目）と 'kanojo'（2人目）で固定。保存データと Firestore の形に含まれるので変えない。 */
(function (root) {
  const KEY = 'warikan-v1';
  const YAMADA = 'yamada';
  const KANOJO = 'kanojo';

  function uid(prefix) {
    const p = prefix || 'id';
    return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaultItems() {
    return [
      { id: 'item-yachin', name: '家賃', kind: 'fixed', defaultPayer: KANOJO, fixedAmount: 60000 },
      { id: 'item-kaimono', name: '買い物', kind: 'variable', defaultPayer: KANOJO, fixedAmount: null },
      { id: 'item-denki', name: '電気', kind: 'variable', defaultPayer: YAMADA, fixedAmount: null },
      { id: 'item-gas', name: 'ガス', kind: 'variable', defaultPayer: YAMADA, fixedAmount: null },
      { id: 'item-suidou', name: '水道', kind: 'variable', defaultPayer: YAMADA, fixedAmount: null },
      { id: 'item-net', name: 'ネット', kind: 'variable', defaultPayer: YAMADA, fixedAmount: null },
    ];
  }

  function defaultState() {
    const now = Date.now();
    return {
      version: 1,
      people: {
        // 初期の表示名。normalize は保存済みの名前をここで上書きしない。
        yamada: { id: YAMADA, name: '自分', color: '#14B8A6' },
        kanojo: { id: KANOJO, name: '相手', color: '#F97366' },
      },
      ratioYamada: 50,
      items: defaultItems(),
      payments: [],
      settlements: {},
      ledger: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  /* 古い保存データや Firestore 経由の値を、比較や反映で使える形にする */
  function coerceAmount(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
    let str = String(value);
    str = str.replace(/[０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30); });
    str = str.replace(/[．，。]/g, '.');
    str = str.replace(/[,，、\s\u3000]/g, '');
    str = str.replace(/[¥￥円]/g, '');
    if (str === '') return null;
    const n = Number(str);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  function inferItemId(p, items) {
    if (!p) return null;
    if (p.itemId) return p.itemId;
    const idMatch = String(p.id || '').match(/^p-(\d{4}-\d{2})-(.+)$/);
    if (idMatch) {
      const fromId = idMatch[2];
      if ((items || []).some(function (it) { return it && it.id === fromId; })) return fromId;
    }
    if (p.itemName) {
      const hits = (items || []).filter(function (it) { return it && it.name === p.itemName && !it.extra; });
      if (hits.length === 1) return hits[0].id;
    }
    return null;
  }

  function normalize(s) {
    const d = defaultState();
    if (!s || typeof s !== 'object') return d;
    s.version = 1;
    s.people = s.people || d.people;
    if (!s.people.yamada) s.people.yamada = d.people.yamada;
    if (!s.people.kanojo) s.people.kanojo = d.people.kanojo;
    if (!s.people.yamada.color) s.people.yamada.color = '#14B8A6';
    if (!s.people.kanojo.color) s.people.kanojo.color = '#F97366';
    if (!Number.isFinite(Number(s.ratioYamada))) s.ratioYamada = 50;
    s.ratioYamada = Math.max(0, Math.min(100, Math.round(Number(s.ratioYamada))));
    if (!Object.prototype.hasOwnProperty.call(s, 'items') || s.items == null || !Array.isArray(s.items)) {
      s.items = d.items;
    }
    (s.items || []).forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      if (it.kind !== 'fixed') it.kind = it.kind === 'variable' ? 'variable' : (it.fixedAmount != null && it.fixedAmount !== '' ? 'fixed' : (it.kind || 'variable'));
      if ('fixedAmount' in it || it.kind === 'fixed') {
        const amt = coerceAmount(it.fixedAmount);
        it.fixedAmount = it.kind === 'fixed' ? amt : null;
      }
    });

    s.payments = Array.isArray(s.payments) ? s.payments : [];
    s.payments.forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      p.extra = !!p.extra;
      if (!p.extra && !p.itemId) p.itemId = inferItemId(p, s.items);
      if (p.amount == null || p.amount === '') {
        if ('amount' in p) p.amount = null;
      } else {
        const coerced = coerceAmount(p.amount);
        if (coerced != null) p.amount = coerced;
      }
      if ('amountManual' in p) p.amountManual = !!p.amountManual;
    });
    s.settlements = s.settlements && typeof s.settlements === 'object' ? s.settlements : {};
    s.ledger = Array.isArray(s.ledger) ? s.ledger : [];
    /* v1.4.0: 残りの支払い。既存の台帳と精算（全額払いを含む）は残高が変わらないよう、そのまま読む。 */
    return s;
  }

  function load() {
    try {
      const raw = root.localStorage && localStorage.getItem(KEY);
      if (!raw) return defaultState();
      return normalize(JSON.parse(raw));
    } catch (e) {
      return defaultState();
    }
  }

  let syncMute = 0;
  function withoutSync(fn) {
    syncMute++;
    try { return fn(); } finally { syncMute--; }
  }

  function save(state, opts) {
    if (!(opts && opts.preserveUpdatedAt)) state.updatedAt = Date.now();
    if (root.localStorage) localStorage.setItem(KEY, JSON.stringify(state));
    if (!syncMute && root.WarikanSync && typeof root.WarikanSync.notifyLocal === 'function') {
      try { root.WarikanSync.notifyLocal(state); } catch (e) {}
    }
    return state;
  }

  function currentWriter() {
    try {
      const Sync = root.WarikanSync;
      if (Sync && typeof Sync.me === 'function') {
        const id = Sync.me();
        if (id === YAMADA || id === KANOJO) return id;
      }
    } catch (e) {}
    return YAMADA;
  }

  function persistNew(obj, prefix) {
    const now = Date.now();
    return Object.assign({ id: uid(prefix), createdAt: now, updatedAt: now, updatedBy: currentWriter() }, obj);
  }

  function addPayment(state, pay) {
    if (pay && pay.month && isSettled(state, pay.month)) return null;
    const p = persistNew({
      month: pay.month,
      itemId: pay.itemId || null,
      itemName: pay.itemName || '',
      payerId: pay.payerId,
      amount: coerceAmount(pay.amount),
      extra: !!pay.extra,
    }, 'p');
    if (pay.id) p.id = pay.id;
    state.payments.push(p);
    save(state);
    return p;
  }

  function updatePayment(state, id, patch) {
    const p = state.payments.find((x) => x.id === id);
    if (!p) return null;
    if (isSettled(state, p.month)) return null;
    if (patch && patch.month && isSettled(state, patch.month)) return null;
    const next = Object.assign({}, patch);
    if ('amount' in next) {
      next.amount = coerceAmount(next.amount);
      if (!('amountManual' in next)) next.amountManual = !isAmountUnentered(next.amount);
    }
    if ('amountManual' in next) next.amountManual = !!next.amountManual;
    Object.assign(p, next, { updatedAt: Date.now(), updatedBy: currentWriter() });
    save(state);
    return p;
  }

  function removePayment(state, id) {
    const p = state.payments.find((x) => x.id === id);
    if (p && isSettled(state, p.month)) return false;
    const before = state.payments.length;
    state.payments = state.payments.filter((x) => x.id !== id);
    if (state.payments.length !== before) save(state);
    return before !== state.payments.length;
  }

  function paymentsInMonth(state, month) {
    return state.payments.filter((p) => p.month === month);
  }

  function itemById(state, id) {
    return (state.items || []).find((i) => i.id === id) || null;
  }

  /* その月の項目行をそろえる。固定費は金額を自動入力、変動費は未入力。既存の行は触らない。 */
  function ensureMonth(state, month) {
    if (isSettled(state, month)) return state;
    let changed = false;
    for (const item of state.items) {
      const exists = state.payments.some((p) => p.month === month && p.itemId === item.id && !p.extra);
      if (exists) continue;
      const amount = item.kind === 'fixed' && item.fixedAmount != null ? Math.round(Number(item.fixedAmount)) : null;
      const row = persistNew({
        month,
        itemId: item.id,
        itemName: item.name,
        payerId: item.defaultPayer,
        amount: Number.isFinite(amount) ? amount : null,
        extra: false,
      }, 'p');
      row.id = 'p-' + month + '-' + item.id;
      state.payments.push(row);
      changed = true;
    }
    if (changed) save(state);
    return state;
  }

  function emptyMarks() {
    return { yamada: null, kanojo: null };
  }

  function getSettlement(state, month) {
    return state.settlements[month] || null;
  }

  function isSettled(state, month) {
    const s = state.settlements[month];
    return !!(s && s.marks && s.marks.yamada && s.marks.kanojo);
  }

  function hasAnyMark(state, month) {
    const s = state.settlements[month];
    return !!(s && s.marks && (s.marks.yamada || s.marks.kanojo));
  }

  /* v1 は1タップで2人分の印を付ける。データは人ごとの marks を残す（将来の2人確認用）。 */
  function settleMonth(state, month, snapshot) {
    const now = Date.now();
    const writer = currentWriter();
    if (snapshot && typeof snapshot === 'object') snapshot.updatedBy = writer;
    state.settlements[month] = {
      marks: { yamada: now, kanojo: now },
      settledAt: now,
      updatedBy: writer,
      snapshot: snapshot || null,
    };
    const carried = snapshot ? Math.round(Number(snapshot.carried) || 0) : 0;
    if (carried > 0 && snapshot && (snapshot.from === YAMADA || snapshot.from === KANOJO)) {
      const signed = snapshot.from === YAMADA ? carried : -carried;
      addCarry(state, month, signed, { paid: Math.round(Number(snapshot.paid) || 0), carried });
    } else {
      removeCarryForMonth(state, month, false);
      save(state);
    }
    return state.settlements[month];
  }

  function clearMarks(state, month) {
    if (!state.settlements[month] && !(state.ledger || []).some((e) => e.kind === 'carry' && e.month === month)) return false;
    if (state.settlements[month]) {
      state.settlements[month].marks = emptyMarks();
      delete state.settlements[month].settledAt;
      delete state.settlements[month].snapshot;
    }
    removeCarryForMonth(state, month, false);
    save(state);
    return true;
  }

  /* その月の支払いを追加・修正・削除したあと。印が1つでもあれば外す。割合の変更では呼ばない。 */
  function onMonthMutated(state, month) {
    if (hasAnyMark(state, month)) {
      clearMarks(state, month);
      return true;
    }
    return false;
  }

  function settledHistory(state) {
    return Object.keys(state.settlements)
      .filter((m) => isSettled(state, m))
      .sort()
      .reverse();
  }

  function lastSettledMonth(state) {
    const keys = settledHistory(state);
    return keys.length ? keys[0] : null;
  }

  function reset() {
    return save(defaultState());
  }

  function getOpening(state) {
    return (state.ledger || []).find((e) => e.kind === 'opening') || null;
  }

  function dirToSigned(from, amount) {
    const a = Math.round(Number(amount) || 0);
    if (!a || (from !== YAMADA && from !== KANOJO)) return 0;
    return from === YAMADA ? a : -a;
  }

  function fieldsFromSigned(signed) {
    const n = Math.round(Number(signed) || 0);
    if (n > 0) return { signed: n, amount: n, from: YAMADA, to: KANOJO };
    if (n < 0) return { signed: n, amount: -n, from: KANOJO, to: YAMADA };
    return { signed: 0, amount: 0, from: null, to: null };
  }

  /* これまでの残りは1件だけ。金額0なら消す。 */
  function setOpening(state, from, amount) {
    const signed = dirToSigned(from, amount);
    const cur = getOpening(state);
    if (!signed) {
      if (cur) {
        state.ledger = state.ledger.filter((e) => e.id !== cur.id);
        save(state);
      }
      return null;
    }
    const fields = Object.assign({ kind: 'opening', month: null }, fieldsFromSigned(signed));
    if (cur) {
      Object.assign(cur, fields, { updatedAt: Date.now() });
      save(state);
      return cur;
    }
    if (!state.ledger) state.ledger = [];
    const e = persistNew(fields, 'l');
    e.id = 'l-opening';
    state.ledger.push(e);
    save(state);
    return e;
  }

  function addCarry(state, month, signed, meta) {
    removeCarryForMonth(state, month, false);
    const n = Math.round(Number(signed) || 0);
    if (!n) {
      save(state);
      return null;
    }
    const fields = Object.assign({
      kind: 'carry',
      month,
      paid: meta && meta.paid != null ? Math.round(Number(meta.paid)) : 0,
      carried: meta && meta.carried != null ? Math.round(Number(meta.carried)) : Math.abs(n),
    }, fieldsFromSigned(n));
    if (!state.ledger) state.ledger = [];
    const e = persistNew(fields, 'l');
    e.id = 'l-carry-' + month;
    state.ledger.push(e);
    save(state);
    return e;
  }

  function removeCarryForMonth(state, month, doSave) {
    const before = (state.ledger || []).length;
    state.ledger = (state.ledger || []).filter((e) => !(e.kind === 'carry' && e.month === month));
    if (doSave !== false && state.ledger.length !== before) save(state);
    return before !== (state.ledger || []).length;
  }

  function addRepayment(state, signed, month) {
    const n = Math.round(Number(signed) || 0);
    if (!n) return null;
    const fields = Object.assign({ kind: 'repayment', month: month || null }, fieldsFromSigned(n));
    // 支払った人は、残りを減らす側（signed が負なら1人目が支払った）
    fields.from = n < 0 ? YAMADA : KANOJO;
    fields.to = n < 0 ? KANOJO : YAMADA;
    if (!state.ledger) state.ledger = [];
    const e = persistNew(fields, 'l');
    state.ledger.push(e);
    save(state);
    return e;
  }

  function removeLedgerEntry(state, id) {
    const e = (state.ledger || []).find((x) => x.id === id);
    if (!e || e.kind === 'carry') return false;
    state.ledger = state.ledger.filter((x) => x.id !== id);
    save(state);
    return true;
  }

  function setRatio(state, ratioYamada) {
    state.ratioYamada = Math.max(0, Math.min(100, Math.round(Number(ratioYamada))));
    save(state);
    return state.ratioYamada;
  }

  function setPersonName(state, id, name) {
    if (!state.people[id]) return;
    const n = String(name || '').trim();
    if (!n) return;
    state.people[id].name = n;
    save(state);
  }

  function addItem(state, item) {
    const it = persistNew({
      name: item.name,
      kind: item.kind === 'fixed' ? 'fixed' : 'variable',
      defaultPayer: item.defaultPayer === YAMADA ? YAMADA : KANOJO,
      fixedAmount: item.kind === 'fixed' && item.fixedAmount != null ? Math.round(Number(item.fixedAmount)) : null,
    }, 'item');
    if (item.id) it.id = item.id;
    state.items.push(it);
    save(state);
    return it;
  }

  function isAmountUnentered(amount) {
    return amount == null || amount === '';
  }

  /* 設定の項目を変えたとき、確定前の月（過去の未確定も含む）と、行がある未来の月へ反映する。
     確定済みの月と、精算画面で手入力した金額（amountManual）は触らない。
     以前は「元の固定額と同じときだけ」更新していたため、設定だけ先に変わって
     精算の金額が古いまま残っていると、そのあとの変更も反映されなかった。 */
  function applyItemToOpenMonths(state, prev, item) {
    const writer = currentWriter();
    const now = Date.now();
    let changed = false;
    for (const p of state.payments) {
      if (!p || p.extra || p.itemId !== item.id) continue;
      if (typeof p.month !== 'string') continue;
      if (isSettled(state, p.month)) continue;
      const patch = {};
      if (item.name && p.itemName !== item.name) patch.itemName = item.name;
      if (prev && item.defaultPayer && p.payerId === prev.defaultPayer && p.payerId !== item.defaultPayer) {
        patch.payerId = item.defaultPayer;
      }
      if (item.kind === 'fixed' && item.fixedAmount != null && !p.amountManual) {
        const nextAmt = coerceAmount(item.fixedAmount);
        const curAmt = coerceAmount(p.amount);
        const unentered = isAmountUnentered(p.amount) || curAmt == null;
        if (nextAmt != null && (unentered || curAmt !== nextAmt)) patch.amount = nextAmt;
      }
      if (Object.keys(patch).length) {
        Object.assign(p, patch, { updatedAt: now, updatedBy: writer });
        changed = true;
      }
    }
    return changed;
  }

  function updateItem(state, id, patch) {
    const it = state.items.find((x) => x.id === id);
    if (!it) return null;
    const prev = {
      name: it.name,
      kind: it.kind,
      defaultPayer: it.defaultPayer,
      fixedAmount: it.fixedAmount,
    };
    const next = Object.assign({}, patch);
    if ('kind' in next) next.kind = next.kind === 'fixed' ? 'fixed' : 'variable';
    if ('defaultPayer' in next) next.defaultPayer = next.defaultPayer === YAMADA ? YAMADA : KANOJO;
    if ('fixedAmount' in next) {
      next.fixedAmount = next.fixedAmount == null || next.fixedAmount === '' ? null : Math.round(Number(next.fixedAmount));
    }
    if (next.kind === 'variable') next.fixedAmount = null;
    Object.assign(it, next, { updatedAt: Date.now(), updatedBy: currentWriter() });
    applyItemToOpenMonths(state, prev, it);
    save(state);
    return it;
  }

  function removeItem(state, id) {
    const before = state.items.length;
    state.items = state.items.filter((x) => x.id !== id);
    if (state.items.length !== before) save(state);
    return before !== state.items.length;
  }

  function isStateLike(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
    if (s.people && typeof s.people === 'object' && !Array.isArray(s.people)) return true;
    if (Array.isArray(s.payments) || Array.isArray(s.ledger) || Array.isArray(s.items)) return true;
    if (s.settlements && typeof s.settlements === 'object' && !Array.isArray(s.settlements)) return true;
    return false;
  }

  function parseBackup(raw) {
    let data;
    try {
      data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return { ok: false };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false };
    let src = null;
    let exportedAt = null;
    let appVersion = null;
    if (data.state && typeof data.state === 'object' && !Array.isArray(data.state) && (data.app === 'warikan' || isStateLike(data.state))) {
      src = data.state;
      exportedAt = data.exportedAt || data.savedAt || null;
      appVersion = data.version != null ? data.version : null;
    } else if (isStateLike(data)) {
      src = data;
      exportedAt = data.exportedAt || null;
    }
    if (!src) return { ok: false };
    let clone;
    try { clone = JSON.parse(JSON.stringify(src)); } catch (e) { return { ok: false }; }
    const state = normalize(clone);
    const payments = Array.isArray(src.payments) ? src.payments : [];
    if (!exportedAt && state.updatedAt) exportedAt = state.updatedAt;
    return { ok: true, state, exportedAt, appVersion, paymentsCount: payments.length };
  }

  function buildBackup(state, info) {
    info = info || {};
    return {
      app: 'warikan',
      version: info.version || '2.1.1', // 呼び出し側は APP_VERSION を渡す。版を上げたらここも合わせる（version.spec.js で照合）
      exportedAt: info.exportedAt || new Date().toISOString(),
      state: state,
    };
  }

  function applyBackup(parsed) {
    if (!parsed || !parsed.ok || !parsed.state) return null;
    return save(parsed.state);
  }

  const api = {
    KEY, uid, defaultState, defaultItems, normalize, load, save, withoutSync,
    parseBackup, buildBackup, applyBackup,
    addPayment, updatePayment, removePayment, paymentsInMonth, itemById, ensureMonth,
    getSettlement, isSettled, hasAnyMark, settleMonth, clearMarks, onMonthMutated, settledHistory,
    lastSettledMonth, reset,
    getOpening, setOpening, addCarry, removeCarryForMonth, addRepayment, removeLedgerEntry,
    setRatio, setPersonName, addItem, updateItem, removeItem,
  };
  root.WarikanStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
