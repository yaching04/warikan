/* ふたり同期。オフなら何もしない（localStorage のみ）。
   バックエンドは差し替え可能（本番は Firebase、テストはメモリ）。 */
(function (root) {
  const SESSION_KEY = 'warikan-sync-v1';
  const ME_KEY = 'warikan-me';
  const INVITE_BASE = 'https://yaching04.github.io/warikan/';
  const FB_VERSION = '12.6.0';
  const FB_BASE = 'https://www.gstatic.com/firebasejs/' + FB_VERSION;
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCBMYMTiFc0SyNPQx8jcpSa9a8cN90n3aI',
    authDomain: 'warikan-ef6d0.firebaseapp.com',
    projectId: 'warikan-ef6d0',
    storageBucket: 'warikan-ef6d0.firebasestorage.app',
    messagingSenderId: '1087824847274',
    appId: '1:1087824847274:web:080469fc5926afa01c0bd3',
  };

  function nowMs() { return Date.now(); }

  function randomId(bytes) {
    const n = bytes || 16;
    const a = new Uint8Array(n);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a);
    else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function parseJoinHash(hash) {
    let s = String(hash || '').trim();
    const hashAt = s.indexOf('#');
    if (hashAt >= 0) s = s.slice(hashAt);
    const m = s.match(/^#join=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    return { hid: m[1], token: m[2] };
  }

  /* 貼り付け用。URL でも hid.token だけでも、前後の文言や空白があっても読む。短い6桁コードは使わない。 */
  function parseJoinInput(text) {
    const raw = String(text == null ? '' : text);
    const fromHash = raw.match(/#join=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/);
    if (fromHash) return { hid: fromHash[1], token: fromHash[2] };
    const trimmed = raw.trim();
    const exact = parseJoinHash(trimmed);
    if (exact) return exact;
    const bareExact = parseJoinHash('#join=' + trimmed);
    if (bareExact) return bareExact;
    const padded = ' ' + raw + ' ';
    const re = /(?:^|[^A-Za-z0-9_.-])([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)(?![A-Za-z0-9_.-])/g;
    let m;
    let best = null;
    while ((m = re.exec(padded))) {
      if (m[1].length < 6 || m[2].length < 6) continue;
      if (!best || (m[1].length + m[2].length > best.hid.length + best.token.length)) {
        best = { hid: m[1], token: m[2] };
      }
    }
    return best;
  }

  function readMeOverride() {
    try {
      const v = root.localStorage ? root.localStorage.getItem(ME_KEY) : null;
      return (v === 'yamada' || v === 'kanojo') ? v : null;
    } catch (e) { return null; }
  }

  function writeMeOverride(id) {
    if (id !== 'yamada' && id !== 'kanojo') return null;
    try { if (root.localStorage) root.localStorage.setItem(ME_KEY, id); } catch (e) {}
    return readMeOverride();
  }

  function setMe(id) {
    return writeMeOverride(id);
  }

  /* LINE はクエリの openExternalBrowser=1 を見ると外部ブラウザ（Safari）で開く。ハッシュの前に置く。 */
  function makeInviteUrl(hid, token) {
    if (!hid || !token) return '';
    return INVITE_BASE + '?openExternalBrowser=1#join=' + hid + '.' + token;
  }

  /* UA に " Line/"（先頭の空白つき）や Instagram / Facebook のアプリ内ブラウザ */
  function isInAppBrowser(ua) {
    const s = String(ua == null
      ? ((typeof navigator !== 'undefined' && navigator.userAgent) || '')
      : ua);
    if (/(?:^|\s)Line\//.test(s)) return 'line';
    if (/Instagram/i.test(s)) return 'instagram';
    if (/FBAN|FBAV/.test(s)) return 'facebook';
    return null;
  }

  function otherPersonId(hostPersonId) {
    return hostPersonId === 'kanojo' ? 'yamada' : 'kanojo';
  }

  function personName(state, id) {
    const p = state && state.people && state.people[id];
    return (p && p.name) || '';
  }

  function isSettledSnap(s) {
    return !!(s && s.marks && s.marks.yamada && s.marks.kanojo);
  }

  function mkErr(code, cause) {
    const e = new Error(code);
    e.code = code;
    if (cause) e.cause = cause;
    return e;
  }

  function errCode(e) {
    if (!e) return 'unknown';
    if (e.code) return String(e.code).replace(/^firestore\//, '').replace(/^auth\//, 'auth/');
    return 'unknown';
  }

  function tagErr(e, step) {
    if (!e || typeof e !== 'object') e = mkErr('unknown');
    if (!e.step) {
      try { e.step = step; } catch (err) {}
    }
    return e;
  }

  /* members から自分の立場を判定。自分しかいない＝招待を作った本人。
     ふたりいて自分も入っている＝前回の参加が通っている（端末の時計はずれるので joinedAt では比べない） */
  function memberRole(members, uid) {
    if (!members || !uid || !members[uid]) return 'none';
    return Object.keys(members).length < 2 ? 'host' : 'member';
  }

  const NETWORK_CODES = { unavailable: 1, 'deadline-exceeded': 1, 'auth/network-request-failed': 1, offline: 1 };
  const STORAGE_HINT = /indexeddb|indexed database|persistence|internal assertion/i;

  /* 参加の失敗を画面向けに分ける */
  function classifyJoinError(e) {
    const code = errCode(e);
    const step = (e && e.step) || '';
    const msg = String((e && e.message) || '');
    let kind = 'other';
    if (code === 'invite-used') kind = 'used';
    else if (code === 'invite-invalid' || code === 'not-found') kind = 'invalid';
    else if (code === 'own-invite') kind = 'own';
    else if (NETWORK_CODES[code] || /network|failed to fetch|load failed/i.test(msg)) kind = 'network';
    else if (code === 'permission-denied' || code === 'unauthenticated' || /^auth\//.test(code)) kind = 'permission';
    return { kind: kind, code: code, step: step, message: msg.slice(0, 160) };
  }

  function isStorageError(e) {
    const code = errCode(e);
    const msg = String((e && e.message) || '');
    if (code === 'permission-denied' || NETWORK_CODES[code]) return false;
    if (code === 'invite-used' || code === 'invite-invalid' || code === 'own-invite' || code === 'not-found') return false;
    return STORAGE_HINT.test(msg) || code === 'internal' || code === 'failed-precondition' || code === 'unknown' || code === 'unimplemented' || code === 'aborted';
  }

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function indexById(arr) {
    const m = {};
    (arr || []).forEach(function (x) { if (x && x.id) m[x.id] = x; });
    return m;
  }

  function diffList(prevArr, nextArr) {
    const prev = indexById(prevArr);
    const next = indexById(nextArr);
    const upserts = [];
    const deletes = [];
    Object.keys(next).forEach(function (id) {
      if (!same(prev[id], next[id])) upserts.push(next[id]);
    });
    Object.keys(prev).forEach(function (id) {
      if (!next[id]) deletes.push(id);
    });
    return { upserts: upserts, deletes: deletes };
  }

  function diffSettlements(prev, next) {
    prev = prev || {};
    next = next || {};
    const upserts = [];
    const deletes = [];
    Object.keys(next).forEach(function (k) {
      if (!same(prev[k], next[k])) upserts.push({ id: k, data: next[k] });
    });
    Object.keys(prev).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(next, k)) deletes.push(k);
    });
    return { upserts: upserts, deletes: deletes };
  }

  function metaFromState(state) {
    return {
      version: state.version || 1,
      ratioYamada: state.ratioYamada,
      people: state.people,
      itemOrder: (state.items || []).map(function (i) { return i.id; }),
      createdAt: state.createdAt || nowMs(),
      updatedAt: state.updatedAt || nowMs(),
    };
  }

  function dedupeLedger(ledger) {
    let opening = null;
    const carry = {};
    const rest = [];
    (ledger || []).forEach(function (e) {
      if (!e) return;
      if (e.kind === 'opening') {
        if (!opening || (e.updatedAt || 0) >= (opening.updatedAt || 0)) opening = e;
      } else if (e.kind === 'carry') {
        const prev = carry[e.month];
        if (!prev || (e.updatedAt || 0) >= (prev.updatedAt || 0)) carry[e.month] = e;
      } else rest.push(e);
    });
    const out = rest.slice();
    if (opening) out.push(opening);
    Object.keys(carry).forEach(function (m) { out.push(carry[m]); });
    return out;
  }

  function stateFromBags(bags) {
    const meta = bags.meta || {};
    const items = (bags.items || []).slice();
    const order = meta.itemOrder || [];
    items.sort(function (a, b) {
      const ia = order.indexOf(a.id);
      const ib = order.indexOf(b.id);
      if (ia < 0 && ib < 0) return 0;
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    });
    const settlements = {};
    (bags.settlements || []).forEach(function (s) {
      if (!s || !s.id) return;
      const copy = Object.assign({}, s);
      delete copy.id;
      settlements[s.id] = copy;
    });
    return {
      version: meta.version || 1,
      people: meta.people,
      ratioYamada: meta.ratioYamada != null ? meta.ratioYamada : 50,
      items: items,
      payments: bags.payments || [],
      settlements: settlements,
      ledger: dedupeLedger(bags.ledger || []),
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
  }

  function settled(s) { return isSettledSnap(s); }

  /* ---------- Memory backend（テスト・ルール相当の検査） ---------- */
  function createMemoryDb() {
    return {
      households: {},
      listeners: [],
      online: true,
      authUsers: {},
    };
  }

  function memClone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  function MemoryBackend(db) {
    this.kind = 'memory';
    this.db = db || createMemoryDb();
    this.uid = null;
    this._seq = 0;
  }
  MemoryBackend.prototype.init = function () { return Promise.resolve(); };
  MemoryBackend.prototype.signInAnonymously = function () {
    if (!this.uid) this.uid = 'mem-' + randomId(8);
    this.db.authUsers[this.uid] = true;
    return Promise.resolve(this.uid);
  };
  MemoryBackend.prototype.signOut = function () {
    this.uid = null;
    return Promise.resolve();
  };
  MemoryBackend.prototype.currentUid = function () { return this.uid; };
  MemoryBackend.prototype.isOnline = function () { return this.db.online !== false; };
  MemoryBackend.prototype.setOnline = function (v) { this.db.online = !!v; this._emit(); };

  MemoryBackend.prototype._hh = function (hid, create) {
    if (!this.db.households[hid] && create) {
      this.db.households[hid] = {
        meta: null,
        invite: {},
        payments: {},
        items: {},
        ledger: {},
        settlements: {},
        config: null,
      };
    }
    return this.db.households[hid] || null;
  };
  MemoryBackend.prototype._member = function (hid) {
    const hh = this._hh(hid);
    if (!this.uid) throw Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' });
    if (!hh || !hh.meta || !hh.meta.members || !hh.meta.members[this.uid]) {
      throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
    }
    return hh;
  };
  MemoryBackend.prototype._emit = function () {
    this.db.listeners.slice().forEach(function (fn) {
      try { fn(); } catch (e) {}
    });
  };

  MemoryBackend.prototype.createHousehold = function (info) {
    const self = this;
    return this.signInAnonymously().then(function (uid) {
      if (self._hh(info.hid)) throw Object.assign(new Error('already-exists'), { code: 'already-exists' });
      const hh = self._hh(info.hid, true);
      const members = {};
      members[uid] = { joinedAt: nowMs() };
      hh.meta = {
        members: members,
        inviteToken: info.token,
        createdAt: nowMs(),
        hostName: info.hostName || '',
        hostPersonId: info.hostPersonId || 'yamada',
      };
      hh.invite[info.token] = { inviteToken: info.token, hostName: info.hostName || '', hostPersonId: info.hostPersonId || 'yamada' };
      writeStateToMem(hh, info.state || {});
      self._emit();
      return { hid: info.hid, token: info.token, uid: uid, members: members };
    });
  };

  MemoryBackend.prototype.readInvite = function (hid, token) {
    if (!this.uid) return Promise.reject(Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' }));
    const hh = this._hh(hid);
    const inv = hh && hh.invite && hh.invite[token];
    if (!inv || inv.inviteToken !== token) {
      return Promise.reject(Object.assign(new Error('permission-denied'), { code: 'permission-denied' }));
    }
    return Promise.resolve(memClone(inv));
  };

  MemoryBackend.prototype.joinHousehold = function (hid, token) {
    const self = this;
    return this.signInAnonymously().then(function (uid) {
      const hh = self._hh(hid);
      if (self.db.failJoin) {
        const f = self.db.failJoin;
        self.db.failJoin = null;
        throw tagErr(Object.assign(new Error(f.message || f.code), { code: f.code }), f.step || 'join-write');
      }
      if (!hh || !hh.meta) throw tagErr(mkErr('invite-invalid'), 'join-write');
      const role = memberRole(hh.meta.members, uid);
      if (role === 'host') throw tagErr(mkErr('own-invite'), 'join-check');
      if (role === 'member') return memClone(hh.meta);
      if (hh.meta.inviteToken !== token) throw tagErr(mkErr('invite-invalid'), 'join-write');
      if (Object.keys(hh.meta.members).length >= 2) throw tagErr(mkErr('invite-used'), 'join-write');
      hh.meta.joinPresentedToken = token;
      hh.meta.members[uid] = { joinedAt: nowMs() };
      self._emit();
      return memClone(hh.meta);
    });
  };

  MemoryBackend.prototype.fetchAll = function (hid) {
    const hh = this._member(hid);
    return Promise.resolve(memClone(stateFromMem(hh)));
  };

  MemoryBackend.prototype.listen = function (hid, onData, onError, onConn) {
    const self = this;
    let stopped = false;
    const emit = function () {
      if (stopped) return;
      try {
        const hh = self._member(hid);
        if (onConn) onConn({ offline: self.db.online === false, members: memClone(hh.meta.members), hostName: hh.meta.hostName, hostPersonId: hh.meta.hostPersonId });
        onData(memClone(stateFromMem(hh)));
      } catch (e) {
        if (onError) onError(e);
      }
    };
    this.db.listeners.push(emit);
    emit();
    return function () {
      stopped = true;
      self.db.listeners = self.db.listeners.filter(function (fn) { return fn !== emit; });
    };
  };

  MemoryBackend.prototype.writeDiff = function (hid, prev, next) {
    const hh = this._member(hid);
    applyDiffToMem(hh, prev, next);
    this._emit();
    return Promise.resolve();
  };

  MemoryBackend.prototype.writePaymentIfMatch = function (hid, id, expectedUpdatedAt, data, opts) {
    const hh = this._member(hid);
    const force = opts && opts.force;
    const cur = hh.payments[id];
    if (!force) {
      if (expectedUpdatedAt == null) {
        if (cur) return Promise.resolve({ ok: false, conflict: true, remote: memClone(cur) });
      } else if (!cur || (cur.updatedAt || 0) !== expectedUpdatedAt) {
        return Promise.resolve({ ok: false, conflict: true, remote: cur ? memClone(cur) : null });
      }
    }
    hh.payments[id] = memClone(data);
    this._emit();
    return Promise.resolve({ ok: true });
  };

  MemoryBackend.prototype.runSettleTx = function (hid, month, settlement, ledgerUpserts, ledgerDeletes) {
    const hh = this._member(hid);
    const cur = hh.settlements[month];
    if (settled(cur) && settled(settlement)) {
      return Promise.reject(Object.assign(new Error('already-settled'), { code: 'already-settled' }));
    }
    hh.settlements[month] = memClone(settlement);
    (ledgerDeletes || []).forEach(function (id) { delete hh.ledger[id]; });
    (ledgerUpserts || []).forEach(function (e) { hh.ledger[e.id] = memClone(e); });
    this._emit();
    return Promise.resolve();
  };

  MemoryBackend.prototype.runUnconfirmTx = function (hid, month, nextSettlement, ledgerDeletes) {
    const hh = this._member(hid);
    const cur = hh.settlements[month];
    if (!settled(cur)) {
      return Promise.reject(Object.assign(new Error('not-settled'), { code: 'not-settled' }));
    }
    if (nextSettlement) hh.settlements[month] = memClone(nextSettlement);
    else delete hh.settlements[month];
    (ledgerDeletes || []).forEach(function (id) { delete hh.ledger[id]; });
    this._emit();
    return Promise.resolve();
  };

  MemoryBackend.prototype.replaceAll = function (hid, state) {
    const hh = this._member(hid);
    writeStateToMem(hh, state);
    this._emit();
    return Promise.resolve();
  };

  function writeStateToMem(hh, state) {
    hh.payments = {};
    hh.items = {};
    hh.ledger = {};
    hh.settlements = {};
    (state.payments || []).forEach(function (p) { if (p && p.id) hh.payments[p.id] = memClone(p); });
    (state.items || []).forEach(function (it) { if (it && it.id) hh.items[it.id] = memClone(it); });
    (state.ledger || []).forEach(function (e) { if (e && e.id) hh.ledger[e.id] = memClone(e); });
    Object.keys(state.settlements || {}).forEach(function (k) {
      hh.settlements[k] = memClone(state.settlements[k]);
    });
    hh.config = metaFromState(state);
  }

  function stateFromMem(hh) {
    return stateFromBags({
      meta: hh.config || {},
      payments: Object.keys(hh.payments).map(function (k) { return hh.payments[k]; }),
      items: Object.keys(hh.items).map(function (k) { return hh.items[k]; }),
      ledger: Object.keys(hh.ledger).map(function (k) { return hh.ledger[k]; }),
      settlements: Object.keys(hh.settlements).map(function (k) {
        return Object.assign({ id: k }, hh.settlements[k]);
      }),
    });
  }

  function applyDiffToMem(hh, prev, next) {
    const pays = diffList(prev && prev.payments, next.payments);
    pays.upserts.forEach(function (p) { hh.payments[p.id] = memClone(p); });
    pays.deletes.forEach(function (id) { delete hh.payments[id]; });
    const items = diffList(prev && prev.items, next.items);
    items.upserts.forEach(function (it) { hh.items[it.id] = memClone(it); });
    items.deletes.forEach(function (id) { delete hh.items[id]; });
    const led = diffList(prev && prev.ledger, next.ledger);
    led.upserts.forEach(function (e) { hh.ledger[e.id] = memClone(e); });
    led.deletes.forEach(function (id) { delete hh.ledger[id]; });
    const st = diffSettlements(prev && prev.settlements, next.settlements);
    st.upserts.forEach(function (x) { hh.settlements[x.id] = memClone(x.data); });
    st.deletes.forEach(function (id) { delete hh.settlements[id]; });
    hh.config = metaFromState(next);
  }

  /* ---------- Firebase backend ---------- */
  function emulatorOpts() {
    if (root.__warikanFirebaseEmulator) return root.__warikanFirebaseEmulator;
    return null;
  }

  function FirebaseBackend() {
    this.kind = 'firebase';
    this._mod = null;
    this._app = null;
    this._auth = null;
    this._db = null;
    this.uid = null;
  }
  FirebaseBackend.prototype.init = async function () {
    if (this._db) return;
    const [appMod, authMod, fsMod] = await Promise.all([
      import(FB_BASE + '/firebase-app.js'),
      import(FB_BASE + '/firebase-auth.js'),
      import(FB_BASE + '/firebase-firestore.js'),
    ]);
    this._mod = { app: appMod, auth: authMod, fs: fsMod };
    const apps = appMod.getApps ? appMod.getApps() : [];
    this._app = apps && apps.length ? (appMod.getApp('warikan') || apps[0]) : appMod.initializeApp(FIREBASE_CONFIG, 'warikan');
    this._auth = authMod.getAuth(this._app);
    const emu = emulatorOpts();
    if (emu && authMod.connectAuthEmulator) {
      try { authMod.connectAuthEmulator(this._auth, 'http://' + (emu.host || '127.0.0.1') + ':' + (emu.authPort || 9098), { disableWarnings: true }); } catch (e) {}
    }
    try {
      if (emu) {
        this._db = fsMod.initializeFirestore(this._app, { localCache: fsMod.memoryLocalCache ? fsMod.memoryLocalCache() : undefined });
        fsMod.connectFirestoreEmulator(this._db, emu.host || '127.0.0.1', emu.firestorePort || 8088);
      } else {
        const cache = fsMod.persistentLocalCache
          ? fsMod.persistentLocalCache(fsMod.persistentMultipleTabManager ? { tabManager: fsMod.persistentMultipleTabManager() } : {})
          : undefined;
        this._db = fsMod.initializeFirestore(this._app, cache ? { localCache: cache } : {});
      }
    } catch (e) {
      this._db = fsMod.getFirestore(this._app);
      if (emu && fsMod.connectFirestoreEmulator) {
        try { fsMod.connectFirestoreEmulator(this._db, emu.host || '127.0.0.1', emu.firestorePort || 8088); } catch (err) {}
      }
    }
    if (this._auth.currentUser) this.uid = this._auth.currentUser.uid;
  };
  FirebaseBackend.prototype.signInAnonymously = async function () {
    await this.init();
    if (this._auth.currentUser) {
      this.uid = this._auth.currentUser.uid;
      return this.uid;
    }
    const cred = await this._mod.auth.signInAnonymously(this._auth);
    this.uid = cred.user.uid;
    return this.uid;
  };
  FirebaseBackend.prototype.signOut = async function () {
    if (!this._auth) return;
    try { await this._mod.auth.signOut(this._auth); } catch (e) {}
    this.uid = null;
  };
  FirebaseBackend.prototype.currentUid = function () {
    return (this._auth && this._auth.currentUser && this._auth.currentUser.uid) || this.uid;
  };
  FirebaseBackend.prototype.isOnline = function () {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  };
  FirebaseBackend.prototype._col = function (hid, name) {
    const fs = this._mod.fs;
    return fs.collection(this._db, 'households', hid, name);
  };
  FirebaseBackend.prototype._doc = function () {
    const fs = this._mod.fs;
    return fs.doc(this._db, Array.prototype.slice.call(arguments).join('/').replace(/^/, '').split('/').filter(Boolean).join && fs.doc
      ? null : null);
  };
  FirebaseBackend.prototype.doc = function () {
    const fs = this._mod.fs;
    const args = [this._db].concat(Array.prototype.slice.call(arguments));
    return fs.doc.apply(fs, args);
  };

  FirebaseBackend.prototype.createHousehold = async function (info) {
    await this.signInAnonymously();
    const fs = this._mod.fs;
    const uid = this.uid;
    const href = this.doc('households', info.hid);
    const members = {};
    members[uid] = { joinedAt: nowMs() };
    await fs.setDoc(href, {
      members: members,
      inviteToken: info.token,
      createdAt: nowMs(),
      hostName: info.hostName || '',
      hostPersonId: info.hostPersonId || 'yamada',
    });
    await fs.setDoc(this.doc('households', info.hid, 'invite', info.token), {
      inviteToken: info.token,
      hostName: info.hostName || '',
      hostPersonId: info.hostPersonId || 'yamada',
    });
    await this.replaceAll(info.hid, info.state || {});
    return { hid: info.hid, token: info.token, uid: uid, members: members };
  };

  FirebaseBackend.prototype.readInvite = async function (hid, token) {
    await this.signInAnonymously();
    const fs = this._mod.fs;
    const snap = await fs.getDoc(this.doc('households', hid, 'invite', token));
    if (!snap.exists()) throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
    return snap.data();
  };

  FirebaseBackend.prototype.joinHousehold = async function (hid, token) {
    await this.signInAnonymously();
    const fs = this._mod.fs;
    const uid = this.uid;
    const href = this.doc('households', hid);
    /* すでにメンバーなら（前回の参加が途中で止まった等）書き込まずにそのまま使う */
    let pre = null;
    try {
      pre = await fs.getDoc(href);
    } catch (e) {
      if (errCode(e) !== 'permission-denied') throw tagErr(e, 'join-check');
    }
    if (pre && pre.exists()) {
      const d = pre.data() || {};
      const role = memberRole(d.members, uid);
      if (role === 'host') throw tagErr(mkErr('own-invite'), 'join-check');
      if (role === 'member') return d;
    }
    try {
      await fs.updateDoc(href, {
        joinPresentedToken: token,
        ['members.' + uid]: { joinedAt: nowMs() },
      });
    } catch (e) {
      if (errCode(e) === 'permission-denied') {
        /* 招待はまだ読める → もう2人そろっている（使用済み）。読めない → 招待が無効 */
        let inviteOk = false;
        try {
          const inv = await fs.getDoc(this.doc('households', hid, 'invite', token));
          inviteOk = inv.exists();
        } catch (e2) {}
        throw tagErr(mkErr(inviteOk ? 'invite-used' : 'invite-invalid', e), 'join-write');
      }
      throw tagErr(e, 'join-write');
    }
    let snap;
    try {
      snap = await fs.getDoc(href);
    } catch (e) {
      throw tagErr(e, 'join-read');
    }
    return snap.exists() ? snap.data() : { members: {} };
  };

  /* IndexedDB が壊れた端末（iOS Safari で起きやすい）向け：メモリキャッシュで作り直す */
  FirebaseBackend.prototype.useMemoryCache = async function () {
    if (!this._db || !this._mod) return false;
    if (this._memoryCache) return false;
    const fs = this._mod.fs;
    try { await fs.terminate(this._db); } catch (e) {}
    try {
      this._db = fs.initializeFirestore(this._app, { localCache: fs.memoryLocalCache ? fs.memoryLocalCache() : undefined });
    } catch (e) {
      this._db = fs.getFirestore(this._app);
    }
    this._memoryCache = true;
    return true;
  };

  FirebaseBackend.prototype.fetchAll = async function (hid) {
    await this.init();
    const fs = this._mod.fs;
    const bags = { payments: [], items: [], ledger: [], settlements: [], meta: {} };
    const names = ['payments', 'items', 'ledger', 'settlements'];
    for (let i = 0; i < names.length; i++) {
      const snap = await fs.getDocs(this._col(hid, names[i]));
      bags[names[i]] = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
    }
    const metaSnap = await fs.getDoc(this.doc('households', hid, 'meta', 'config'));
    if (metaSnap.exists()) bags.meta = metaSnap.data() || {};
    return stateFromBags(bags);
  };

  FirebaseBackend.prototype.listen = function (hid, onData, onError, onConn) {
    const self = this;
    const fs = this._mod.fs;
    const bags = { payments: null, items: null, ledger: null, settlements: null, meta: null };
    const unsubs = [];
    let members = null;
    let hostName = '';
    let hostPersonId = 'yamada';
    let stopped = false;

    function conn() {
      if (!onConn || stopped) return;
      const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
      onConn({ offline: offline, members: members, hostName: hostName, hostPersonId: hostPersonId });
    }
    function maybe() {
      if (stopped) return;
      if (bags.payments == null || bags.items == null || bags.ledger == null || bags.settlements == null || bags.meta == null) return;
      try { onData(stateFromBags(bags)); } catch (e) { if (onError) onError(e); }
    }
    function listenCol(name) {
      const u = fs.onSnapshot(self._col(hid, name), { includeMetadataChanges: true }, function (snap) {
        const first = bags[name] == null;
        const dataChanged = first || snap.docChanges().length > 0;
        if (dataChanged) {
          bags[name] = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        }
        conn();
        if (dataChanged) maybe();
      }, function (err) { if (onError) onError(err); });
      unsubs.push(u);
    }
    listenCol('payments');
    listenCol('items');
    listenCol('ledger');
    listenCol('settlements');
    unsubs.push(fs.onSnapshot(this.doc('households', hid, 'meta', 'config'), { includeMetadataChanges: true }, function (snap) {
      const next = snap.exists() ? (snap.data() || {}) : {};
      const first = bags.meta == null;
      const changed = first || JSON.stringify(bags.meta) !== JSON.stringify(next);
      if (changed) bags.meta = next;
      conn();
      if (changed) maybe();
    }, function (err) { if (onError) onError(err); }));
    unsubs.push(fs.onSnapshot(this.doc('households', hid), { includeMetadataChanges: true }, function (snap) {
      if (snap.exists()) {
        const d = snap.data() || {};
        members = d.members || {};
        hostName = d.hostName || '';
        hostPersonId = d.hostPersonId || 'yamada';
      }
      conn();
    }, function (err) { if (onError) onError(err); }));

    const onOff = function () { conn(); };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOff);
      window.addEventListener('offline', onOff);
    }
    return function () {
      stopped = true;
      unsubs.forEach(function (u) { try { u(); } catch (e) {} });
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOff);
        window.removeEventListener('offline', onOff);
      }
    };
  };

  FirebaseBackend.prototype._runBatch = async function (writes) {
    const fs = this._mod.fs;
    const CHUNK = 400;
    for (let i = 0; i < writes.length; i += CHUNK) {
      const batch = fs.writeBatch(this._db);
      writes.slice(i, i + CHUNK).forEach(function (w) {
        if (w.type === 'set') batch.set(w.ref, w.data);
        else if (w.type === 'delete') batch.delete(w.ref);
      });
      await batch.commit();
    }
  };

  FirebaseBackend.prototype.writeDiff = async function (hid, prev, next) {
    await this.init();
    const self = this;
    const writes = [];
    function addList(col, diff) {
      diff.upserts.forEach(function (row) {
        writes.push({ type: 'set', ref: self.doc('households', hid, col, row.id), data: row });
      });
      diff.deletes.forEach(function (id) {
        writes.push({ type: 'delete', ref: self.doc('households', hid, col, id) });
      });
    }
    addList('payments', diffList(prev && prev.payments, next.payments));
    addList('items', diffList(prev && prev.items, next.items));
    addList('ledger', diffList(prev && prev.ledger, next.ledger));
    const st = diffSettlements(prev && prev.settlements, next.settlements);
    st.upserts.forEach(function (x) {
      writes.push({ type: 'set', ref: self.doc('households', hid, 'settlements', x.id), data: x.data });
    });
    st.deletes.forEach(function (id) {
      writes.push({ type: 'delete', ref: self.doc('households', hid, 'settlements', id) });
    });
    writes.push({ type: 'set', ref: this.doc('households', hid, 'meta', 'config'), data: metaFromState(next) });
    await this._runBatch(writes);
  };

  FirebaseBackend.prototype.writePaymentIfMatch = async function (hid, id, expectedUpdatedAt, data, opts) {
    await this.init();
    const fs = this._mod.fs;
    const self = this;
    const force = opts && opts.force;
    try {
      return await fs.runTransaction(this._db, async function (tx) {
        const ref = self.doc('households', hid, 'payments', id);
        const snap = await tx.get(ref);
        const cur = snap.exists() ? snap.data() : null;
        if (!force) {
          if (expectedUpdatedAt == null) {
            if (cur) return { ok: false, conflict: true, remote: cur };
          } else if (!cur || (cur.updatedAt || 0) !== expectedUpdatedAt) {
            return { ok: false, conflict: true, remote: cur || null };
          }
        }
        tx.set(ref, data);
        return { ok: true };
      });
    } catch (e) {
      if (e && e.conflict) return { ok: false, conflict: true, remote: e.remote || null };
      throw e;
    }
  };

  FirebaseBackend.prototype.runSettleTx = async function (hid, month, settlement, ledgerUpserts, ledgerDeletes) {
    await this.init();
    const fs = this._mod.fs;
    const self = this;
    await fs.runTransaction(this._db, async function (tx) {
      const sref = self.doc('households', hid, 'settlements', month);
      const snap = await tx.get(sref);
      const cur = snap.exists() ? snap.data() : null;
      if (settled(cur) && settled(settlement)) {
        throw Object.assign(new Error('already-settled'), { code: 'already-settled' });
      }
      tx.set(sref, settlement);
      (ledgerDeletes || []).forEach(function (id) { tx.delete(self.doc('households', hid, 'ledger', id)); });
      (ledgerUpserts || []).forEach(function (e) { tx.set(self.doc('households', hid, 'ledger', e.id), e); });
    });
  };

  FirebaseBackend.prototype.runUnconfirmTx = async function (hid, month, nextSettlement, ledgerDeletes) {
    await this.init();
    const fs = this._mod.fs;
    const self = this;
    await fs.runTransaction(this._db, async function (tx) {
      const sref = self.doc('households', hid, 'settlements', month);
      const snap = await tx.get(sref);
      const cur = snap.exists() ? snap.data() : null;
      if (!settled(cur)) throw Object.assign(new Error('not-settled'), { code: 'not-settled' });
      if (nextSettlement) tx.set(sref, nextSettlement);
      else tx.delete(sref);
      (ledgerDeletes || []).forEach(function (id) { tx.delete(self.doc('households', hid, 'ledger', id)); });
    });
  };

  FirebaseBackend.prototype.replaceAll = async function (hid, state) {
    await this.init();
    const fs = this._mod.fs;
    const self = this;
    const names = ['payments', 'items', 'ledger', 'settlements'];
    const existing = {};
    for (let i = 0; i < names.length; i++) {
      const snap = await fs.getDocs(this._col(hid, names[i]));
      existing[names[i]] = snap.docs.map(function (d) { return d.id; });
    }
    const writes = [];
    function setAll(col, rows) {
      const keep = {};
      (rows || []).forEach(function (row) {
        if (!row || !row.id) return;
        keep[row.id] = true;
        writes.push({ type: 'set', ref: self.doc('households', hid, col, row.id), data: row });
      });
      (existing[col] || []).forEach(function (id) {
        if (!keep[id]) writes.push({ type: 'delete', ref: self.doc('households', hid, col, id) });
      });
    }
    setAll('payments', state.payments);
    setAll('items', state.items);
    setAll('ledger', state.ledger);
    const setts = Object.keys(state.settlements || {}).map(function (k) {
      return Object.assign({ id: k }, state.settlements[k]);
    });
    const keepS = {};
    setts.forEach(function (row) {
      keepS[row.id] = true;
      const data = Object.assign({}, row);
      delete data.id;
      writes.push({ type: 'set', ref: self.doc('households', hid, 'settlements', row.id), data: data });
    });
    (existing.settlements || []).forEach(function (id) {
      if (!keepS[id]) writes.push({ type: 'delete', ref: self.doc('households', hid, 'settlements', id) });
    });
    writes.push({ type: 'set', ref: this.doc('households', hid, 'meta', 'config'), data: metaFromState(state) });
    await this._runBatch(writes);
  };

  /* ---------- Sync facade ---------- */
  function defaultBackend() {
    if (root.__warikanSyncMemoryDb) return new MemoryBackend(root.__warikanSyncMemoryDb);
    if (root.__warikanSyncBackend === 'memory') {
      if (!root.__warikanSyncMemoryDb) root.__warikanSyncMemoryDb = createMemoryDb();
      return new MemoryBackend(root.__warikanSyncMemoryDb);
    }
    return new FirebaseBackend();
  }

  function createClient(opts) {
    opts = opts || {};
    let hooks = {
      getState: function () { return null; },
      replaceState: function () {},
      onStatus: function () {},
    };
    let backend = opts.backend || null;
    let session = null;
    let lastPushed = null;
    let unsub = null;
    let notifyTimer = null;
    let applyingRemote = false;
    let flushChain = Promise.resolve();
    let statusOffline = false;
    let cachedMembers = null;
    let cachedHostName = '';
    let cachedHostPersonId = 'yamada';
    const persistSession = opts.ephemeral ? false : true;
    const sessionKey = opts.sessionKey || SESSION_KEY;

    function inviteUrl(hid, token) {
      const s = session || {};
      return makeInviteUrl(hid || s.hid, token || s.token);
    }
    function loadSession() {
      if (!persistSession) return null;
      try {
        const raw = root.localStorage && localStorage.getItem(sessionKey);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s || !s.hid || !s.token) return null;
        return s;
      } catch (e) { return null; }
    }
    function saveSession(s) {
      session = s;
      if (!persistSession) return;
      try {
        if (!root.localStorage) return;
        if (s) localStorage.setItem(sessionKey, JSON.stringify(s));
        else localStorage.removeItem(sessionKey);
      } catch (e) {}
    }

    function ensureBackend() {
    if (!backend) backend = defaultBackend();
    return backend;
  }

  function memberCount() {
    return cachedMembers ? Object.keys(cachedMembers).length : (session ? 1 : 0);
  }

  function status() {
    const state = hooks.getState && hooks.getState();
    const hostPersonId = (session && session.hostPersonId) || cachedHostPersonId || 'yamada';
    const waitingName = personName(state, otherPersonId(hostPersonId));
    return {
      active: !!(session && !session.left),
      left: !!(session && session.left),
      canReconnect: !!(session && session.left && session.hid && session.uid),
      offline: !!(session && !session.left && statusOffline),
      memberCount: session && !session.left ? memberCount() : 0,
      waitingName: waitingName,
      hostName: cachedHostName || (session && session.hostName) || personName(state, hostPersonId),
      hostPersonId: hostPersonId,
      me: me(),
      hid: session && session.hid,
      token: session && session.token,
      uid: session && session.uid,
    };
  }

  function emitStatus() {
    try { hooks.onStatus(status()); } catch (e) {}
  }

    let hydrating = false;

    function payKey(p) {
      return JSON.stringify({
        amount: p && p.amount,
        payerId: p && p.payerId,
        itemId: p && p.itemId,
        itemName: p && p.itemName,
        extra: !!(p && p.extra),
      });
    }

    function describeRemoteChanges(prev, next) {
      const my = me();
      const events = [];
      const prevIdx = indexById((prev && prev.payments) || []);
      ((next && next.payments) || []).forEach(function (p) {
        if (!p || !p.id) return;
        if (!p.updatedBy || p.updatedBy === my) return;
        const old = prevIdx[p.id];
        const filled = p.amount != null && p.amount !== '';
        if (!old) {
          events.push({ kind: filled ? 'pay-input' : 'pay-add', payment: p, writer: p.updatedBy });
          return;
        }
        if (payKey(old) === payKey(p)) return;
        const oldFilled = old.amount != null && old.amount !== '';
        events.push({ kind: (!oldFilled && filled) ? 'pay-input' : 'pay-edit', payment: p, writer: p.updatedBy });
      });
      const prevS = (prev && prev.settlements) || {};
      const nextS = (next && next.settlements) || {};
      Object.keys(nextS).forEach(function (m) {
        const a = settled(prevS[m]);
        const b = settled(nextS[m]);
        if (!a && b) {
          const rec = nextS[m];
          const writer = (rec && rec.updatedBy) || (rec && rec.snapshot && rec.snapshot.updatedBy);
          if (!writer || writer === my) return;
          events.push({ kind: 'settle', month: m, writer: writer, settlement: rec });
        }
      });
      return events;
    }

    function applyRemote(next, opts) {
      const S = root.WarikanStore;
      const local = hooks.getState && hooks.getState();
      const pending = lastPushed && local && !same(local, lastPushed);
      const norm = S && S.normalize ? S.normalize(clone(next)) : clone(next);
      const dropped = [];
      const applied = pending ? mergePush(lastPushed, local, norm, dropped) : norm;
      const initial = !!(opts && opts.initial);
      const prevRemote = lastPushed ? clone(lastPushed) : null;
      applyingRemote = true;
      try {
        lastPushed = clone(norm);
        hooks.replaceState(applied);
      } finally {
        applyingRemote = false;
      }
      if (pending && !same(applied, norm) && !hasCommitLock()) queuePush(applied);
      if (!initial && prevRemote) {
        const notices = describeRemoteChanges(prevRemote, norm);
        const conflictIds = {};
        dropped.forEach(function (d) { if (d && d.theirs && d.theirs.id) conflictIds[d.theirs.id] = true; });
        const toastable = notices.filter(function (n) { return !n.payment || !conflictIds[n.payment.id]; });
        if (toastable.length && hooks.onRemoteNotice) {
          try { hooks.onRemoteNotice(toastable); } catch (e) {}
        }
        if (dropped.length && hooks.onPaymentConflict) {
          try { hooks.onPaymentConflict(dropped[0]); } catch (e) {}
        }
      }
    }

  function startListen() {
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    if (!session || session.left) return;
    const b = ensureBackend();
    hydrating = true;
    unsub = b.listen(session.hid, function (st) {
      if (applyingRemote) return;
      const first = hydrating;
      hydrating = false;
      applyRemote(st, { initial: first });
    }, function (err) {
      if (err && (err.code === 'permission-denied' || err.code === 'unauthenticated')) {
        /* 再接続できないときは端末のデータを残して共有だけ外す。hid/uid は残す */
        stopListen();
        if (session) saveSession(Object.assign({}, session, { left: true, leftAt: nowMs() }));
        else saveSession(null);
        lastPushed = null;
        emitStatus();
      }
    }, function (conn) {
      if (conn.members) cachedMembers = conn.members;
      if (conn.hostName) cachedHostName = conn.hostName;
      if (conn.hostPersonId) cachedHostPersonId = conn.hostPersonId;
      statusOffline = !!conn.offline;
      emitStatus();
    });
  }

  function stopListen() {
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
  }

  function settleDiffs(prev, next) {
    const out = { settles: [], unconfirms: [] };
    const prevS = (prev && prev.settlements) || {};
    const nextS = (next && next.settlements) || {};
    const months = {};
    Object.keys(prevS).concat(Object.keys(nextS)).forEach(function (m) { months[m] = true; });
    Object.keys(months).forEach(function (m) {
      const a = settled(prevS[m]);
      const b = settled(nextS[m]);
      const prevCarry = (prev && prev.ledger || []).filter(function (e) { return e.kind === 'carry' && e.month === m; });
      const nextCarry = (next && next.ledger || []).filter(function (e) { return e.kind === 'carry' && e.month === m; });
      if (!a && b) {
        out.settles.push({
          month: m,
          settlement: nextS[m],
          ledgerUpserts: nextCarry,
          ledgerDeletes: prevCarry.map(function (e) { return e.id; }).filter(function (id) {
            return !nextCarry.some(function (x) { return x.id === id; });
          }),
        });
      } else if (a && !b) {
        out.unconfirms.push({
          month: m,
          settlement: nextS[m] || null,
          ledgerDeletes: prevCarry.map(function (e) { return e.id; }),
        });
      }
    });
    return out;
  }

  function stripSettledLedger(prev, next, ops) {
    /* 精算の台帳行は transaction 側で書くので、通常 diff から外す */
    if (!ops.settles.length && !ops.unconfirms.length) return { prev: prev, next: next };
    const skip = {};
    ops.settles.forEach(function (op) {
      skip[op.month] = true;
      (op.ledgerUpserts || []).forEach(function (e) { skip['l:' + e.id] = true; });
      (op.ledgerDeletes || []).forEach(function (id) { skip['l:' + id] = true; });
    });
    ops.unconfirms.forEach(function (op) {
      skip[op.month] = true;
      (op.ledgerDeletes || []).forEach(function (id) { skip['l:' + id] = true; });
    });
    function filterState(st, isPrev) {
      const copy = clone(st);
      const setts = {};
      Object.keys(copy.settlements || {}).forEach(function (m) {
        if (!skip[m]) setts[m] = copy.settlements[m];
        else if (isPrev) setts[m] = copy.settlements[m]; /* prev に残すと next から消えた扱いにならないよう、両方から外す */
      });
      /* 両方から対象月を外すと diff が空になる */
      copy.settlements = {};
      Object.keys((st.settlements || {})).forEach(function (m) {
        if (!skip[m]) copy.settlements[m] = st.settlements[m];
      });
      copy.ledger = (st.ledger || []).filter(function (e) { return !skip['l:' + e.id]; });
      return copy;
    }
    return { prev: filterState(prev, true), next: filterState(next, false) };
  }

    function emptyState() {
      return { payments: [], items: [], ledger: [], settlements: {}, people: {}, ratioYamada: 50, version: 1 };
    }

    function mergeList(baseArr, localArr, currentArr, dropped) {
      const d = diffList(baseArr, localArr);
      const curIdx = indexById(currentArr);
      const baseIdx = indexById(baseArr);
      d.upserts.forEach(function (row) {
        const remote = curIdx[row.id];
        if (remote && baseIdx[row.id] && !same(remote, baseIdx[row.id]) && (remote.updatedAt || 0) > (row.updatedAt || 0)) {
          if (dropped) dropped.push({ mine: clone(row), theirs: clone(remote) });
          return;
        }
        curIdx[row.id] = row;
      });
      d.deletes.forEach(function (id) {
        const remote = curIdx[id];
        const was = baseIdx[id];
        if (remote && was && same(remote, was)) delete curIdx[id];
      });
      return Object.keys(curIdx).map(function (k) { return curIdx[k]; });
    }

    function mergePush(base, local, current, dropped) {
      const out = clone(current || local || emptyState());
      base = base || emptyState();
      local = local || emptyState();
      out.payments = mergeList(base.payments, local.payments, out.payments, dropped);
      out.items = mergeList(base.items, local.items, out.items);
      out.ledger = mergeList(base.ledger, local.ledger, out.ledger);
      const st = diffSettlements(base.settlements, local.settlements);
      out.settlements = clone(out.settlements || {});
      st.upserts.forEach(function (x) {
        const remote = out.settlements[x.id];
        const was = (base.settlements || {})[x.id];
        if (remote && was && !same(remote, was) && (remote.settledAt || remote.updatedAt || 0) > (x.data && (x.data.settledAt || x.data.updatedAt) || 0)) return;
        out.settlements[x.id] = x.data;
      });
      st.deletes.forEach(function (id) {
        const remote = out.settlements[id];
        const was = (base.settlements || {})[id];
        if (remote && was && same(remote, was)) delete out.settlements[id];
      });
      out.people = local.people || out.people;
      out.ratioYamada = local.ratioYamada != null ? local.ratioYamada : out.ratioYamada;
      out.version = local.version || out.version;
      out.createdAt = local.createdAt || out.createdAt;
      out.updatedAt = local.updatedAt || out.updatedAt;
      return out;
    }

    function pushState(job) {
    if (!session || session.left || applyingRemote) return Promise.resolve();
    const next = job && job.next ? mergePush(job.base, job.next, lastPushed) : job;
    const b = ensureBackend();
    const prev = lastPushed || emptyState();
    const ops = settleDiffs(prev, next);
    const stripped = stripSettledLedger(prev, next, ops);
    let p = Promise.resolve();
    ops.settles.forEach(function (op) {
      p = p.then(function () {
        return b.runSettleTx(session.hid, op.month, op.settlement, op.ledgerUpserts, op.ledgerDeletes);
      });
    });
    ops.unconfirms.forEach(function (op) {
      p = p.then(function () {
        return b.runUnconfirmTx(session.hid, op.month, op.settlement, op.ledgerDeletes);
      });
    });
    p = p.then(function () {
      return b.writeDiff(session.hid, stripped.prev, stripped.next);
    }).then(function () {
      lastPushed = clone(next);
    }).catch(function (err) {
      if (err && (err.code === 'already-settled' || err.code === 'not-settled')) {
        return b.fetchAll(session.hid).then(function (st) { applyRemote(st); });
      }
      statusOffline = true;
      emitStatus();
      throw err;
    });
    return p;
  }

    let pendingJob = null;
    const commitLocks = {};

    function hasCommitLock() {
      return Object.keys(commitLocks).length > 0;
    }

    function queuePush(state) {
      if (!session || session.left) return Promise.resolve();
      const job = { base: lastPushed ? clone(lastPushed) : emptyState(), next: clone(state) };
      flushChain = flushChain.then(function () { return pushState(job); }).catch(function () {});
      return flushChain;
    }

    function notifyLocal(state) {
      if (!session || session.left || applyingRemote) return;
      pendingJob = { base: lastPushed ? clone(lastPushed) : emptyState(), next: clone(state) };
      if (notifyTimer) clearTimeout(notifyTimer);
      notifyTimer = setTimeout(function () {
        notifyTimer = null;
        const job = pendingJob;
        pendingJob = null;
        if (job) flushChain = flushChain.then(function () { return pushState(job); }).catch(function () {});
      }, 80);
    }

    function flush() {
      if (notifyTimer) {
        clearTimeout(notifyTimer);
        notifyTimer = null;
      }
      if (pendingJob) {
        const job = pendingJob;
        pendingJob = null;
        flushChain = flushChain.then(function () { return pushState(job); }).catch(function () {});
      }
      return flushChain;
    }

  function startShare() {
    const state = hooks.getState && hooks.getState();
    if (!state) return Promise.reject(new Error('no-state'));
    const hid = randomId(16);
    const token = randomId(16);
    const hostPersonId = 'yamada';
    const hostName = personName(state, hostPersonId);
    const b = ensureBackend();
    return b.createHousehold({
      hid: hid,
      token: token,
      hostName: hostName,
      hostPersonId: hostPersonId,
      state: state,
    }).then(function (info) {
      lastPushed = clone(state);
      cachedMembers = info.members;
      cachedHostName = hostName;
      cachedHostPersonId = hostPersonId;
      statusOffline = b.isOnline() === false;
      saveSession({
        hid: hid,
        token: token,
        uid: info.uid,
        hostName: hostName,
        hostPersonId: hostPersonId,
        me: hostPersonId,
        startedAt: nowMs(),
      });
      startListen();
      emitStatus();
      return status();
    });
  }

  function join(hid, token) {
    const b = ensureBackend();
    if (session && !session.left && session.hid === hid) {
      if (session.me === (session.hostPersonId || 'yamada')) return Promise.reject(tagErr(mkErr('own-invite'), 'join-check'));
      return Promise.resolve(status());
    }
    function attempt() {
      return b.joinHousehold(hid, token).then(function (meta) {
        return b.fetchAll(hid).catch(function (e) { throw tagErr(e, 'fetch'); }).then(function (st) {
          return { meta: meta, st: st };
        });
      });
    }
    return attempt().catch(function (e) {
      /* IndexedDB まわりで落ちたらメモリキャッシュで1回だけやり直す（参加は何度やっても安全） */
      if (isStorageError(e) && b.useMemoryCache) {
        return b.useMemoryCache().then(function (switched) {
          if (!switched) throw e;
          return attempt();
        });
      }
      throw e;
    }).then(function (res) {
      const meta = res.meta;
      const st = res.st;
      try {
        const S = root.WarikanStore;
        const norm = S && S.normalize ? S.normalize(st) : st;
        applyingRemote = true;
        try {
          lastPushed = clone(norm);
          hooks.replaceState(norm);
        } finally {
          applyingRemote = false;
        }
        cachedMembers = (meta && meta.members) || {};
        cachedHostName = (meta && meta.hostName) || '';
        cachedHostPersonId = (meta && meta.hostPersonId) || 'yamada';
        statusOffline = b.isOnline() === false;
        saveSession({
          hid: hid,
          token: token,
          uid: b.currentUid(),
          hostName: cachedHostName,
          hostPersonId: cachedHostPersonId,
          me: otherPersonId(cachedHostPersonId),
          startedAt: nowMs(),
        });
      } catch (e) {
        throw tagErr(e, 'apply');
      }
      startListen();
      emitStatus();
      return status();
    });
  }

  function leave(opts) {
    stopListen();
    const forget = !!(opts && opts.forget);
    const b = backend;
    lastPushed = null;
    cachedMembers = null;
    statusOffline = false;
    hydrating = false;
    if (!forget && session && session.hid && session.uid) {
      saveSession(Object.assign({}, session, { left: true, leftAt: nowMs() }));
      emitStatus();
      return Promise.resolve();
    }
    cachedHostName = '';
    saveSession(null);
    const p = b && b.signOut ? b.signOut() : Promise.resolve();
    return p.then(function () { emitStatus(); });
  }

  function canReconnect() {
    return !!(session && session.left && session.hid && session.uid);
  }

  function reconnect() {
    if (!canReconnect()) return Promise.resolve({ ok: false, reason: 'no-session' });
    const s = session;
    const b = ensureBackend();
    return b.init().then(function () { return b.signInAnonymously(); }).then(function (uid) {
      if (s.uid && uid && s.uid !== uid) {
        return { ok: false, reason: 'auth-lost' };
      }
      if (!s.uid && uid) {
        s.uid = uid;
        saveSession(s);
      }
      return b.fetchAll(s.hid).then(function (st) {
        const S = root.WarikanStore;
        const norm = S && S.normalize ? S.normalize(st) : st;
        applyingRemote = true;
        try {
          lastPushed = clone(norm);
          hooks.replaceState(norm);
        } finally {
          applyingRemote = false;
        }
        s.left = false;
        delete s.leftAt;
        saveSession(s);
        statusOffline = b.isOnline() === false;
        startListen();
        emitStatus();
        return { ok: true };
      }).catch(function (err) {
        const code = err && err.code;
        if (code === 'permission-denied' || code === 'unauthenticated' || code === 'not-found') {
          return { ok: false, reason: 'auth-lost' };
        }
        return Promise.reject(err);
      });
    }).catch(function (err) {
      const code = err && err.code;
      if (code === 'permission-denied' || code === 'unauthenticated') {
        return { ok: false, reason: 'auth-lost' };
      }
      return Promise.reject(err);
    });
  }

  function patchLastPushedPayment(payment) {
    if (!payment || !payment.id) return;
    if (!lastPushed) lastPushed = emptyState();
    lastPushed = clone(lastPushed);
    lastPushed.payments = (lastPushed.payments || []).slice();
    const i = lastPushed.payments.findIndex(function (x) { return x && x.id === payment.id; });
    if (i >= 0) lastPushed.payments[i] = clone(payment);
    else lastPushed.payments.push(clone(payment));
  }

  function commitPayment(expectedUpdatedAt, payment, opts) {
    if (!session || session.left || !payment || !payment.id) return Promise.resolve({ ok: true, localOnly: true });
    const b = ensureBackend();
    if (!b.writePaymentIfMatch) return Promise.resolve({ ok: true, localOnly: true });
    commitLocks[payment.id] = true;
    return flush().then(function () {
      return b.writePaymentIfMatch(session.hid, payment.id, expectedUpdatedAt, payment, opts);
    }).then(function (res) {
      if (res && res.ok) patchLastPushedPayment(payment);
      return res || { ok: true };
    }).finally(function () {
      delete commitLocks[payment.id];
    });
  }

  function resume() {
    const s = loadSession();
    if (!s) return Promise.resolve(false);
    session = s;
    if (s.left) {
      emitStatus();
      return Promise.resolve(false);
    }
    const b = ensureBackend();
    return b.init().then(function () { return b.signInAnonymously(); }).then(function (uid) {
      if (s.uid && uid && s.uid !== uid) {
        /* 別の匿名ユーザーになってしまった */
        saveSession(null);
        session = null;
        emitStatus();
        return false;
      }
      if (!s.uid && uid) {
        s.uid = uid;
        saveSession(s);
      }
      startListen();
      emitStatus();
      return true;
    }).catch(function () {
      statusOffline = true;
      emitStatus();
      return !!session;
    });
  }

  function peekInvite(hid, token) {
    const b = ensureBackend();
    return b.init().then(function () { return b.signInAnonymously(); }).then(function () {
      return b.readInvite(hid, token);
    });
  }

  function shareInvitePayload() {
    const url = inviteUrl();
    if (!url) return null;
    return { title: 'わりかん', text: 'わりかんのデータにつながってね', url: url };
  }

  function init(nextHooks) {
    hooks = Object.assign(hooks, nextHooks || {});
    if (!session) {
      const s = loadSession();
      if (s) {
        session = s;
        if (s.hostName) cachedHostName = s.hostName;
        if (s.hostPersonId) cachedHostPersonId = s.hostPersonId;
      }
    }
  }

  function useBackend(next) {
    backend = next;
  }

    function me() {
      const over = readMeOverride();
      if (over) return over;
      if (session && (session.me === 'yamada' || session.me === 'kanojo')) return session.me;
      return null;
    }

    function setMeLocal(id) {
      return setMe(id);
    }

    function isActive() { return !!(session && !session.left); }


    const client = {
      init: init,
      useBackend: useBackend,
      parseJoinHash: parseJoinHash,
      parseJoinInput: parseJoinInput,
      isInAppBrowser: isInAppBrowser,
      setMe: setMeLocal,
      inviteUrl: inviteUrl,
      shareInvitePayload: shareInvitePayload,
      isActive: isActive,
      me: me,
      status: status,
      canReconnect: canReconnect,
      startShare: startShare,
      join: join,
      leave: leave,
      reconnect: reconnect,
      resume: resume,
      peekInvite: peekInvite,
      notifyLocal: notifyLocal,
      flush: flush,
      commitPayment: commitPayment,
    };
    if (opts.backend) client.useBackend(opts.backend);
    if (opts.hooks) client.init(opts.hooks);
    return client;
  }


  const defaultClient = createClient();

  const api = {
    SESSION_KEY: SESSION_KEY,
    ME_KEY: ME_KEY,
    INVITE_BASE: INVITE_BASE,
    FIREBASE_CONFIG: FIREBASE_CONFIG,
    FB_VERSION: FB_VERSION,
    createClient: createClient,
    createMemoryDb: createMemoryDb,
    MemoryBackend: MemoryBackend,
    FirebaseBackend: FirebaseBackend,
    defaultBackend: defaultBackend,
    parseJoinHash: parseJoinHash,
    parseJoinInput: parseJoinInput,
    isInAppBrowser: isInAppBrowser,
    setMe: setMe,
    classifyJoinError: classifyJoinError,
    memberRole: memberRole,
    init: function () { return defaultClient.init.apply(defaultClient, arguments); },
    useBackend: function () { return defaultClient.useBackend.apply(defaultClient, arguments); },
    inviteUrl: function () { return defaultClient.inviteUrl.apply(defaultClient, arguments); },
    shareInvitePayload: function () { return defaultClient.shareInvitePayload.apply(defaultClient, arguments); },
    isActive: function () { return defaultClient.isActive.apply(defaultClient, arguments); },
    me: function () { return defaultClient.me.apply(defaultClient, arguments); },
    status: function () { return defaultClient.status.apply(defaultClient, arguments); },
    canReconnect: function () { return defaultClient.canReconnect.apply(defaultClient, arguments); },
    startShare: function () { return defaultClient.startShare.apply(defaultClient, arguments); },
    join: function () { return defaultClient.join.apply(defaultClient, arguments); },
    leave: function () { return defaultClient.leave.apply(defaultClient, arguments); },
    reconnect: function () { return defaultClient.reconnect.apply(defaultClient, arguments); },
    resume: function () { return defaultClient.resume.apply(defaultClient, arguments); },
    peekInvite: function () { return defaultClient.peekInvite.apply(defaultClient, arguments); },
    notifyLocal: function () { return defaultClient.notifyLocal.apply(defaultClient, arguments); },
    flush: function () { return defaultClient.flush.apply(defaultClient, arguments); },
    commitPayment: function () { return defaultClient.commitPayment.apply(defaultClient, arguments); },
  };
  root.WarikanSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
