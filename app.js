/*
 * わりかん — 画面とイベント。
 *
 * 依存（index.html で先に読み込む）:
 *   WarikanLogic … 計算・日付（logic.js）
 *   WarikanStore … データの読み書き（store.js、localStorage）
 *   WarikanSync  … ふたりで使うときの同期（sync.js、Firebase）。無くても動く
 *
 * 描画は「state を変える → render() で今のタブを作り直す」の一方向。
 * ボタンは data-act 属性で区別し、body のクリックを ACTIONS 表から引く（「イベント」の節）。
 *
 * 節の並び: 状態 / テーマ / 人と名前 / バックアップ / トースト / シート（dialog）/
 *   精算カード / 今月 / 履歴 / ふたりで使う / 設定 / 全体描画 / 支払いダイアログ / 項目編集 / イベント / 更新バー / 起動
 *
 * window.__warikan* はテスト用のつまみ（時刻の固定、同期のメモリ化など）。本番では使わない。
 */
(() => {
  const L = window.WarikanLogic;
  const S = window.WarikanStore;
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  /* ---------- 定数 ---------- */
  const APP_VERSION = '2.1.1';
  const THEME_KEY = 'warikan-theme';
  const BACKUP_AT_KEY = 'warikan-backup-at';
  const RESTORED_AT_KEY = 'warikan-backup-restored-at';
  const SETTLE_ADVANCE_MS = 600;    // 精算後、次の月へスライドするまでの待ち
  const dlg = document.getElementById('dlg');
  // 同期モジュールが無いとき（読み込み失敗など）の代わり。常に「共有していない」として振る舞う
  const Sync = window.WarikanSync || {
    isActive: function () { return false; },
    status: function () { return { active: false }; },
    init: function () {},
    resume: function () { return Promise.resolve(false); },
    parseJoinHash: function () { return null; },
    parseJoinInput: function () { return null; },
    me: function () { return null; },
    setMe: function () { return null; },
  };

  /* ---------- 状態 ---------- */
  let state = S.load();
  let tab = 'home';                 // 'home'（精算）| 'hist'（履歴）| 'set'（設定）
  let month = L.monthKey(window.__warikanNow != null ? new Date(window.__warikanNow) : new Date());
  let lastNow = nowKey();           // 月またぎの検出用
  let lastAmt = null;               // 前回出した精算額（変わったときだけフェードさせる）
  let chartSel = null;              // 履歴グラフで選んでいる月
  let chartShown = false;
  let animateFrom = null;
  // 残りの支払い（台帳）画面と、ブラウザの戻る操作の対応
  let ledgerOpen = false;
  let ledgerPushed = false;
  let ignoreLedgerPop = false;
  let backPending = false;
  let wantLedgerAfterBack = false;
  // 精算した直後の「確定しました」表示と、次の月へのスライド
  let justSettled = false;
  let sliding = false;
  let settleAdvanceTimer = null;
  let settleStepsOpen = false;
  let pendingRestore = null;        // 読み込んだバックアップ（確認待ち）
  let pendingJoin = null;           // 招待リンクから開いた参加の情報（確認待ち）
  let shareBusy = false;

  /* ---------- テーマ ---------- */
  function themeValue() {
    try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch (e) { return 'light'; }
  }
  function applyTheme(tname, { save = true } = {}) {
    const tval = tname === 'dark' ? 'dark' : 'light';
    if (save) {
      try { localStorage.setItem(THEME_KEY, tval); } catch (e) {}
    }
    document.documentElement.setAttribute('data-theme', tval);
    document.documentElement.style.colorScheme = tval;
    const meta = document.getElementById('themeColor') || document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = tval === 'dark' ? '#1C1B1A' : '#FAF8F5';
  }
  applyTheme(themeValue(), { save: false });

  /* ---------- 動きと月 ---------- */
  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function settleDelayMs() {
    if (window.__warikanSettleDelay != null) return Math.max(0, Number(window.__warikanSettleDelay) || 0);
    return SETTLE_ADVANCE_MS;
  }
  function lastSettled() { return S.lastSettledMonth(state); }
  function firstOpenMonth() {
    const last = lastSettled();
    if (!last) return nowKey();
    return L.addMonth(last, 1);
  }

  /* ---------- 人と名前 ---------- */
  // 人の id は 'yamada'（1人目）と 'kanojo'（2人目）で固定。表示名は設定の名前を使う
  function person(id) { return state.people[id]; }
  function nameOf(id) { return L.displayName(person(id)); }
  function colorOf(id) { return person(id).color; }
  function myId() {
    const id = typeof Sync.me === 'function' ? Sync.me() : (Sync.status && Sync.status().me);
    return (id === 'yamada' || id === 'kanojo') ? id : null;
  }
  function partnerId() {
    const me = myId();
    return me ? (me === 'yamada' ? 'kanojo' : 'yamada') : null;
  }
  function labelOf(id) {
    return L.perspectiveLabel(nameOf(id), !!(myId() && id === myId()), !!myId());
  }
  function peopleOrder() {
    return myId() === 'kanojo' ? ['kanojo', 'yamada'] : ['yamada', 'kanojo'];
  }
  function applyMeAccent() {
    const me = myId();
    if (me) document.documentElement.setAttribute('data-me', me);
    else document.documentElement.removeAttribute('data-me');
  }
  function remainPhrase(dir, { short = false } = {}) {
    if (!dir || !dir.from) return { text: '', recv: false };
    const me = myId();
    if (!me) {
      const a = short ? shortName(dir.from) : nameOf(dir.from);
      const b = short ? shortName(dir.to) : nameOf(dir.to);
      return { text: a + ' → ' + b, recv: false };
    }
    const otherId = me === dir.from ? dir.to : dir.from;
    const otherName = labelOf(otherId);
    if (dir.from === me) return { text: otherName + 'に払う', recv: false };
    return { text: otherName + 'から受け取る', recv: true };
  }
  function isRecvRemain(dir) {
    return !!(dir && remainPhrase(dir).recv);
  }
  function repayActionLabel(dir) {
    return isRecvRemain(dir) ? '受け取った' : '支払った';
  }
  function nowDate() { return window.__warikanNow != null ? new Date(window.__warikanNow) : new Date(); }
  function nowKey() { return L.monthKey(nowDate()); }
  function bounds() { return L.monthRange(nowKey(), lastSettled()); }

  /* ---------- バックアップ ---------- */
  function backupFileStamp(d) {
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }
  function formatBackupDay(d) {
    const md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    if (d.getFullYear() !== nowDate().getFullYear()) return d.getFullYear() + '年' + md;
    return md;
  }
  function formatBackupFullDate(val) {
    if (val == null || val === '') return '';
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return '';
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function readTimeKey(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
      const ms = Date.parse(raw);
      return Number.isFinite(ms) ? ms : null;
    } catch (e) { return null; }
  }
  function lastBackupAt() { return readTimeKey(BACKUP_AT_KEY); }
  function lastRestoredAt() { return readTimeKey(RESTORED_AT_KEY); }
  function markBackupSaved(ts) {
    try { localStorage.setItem(BACKUP_AT_KEY, String(ts != null ? ts : nowDate().getTime())); } catch (e) {}
  }
  function markBackupRestored(ts) {
    try { localStorage.setItem(RESTORED_AT_KEY, String(ts != null ? ts : nowDate().getTime())); } catch (e) {}
  }
  function nagReferenceAt() {
    const saved = lastBackupAt();
    const restored = lastRestoredAt();
    if (saved == null && restored == null) return null;
    return Math.max(saved || 0, restored || 0);
  }
  function backupMetaHtml() {
    const hint = '<span class="backup-meta-hint">精算すると自動で保存します。</span>';
    const at = lastBackupAt();
    const status = at
      ? `<span class="backup-meta-status">最後の保存：${esc(formatBackupDay(new Date(at)))}</span>`
      : `<span class="backup-meta-status unset">まだ保存していません</span>`;
    return `<p class="backup-meta">${hint}${status}</p>`;
  }

  function backupStale() {
    const at = nagReferenceAt();
    if (at == null) return (S.settledHistory(state) || []).length > 0;
    return (nowDate().getTime() - at) >= 35 * 24 * 60 * 60 * 1000;
  }

  function backupNagHtml() {
    if (!backupStale()) return '';
    const msg = lastBackupAt() == null ? 'まだバックアップを保存していません' : 'バックアップが1か月以上前です';
    return `<button type="button" class="backup-nag" data-act="backup-save"><span class="backup-nag-msg">${msg}</span><span class="backup-nag-go">今すぐ保存 ›</span></button>`;
  }

  function refreshBackupChrome() {
    const meta = document.querySelector('.backup-meta');
    if (meta) meta.outerHTML = backupMetaHtml();
    const nag = document.querySelector('.backup-nag');
    if (backupStale()) {
      if (!nag && tab === 'home' && !ledgerOpen) {
        const main = document.getElementById('main');
        if (main) main.insertAdjacentHTML('afterbegin', backupNagHtml());
      }
    } else if (nag) nag.remove();
  }

  /* ユーザー操作の中で同期的に呼ぶ。share の前に await / setTimeout を置かない。 */
  function offerBackup() {
    const when = nowDate();
    const payload = S.buildBackup(state, { version: APP_VERSION, exportedAt: when.toISOString() });
    const name = 'warikan-backup-' + backupFileStamp(when) + '.json';
    const json = JSON.stringify(payload);
    const blob = new Blob([json], { type: 'application/json' });
    let file = null;
    try { file = new File([blob], name, { type: 'application/json' }); } catch (e) { file = null; }
    let sharePromise = null;
    try {
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        sharePromise = navigator.share({ files: [file], title: 'わりかんのバックアップ' });
      }
    } catch (e) {
      sharePromise = null;
    }
    if (sharePromise && typeof sharePromise.then === 'function') {
      sharePromise.then(() => {
        markBackupSaved(when.getTime());
        refreshBackupChrome();
      }).catch((err) => {
        if (err && err.name === 'AbortError') return;
      });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
    markBackupSaved(when.getTime());
    refreshBackupChrome();
  }

  /* ---------- トースト ---------- */
  function showToast(msg, opts) {
    const t = document.getElementById('toast');
    t.hidden = false;
    t.textContent = msg;
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    const writer = opts && opts.writer;
    if (writer) {
      t.classList.add('toast-remote');
      t.setAttribute('data-who', writer === 'kanojo' ? 'kanojo' : 'yamada');
    } else {
      t.classList.remove('toast-remote');
      t.removeAttribute('data-who');
    }
    clearTimeout(showToast._t);
    const ms = (opts && opts.ms) || (writer ? 3000 : 2000);
    showToast._t = setTimeout(() => {
      t.hidden = true;
      t.classList.remove('toast-remote');
      t.removeAttribute('data-who');
    }, ms);
  }

  function savedToast(label, amount) {
    showToast(label + ' ' + L.yen(amount) + ' を保存しました');
  }

  /* ---------- シート（dialog） ---------- */
  function ensureSheetChrome(sheet) {
    if (!sheet || sheet.querySelector(':scope > .sheet-body')) return;
    const body = document.createElement('div');
    body.className = 'sheet-body';
    const acts = sheet.querySelector(':scope > .acts');
    [...sheet.childNodes].forEach((n) => {
      if (n !== acts) body.appendChild(n);
    });
    if (acts) sheet.insertBefore(body, acts);
    else sheet.appendChild(body);
  }

  function liftSheetForKeyboard() {
    const sheet = dlg.querySelector('.sheet');
    if (!dlg.open || !sheet) return;
    ensureSheetChrome(sheet);
    const vv = window.visualViewport;
    const visH = Math.round(vv ? vv.height : window.innerHeight);
    const offset = vv ? (vv.offsetTop || 0) : 0;
    const bottomGap = Math.max(0, Math.round(window.innerHeight - visH - offset));
    const maxH = Math.max(120, visH);
    dlg.style.maxHeight = maxH + 'px';
    dlg.style.marginBottom = bottomGap + 'px';
    sheet.style.maxHeight = maxH + 'px';
    sheet.style.paddingBottom = '';
    const ae = document.activeElement;
    const scroller = sheet.querySelector('.sheet-body') || sheet;
    if (ae && scroller.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) {
      try { ae.scrollIntoView({ block: 'nearest', behavior: 'auto' }); } catch (err) {}
    }
  }

  let dlgOpener = null;
  let dlgOpenerSel = null;
  let restoreOpenerTimer = null;

  function sheetFocusables() {
    const root = dlg.querySelector('.sheet') || dlg;
    const sel = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return [...root.querySelectorAll(sel)].filter((el) => {
      if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  function rememberDlgOpener(el) {
    if (!el || el === document.body || el === document.documentElement || (dlg && dlg.contains(el))) {
      return;
    }
    dlgOpener = el;
    const act = el.getAttribute && el.getAttribute('data-act');
    if (act) {
      let s = '[data-act="' + act + '"]';
      const month = el.getAttribute('data-month');
      const id = el.getAttribute('data-id');
      if (month) s += '[data-month="' + month + '"]';
      if (id) s += '[data-id="' + id + '"]';
      dlgOpenerSel = s;
    } else if (el.id) {
      dlgOpenerSel = '#' + el.id;
    } else {
      dlgOpenerSel = null;
    }
  }

  let skipDlgRestore = false;
  function restoreDlgOpener() {
    if (skipDlgRestore) {
      dlgOpener = null;
      dlgOpenerSel = null;
      return;
    }
    const node = dlgOpener;
    const sel = dlgOpenerSel;
    dlgOpener = null;
    dlgOpenerSel = null;
    if (restoreOpenerTimer) clearTimeout(restoreOpenerTimer);
    restoreOpenerTimer = setTimeout(() => {
      restoreOpenerTimer = null;
      let el = node && document.contains(node) ? node : null;
      if (!el && sel) {
        try { el = document.querySelector(sel); } catch (err) { el = null; }
      }
      if (el && typeof el.focus === 'function') el.focus();
    }, 0);
  }

  function trapSheetTab(e) {
    if (e.key !== 'Tab' || !dlg.open) return;
    const root = dlg.querySelector('.sheet') || dlg;
    const list = sheetFocusables();
    if (!list.length) {
      e.preventDefault();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    const inList = list.indexOf(active) >= 0;
    if (e.shiftKey) {
      if (!inList || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !root.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  function cleanupDlgChrome() {
    dlg.style.maxHeight = '';
    dlg.style.marginBottom = '';
  }

  function bindSheetKeyboard() {
    if (bindSheetKeyboard._on) return;
    const on = () => liftSheetForKeyboard();
    bindSheetKeyboard._on = on;
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', on);
      window.visualViewport.addEventListener('scroll', on);
    }
    window.addEventListener('resize', on);
    dlg.addEventListener('focusin', on);
    dlg.addEventListener('keydown', trapSheetTab, true);
    dlg.addEventListener('close', () => {
      cleanupDlgChrome();
      restoreDlgOpener();
    });
  }

  function showAppDialog(build, { stepChange = true } = {}) {
    const first = !dlg.open;
    if (first) rememberDlgOpener(document.activeElement);
    removeCloseGhost();
    build();
    if (!dlg.open) dlg.showModal();
    bindSheetKeyboard();
    liftSheetForKeyboard();
    if (first || stepChange) {
      const focus = dlg.querySelector('[autofocus]') || dlg.querySelector('h2');
      if (focus) {
        if (focus.tagName === 'H2') { focus.setAttribute('tabindex', '-1'); }
        focus.focus();
      }
    }
    liftSheetForKeyboard();
  }

  // 閉じるときの下に滑る動き：見た目だけのコピーを動かし、本物はすぐ閉じる
  let closeGhost = null;
  function removeCloseGhost() {
    if (!closeGhost) return;
    closeGhost.forEach((el) => el.remove());
    closeGhost = null;
  }
  function playCloseGhost() {
    removeCloseGhost();
    const r = dlg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dim = document.createElement('div');
    dim.className = 'dlg-ghost-dim';
    dim.setAttribute('aria-hidden', 'true');
    const g = document.createElement('div');
    g.className = 'dlg-ghost';
    g.setAttribute('aria-hidden', 'true');
    g.inert = true;
    g.innerHTML = dlg.innerHTML;
    g.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    Object.assign(g.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    const sb = dlg.querySelector('.sheet-body');
    document.body.append(dim, g);
    const gsb = g.querySelector('.sheet-body');
    if (sb && gsb) gsb.scrollTop = sb.scrollTop;
    const pair = [dim, g];
    closeGhost = pair;
    setTimeout(() => { if (closeGhost === pair) removeCloseGhost(); else pair.forEach((el) => el.remove()); }, 260);
  }

  function closeDlg({ restore = true } = {}) {
    if (!restore) {
      dlgOpener = null;
      dlgOpenerSel = null;
      skipDlgRestore = true;
    }
    if (dlg.open) {
      playCloseGhost();
      dlg.close();
    }
    skipDlgRestore = false;
    cleanupDlgChrome();
    dlg.innerHTML = '';
  }

  function mutateMonth(monthKey, fn) {
    if (S.isSettled(state, monthKey)) return;
    const was = S.hasAnyMark(state, monthKey);
    fn();
    if (was) S.onMonthMutated(state, monthKey);
    else state = S.save(state);
  }

  /* ---------- 精算カード ---------- */
  function liveSettle(m) {
    if (!S.isSettled(state, m)) S.ensureMonth(state, m);
    const pays = S.paymentsInMonth(state, m);
    return L.computeSettle(pays, state.ratioYamada);
  }

  function settleFor(m) {
    return L.settleDisplay(liveSettle(m), S.getSettlement(state, m));
  }

  function unfilledCount(m) {
    S.ensureMonth(state, m);
    return S.paymentsInMonth(state, m).filter((p) => !L.isFilled(p)).length;
  }

  function stepHtml(r) {
    const y = labelOf('yamada');
    const k = labelOf('kanojo');
    const row = (lab, amt) => `<p class="settle-step"><span class="lab">${esc(lab)}</span><span class="yen">${L.yen(amt)}</span></p>`;
    return `<div class="settle-steps" id="settleSteps">
      ${row(k + 'が払った分', r.kanojoPaid)}
      ${row('→ ' + y + 'の負担', r.yamadaBurdenOfKanojo)}
      ${row(y + 'が払った分', r.yamadaPaid)}
      ${row('→ ' + k + 'の負担', r.kanojoBurdenOfYamada)}
    </div>`;
  }

  function whoLine(r) {
    if (!r.from) return `<div class="settle-who">貸し借りなし</div>`;
    return `<div class="settle-who">
      <span class="nm"><i class="dot" style="background:${colorOf(r.from)}"></i>${esc(labelOf(r.from))}</span>
      <span aria-hidden="true">→</span>
      <span class="nm"><i class="dot" style="background:${colorOf(r.to)}"></i>${esc(labelOf(r.to))}</span>
    </div>`;
  }

  function viewMeId() {
    return myId() || 'yamada';
  }

  function paymentsInOrder(m) {
    S.ensureMonth(state, m);
    const items = state.items;
    const pays = S.paymentsInMonth(state, m);
    const rows = [];
    for (const item of items) {
      const p = pays.find((x) => x.itemId === item.id && !x.extra);
      if (p) rows.push(p);
    }
    for (const p of pays) {
      if (p.extra || !items.some((i) => i.id === p.itemId)) rows.push(p);
    }
    const me = viewMeId();
    const mine = [];
    const other = [];
    for (const p of rows) {
      if (p.payerId === me) mine.push(p);
      else other.push(p);
    }
    return mine.concat(other);
  }

  function unfilledPayments(m) {
    return paymentsInOrder(m).filter((p) => !L.isFilled(p));
  }

  function filledProgress(m) {
    const rows = paymentsInOrder(m);
    return { filled: rows.filter((p) => L.isFilled(p)).length, total: rows.length };
  }

  function settleAmtLabel(r, m) {
    const mon = shortMonth(m) + '分';
    if (r.from) return mon + '、' + labelOf(r.from) + 'が渡す額';
    return mon + 'の精算額';
  }

  function progressHtml(m) {
    const { filled, total } = filledProgress(m);
    if (!total) return '';
    if (filled >= total) return `<p class="settle-progress-lab done">すべて入力済み ✓</p>`;
    const pct = Math.round((filled / total) * 100);
    return `<div class="settle-progress">
      <p class="settle-progress-lab">${filled}/${total} 入力済み</p>
      <div class="settle-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
    </div>`;
  }

  function renderSettleCard(m, { showActions = true } = {}) {
    const r = settleFor(m);
    const settled = S.isSettled(state, m);
    if (justSettled && settled && showActions) {
      return `<section class="card settle settled" data-card="settle">
        <p class="settle-confirmed">${esc(shortMonth(m))}を確定しました</p>
      </section>`;
    }
    const unfilled = unfilledCount(m);
    let actions = '';
    if (showActions && !settled) {
      if (unfilled) {
        actions = `<div class="settle-acts">
          <button type="button" class="btn" data-act="fill-missing">未入力を入れる（${unfilled}件）</button>
          <button type="button" class="btn ghost" data-act="settle">精算する</button>
        </div>`;
      } else {
        actions = `<button type="button" class="btn" data-act="settle">精算する</button>`;
      }
    } else if (showActions && settled) {
      const stepsOpenC = settleStepsOpen;
      return `<section class="card settle settled compact" data-card="settle">
        <div class="settle-compact">
          <span class="settle-done">🔒 ${esc(shortMonth(m))}は確定済み</span>
          <span class="settle-compact-amt" id="settleAmt" data-amt="${r.amount}">${L.yen(r.amount)}</span>
        </div>
        <button type="button" class="settle-detail" data-act="toggle-steps" aria-expanded="${stepsOpenC ? 'true' : 'false'}" aria-controls="settleSteps">${stepsOpenC ? '△ 閉じる' : '▽ 詳細'}</button>
        <div class="settle-steps-wrap${stepsOpenC ? ' is-open' : ''}" id="settleSteps">
          ${stepHtml(r)}
        </div>
        <button type="button" class="settle-done-hint" data-act="goto-hist">修正は履歴から</button>
      </section>`;
    }
    const stepsOpen = settleStepsOpen;
    return `<section class="card settle${settled ? ' settled' : ''}" data-card="settle">
      ${whoLine(r)}
      <p class="settle-amt-lab">${esc(settleAmtLabel(r, m))}</p>
      <div class="settle-amt${r.amount === 0 ? ' zero' : ''}" id="settleAmt" data-amt="${r.amount}">${L.yen(r.amount)}</div>
      <button type="button" class="settle-detail" data-act="toggle-steps" aria-expanded="${stepsOpen ? 'true' : 'false'}" aria-controls="settleSteps">${stepsOpen ? '△ 閉じる' : '▽ 詳細'}</button>
      <div class="settle-steps-wrap${stepsOpen ? ' is-open' : ''}">
        ${stepHtml(r)}
      </div>
      ${progressHtml(m)}
      ${actions}
    </section>`;
  }

  function applySettle() {
    if (S.isSettled(state, month) || sliding) return;
    const fromMonth = month;
    const live = liveSettle(fromMonth);
    const snap = Object.assign({}, live, {
      ratioYamada: state.ratioYamada,
      choice: 'settled',
      paid: 0,
      carried: live.amount,
    });
    S.settleMonth(state, fromMonth, snap);
    offerBackup();
    closeDlg({ restore: false });
    justSettled = true;
    lastAmt = live.amount;
    render();
    const dest = firstOpenMonth();
    const delay = settleDelayMs();
    clearTimeout(settleAdvanceTimer);
    const go = () => {
      justSettled = false;
      if (tab !== 'home' || ledgerOpen || month !== fromMonth) {
        if (tab === 'home' && !ledgerOpen) render();
        return;
      }
      if (dest === fromMonth) {
        render();
        return;
      }
      if (reduceMotion() || delay === 0) {
        month = dest;
        if (!S.isSettled(state, month)) S.ensureMonth(state, month);
        render();
        showToast(shortMonth(dest) + 'になりました');
        return;
      }
      slideToMonth(dest);
    };
    if (delay === 0) go();
    else settleAdvanceTimer = setTimeout(go, delay);
  }

  function slideToMonth(dest) {
    if (sliding) return;
    sliding = true;
    const topEl = document.getElementById('top');
    const mainEl = document.getElementById('main');
    const oldTop = topEl.innerHTML;
    const oldMain = mainEl.innerHTML;
    month = dest;
    if (!S.isSettled(state, month)) S.ensureMonth(state, month);
    justSettled = false;
    renderHome();
    const newTop = topEl.innerHTML;
    const newMain = mainEl.innerHTML;
    const wrap = (a, b) => `<div class="mslide"><div class="mslide-track"><div class="mslide-pane">${a}</div><div class="mslide-pane">${b}</div></div></div>`;
    topEl.innerHTML = wrap(oldTop, newTop);
    mainEl.innerHTML = wrap(oldMain, newMain);
    const tracks = [...document.querySelectorAll('.mslide-track')];
    void (tracks[0] && tracks[0].offsetWidth);
    tracks.forEach((el) => el.classList.add('go'));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      sliding = false;
      render();
      showToast(shortMonth(dest) + 'になりました');
    };
    const tr = tracks[0];
    if (tr) tr.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 500);
  }

  function shortName(id) {
    const p = person(id);
    return (p && p.name) || nameOf(id);
  }

  function tsukeWhoHtml(dir) {
    if (!dir || !dir.from) return '';
    const fullP = remainPhrase(dir);
    const shortP = remainPhrase(dir, { short: true });
    return `<span class="tsuke-who tsuke-who-full">${esc(fullP.text)}</span><span class="tsuke-who tsuke-who-short">${esc(shortP.text)}</span>`;
  }

  function tsukeHeadHtml(label, dir, { asButton = false } = {}) {
    const stacked = !!(dir && dir.from && myId());
    const who = stacked
      ? `<span class="tsuke-who">${esc(remainPhrase(dir).text)}</span>`
      : tsukeWhoHtml(dir);
    const body = dir && dir.from
      ? `<div class="tsuke-lab">${esc(label)}</div>
         <div class="tsuke-main${stacked ? ' stack' : ''}">
           ${who}
           <span class="tsuke-amt">${L.yen(dir.amount)}</span>
         </div>`
      : `<div class="tsuke-lab">${esc(label)}</div>
         <div class="tsuke-main"><span class="tsuke-none">残りなし</span></div>`;
    if (asButton) {
      return `<button type="button" class="tsuke-body tsuke-open" data-act="open-ledger" aria-label="支払いの記録を開く">${body}</button>`;
    }
    return `<div class="tsuke-body">${body}</div>`;
  }

  function isFirstRunTsuke() {
    return !S.getOpening(state) && !(state.ledger && state.ledger.length) && !S.settledHistory(state).length;
  }

  function renderTsukeCard() {
    const total = L.ledgerTotal(state.ledger);
    const dir = L.dirFromSigned(total);
    const first = isFirstRunTsuke();
    const body = first
      ? `<button type="button" class="tsuke-body tsuke-open" data-act="open-ledger" aria-label="支払いの記録を開く">
           <div class="tsuke-lab">残りの支払い</div>
         </button>`
      : tsukeHeadHtml('残りの支払い', dir, { asButton: true });
    const repay = !first && dir.from
      ? `<button type="button" class="btn ghost tsuke-repay" data-act="repay">${esc(repayActionLabel(dir))}</button>`
      : '';
    const hintBtn = first
      ? `<button type="button" class="btn ghost tsuke-repay" data-act="edit-opening">入力する</button>`
      : '';
    const recv = !first && remainPhrase(dir).recv;
    return `<section class="card tsuke${recv ? ' recv' : ''}" data-card="tsuke">
      ${body}
      ${hintBtn}
      ${repay}
    </section>`;
  }

  function repayButton(dir) {
    if (!dir || !dir.from) return '';
    return `<button type="button" class="btn ghost tsuke-repay" data-act="repay">${esc(repayActionLabel(dir))}</button>`;
  }

  function openRepay() {
    const total = L.ledgerTotal(state.ledger);
    const dir = L.dirFromSigned(total);
    if (!dir.from) return;
    showAppDialog(() => {
      const phrase = remainPhrase(dir);
      const act = repayActionLabel(dir);
      const note = phrase.text
        ? (myId()
          ? `<p class="note remain-stack${phrase.recv ? ' recv-note' : ''}"><span class="remain-line">${esc(phrase.text)}</span><span class="remain-yen">${L.yen(dir.amount)}</span></p>`
          : `<p class="note">${esc(phrase.text)} ${L.yen(dir.amount)}</p>`)
        : '';
      dlg.innerHTML = `<form class="sheet" id="repayForm" novalidate>
        <h2 id="dh" tabindex="-1" autofocus>${esc(act)}</h2>
        ${note}
        <div class="f">
          <label for="repayAmt">${esc(act)}金額</label>
          <input id="repayAmt" type="text" inputmode="numeric" placeholder="例：4,000" autofocus>
          <p class="field-err" id="repayErr" hidden></p>
        </div>
        <div class="acts">
          <button type="button" class="btn ghost" data-act="repay-all">全額 ${L.yen(dir.amount)}</button>
          <button type="submit" class="btn">${esc(act)}</button>
          <button type="button" class="btn ghost" data-act="close">キャンセル</button>
        </div>
      </form>`;
      dlg.setAttribute('aria-labelledby', 'dh');
      dlg.onsubmit = (e) => {
        e.preventDefault();
        const parsed = L.validateRepayment(dlg.querySelector('#repayAmt').value, dir.amount);
        if (!parsed.ok) {
          const err = dlg.querySelector('#repayErr');
          if (err) { err.hidden = false; err.textContent = parsed.message; }
          const amt = dlg.querySelector('#repayAmt');
          if (amt) amt.focus();
          return;
        }
        S.addRepayment(state, L.repaymentSigned(total, parsed.value), nowKey());
        closeDlg({ restore: false });
        showToast(L.yen(parsed.value) + (isRecvRemain(dir) ? ' を受け取りました' : ' を支払いました'));
        render();
        if (ledgerOpen) focusLedgerHeading();
      };
      dlg.oninput = (e) => {
        if (e.target.id === 'repayAmt') {
          const err = dlg.querySelector('#repayErr');
          if (err) { err.hidden = true; err.textContent = ''; }
        }
      };
    });
  }

  function renderLedger() {
    document.getElementById('top').innerHTML = `<nav class="mnav">
      <button type="button" data-act="close-ledger" aria-label="戻る">‹</button>
      <b tabindex="-1">支払いの記録</b>
      <span class="mnav-spacer" aria-hidden="true"></span>
    </nav>`;
    const { total, rows } = L.ledgerWithRunning(state.ledger);
    const dir = L.dirFromSigned(total);
    const head = `<div class="tsuke-now${remainPhrase(dir).recv ? ' recv' : ''}">${tsukeHeadHtml('残りの支払い', dir)}${repayButton(dir)}</div>`;
    if (!rows.length) {
      document.getElementById('main').innerHTML = head + `<p class="empty">まだ記録がありません</p>`;
      return;
    }
    document.getElementById('main').innerHTML = head + `
      <div class="card hlist" style="padding-top:0;padding-bottom:0">${rows.map(({ entry, after, effect }) => {
        const canDel = entry.kind === 'opening' || entry.kind === 'repayment';
        const when = L.formatLedgerWhen(entry);
        const afterDir = L.dirFromSigned(after);
        const afterTxt = afterDir.from
          ? `残り ${remainPhrase(afterDir).text} ${L.yen(afterDir.amount)}`
          : '残りなし';
        const grew = effect === 'inc';
        const sign = grew ? '+' : '−';
        const amtClass = grew ? 'amt inc' : 'amt dec';
        const del = canDel
          ? `<button type="button" class="lrow-del" data-act="del-ledger" data-id="${escAttr(entry.id)}">消す</button>`
          : `<span class="lrow-del lrow-del-ph" aria-hidden="true"></span>`;
        return `<div class="lrow">
          <div class="l">
            <b>${esc(when)}</b>
            <small class="after">${esc(afterTxt)}</small>
          </div>
          <span class="${amtClass}">${sign}${L.yen(entry.amount)}</span>
          ${del}
        </div>`;
      }).join('')}</div>`;
  }

  function confirmDelLedger(id) {
    const e = (state.ledger || []).find((x) => x.id === id);
    if (!e || e.kind === 'carry') return;
    showAppDialog(() => {
      dlg.innerHTML = `<div class="sheet">
        <h2 id="dh" tabindex="-1" autofocus>この記録を消しますか？</h2>
        <p class="note">消すと残りの支払いが変わります。</p>
        <div class="acts">
          <button type="button" class="btn danger" data-act="del-ledger-ok" data-id="${escAttr(id)}">消す</button>
          <button type="button" class="btn ghost" data-act="close">キャンセル</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    });
  }

  function openOpening() {
    const cur = S.getOpening(state);
    let from = (cur && cur.from) || 'yamada';
    const draw = (stepChange) => showAppDialog(() => {
      dlg.innerHTML = `<form class="sheet" id="openForm" novalidate>
        <h2 id="dh" tabindex="-1">残りの支払い</h2>
        <p class="note">アプリを使い始める前からの残りを入れておけます。あとから直せます。</p>
        <div class="f">
          <label>向き</label>
          <div class="acts" style="margin:0">
            ${peopleOrder().map((id) => {
              const other = id === 'yamada' ? 'kanojo' : 'yamada';
              const coral = id === 'kanojo' ? ' coral' : '';
              return `<button type="button" class="pick ${from === id ? 'on' : ''}${coral}" data-open-from="${id}" style="--on:${colorOf(id)}">${esc(labelOf(id))} → ${esc(labelOf(other))}</button>`;
            }).join('')}
          </div>
        </div>
        <div class="f">
          <label for="openAmt">金額</label>
          <input id="openAmt" type="text" inputmode="numeric" placeholder="例：4,000" value="${cur && cur.amount ? escAttr(String(cur.amount)) : ''}" autofocus>
          <p class="field-err" id="openErr" hidden></p>
          <p class="note">空か 0 にすると、これまでの残りは消えます。</p>
        </div>
        <div class="acts">
          <button type="submit" class="btn">保存</button>
          ${cur ? `<button type="button" class="btn danger" data-act="del-opening">消す</button>` : ''}
          <button type="button" class="btn ghost" data-act="close">キャンセル</button>
        </div>
      </form>`;
      dlg.setAttribute('aria-labelledby', 'dh');
      dlg.onclick = (e) => {
        const pick = e.target.closest('[data-open-from]');
        if (!pick) return;
        from = pick.dataset.openFrom;
        const amt = dlg.querySelector('#openAmt');
        if (amt && cur) { /* keep typed value */ }
        const typed = dlg.querySelector('#openAmt') && dlg.querySelector('#openAmt').value;
        draw(false);
        const again = dlg.querySelector('#openAmt');
        if (again && typed != null) again.value = typed;
        if (again) again.focus();
      };
      dlg.onsubmit = (e) => {
        e.preventDefault();
        const raw = dlg.querySelector('#openAmt').value;
        if (!String(raw).trim()) {
          S.setOpening(state, from, 0);
          closeDlg({ restore: false });
          render();
          return;
        }
        const parsed = L.parseAmountInput(raw);
        if (!parsed.ok) {
          const err = dlg.querySelector('#openErr');
          if (err) { err.hidden = false; err.textContent = parsed.message; }
          dlg.querySelector('#openAmt').focus();
          return;
        }
        S.setOpening(state, from, parsed.value);
        closeDlg({ restore: false });
        render();
      };
      dlg.oninput = (e) => {
        if (e.target.id === 'openAmt') {
          const err = dlg.querySelector('#openErr');
          if (err) { err.hidden = true; err.textContent = ''; }
        }
      };
    }, { stepChange });
    draw(true);
  }

  function animateSettleIfNeeded() {
    const el = document.getElementById('settleAmt');
    if (!el) { lastAmt = null; return; }
    const to = Number(el.dataset.amt);
    const from = animateFrom != null ? animateFrom : lastAmt;
    lastAmt = to;
    animateFrom = null;
    el.textContent = L.yen(to);
    if (from == null || from === to) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    el.classList.remove('settle-amt-fade');
    void el.offsetWidth;
    el.classList.add('settle-amt-fade');
  }

  /* ---------- 今月 ---------- */
  function groupPayLabel(isMine, sum) {
    const yen = L.yen(sum);
    if (myId()) {
      return isMine ? ('自分が払う ' + yen) : (labelOf(partnerId()) + 'が払う ' + yen);
    }
    const me = viewMeId();
    const other = me === 'yamada' ? 'kanojo' : 'yamada';
    return (isMine ? nameOf(me) : nameOf(other)) + 'が払う ' + yen;
  }

  function paymentRows(m) {
    const rows = paymentsInOrder(m);
    if (!rows.length) return `<p class="empty">支払いがまだありません</p>`;
    const locked = S.isSettled(state, m);
    const me = viewMeId();
    const groups = [{ mine: true, rows: [] }, { mine: false, rows: [] }];
    rows.forEach((p) => { (p.payerId === me ? groups[0] : groups[1]).rows.push(p); });
    const rowHtml = (p) => {
      const item = S.itemById(state, p.itemId);
      const label = (item && item.name) || p.itemName || '支払い';
      const filled = L.isFilled(p);
      const inner = `<span class="meta">
          <span class="name">${esc(label)}</span>
          <span class="who"><i class="dot" style="background:${colorOf(p.payerId)}"></i>${esc(labelOf(p.payerId))}</span>
        </span>
        <span class="amt${filled ? '' : ' empty'}">${filled ? L.yen(p.amount) : '未入力'}</span>`;
      if (locked) return `<li><div class="prow is-locked" data-id="${p.id}">${inner}</div></li>`;
      return `<li><button type="button" class="prow" data-act="edit-pay" data-id="${p.id}">${inner}</button></li>`;
    };
    const parts = [];
    groups.forEach((g) => {
      if (!g.rows.length) return;
      const sum = g.rows.reduce((n, p) => n + (L.isFilled(p) ? Math.round(Number(p.amount)) : 0), 0);
      parts.push(`<li class="phead">${esc(groupPayLabel(g.mine, sum))}</li>`);
      g.rows.forEach((p) => { parts.push(rowHtml(p)); });
    });
    return `<ul class="plist">${parts.join('')}</ul>`;
  }

  function renderHome() {
    const b = bounds();
    const atMin = month <= b.min;
    const atMax = month >= b.max;
    const locked = S.isSettled(state, month);
    const lock = locked ? '<span class="mlock" aria-hidden="true">🔒</span>' : '';
    const mLab = L.monthLabel(month);
    const parts = L.parseMonth(month);
    document.getElementById('top').innerHTML = `<nav class="mnav">
      <button type="button" data-act="prev-m" aria-label="前の月" ${atMin ? 'disabled' : ''}>‹</button>
      <b id="mLbl" class="mlbl" tabindex="-1"${locked ? ` aria-label="${escAttr(mLab + '（精算済み）')}"` : ''}><span class="myear">${parts.y}年</span><span class="mmon">${parts.m}月</span>${lock}</b>
      <button type="button" data-act="next-m" aria-label="次の月" ${atMax ? 'disabled' : ''}>›</button>
    </nav>`;
    document.getElementById('main').innerHTML =
      backupNagHtml() +
      renderSettleCard(month) +
      renderTsukeCard() +
      `<div class="sec-h"><h2>支払い</h2></div>
       <div class="card" style="padding-top:8px;padding-bottom:8px">${paymentRows(month)}</div>` +
      (locked ? '' : `<button type="button" class="btn ghost addpay" data-act="add-pay">項目を追加</button>`);
    animateSettleIfNeeded();
  }

  /* ---------- 履歴 ---------- */
  function repaymentsInMonth(m) {
    return (state.ledger || []).filter((e) => e.kind === 'repayment' && L.repaymentMonth(e) === m);
  }

  function historyMonths() {
    const set = {};
    (S.settledHistory(state) || []).forEach((m) => { set[m] = true; });
    (state.ledger || []).forEach((e) => {
      if (e.kind !== 'repayment') return;
      const mk = L.repaymentMonth(e);
      if (mk) set[mk] = true;
    });
    return Object.keys(set).sort().reverse();
  }

  function shortMonth(m) { return L.parseMonth(m).m + '月'; }

  function defaultChartSel() {
    const cur = nowKey();
    const settled = lastSettled();
    return (settled && settled > cur) ? settled : cur;
  }

  function chartData() {
    const cur = nowKey();
    const months = L.lastMonths(cur, 6, lastSettled());
    if (!chartSel || months.indexOf(chartSel) < 0) {
      const want = defaultChartSel();
      chartSel = months.indexOf(want) >= 0 ? want : (months[months.length - 1] || cur);
    }
    const data = L.monthlyTotals(state.payments, state.items, months);
    return { cur, months, data };
  }

  function chartBarsHtml(cd) {
    const { cur, data } = cd;
    const max = Math.max(1, ...data.map((d) => d.total));
    const H = 140;
    return data.map((d) => {
      const on = d.month === chartSel;
      const isCur = d.month === cur;
      let inner;
      if (!d.has || d.total <= 0) {
        inner = `<span class="cbar-stub"></span>`;
      } else {
        const h = Math.max(4, Math.round((d.total / max) * H));
        const yh = d.total ? Math.round(h * d.yamada / d.total) : 0;
        const kh = h - yh;
        const gap = yh > 0 && kh > 0 ? 2 : 0;
        inner = `<span class="cbar-stack" style="height:${h}px">
          ${kh > 0 ? `<span class="cbar-k" style="height:${Math.max(0, kh - gap)}px"></span>` : ''}
          ${gap ? `<span class="cbar-gap" style="height:2px"></span>` : ''}
          ${yh > 0 ? `<span class="cbar-y" style="height:${yh}px"></span>` : ''}
        </span>`;
      }
      return `<button type="button" class="cbar${on ? ' on' : ''}${isCur ? ' cur' : ''}" data-act="chart-sel" data-month="${d.month}"
        aria-pressed="${on ? 'true' : 'false'}" aria-label="${shortMonth(d.month)} 合計${d.total.toLocaleString('en-US')}円">
        <span class="cbar-plot">${inner}</span>
        <span class="cbar-lab">${shortMonth(d.month)}</span>
      </button>`;
    }).join('');
  }

  function chartDetailHtml(cd) {
    const { months, data } = cd;
    const i = months.indexOf(chartSel);
    const sel = data[i];
    const prev = i > 0 ? data[i - 1] : null;
    const nm = shortMonth(sel.month);
    const dot = (id) => `<i class="dot" style="background:var(${id === 'yamada' ? '--c-y' : '--c-k'})"></i>`;
    const line1 = `<p class="chart-sum">${nm} 合計 ${L.yen(sel.total)}</p>`;
    const line2 = `<p class="chart-who">${peopleOrder().map((id) => `<span class="pair">${dot(id)}${esc(labelOf(id))} ${L.yen(id === 'yamada' ? sel.yamada : sel.kanojo)}</span>`).join('　')}</p>`;
    let diffHtml;
    if (!sel.has) {
      diffHtml = `<p class="chart-diff flat">この月のデータなし</p>`;
    } else if (prev && prev.has) {
      const diff = sel.total - prev.total;
      const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
      const txt = diff > 0 ? '+' + L.yen(diff) : diff < 0 ? '−' + L.yen(-diff) : '±' + L.yen(0);
      diffHtml = `<p class="chart-diff ${cls}">先月より ${txt}</p>`;
    } else {
      diffHtml = `<p class="chart-diff flat">先月のデータなし</p>`;
    }
    return line1 + line2 + diffHtml;
  }

  function renderChart() {
    const cd = chartData();
    const animate = !chartShown;
    chartShown = true;
    return `<section class="card chart${animate ? ' grow' : ''}" data-card="chart">
      <h2 class="chart-title">月ごとの支払い</h2>
      <div class="chart-bars">${chartBarsHtml(cd)}</div>
      <div class="chart-detail" aria-live="polite">${chartDetailHtml(cd)}</div>
    </section>`;
  }

  /* 月の選択と切替は、カードと aria-live の器を残したまま中身だけ差し替える */
  function updateChartInPlace({ bars } = {}) {
    const card = document.querySelector('[data-card=chart]');
    if (!card) { render(); return; }
    const cd = chartData();
    card.classList.remove('grow');
    if (bars) {
      card.querySelector('.chart-bars').innerHTML = chartBarsHtml(cd);
    } else {
      card.querySelectorAll('.cbar').forEach((x) => {
        const on = x.dataset.month === chartSel;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    card.querySelector('.chart-detail').innerHTML = chartDetailHtml(cd);
  }

  function renderHist() {
    document.getElementById('top').innerHTML = `<h1>履歴</h1>`;
    const chart = renderChart();
    const keys = historyMonths();
    const link = `<p class="hist-ledger"><button type="button" class="btn ghost" data-act="open-ledger">支払いの記録を見る</button></p>`;
    if (!keys.length) {
      document.getElementById('main').innerHTML = chart + `<p class="empty">まだ精算した月はありません</p>` + link;
      return;
    }
    const rows = keys.map((m) => {
      const settled = S.isSettled(state, m);
      const snap = settled ? (S.getSettlement(state, m) || {}).snapshot : null;
      const st = L.histStatus(snap);
      const r = snap || settleFor(m);
      const line = r.from ? `${labelOf(r.from)} → ${labelOf(r.to)} ${L.yen(r.amount)}` : `貸し借りなし ${L.yen(0)}`;
      const unconfirm = settled ? `<button type="button" class="h-unconfirm" data-act="unconfirm" data-month="${m}">修正</button>` : '';
      const monthRow = `<div class="hrow-wrap">
        <button type="button" class="hrow" data-act="open-hist" data-month="${m}">
          <span class="l"><b>${esc(L.monthLabel(m))}</b><small>${esc(line)}</small></span>
          <span class="hbadge hbadge-${st.key}">${esc(st.label)}</span>
        </button>
        ${unconfirm}
      </div>`;
      const repaid = repaymentsInMonth(m).reduce((n, e) => n + (Number(e.amount) || 0), 0);
      const repayRow = repaid
        ? `<button type="button" class="hrow hrow-repay" data-act="open-ledger">
             <span class="l"><b>支払った −${L.yen(repaid)}</b></span>
           </button>`
        : '';
      return monthRow + repayRow;
    }).join('');
    document.getElementById('main').innerHTML = chart + `<div class="card hlist" style="padding-top:0;padding-bottom:0">${rows}</div>` + link;
  }

  function openHist(m) {
    const settled = S.isSettled(state, m);
    const snap = settled ? (S.getSettlement(state, m) || {}).snapshot : null;
    const r = snap || settleFor(m);
    const mark = settled ? L.settleKindLabel(snap) : '未精算';
    showAppDialog(() => {
      dlg.innerHTML = `<div class="sheet">
        <h2 id="dh">${esc(L.monthLabel(m))}の精算</h2>
        ${stepHtml(r)}
        ${whoLine(r)}
        <div class="settle-amt${r.amount === 0 ? ' zero' : ''}">${L.yen(r.amount)}</div>
        <div class="settle-done">${esc(mark)}</div>
        <div class="hist-pays">${paymentRows(m)}</div>
        <div class="acts">
          <button type="button" class="btn ghost" data-act="close">閉じる</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    });
  }


  function openRestorePicker() {
    let input = document.getElementById('backupFile');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'backupFile';
      input.accept = '.json,application/json';
      input.hidden = true;
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const parsed = S.parseBackup(String(reader.result || ''));
          if (!parsed.ok) {
            showToast('このファイルは読み込めませんでした');
            return;
          }
          pendingRestore = parsed;
          openRestoreConfirm(parsed);
        };
        reader.onerror = () => showToast('このファイルは読み込めませんでした');
        reader.readAsText(file);
      });
      document.body.appendChild(input);
    }
    input.click();
  }

  function openRestoreConfirm(parsed) {
    const date = formatBackupFullDate(parsed.exportedAt);
    const dateLine = date ? `<p class="note">ファイルの保存日：${esc(date)}</p>` : '';
    showAppDialog(() => {
      dlg.innerHTML = `<div class="sheet">
        <h2 id="dh" tabindex="-1" autofocus>バックアップから戻しますか？</h2>
        <p>いまのデータは、ファイルの内容に置き換わります</p>
        ${Sync.isActive() ? '<p>ふたりのデータが置き換わります</p>' : ''}
        ${dateLine}
        <p class="note">支払い：${parsed.paymentsCount}件</p>
        <div class="acts">
          <button type="button" class="btn" data-act="restore-ok">戻す</button>
          <button type="button" class="btn ghost" data-act="close">やめる</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    });
  }

  function applyPendingRestore() {
    const parsed = pendingRestore;
    pendingRestore = null;
    closeDlg({ restore: false });
    if (!parsed || !parsed.ok) return;
    const applied = S.applyBackup(parsed);
    if (!applied) {
      showToast('このファイルは読み込めませんでした');
      return;
    }
    state = applied;
    const exportedMs = parsed.exportedAt ? Date.parse(parsed.exportedAt) : NaN;
    markBackupSaved(Number.isFinite(exportedMs) ? exportedMs : nowDate().getTime());
    markBackupRestored(nowDate().getTime());
    tab = 'home';
    ledgerOpen = false;
    ledgerPushed = false;
    justSettled = false;
    sliding = false;
    clearTimeout(settleAdvanceTimer);
    lastAmt = null;
    chartSel = null;
    chartShown = false;
    settleStepsOpen = false;
    month = firstOpenMonth();
    if (!S.isSettled(state, month)) S.ensureMonth(state, month);
    if (Sync.isActive()) {
      Promise.resolve(Sync.flush && Sync.flush()).catch(function () {});
    }
    window.scrollTo(0, 0);
    render();
    showToast('バックアップから戻しました');
  }

  function openWipeConfirm() {
    showAppDialog(() => {
      dlg.innerHTML = `<div class="sheet">
        <h2 id="dh" tabindex="-1" autofocus>全てのデータを削除しますか？</h2>
        <p class="note">支払い・履歴・残りの支払いがすべて消えます。元には戻せません。</p>
        ${Sync.isActive() ? '<p class="note">この端末の共有は解除されます。相手の端末とクラウドのデータは残ります。</p>' : ''}
        <div class="acts">
          <button type="button" class="btn danger-fill" data-act="wipe-ok">削除する</button>
          <button type="button" class="btn ghost" data-act="close">やめる</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    });
  }

  function wipeAllData() {
    closeDlg({ restore: false });
    const after = function () {
    try { localStorage.removeItem(RESTORED_AT_KEY); } catch (e) {}
    state = S.reset();
    tab = 'home';
    ledgerOpen = false;
    ledgerPushed = false;
    justSettled = false;
    sliding = false;
    clearTimeout(settleAdvanceTimer);
    lastAmt = null;
    chartSel = null;
    chartShown = false;
    month = firstOpenMonth();
    if (!S.isSettled(state, month)) S.ensureMonth(state, month);
    render();
    showToast('すべてのデータを削除しました');
    };
    if ((Sync.isActive() || (Sync.status && Sync.status().canReconnect) || (Sync.canReconnect && Sync.canReconnect())) && Sync.leave) {
      Promise.resolve(Sync.leave({ forget: true })).then(after).catch(after);
    } else after();
  }

  /* ---------- ふたりで使う ---------- */
  function shareCardHtml() {
    const st = Sync.status ? Sync.status() : { active: false };
    const lines = [];
    if (st.active && st.offline) {
      lines.push('<p class="share-status off">オフライン（あとで同期します）</p>');
    }
    if (st.active && st.memberCount >= 2) {
      lines.push('<p class="share-status ok">共有中（ふたり）</p>');
    } else if (st.active && st.memberCount < 2) {
      const who = L.publicName(st.waitingName, '');
      lines.push('<p class="share-status wait">' + (who ? esc(who) + 'の参加待ち' : '参加待ち') + '</p>');
    } else {
      lines.push('<p class="note" style="margin:0 0 8px">別の端末からも、同じデータを使えるようにします。</p>');
    }
    let actions = '';
    if (!st.active && st.canReconnect) {
      lines.length = 0;
      if (st.offline) lines.push('<p class="share-status off">オフライン（あとで同期します）</p>');
      lines.push('<p class="note" style="margin:0 0 8px">前につながっていたデータに、もう一度つながります。</p>');
      actions = '<button type="button" class="btn" data-act="share-reconnect"' + (shareBusy ? ' disabled' : '') + '>もう一度つなぐ</button>';
      actions += '<button type="button" class="btn text" data-act="share-start"' + (shareBusy ? ' disabled' : '') + '>共有を始める</button>';
      actions += '<button type="button" class="btn ghost" data-act="share-join-enter"' + (shareBusy ? ' disabled' : '') + '>招待リンクで参加</button>';
    } else if (!st.active) {
      actions = '<button type="button" class="btn" data-act="share-start"' + (shareBusy ? ' disabled' : '') + '>共有を始める</button>';
      actions += '<button type="button" class="btn ghost" data-act="share-join-enter"' + (shareBusy ? ' disabled' : '') + '>招待リンクで参加</button>';
    } else {
      if (st.memberCount < 2) {
        actions += '<button type="button" class="btn" data-act="share-invite">招待リンクを送る</button>';
      } else {
        actions += '<button type="button" class="btn ghost" data-act="share-invite">招待リンクを送る</button>';
      }
      actions += '<button type="button" class="btn text" data-act="share-leave">共有をやめる</button>';
    }
    return `<div class="card" data-card="share">
      <h2 style="margin:0 0 8px;font-size:16px">ふたりで使う</h2>
      ${lines.join('')}
      ${actions}
    </div>`;
  }

  function startShareFlow() {
    if (!Sync.startShare || shareBusy) return;
    shareBusy = true;
    const btn = document.querySelector('[data-act=share-start]');
    if (btn) btn.disabled = true;
    Sync.startShare().then(function () {
      shareBusy = false;
      render();
      showToast('共有を始めました。招待リンクを送ってね');
    }).catch(function () {
      shareBusy = false;
      render();
      showToast('共有を始められませんでした');
    });
  }

  function sendInviteLink() {
    const payload = Sync.shareInvitePayload && Sync.shareInvitePayload();
    const url = (payload && payload.url) || (Sync.inviteUrl && Sync.inviteUrl()) || '';
    if (!url) { showToast('リンクを作れませんでした'); return; }
    let sharePromise = null;
    try {
      if (navigator.share) sharePromise = navigator.share(payload || { title: 'わりかん', url: url });
    } catch (e) { sharePromise = null; }
    if (sharePromise && typeof sharePromise.then === 'function') {
      sharePromise.catch(function () {});
      return;
    }
    showAppDialog(function () {
      dlg.innerHTML = `<div class="sheet">
        <h2 id="dh" tabindex="-1" autofocus>招待リンク</h2>
        <p class="note" style="word-break:break-all">${esc(url)}</p>
        <div class="acts">
          <button type="button" class="btn ghost" data-act="close">閉じる</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    });
  }

  function openLeaveConfirm() {
    showAppDialog(function () {
      dlg.innerHTML = `<div class="sheet">
        <h2 id="dh" tabindex="-1" autofocus>共有をやめますか？</h2>
        <p class="note">この端末だけ共有をやめます。データはこの端末に残ります。</p>
        <div class="acts">
          <button type="button" class="btn danger" data-act="share-leave-ok">共有をやめる</button>
          <button type="button" class="btn ghost" data-act="close">キャンセル</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    });
  }

  function leaveShareFlow() {
    closeDlg({ restore: false });
    Promise.resolve(Sync.leave && Sync.leave()).then(function () {
      render();
      showToast('この端末の共有をやめました');
    }).catch(function () {
      render();
      showToast('共有をやめられませんでした');
    });
  }

  const STASH_KEY = 'warikan-reconnect-backup';
  function stashLocalBackup() {
    try {
      const payload = S.buildBackup(state, { version: APP_VERSION, exportedAt: nowDate().toISOString() });
      localStorage.setItem(STASH_KEY, JSON.stringify(payload));
    } catch (e) {}
    try { offerBackup(); } catch (e) {}
  }

  function openReconnectConfirm() {
    showAppDialog(function () {
      dlg.innerHTML = `<div class="sheet">
        <h2 id="dh" tabindex="-1" autofocus>もう一度つながりますか？</h2>
        <p>つながっているデータで、この端末のデータを置き換えます。</p>
        <p class="note">いまのこの端末のデータはバックアップに残します。</p>
        <div class="acts">
          <button type="button" class="btn" data-act="share-reconnect-ok">つなぐ</button>
          <button type="button" class="btn ghost" data-act="close">やめる</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    });
  }

  function showAuthLost() {
    showAppDialog(function () {
      dlg.innerHTML = `<div class="sheet">
        <h2 id="dh" tabindex="-1" autofocus>つなぎ直できませんでした</h2>
        <p>この端末のログインが残っていないため、もう一度つなぐことができません。招待リンクをもらって参加してください。</p>
        <div class="acts">
          <button type="button" class="btn ghost" data-act="close">閉じる</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    });
  }

  function reconnectShareFlow() {
    closeDlg({ restore: false });
    if (!Sync.reconnect || shareBusy) return;
    stashLocalBackup();
    shareBusy = true;
    Sync.reconnect().then(function (res) {
      shareBusy = false;
      if (res && res.ok) {
        month = firstOpenMonth();
        if (!S.isSettled(state, month)) S.ensureMonth(state, month);
        render();
        showToast('もう一度つながりました');
        return;
      }
      if (res && res.reason === 'auth-lost') {
        Promise.resolve(Sync.leave && Sync.leave({ forget: true })).finally(function () {
          render();
          showAuthLost();
        });
        return;
      }
      render();
      showToast('つなぎ直できませんでした');
    }).catch(function () {
      shareBusy = false;
      render();
      showToast('つなぎ直できませんでした');
    });
  }

  let pendingConflict = null;
  function payAmountText(p) {
    if (!p) return '（なし）';
    return L.isFilled(p) ? L.yen(p.amount) : '未入力';
  }
  function openPaymentConflict(payload) {
    pendingConflict = payload || {};
    const mine = pendingConflict.mine;
    const theirs = pendingConflict.theirs;
    const writer = (theirs && theirs.updatedBy) || (partnerId && partnerId()) || 'kanojo';
    const other = labelOf(writer) || '相手';
    const item = (mine && (S.itemById(state, mine.itemId) || {}).name) || (mine && mine.itemName) || (theirs && theirs.itemName) || '支払い';
    showAppDialog(function () {
      dlg.innerHTML = `<div class="sheet">
        <h2 id="dh" tabindex="-1" autofocus>${esc(other)}が先に変えました</h2>
        <p class="note">${esc(item)}</p>
        <p>相手：${esc(payAmountText(theirs))}</p>
        <p>自分：${esc(payAmountText(mine))}</p>
        <div class="acts">
          <button type="button" class="btn" data-act="conflict-theirs">相手のままにする</button>
          <button type="button" class="btn ghost" data-act="conflict-mine">自分のを使う</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    });
  }
  function applyConflictTheirs() {
    const c = pendingConflict;
    pendingConflict = null;
    closeDlg({ restore: false });
    if (!c) return;
    if (c.theirs && c.theirs.id) {
      const i = state.payments.findIndex((x) => x.id === c.theirs.id);
      S.withoutSync(function () {
        if (i >= 0) state.payments[i] = c.theirs;
        else state.payments.push(c.theirs);
        S.save(state);
      });
    } else if (c.mine && c.mine.id) {
      S.withoutSync(function () { S.removePayment(state, c.mine.id); });
    }
    render();
  }
  function applyConflictMine() {
    const c = pendingConflict;
    pendingConflict = null;
    closeDlg({ restore: false });
    if (!c || !c.mine) { render(); return; }
    const mine = Object.assign({}, c.mine, { updatedAt: Date.now() });
    if (S.updatePayment) {
      const i = state.payments.findIndex((x) => x.id === mine.id);
      S.withoutSync(function () {
        if (i >= 0) Object.assign(state.payments[i], mine);
        else state.payments.push(mine);
        S.save(state);
      });
    }
    if (Sync.isActive() && Sync.commitPayment) {
      Sync.commitPayment(c.theirs && c.theirs.updatedAt, mine, { force: true }).then(function () { render(); });
    } else render();
  }

  let noticeBuf = [];
  let noticeTimer = null;
  let flashUntil = {};
  function applyRowFlash() {
    const now = Date.now();
    Object.keys(flashUntil).forEach((id) => {
      if (flashUntil[id].until < now) { delete flashUntil[id]; return; }
      const el = document.querySelector('.prow[data-id="' + id + '"]');
      if (!el) return;
      el.setAttribute('data-flash-who', flashUntil[id].who === 'kanojo' ? 'kanojo' : 'yamada');
      el.classList.add('flash');
      if (flashUntil[id].static) el.classList.add('flash-static');
    });
  }
  function queueRemoteNotices(events) {
    try { window.__warikanRemoteNotices = (window.__warikanRemoteNotices || []).concat(events || []); } catch (e) {}
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    (events || []).forEach((e) => {
      const key = (e.kind || '') + ':' + (e.payment && e.payment.id || e.month || '') + ':' + ((e.payment && e.payment.updatedAt) || '');
      if (noticeBuf.some((x) => ((x.kind || '') + ':' + (x.payment && x.payment.id || x.month || '') + ':' + ((x.payment && x.payment.updatedAt) || '')) === key)) return;
      noticeBuf.push(e);
      if (e.payment && e.payment.id) {
        flashUntil[e.payment.id] = { until: Date.now() + 1500, who: e.writer, static: reduce };
      }
    });
    applyRowFlash();
    if (!noticeTimer) noticeTimer = setTimeout(flushRemoteNotices, 400);
  }
  function flushRemoteNotices() {
    noticeTimer = null;
    const ev = noticeBuf;
    noticeBuf = [];
    if (!ev.length) return;
    const writer = ev[0].writer;
    const nm = labelOf(writer) || '相手';
    let msg;
    if (ev.length === 1 && ev[0].kind === 'settle') {
      msg = nm + 'が' + shortMonth(ev[0].month) + 'を精算しました';
    } else if (ev.length === 1 && ev[0].payment) {
      const item = S.itemById(state, ev[0].payment.itemId);
      const label = (item && item.name) || ev[0].payment.itemName || '支払い';
      msg = ev[0].kind === 'pay-edit' ? (nm + 'が' + label + 'を直しました') : (nm + 'が' + label + 'を入力しました');
    } else {
      msg = nm + 'が支払いを更新しました';
    }
    showToast(msg, { writer: writer, ms: 3000 });
  }

  function commitAfterLocalWrite(id, expectedUpdatedAt, thenFn) {
    const written = state.payments.find((x) => x.id === id);
    if (!Sync.isActive || !Sync.isActive() || !Sync.commitPayment || !written) {
      if (thenFn) thenFn({ ok: true });
      return;
    }
    Sync.commitPayment(expectedUpdatedAt, written).then(function (res) {
      if (res && res.conflict) {
        openPaymentConflict({ mine: written, theirs: res.remote, expectedUpdatedAt: expectedUpdatedAt });
        return;
      }
      if (thenFn) thenFn(res || { ok: true });
    }).catch(function () { if (thenFn) thenFn({ ok: true }); });
  }

  function openJoinConfirm(info, invite) {
    pendingJoin = info;
    const hostName = L.publicName((invite && invite.hostName) || '', '');
    const connect = hostName
      ? esc(hostName) + 'のデータとつながります'
      : '共有のデータとつながります';
    showAppDialog(function () {
      dlg.innerHTML = `<div class="sheet">
        <h2 id="dh" tabindex="-1" autofocus>共有に参加しますか？</h2>
        <p>${connect}</p>
        <p class="note">この端末にあるデータは置き換わります</p>
        <div class="acts">
          <button type="button" class="btn" data-act="share-join-ok">参加する</button>
          <button type="button" class="btn ghost" data-act="close">やめる</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    });
  }

  function confirmJoinFlow() {
    const info = pendingJoin;
    pendingJoin = null;
    closeDlg({ restore: false });
    if (!info || !Sync.join) return;
    shareBusy = true;
    Sync.join(info.hid, info.token).then(function () {
      shareBusy = false;
      try { history.replaceState({ warikan: 'home' }, '', location.pathname + location.search); } catch (e) {}
      month = firstOpenMonth();
      if (!S.isSettled(state, month)) S.ensureMonth(state, month);
      tab = 'set';
      render();
      showToast('共有に参加しました');
    }).catch(function (err) {
      shareBusy = false;
      render();
      openJoinError(info, err);
    });
  }

  /* 参加できなかった理由を、ふつうの言葉で出す */
  function joinErrorText(info, err) {
    const c = Sync.classifyJoinError ? Sync.classifyJoinError(err) : { kind: 'other', code: (err && err.code) || 'unknown', step: '' };
    const host = L.publicName((info && info.hostName) || '', '相手');
    const codeLine = 'コード: ' + c.code + (c.step ? '（' + c.step + '）' : '');
    if (c.kind === 'used') {
      return { kind: c.kind, title: 'この招待はもう使われています', body: 'この招待リンクでは、もうふたりがつながっています。' + host + 'に、設定の「共有をやめる」→「共有を始める」で新しい招待リンクを作って送ってもらってね。', code: codeLine, retry: false };
    }
    if (c.kind === 'invalid') {
      return { kind: c.kind, title: 'この招待リンクは使えません', body: 'リンクが古いか、途中で切れています。' + host + 'に新しい招待リンクを送ってもらってね。', code: codeLine, retry: false };
    }
    if (c.kind === 'own') {
      return { kind: c.kind, title: '自分で作った招待リンクです', body: 'このリンクは相手の携帯で開いてね。', code: codeLine, retry: false };
    }
    if (c.kind === 'network') {
      return { kind: c.kind, title: '通信できませんでした', body: '電波のいい所で、もう一度ためしてね。', code: codeLine, retry: true };
    }
    if (c.kind === 'permission') {
      return { kind: c.kind, title: '権限エラーで参加できませんでした', body: 'もうふたりがつながっています。' + host + 'に、設定の「共有をやめる」→「共有を始める」で新しい招待リンクを作って送ってもらってね。', code: codeLine, retry: true };
    }
    return { kind: c.kind, title: '参加できませんでした', body: 'もう一度ためしてね。だめなら下のコードを伝えてね。', code: codeLine, retry: true };
  }

  function openJoinError(info, err) {
    const t = joinErrorText(info, err);
    pendingJoin = t.retry ? info : null;
    showAppDialog(function () {
      dlg.innerHTML = `<div class="sheet" data-join-error="${esc(t.kind)}">
        <h2 id="dh" tabindex="-1" autofocus>${esc(t.title)}</h2>
        <p>${esc(t.body)}</p>
        <p class="note" data-join-code>${esc(t.code)}</p>
        <div class="acts">
          ${t.retry ? '<button type="button" class="btn" data-act="share-join-ok">もう一度ためす</button>' : ''}
          <button type="button" class="btn ${t.retry ? 'ghost' : ''}" data-act="close">閉じる</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    });
  }

  function replaceStateFromSync(next) {
    /* 受信のたびに updatedAt を付け替えると、差分が残った扱いになって書き込みが止まらなくなる */
    if (S.withoutSync) S.withoutSync(function () { S.save(next, { preserveUpdatedAt: true }); });
    else S.save(next, { preserveUpdatedAt: true });
    state = next;
    if (tab === 'home' && !ledgerOpen && !S.isSettled(state, month)) {
      if (S.withoutSync) S.withoutSync(function () { S.ensureMonth(state, month); });
      else S.ensureMonth(state, month);
    }
    render();
  }

  function inAppKind() {
    const fn = Sync.isInAppBrowser || (window.WarikanSync && window.WarikanSync.isInAppBrowser);
    if (typeof fn === 'function') return fn();
    return null;
  }
  function inAppAppName(kind) {
    if (kind === 'instagram') return 'Instagram';
    if (kind === 'facebook') return 'Facebook';
    return 'LINE';
  }
  function joinLinkForCopy(info) {
    if (info && typeof Sync.inviteUrl === 'function') {
      const u = Sync.inviteUrl(info.hid, info.token);
      if (u) return u;
    }
    if (!info || !info.hid || !info.token) return location.href;
    const base = Sync.INVITE_BASE || 'https://yaching04.github.io/warikan/';
    return base + '?openExternalBrowser=1#join=' + info.hid + '.' + info.token;
  }
  function copyText(text) {
    function fallback() {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }
  function openInAppJoinSheet(info) {
    const kind = inAppKind() || 'line';
    const appName = inAppAppName(kind);
    const url = joinLinkForCopy(info);
    showAppDialog(function () {
      dlg.innerHTML = `<div class="sheet" data-inapp-join="${esc(kind)}">
        <h2 id="dh" tabindex="-1" autofocus>${esc(appName)}の中で開いています</h2>
        <p>Safariで開いてから参加してね</p>
        <p class="note">右下の…から「ブラウザで開く」を選ぶか、リンクをコピーしてSafariで開いてね。</p>
        <div class="acts">
          <button type="button" class="btn" data-act="copy-join-link" data-url="${escAttr(url)}">リンクをコピー</button>
          <button type="button" class="btn ghost" data-act="close">閉じる</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    });
  }
  function inAppBannerHtml() {
    const kind = inAppKind();
    if (!kind) return '';
    if (!(Sync.isActive && Sync.isActive())) return '';
    const appName = inAppAppName(kind);
    return `<div class="inapp-banner" data-inapp-banner>
      <p>${esc(appName)}の中で開いています。Safariやホーム画面のアプリで開くと、別の人として表示されてしまいます。右下の…から「ブラウザで開く」を選んでね。</p>
    </div>`;
  }

  function parseJoinFromInput(text) {
    const fn = Sync.parseJoinInput || (window.WarikanSync && window.WarikanSync.parseJoinInput);
    if (typeof fn === 'function') return fn(text);
    if (typeof Sync.parseJoinHash === 'function') {
      return Sync.parseJoinHash(text) || Sync.parseJoinHash('#join=' + String(text || '').trim());
    }
    return null;
  }

  function isStandaloneDisplay() {
    try {
      if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
      if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (e) {}
    return false;
  }

  function isIOSDevice() {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    if (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
    return false;
  }

  function beginJoinFromInfo(info) {
    if (!info || !info.hid || !info.token) return;
    if (Sync.peekInvite) {
      Sync.peekInvite(info.hid, info.token).then(function (inv) {
        info.hostName = (inv && inv.hostName) || '';
        openJoinConfirm(info, inv || {});
      }).catch(function (err) {
        const c = Sync.classifyJoinError ? Sync.classifyJoinError(err) : { kind: 'other' };
        if (c.code === 'permission-denied') {
          openJoinError(info, Object.assign(new Error('invite-invalid'), { code: 'invite-invalid', step: 'invite-read' }));
          return;
        }
        openJoinConfirm(info, {});
      });
    } else {
      openJoinConfirm(info, {});
    }
  }

  function refreshJoinInputDetect() {
    const input = dlg.querySelector('#joinInput');
    if (!input) return;
    const parsed = parseJoinFromInput(input.value);
    const hint = dlg.querySelector('[data-join-detected]');
    if (hint) hint.hidden = !parsed;
    if (parsed) {
      input.setAttribute('data-hid', parsed.hid);
      input.setAttribute('data-token', parsed.token);
    } else {
      input.removeAttribute('data-hid');
      input.removeAttribute('data-token');
    }
  }

  function openPasteJoinSheet() {
    showAppDialog(function () {
      dlg.innerHTML = `<div class="sheet" data-join-paste>
        <div class="sheet-body">
          <h2 id="dh" tabindex="-1">招待リンクで参加</h2>
          <p class="note">届いた招待リンクを貼ってね</p>
          <div class="f" style="margin:0">
            <label for="joinInput">招待リンク</label>
            <textarea id="joinInput" class="join-input" rows="4" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus placeholder="リンクを貼る"></textarea>
            <p class="note join-detected" data-join-detected hidden>リンクを読み取りました</p>
          </div>
        </div>
        <div class="acts">
          <button type="button" class="btn" data-act="share-join-paste">参加する</button>
          <button type="button" class="btn ghost" data-act="close">閉じる</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
      dlg.oninput = refreshJoinInputDetect;
      dlg.onpaste = function () { setTimeout(refreshJoinInputDetect, 0); };
    });
    const input = dlg.querySelector('#joinInput');
    if (input) {
      try { input.focus(); } catch (e) {}
    }
  }

  function openJoinLinkInvalid() {
    showAppDialog(function () {
      dlg.innerHTML = `<div class="sheet" data-join-error="invalid-link">
        <h2 id="dh" tabindex="-1" autofocus>このリンクは読み取れませんでした</h2>
        <p>届いた招待リンクを、そのまま貼ってね。</p>
        <div class="acts">
          <button type="button" class="btn" data-act="share-join-enter">戻る</button>
          <button type="button" class="btn ghost" data-act="close">閉じる</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    });
  }

  function submitPasteJoin() {
    const input = dlg.querySelector('#joinInput');
    const text = input ? input.value : '';
    const info = parseJoinFromInput(text);
    if (!info) {
      openJoinLinkInvalid();
      return;
    }
    closeDlg({ restore: false });
    beginJoinFromInfo(info);
  }

  function openIosSafariJoinSheet(info) {
    const url = joinLinkForCopy(info);
    pendingJoin = info;
    showAppDialog(function () {
      dlg.innerHTML = `<div class="sheet" data-ios-join>
        <h2 id="dh" tabindex="-1" autofocus>ホーム画面のアプリで使う？</h2>
        <p>先にホーム画面に追加して、アプリの設定から「招待リンクで参加」でリンクを貼って参加してね。</p>
        <div class="acts">
          <button type="button" class="btn" data-act="copy-join-link" data-url="${escAttr(url)}">リンクをコピー</button>
          <button type="button" class="btn ghost" data-act="share-join-safari">Safariでこのまま参加</button>
          <button type="button" class="btn ghost" data-act="close">閉じる</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    });
  }

  function continueSafariJoin() {
    const info = pendingJoin;
    closeDlg({ restore: false });
    if (info) beginJoinFromInfo(info);
  }

  function maybeOpenJoinFromHash() {
    if (!Sync.parseJoinHash) return false;
    const info = Sync.parseJoinHash(location.hash) || Sync.parseJoinHash(location.href);
    if (!info) return false;
    if (inAppKind()) {
      openInAppJoinSheet(info);
      return true;
    }
    if (isIOSDevice() && !isStandaloneDisplay()) {
      openIosSafariJoinSheet(info);
      return true;
    }
    beginJoinFromInfo(info);
    return true;
  }

  /* ---------- 設定 ---------- */
  function renderSet() {
    document.getElementById('top').innerHTML = `<h1>設定</h1>`;
    const y = state.ratioYamada;
    const k = 100 - y;
    const theme = themeValue();
    document.getElementById('main').innerHTML = `
      <div class="card" data-card="theme">
        <div class="seg" role="group" aria-label="テーマ">
          <button type="button" data-act="theme" data-theme-set="light" aria-pressed="${theme === 'light'}" class="${theme === 'light' ? 'on' : ''}">ライト</button>
          <button type="button" data-act="theme" data-theme-set="dark" aria-pressed="${theme === 'dark'}" class="${theme === 'dark' ? 'on' : ''}">ダーク</button>
        </div>
      </div>
      <div class="card" data-card="people">
        <div class="names">
          ${peopleOrder().map((id, i) => {
            const varc = id === 'yamada' ? 'var(--c-y)' : 'var(--c-k)';
            const iid = id === 'yamada' ? 'nm-y' : 'nm-k';
            const aria = i === 0 ? 'ひとりめ' : 'ふたりめ';
            return `<div class="f" style="margin:0">
            <i class="dot" style="background:${varc}" aria-hidden="true"></i>
            <input id="${iid}" type="text" maxlength="10" value="${escAttr(person(id).name)}" data-act="name" data-id="${id}" aria-label="${aria}">
          </div>`;
          }).join('')}
        </div>
        <div class="me-block">
          <p class="me-lab">このスマホは</p>
          <div class="seg me-seg" role="group" aria-label="このスマホは">
            ${['yamada', 'kanojo'].map((id) => {
              const on = myId() === id;
              return `<button type="button" data-act="set-me" data-id="${id}" aria-pressed="${on}" class="${on ? 'on' : ''}">${esc(nameOf(id))}</button>`;
            }).join('')}
          </div>
          <p class="note me-note">この端末で使う人を選んでね</p>
        </div>
      </div>
      <div class="card" data-card="opening">
        <h2 style="margin:0 0 8px;font-size:16px">残りの支払い</h2>
        <p class="note" style="margin:0 0 8px">${(() => {
          const o = S.getOpening(state);
          if (!o || !o.from) return 'まだありません';
          return esc(remainPhrase(o).text) + ' ' + L.yen(o.amount);
        })()}</p>
        <button type="button" class="btn ghost" data-act="edit-opening">${S.getOpening(state) ? '編集する' : '設定する'}</button>
      </div>
      <div class="card">
        <h2 style="margin:0 0 8px;font-size:16px">負担の割合</h2>
        ${(() => {
          const order = peopleOrder();
          const left = order[0];
          const right = order[1];
          const leftPct = left === 'yamada' ? y : k;
          const leftC = left === 'yamada' ? 'var(--teal)' : 'var(--coral)';
          const rightC = right === 'yamada' ? 'var(--teal)' : 'var(--coral)';
          return `<div class="ratio-read" id="ratioRead">${esc(labelOf(left))} ${leftPct} : ${100 - leftPct} ${esc(labelOf(right))}</div>
        <input type="range" id="ratio" min="0" max="100" step="1" value="${leftPct}" style="--ratio:${leftPct}%;--ratio-a:${leftC};--ratio-b:${rightC}" aria-label="負担の割合" data-ratio-left="${left}">`;
        })()}
      </div>
      <div class="card" style="padding-bottom:8px">
        <div class="sec-h" style="margin:0"><h2>項目</h2>
          <button type="button" class="item" style="border:0;padding:0;min-height:44px;color:var(--pri);font-weight:700;background:none;font-size:13px" data-act="add-item">毎月の項目を追加</button>
        </div>
        ${state.items.map((it) => {
          const kind = it.kind === 'fixed' ? `固定 ${it.fixedAmount != null ? L.yen(it.fixedAmount) : ''}` : '変動';
          return `<div class="item">
            <div class="l"><b>${esc(it.name)}</b><small>${esc(kind)} · ${esc(labelOf(it.defaultPayer))}</small></div>
            <button type="button" data-act="edit-item" data-id="${it.id}">編集</button>
          </div>`;
        }).join('')}
      </div>
      ${shareCardHtml()}
      <div class="card" data-card="backup">
        <button type="button" class="btn ghost" data-act="backup-save">バックアップを保存</button>
        <button type="button" class="btn text" data-act="backup-restore">バックアップから戻す</button>
        ${backupMetaHtml()}
      </div>
      <button type="button" class="btn wipe" data-act="wipe">全てのデータを削除</button>
      <p class="note">${Sync.isActive() ? '共有中は、つながっている端末とデータを同期します。' : 'データはこのスマホの中だけに保存されます。'}v${APP_VERSION}</p>`;
  }

  /* ---------- 全体描画 ---------- */
  let pendingSettingsRender = false;
  let nameComposing = false;

  function settingsFieldFocused() {
    const el = document.activeElement;
    if (!el || tab !== 'set') return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') return false;
    const typ = (el.type || '').toLowerCase();
    if (typ === 'button' || typ === 'submit' || typ === 'checkbox' || typ === 'radio' || typ === 'hidden') return false;
    const main = document.getElementById('main');
    return !!(main && main.contains(el));
  }

  function flushSettingsRender() {
    if (!pendingSettingsRender) return;
    if (settingsFieldFocused()) return;
    pendingSettingsRender = false;
    render();
  }

  function displayNameLive(id, overrideId, raw) {
    let n = nameOf(id);
    if (overrideId && id === overrideId) {
      const typed = String(raw == null ? '' : raw);
      if (typed.trim()) n = typed;
    }
    return L.perspectiveLabel(n, !!(myId() && id === myId()), !!myId());
  }

  function updateNameLive(id, raw) {
    $$('[data-act=set-me]').forEach((btn) => {
      const pid = btn.dataset.id;
      if (pid !== 'yamada' && pid !== 'kanojo') return;
      let label = '';
      if (id && pid === id) {
        const n = String(raw == null ? '' : raw);
        label = n.trim() ? n : nameOf(pid);
      } else {
        label = nameOf(pid);
      }
      btn.textContent = label;
    });
    const read = document.getElementById('ratioRead');
    if (!read) return;
    const order = peopleOrder();
    const leftId = order[0];
    const rightId = order[1];
    const leftPct = leftId === 'yamada' ? state.ratioYamada : 100 - state.ratioYamada;
    read.textContent = `${displayNameLive(leftId, id, raw)} ${leftPct} : ${100 - leftPct} ${displayNameLive(rightId, id, raw)}`;
  }

  function commitNameInput(el) {
    if (!el || el.dataset.act !== 'name') return;
    const v = el.value.trim();
    if (!v) {
      el.value = person(el.dataset.id).name;
      updateNameLive(el.dataset.id, el.value);
      return;
    }
    S.setPersonName(state, el.dataset.id, v);
    updateNameLive(el.dataset.id, v);
  }

  function render() {
    if (settingsFieldFocused()) {
      pendingSettingsRender = true;
      return;
    }
    pendingSettingsRender = false;
    applyMeAccent();
    setTimeout(applyRowFlash, 0);
    $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'home' && ledgerOpen) renderLedger();
    else if (tab === 'home') renderHome();
    else if (tab === 'hist') renderHist();
    else renderSet();
    if (typeof syncTabPill === 'function') syncTabPill(pillReady);
    const banner = inAppBannerHtml();
    if (banner) {
      const main = document.getElementById('main');
      if (main) main.insertAdjacentHTML('afterbegin', banner);
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escAttr(s) { return esc(s); }

  function amountPlaceholder(itemId, m) {
    const prev = L.previousFilledAmount(state.payments, itemId, m);
    return prev != null ? '先月 ' + L.yen(prev) : '';
  }

  function confirmUnconfirm(m) {
    if (!m || !S.isSettled(state, m)) return;
    showAppDialog(() => {
      dlg.innerHTML = `<div class="sheet">
        <h2 id="dh" tabindex="-1" autofocus>${esc(shortMonth(m))}を修正しますか？</h2>
        <p class="note">確定が外れて、金額を直せるようになります</p>
        <div class="acts">
          <button type="button" class="btn" data-act="unconfirm-ok" data-month="${escAttr(m)}">修正する</button>
          <button type="button" class="btn ghost" data-act="close">やめる</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    });
  }

  function openSettleMissingConfirm() {
    const n = unfilledCount(month);
    showAppDialog(() => {
      dlg.innerHTML = `<div class="sheet">
        <h2 id="dh" tabindex="-1" autofocus>未入力のまま精算しますか？</h2>
        <p class="note">未入力が${n}件あります。このまま精算しますか？</p>
        <div class="acts">
          <button type="button" class="btn" data-act="settle-anyway">このまま精算する</button>
          <button type="button" class="btn ghost" data-act="close">戻る</button>
        </div>
      </div>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    });
  }

  function openFillMissing(startId) {
    if (S.isSettled(state, month)) return;

    const nextMissing = () => unfilledPayments(month);
    let current = (startId && nextMissing().find((p) => p.id === startId)) || nextMissing()[0];
    if (!current) return;
    let followOn = false;
    let fillExpected = current.updatedAt;
    const draw = () => {
      fillExpected = current.updatedAt;
      const item = S.itemById(state, current.itemId);
      const label = (item && item.name) || current.itemName || '支払い';
      const title = followOn ? ('次：' + label) : (label + 'の金額を入れる');
      const ph = amountPlaceholder(current.itemId, current.month || month);
      showAppDialog(() => {
        dlg.innerHTML = `<form class="sheet" id="fillForm" novalidate>
          <h2 id="dh" tabindex="-1">${esc(title)}</h2>
          <p class="fill-meta"><b>${esc(label)}</b><span class="who">${esc(labelOf(current.payerId))}</span></p>
          <div class="f">
            <label for="aa">金額</label>
            <input id="aa" type="text" inputmode="numeric" placeholder="${escAttr(ph)}" value="" autofocus>
            <p class="field-err" id="aaErr" hidden></p>
          </div>
          <div class="acts">
            <button type="submit" class="btn">保存</button>
            <button type="button" class="btn ghost" data-act="close">閉じる</button>
          </div>
        </form>`;
        dlg.setAttribute('aria-labelledby', 'dh');
        dlg.onsubmit = (e) => {
          e.preventDefault();
          const parsed = L.parseAmountInput(dlg.querySelector('#aa').value);
          if (!parsed.ok) {
            const err = dlg.querySelector('#aaErr');
            if (err) { err.hidden = false; err.textContent = parsed.message; }
            dlg.querySelector('#aa').focus();
            return;
          }
          const before = settleFor(month).amount;
          const savedLabel = label;
          const savedAmt = parsed.value;
          const savedId = current.id;
          const expected = fillExpected;
          const write = () => {
            mutateMonth(month, () => {
              S.updatePayment(state, savedId, { amount: savedAmt });
            });
          };
          const goNext = () => {
            animateFrom = before;
            savedToast(savedLabel, savedAmt);
            render();
            const rest = nextMissing();
            if (rest.length) {
              const ids = paymentsInOrder(month).map((x) => x.id);
              const at = ids.indexOf(savedId);
              current = rest.find((x) => ids.indexOf(x.id) > at) || rest[0];
              followOn = true;
              draw();
            } else {
              closeDlg({ restore: false });
            }
          };
          if (Sync.isActive && Sync.isActive() && Sync.commitPayment) {
            S.withoutSync(write);
            commitAfterLocalWrite(savedId, expected, function (res) {
              if (res && res.conflict) { render(); return; }
              goNext();
            });
          } else {
            write();
            goNext();
          }
        };
        dlg.oninput = (e) => {
          if (e.target.id === 'aa') {
            const err = dlg.querySelector('#aaErr');
            if (err) { err.hidden = true; err.textContent = ''; }
          }
        };
      });
    };
    draw();
  }

  /* ---------- 支払いダイアログ ---------- */
  function openPay(existing) {
    const p = existing ? state.payments.find((x) => x.id === existing) : null;
    if (!p || S.isSettled(state, p.month)) return;

    const targetMonth = p.month || month;
    const draft = {
      payerId: p.payerId,
      itemId: p.itemId || '',
      amount: L.isFilled(p) ? String(p.amount) : '',
    };
    const amtFocus = !L.isFilled(p);
    const draw = (stepChange) => showAppDialog(() => {
      const itemField = `<div class="f">
          <label for="payItem">項目</label>
          <select id="payItem">${state.items.map((it) =>
            `<option value="${it.id}" ${it.id === draft.itemId ? 'selected' : ''}>${esc(it.name)}</option>`).join('')}</select>
        </div>`;
      const payerField = `<div class="f">
          <label>誰が払ったか</label>
          <div class="row2">
            ${peopleOrder().map((id) => {
              const coral = id === 'kanojo' ? ' coral' : '';
              return `<button type="button" class="pick${coral}${draft.payerId === id ? ' on' : ''}" data-pick="${id}" style="--on:${colorOf(id)}">
              <i class="dot" style="background:${colorOf(id)}"></i> ${esc(labelOf(id))}
            </button>`;
            }).join('')}
          </div>
        </div>`;
      const amtField = `<div class="f">
          <label for="aa">金額</label>
          <input id="aa" type="text" inputmode="numeric" placeholder="${escAttr(amountPlaceholder(draft.itemId, targetMonth))}" value="${escAttr(draft.amount)}"${amtFocus ? ' autofocus' : ''}>
          <p class="field-err" id="aaErr" hidden></p>
        </div>`;
      dlg.innerHTML = `<form class="sheet" id="payForm" novalidate>
        <h2 id="dh" tabindex="-1"${amtFocus ? '' : ' autofocus'}>支払いの編集</h2>
        ${payerField}${itemField}${amtField}
        <div class="acts">
          <button type="submit" class="btn">保存</button>
          <button type="button" class="btn ghost" data-act="close">キャンセル</button>
          <button type="button" class="btn danger" data-act="del-pay" data-id="${p.id}">${p.extra ? '削除する' : '未入力に戻す'}</button>
        </div>
      </form>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    }, { stepChange });

    function restoreFocus(key) {
      if (key === 'aa') {
        const aa = dlg.querySelector('#aa');
        if (aa) aa.focus();
        return;
      }
      if (key && key.startsWith('pick:')) {
        const pick = dlg.querySelector('[data-pick="' + key.slice(5) + '"]');
        if (pick) pick.focus();
      }
    }

    draw(true);

    dlg.onclick = (e) => {
      const pick = e.target.closest('[data-pick]');
      if (!pick) return;
      draft.payerId = pick.dataset.pick;
      const sel = dlg.querySelector('#payItem');
      if (sel) draft.itemId = sel.value;
      const aa = dlg.querySelector('#aa');
      if (aa) draft.amount = aa.value;
      draw(false);
      restoreFocus('pick:' + draft.payerId);
    };
    dlg.oninput = (e) => {
      if (e.target.id === 'payItem') draft.itemId = e.target.value;
      if (e.target.id === 'aa') {
        draft.amount = e.target.value;
        const err = dlg.querySelector('#aaErr');
        if (err) { err.hidden = true; err.textContent = ''; }
      }
    };
    dlg.onsubmit = (e) => {
      e.preventDefault();
      const itemId = dlg.querySelector('#payItem') && dlg.querySelector('#payItem').value;
      const item = S.itemById(state, itemId);
      if (!itemId || !item) return;
      const parsed = L.parseAmountInput(dlg.querySelector('#aa').value);
      if (!parsed.ok) {
        const err = dlg.querySelector('#aaErr');
        if (err) { err.hidden = false; err.textContent = parsed.message; }
        dlg.querySelector('#aa').focus();
        return;
      }
      const amount = parsed.value;
      const payerId = draft.payerId || item.defaultPayer;
      const before = settleFor(targetMonth).amount;
      const expected = p.updatedAt;
      const write = () => {
        mutateMonth(targetMonth, () => {
          S.updatePayment(state, p.id, { payerId, itemId, itemName: item.name, amount });
        });
      };
      animateFrom = (targetMonth === month) ? before : null;
      closeDlg({ restore: false });
      if (Sync.isActive && Sync.isActive() && Sync.commitPayment) {
        S.withoutSync(write);
        render();
        commitAfterLocalWrite(p.id, expected, function (res) {
          if (!res || res.ok !== false) savedToast(item.name, amount);
          render();
        });
      } else {
        write();
        savedToast(item.name, amount);
        render();
      }
    };
  }

  function clearOrDeletePay(id) {
    const p = state.payments.find((x) => x.id === id);
    if (!p) return;
    const targetMonth = p.month || month;
    const before = settleFor(targetMonth).amount;
    const expected = p.updatedAt;
    const write = () => {
      mutateMonth(targetMonth, () => {
        if (p.extra) S.removePayment(state, id);
        else S.updatePayment(state, id, { amount: null });
      });
    };
    animateFrom = (targetMonth === month) ? before : null;
    closeDlg({ restore: false });
    if (!p.extra && Sync.isActive && Sync.isActive() && Sync.commitPayment) {
      S.withoutSync(write);
      render();
      commitAfterLocalWrite(id, expected, function () { render(); });
    } else {
      write();
      render();
    }
  }

  /* ---------- 項目編集 ---------- */
  function itemFormFields(draft) {
    const fixField = `<div class="f" id="fixWrap" ${draft.kind === 'fixed' ? '' : 'hidden'}>
          <label for="inAmt">固定の金額</label>
          <input id="inAmt" type="text" inputmode="numeric" value="${escAttr(draft.fixedAmount)}" placeholder="例：4,000">
          <p class="field-err" id="inAmtErr" hidden></p>
        </div>`;
    return `<div class="f">
          <label for="inName">名前</label>
          <input id="inName" type="text" maxlength="20" required value="${escAttr(draft.name)}" autofocus>
        </div>
        <div class="f">
          <label>種類</label>
          <div class="row2">
            <button type="button" class="pick${draft.kind === 'fixed' ? ' on' : ''}" data-kind="fixed">固定</button>
            <button type="button" class="pick${draft.kind === 'variable' ? ' on' : ''}" data-kind="variable">変動</button>
          </div>
        </div>
        ${fixField}
        <div class="f">
          <label>いつも払う人</label>
          <div class="row2">
            ${peopleOrder().map((id) => {
              const coral = id === 'kanojo' ? ' coral' : '';
              return `<button type="button" class="pick${coral}${draft.defaultPayer === id ? ' on' : ''}" data-payer="${id}" style="--on:${colorOf(id)}">${esc(labelOf(id))}</button>`;
            }).join('')}
          </div>
        </div>`;
  }

  function openItem(id) {
    const it = id ? S.itemById(state, id) : null;
    const draft = {
      name: (it && it.name) || '',
      kind: (it && it.kind) || 'variable',
      defaultPayer: (it && it.defaultPayer) || 'kanojo',
      fixedAmount: it && it.fixedAmount != null ? String(it.fixedAmount) : '',
    };
    const draw = (stepChange) => showAppDialog(() => {
      dlg.innerHTML = `<form class="sheet" id="itemForm" novalidate>
        <h2 id="dh">${it ? '項目の編集' : '項目を追加'}</h2>
        ${itemFormFields(draft)}
        <div class="acts">
          <button type="submit" class="btn">保存</button>
          <button type="button" class="btn ghost" data-act="close">キャンセル</button>
          ${it ? `<button type="button" class="btn danger" data-act="del-item" data-id="${it.id}">削除する</button>` : ''}
        </div>
      </form>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    }, { stepChange });

    const grab = () => {
      draft.name = dlg.querySelector('#inName').value;
      const amt = dlg.querySelector('#inAmt');
      if (amt) draft.fixedAmount = amt.value;
    };
    draw(true);
    dlg.onclick = (e) => {
      const k = e.target.closest('[data-kind]');
      const py = e.target.closest('[data-payer]');
      if (k || py) {
        grab();
        if (k) draft.kind = k.dataset.kind;
        if (py) draft.defaultPayer = py.dataset.payer;
        draw(false);
        dlg.querySelector('#inName').focus();
      }
    };
    dlg.onsubmit = (e) => {
      e.preventDefault();
      grab();
      const name = draft.name.trim();
      if (!name) { showToast('名前を入れてね'); return; }
      let fixedAmount = null;
      if (draft.kind === 'fixed') {
        const parsed = L.parseAmountInput(draft.fixedAmount);
        if (!parsed.ok) {
          const err = dlg.querySelector('#inAmtErr');
          if (err) { err.hidden = false; err.textContent = parsed.message; }
          const amt = dlg.querySelector('#inAmt');
          if (amt) amt.focus();
          return;
        }
        fixedAmount = parsed.value;
      }
      const saved = it
        ? S.updateItem(state, it.id, { name, kind: draft.kind, defaultPayer: draft.defaultPayer, fixedAmount })
        : S.addItem(state, { name, kind: draft.kind, defaultPayer: draft.defaultPayer, fixedAmount });
      if (!S.isSettled(state, month)) S.ensureMonth(state, month);
      closeDlg({ restore: false });
      if (saved && fixedAmount != null && !S.isSettled(state, month)) savedToast(name, fixedAmount);
      render();
    };
  }

  function openOneOff(id) {
    if (S.isSettled(state, month) && !id) return;
    const p = id ? state.payments.find((x) => x.id === id) : null;
    if (id && (!p || !p.extra || S.isSettled(state, p.month))) return;
    const targetMonth = (p && p.month) || month;
    const draft = {
      name: (p && (p.itemName || (S.itemById(state, p.itemId) || {}).name)) || '',
      payerId: (p && p.payerId) || viewMeId() || 'yamada',
      amount: p && L.isFilled(p) ? String(p.amount) : '',
    };
    const draw = (stepChange) => showAppDialog(() => {
      dlg.innerHTML = `<form class="sheet" id="oneOffForm" novalidate>
        <h2 id="dh">${p ? '項目の編集' : '項目を追加'}</h2>
        <div class="f">
          <label for="inName">名前</label>
          <input id="inName" type="text" maxlength="20" required value="${escAttr(draft.name)}" autofocus>
        </div>
        <div class="f">
          <label for="inAmt">金額</label>
          <input id="inAmt" type="text" inputmode="numeric" value="${escAttr(draft.amount)}" placeholder="任意">
          <p class="field-err" id="inAmtErr" hidden></p>
        </div>
        <div class="f">
          <label>払った人</label>
          <div class="row2">
            ${peopleOrder().map((pid) => {
              const coral = pid === 'kanojo' ? ' coral' : '';
              return `<button type="button" class="pick${coral}${draft.payerId === pid ? ' on' : ''}" data-payer="${pid}" style="--on:${colorOf(pid)}">${esc(labelOf(pid))}</button>`;
            }).join('')}
          </div>
        </div>
        <div class="acts">
          <button type="submit" class="btn">保存</button>
          <button type="button" class="btn ghost" data-act="close">キャンセル</button>
          ${p ? `<button type="button" class="btn danger" data-act="del-pay" data-id="${p.id}">削除する</button>` : ''}
        </div>
      </form>`;
      dlg.setAttribute('aria-labelledby', 'dh');
    }, { stepChange });

    const grab = () => {
      const nameEl = dlg.querySelector('#inName');
      const amtEl = dlg.querySelector('#inAmt');
      if (nameEl) draft.name = nameEl.value;
      if (amtEl) draft.amount = amtEl.value;
    };
    draw(true);
    dlg.onclick = (e) => {
      const py = e.target.closest('[data-payer]');
      if (!py) return;
      grab();
      draft.payerId = py.dataset.payer;
      draw(false);
      const nameEl = dlg.querySelector('#inName');
      if (nameEl) nameEl.focus();
    };
    dlg.oninput = (e) => {
      if (e.target.id === 'inAmt') {
        const err = dlg.querySelector('#inAmtErr');
        if (err) { err.hidden = true; err.textContent = ''; }
      }
    };
    dlg.onsubmit = (e) => {
      e.preventDefault();
      grab();
      const name = String(draft.name || '').trim();
      if (!name) { showToast('名前を入れてね'); return; }
      let amount = null;
      const raw = String(draft.amount == null ? '' : draft.amount).trim();
      if (raw !== '') {
        const parsed = L.parseAmountInput(raw);
        if (!parsed.ok) {
          const err = dlg.querySelector('#inAmtErr');
          if (err) { err.hidden = false; err.textContent = parsed.message; }
          const amt = dlg.querySelector('#inAmt');
          if (amt) amt.focus();
          return;
        }
        amount = parsed.value;
      }
      const payerId = draft.payerId || viewMeId() || 'yamada';
      const before = settleFor(targetMonth).amount;
      const write = () => {
        mutateMonth(targetMonth, () => {
          if (p) {
            S.updatePayment(state, p.id, { payerId, itemId: null, itemName: name, amount, extra: true });
          } else {
            S.addPayment(state, { month: targetMonth, itemId: null, itemName: name, payerId, amount, extra: true });
          }
        });
      };
      animateFrom = (targetMonth === month) ? before : null;
      closeDlg({ restore: false });
      write();
      if (amount != null) savedToast(name, amount);
      render();
    };
  }

  function homeUrl() {
    return location.pathname + location.search;
  }
  function isTsukeLoc() {
    return location.hash === '#tsuke' || !!(history.state && history.state.warikan === 'tsuke');
  }
  function focusLedgerHeading() {
    const heading = document.querySelector('#top .mnav b[tabindex="-1"]');
    const back = document.querySelector('[data-act=close-ledger]');
    if (heading || back) (heading || back).focus();
  }
  function focusTsukeOpen() {
    const open = document.querySelector('.tsuke-open');
    if (open) open.focus();
  }
  function settleHistoryBack() {
    backPending = false;
    if (wantLedgerAfterBack) {
      wantLedgerAfterBack = false;
      openLedgerScreen();
    }
  }
  function openLedgerScreen({ fromHistory } = {}) {
    if (backPending && !fromHistory) {
      wantLedgerAfterBack = true;
      return;
    }
    const toast = document.getElementById('toast');
    if (toast) toast.hidden = true;
    ledgerOpen = true;
    if (!fromHistory && location.hash !== '#tsuke') {
      history.pushState({ warikan: 'tsuke' }, '', '#tsuke');
      ledgerPushed = true;
    } else if (!fromHistory) {
      history.replaceState({ warikan: 'tsuke' }, '', '#tsuke');
    } else {
      ledgerPushed = true;
    }
    render();
    focusLedgerHeading();
  }
  function closeLedgerScreen({ fromHistory } = {}) {
    if (!ledgerOpen && fromHistory) return;
    const shouldPop = !fromHistory && ledgerPushed && location.hash === '#tsuke';
    ledgerOpen = false;
    ledgerPushed = false;
    if (shouldPop) {
      ignoreLedgerPop = true;
      backPending = true;
    } else if (location.hash === '#tsuke') history.replaceState({ warikan: 'home' }, '', homeUrl());
    render();
    if (tab === 'home') focusTsukeOpen();
    if (shouldPop) history.back();
  }

  /* ---------- イベント ---------- */
  let pillReady = false;
  let tabDragged = false;
  function tabNav() { return document.getElementById('tabs'); }
  function pillBoxForTab(name) {
    const nav = tabNav();
    const btn = nav && nav.querySelector('[data-tab="' + name + '"]');
    const pill = document.getElementById('tabPill');
    if (!nav || !btn || !pill) return null;
    const nr = nav.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const pad = 8;
    return { x: br.left - nr.left + pad, w: Math.max(24, br.width - pad * 2) };
  }
  function tabAtX(clientX) {
    const btns = $$('#tabs [data-tab]');
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) return b.dataset.tab;
    }
    let best = null, dist = Infinity;
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      const d = Math.min(Math.abs(clientX - r.left), Math.abs(clientX - r.right));
      if (d < dist) { dist = d; best = b.dataset.tab; }
    }
    return best;
  }
  function syncTabPill(animate) {
    const pill = document.getElementById('tabPill');
    const box = pillBoxForTab(tab);
    if (!pill || !box) return;
    const motion = !reduceMotion() && animate && pillReady;
    pill.style.transition = motion ? 'transform .2s ease, width .2s ease' : 'none';
    pill.style.width = box.w + 'px';
    pill.style.transform = 'translate3d(' + box.x + 'px,0,0)';
    pillReady = true;
  }
  function switchTab(next, { animatePill = true } = {}) {
    if (!next) { syncTabPill(animatePill); return; }
    if (next !== tab) {
      tab = next;
      lastAmt = null;
      justSettled = false;
      if (tab === 'home') {
        month = firstOpenMonth();
        if (!S.isSettled(state, month)) S.ensureMonth(state, month);
      }
      if (ledgerOpen) closeLedgerScreen();
      else render();
      window.scrollTo(0, 0);
    }
    syncTabPill(animatePill);
  }
  document.getElementById('tabs').addEventListener('click', (e) => {
    if (tabDragged) { e.preventDefault(); e.stopPropagation(); tabDragged = false; return; }
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    switchTab(b.dataset.tab);
  });
  (function setupTabDrag() {
    const nav = tabNav();
    if (!nav || !window.PointerEvent) return;
    let pid = null, dragging = false, startX = 0;
    nav.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      if (dlg.open) return;
      pid = e.pointerId;
      startX = e.clientX;
      dragging = false;
      tabDragged = false;
    });
    nav.addEventListener('pointermove', (e) => {
      if (pid == null || e.pointerId !== pid) return;
      const box = pillBoxForTab(tab);
      const pill = document.getElementById('tabPill');
      if (!box || !pill) return;
      const nr = nav.getBoundingClientRect();
      if (!dragging && Math.abs(e.clientX - startX) < 16) return;
      if (!dragging) {
        dragging = true;
        tabDragged = true;
        try { nav.setPointerCapture(pid); } catch (err) {}
      }
      const w = box.w;
      const minX = 8;
      const maxX = Math.max(minX, nr.width - w - 8);
      const x = Math.max(minX, Math.min(maxX, e.clientX - nr.left - w / 2));
      if (!reduceMotion()) pill.style.transition = 'none';
      pill.style.width = w + 'px';
      pill.style.transform = 'translate3d(' + x + 'px,0,0)';
    });
    function endDrag(e) {
      if (pid == null || (e && e.pointerId != null && e.pointerId !== pid)) return;
      const was = dragging;
      const x = e && e.clientX;
      dragging = false;
      try { if (pid != null) nav.releasePointerCapture(pid); } catch (err) {}
      pid = null;
      if (was) {
        switchTab(tabAtX(x), { animatePill: true });
        setTimeout(() => { tabDragged = false; }, 50);
      } else {
        tabDragged = false;
        // iPhone では touch-action:none のせいで click が来ないことがあるので、タップもここで切り替える
        const hit = e && e.type === 'pointerup' && e.target && e.target.closest && e.target.closest('[data-tab]');
        if (hit) switchTab(hit.dataset.tab);
        else syncTabPill(false);
      }
    }
    nav.addEventListener('pointerup', endDrag);
    nav.addEventListener('pointercancel', endDrag);
  })();
  window.addEventListener('resize', () => syncTabPill(false));

  /*
   * data-act ボタンの処理。body で一括して受け、act 名でここから引く。
   * 各処理は押されたボタン要素を受け取る。
   */
  function stepMonth(b) {
    const act = b.dataset.act;
    if (sliding) return;
    justSettled = false;
    const bds = bounds();
    const next = L.addMonth(month, act === 'next-m' ? 1 : -1);
    month = L.clampMonth(next, bds.min, bds.max);
    lastAmt = null;
    render();
    // 端の月で押したボタンが無効になったら、反対側へフォーカスを逃がす
    const nowPrev = document.querySelector('[data-act=prev-m]');
    const nowNext = document.querySelector('[data-act=next-m]');
    if (act === 'prev-m' && nowPrev && nowPrev.disabled) (nowNext || document.getElementById('mLbl')).focus();
    else if (act === 'next-m' && nowNext && nowNext.disabled) (nowPrev || document.getElementById('mLbl')).focus();
  }

  function toggleSettleSteps() {
    settleStepsOpen = !settleStepsOpen;
    const wrap = document.querySelector('.settle-steps-wrap');
    const btn = document.querySelector('[data-act=toggle-steps]');
    if (wrap) wrap.classList.toggle('is-open', settleStepsOpen);
    if (btn) {
      btn.setAttribute('aria-expanded', settleStepsOpen ? 'true' : 'false');
      btn.textContent = settleStepsOpen ? '△ 閉じる' : '▽ 詳細';
    }
  }

  function fillRepayAll() {
    const input = dlg.querySelector('#repayAmt');
    if (!input) return;
    const dir = L.dirFromSigned(L.ledgerTotal(state.ledger));
    input.value = String(dir.amount || '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }

  function chooseMe(b) {
    const id = b.dataset.id;
    if (id !== 'yamada' && id !== 'kanojo') return;
    if (typeof Sync.setMe === 'function') Sync.setMe(id);
    else {
      try { localStorage.setItem('warikan-me', id); } catch (e) {}
    }
    render();
  }

  function copyJoinLink(b) {
    const url = b.getAttribute('data-url') || '';
    copyText(url).then(function (ok) { showToast(ok ? 'リンクをコピーしたよ' : 'コピーできませんでした'); });
  }

  function unconfirmMonth(b) {
    const m = b.dataset.month;
    S.clearMarks(state, m);
    month = m;
    tab = 'home';
    lastAmt = null;
    closeDlg({ restore: false });
    render();
    window.scrollTo(0, 0);
  }

  function editPayment(b) {
    const pay = state.payments.find((x) => x.id === b.dataset.id);
    if (!pay || S.isSettled(state, pay.month)) return;
    if (pay.extra) openOneOff(pay.id);
    else if (!L.isFilled(pay)) openFillMissing(pay.id);
    else openPay(b.dataset.id);
  }

  function deleteItem(b) {
    const id = b.dataset.id;
    mutateMonth(month, () => {
      S.removeItem(state, id);
      // 表示中の月の、まだ金額のない行は一緒に消す（入力済みの行は残す）
      for (const p of S.paymentsInMonth(state, month).filter((x) => x.itemId === id && !L.isFilled(x) && !x.extra)) {
        S.removePayment(state, p.id);
      }
    });
    closeDlg({ restore: false });
    render();
  }

  function closeDlgAndRender() {
    closeDlg({ restore: false });
    render();
  }

  const ACTIONS = {
    // 精算（今月）
    'prev-m': stepMonth,
    'next-m': stepMonth,
    'settle': () => {
      if (S.isSettled(state, month) || sliding) return;
      if (unfilledCount(month)) openSettleMissingConfirm();
      else applySettle();
    },
    'settle-anyway': () => applySettle(),
    'fill-missing': () => { if (!S.isSettled(state, month)) openFillMissing(); },
    'toggle-steps': toggleSettleSteps,
    'goto-hist': () => { tab = 'hist'; lastAmt = null; render(); },
    // 支払い
    'edit-pay': editPayment,
    'add-pay': () => { if (!S.isSettled(state, month)) openOneOff(null); },
    'del-pay': (b) => clearOrDeletePay(b.dataset.id),
    'conflict-theirs': () => applyConflictTheirs(),
    'conflict-mine': () => applyConflictMine(),
    // 残りの支払い（台帳）
    'open-ledger': () => {
      if (tab !== 'home') {
        tab = 'home';
        lastAmt = null;
      }
      openLedgerScreen();
    },
    'close-ledger': () => closeLedgerScreen(),
    'repay': () => openRepay(),
    'repay-all': fillRepayAll,
    'edit-opening': () => openOpening(),
    'del-opening': () => { S.setOpening(state, 'yamada', 0); closeDlgAndRender(); },
    'del-ledger': (b) => confirmDelLedger(b.dataset.id),
    'del-ledger-ok': (b) => { S.removeLedgerEntry(state, b.dataset.id); closeDlgAndRender(); },
    // 履歴
    'chart-sel': (b) => { chartSel = b.dataset.month; updateChartInPlace(); b.focus(); },
    'open-hist': (b) => openHist(b.dataset.month),
    'unconfirm': (b) => confirmUnconfirm(b.dataset.month),
    'unconfirm-ok': unconfirmMonth,
    // 設定
    'theme': (b) => { applyTheme(b.dataset.themeSet); render(); },
    'set-me': chooseMe,
    'add-item': () => openItem(null),
    'edit-item': (b) => openItem(b.dataset.id),
    'del-item': deleteItem,
    'backup-save': () => offerBackup(),
    'backup-restore': () => openRestorePicker(),
    'restore-ok': () => applyPendingRestore(),
    'wipe': () => openWipeConfirm(),
    'wipe-ok': () => wipeAllData(),
    // ふたりで使う
    'share-start': () => startShareFlow(),
    'share-reconnect': () => openReconnectConfirm(),
    'share-reconnect-ok': () => reconnectShareFlow(),
    'share-invite': () => sendInviteLink(),
    'share-leave': () => openLeaveConfirm(),
    'share-leave-ok': () => leaveShareFlow(),
    'share-join-ok': () => confirmJoinFlow(),
    'share-join-enter': () => openPasteJoinSheet(),
    'share-join-paste': () => submitPasteJoin(),
    'share-join-safari': () => continueSafariJoin(),
    'copy-join-link': copyJoinLink,
    // 共通
    'close': () => closeDlg(),
  };

  document.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (!dlg.open && !dlg.contains(b)) rememberDlgOpener(b);
    const handler = Object.prototype.hasOwnProperty.call(ACTIONS, b.dataset.act) ? ACTIONS[b.dataset.act] : null;
    if (handler) handler(b);
  });

  document.body.addEventListener('compositionstart', (e) => {
    if (e.target && e.target.dataset && e.target.dataset.act === 'name') nameComposing = true;
  });
  document.body.addEventListener('compositionend', (e) => {
    if (!e.target || !e.target.dataset || e.target.dataset.act !== 'name') return;
    nameComposing = false;
    updateNameLive(e.target.dataset.id, e.target.value);
  });
  document.body.addEventListener('input', (e) => {
    if (e.target.id === 'ratio') {
      const v = Number(e.target.value);
      const left = e.target.dataset.ratioLeft || 'yamada';
      S.setRatio(state, left === 'yamada' ? v : 100 - v);
      e.target.style.setProperty('--ratio', v + '%');
      const read = document.getElementById('ratioRead');
      if (read) {
        const order = peopleOrder();
        const leftId = order[0];
        const rightId = order[1];
        const leftPct = leftId === 'yamada' ? state.ratioYamada : 100 - state.ratioYamada;
        read.textContent = `${labelOf(leftId)} ${leftPct} : ${100 - leftPct} ${labelOf(rightId)}`;
      }
      return;
    }
    if (e.target.dataset.act === 'name') {
      if (nameComposing || e.isComposing) return;
      updateNameLive(e.target.dataset.id, e.target.value);
    }
  });

  document.body.addEventListener('change', (e) => {
    if (e.target.dataset.act === 'name') {
      commitNameInput(e.target);
      render();
    }
  });
  document.body.addEventListener('blur', (e) => {
    if (e.target && e.target.dataset && e.target.dataset.act === 'name') {
      commitNameInput(e.target);
    }
    if (pendingSettingsRender) setTimeout(flushSettingsRender, 0);
  }, true);

  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeDlg();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) closeDlg();
  });
  dlg.addEventListener('close', () => { dlg.onclick = null; dlg.onsubmit = null; dlg.oninput = null; dlg.onpaste = null; });

  /* ---------- 更新バー ---------- */
  function showUpdateBar() {
    if (document.getElementById('updBar')) return;
    const d = document.createElement('div'); d.id = 'updBar'; d.className = 'updbar'; d.setAttribute('role', 'status');
    d.innerHTML = '<span>新しい版があります</span><button type="button" class="upd-go">更新する</button><button type="button" class="upd-x" aria-label="閉じる">✕</button>';
    d.querySelector('.upd-go').onclick = () => location.reload();
    d.querySelector('.upd-x').onclick = () => {
      d.remove(); document.body.classList.remove('has-upd');
      document.body.style.removeProperty('--upd-h');
    };
    document.body.appendChild(d);
    const h = Math.ceil(d.getBoundingClientRect().height) || 56;
    document.body.style.setProperty('--upd-h', h + 'px');
    document.body.classList.add('has-upd');
  }
  window.__showUpdateBar = showUpdateBar;

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    const hadCtrl = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing; if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'activated' && hadCtrl) showUpdateBar(); });
      });
    }).catch(() => {});
  }

  function checkMonthRoll() {
    const now = nowKey();
    if (now === lastNow) return;
    if (month === lastNow) {
      month = firstOpenMonth();
      lastAmt = null;
    }
    lastNow = now;
    if (tab === 'home') render();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkMonthRoll();
  });
  window.addEventListener('focus', checkMonthRoll);
  window.__checkMonthRoll = checkMonthRoll;

  window.addEventListener('popstate', () => {
    const ignore = ignoreLedgerPop;
    if (ignoreLedgerPop) ignoreLedgerPop = false;
    if (!ignore) {
      if (isTsukeLoc()) {
        if (tab !== 'home') tab = 'home';
        openLedgerScreen({ fromHistory: true });
      } else if (ledgerOpen) {
        closeLedgerScreen({ fromHistory: true });
      } else if (tab !== 'home') {
        tab = 'home';
        lastAmt = null;
        render();
        focusTsukeOpen();
      }
    }
    settleHistoryBack();
  });

  /* ---------- 起動 ---------- */
  month = firstOpenMonth();
  if (!S.isSettled(state, month)) S.ensureMonth(state, month);
  if (Sync.init) {
    Sync.init({
      getState: function () { return state; },
      replaceState: replaceStateFromSync,
      onStatus: function () {
        if (tab === 'set') render();
      },
      onRemoteNotice: function (events) { queueRemoteNotices(events); },
      onPaymentConflict: function (payload) { openPaymentConflict(payload); },
    });
  }
  window.addEventListener('hashchange', function () {
    maybeOpenJoinFromHash();
  });
  const openedJoin = maybeOpenJoinFromHash();
  if (!openedJoin && location.hash === '#tsuke') {
    ledgerOpen = true;
    ledgerPushed = false;
    history.replaceState({ warikan: 'tsuke' }, '', '#tsuke');
  }
  render();
  syncTabPill(false);
  if (ledgerOpen) focusLedgerHeading();
  if (Sync.resume) {
    Sync.resume().then(function () { render(); });
  }
})();
