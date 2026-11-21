const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');

const PROJECT = 'warikan-ef6d0';
const RULES = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
const [host, port] = HOST.split(':');

let fails = 0;
const ck = (n, p) => p.then(() => { console.log('ok - ' + n); }).catch((e) => {
  fails++;
  console.log('FAIL - ' + n);
  console.log(e && e.message || e);
});

(async () => {
  const env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: RULES, host, port: Number(port) },
  });
  await env.clearFirestore();

  const hid = 'h' + 'a'.repeat(31);
  const token = 't' + 'b'.repeat(31);
  const alice = env.authenticatedContext('alice');
  const bob = env.authenticatedContext('bob');
  const carol = env.authenticatedContext('carol');
  const eve = env.unauthenticatedContext();
  const a = alice.firestore();
  const b = bob.firestore();
  const c = carol.firestore();
  const e = eve.firestore();
  const href = (db) => db.doc('households/' + hid);
  const inv = (db) => db.doc('households/' + hid + '/invite/' + token);
  const pay = (db, id) => db.doc('households/' + hid + '/payments/' + id);

  await ck('未ログインは作成できない', assertFails(e.doc('households/' + hid).set({
    members: { x: { joinedAt: 1 } }, inviteToken: token, createdAt: 1, hostName: 'たろう',
  })));

  await ck('ホストは自分だけが members の household を作れる', assertSucceeds(href(a).set({
    members: { alice: { joinedAt: 1 } },
    inviteToken: token,
    createdAt: 1,
    hostName: 'たろう',
    hostPersonId: 'yamada',
  })));

  await ck('ホストは invite を作れる', assertSucceeds(inv(a).set({
    inviteToken: token, hostName: 'たろう', hostPersonId: 'yamada',
  })));

  await ck('ホストは支払いを書ける', assertSucceeds(pay(a, 'p1').set({
    id: 'p1', month: '2026-11', amount: 60000,
  })));

  await ck('未参加は household を読めない', assertFails(href(b).get()));
  await ck('未参加は支払いを読めない', assertFails(pay(b, 'p1').get()));
  await ck('正しい token なら invite を読める', assertSucceeds(inv(b).get()));
  await ck('間違った token では invite を読めない', assertFails(
    b.doc('households/' + hid + '/invite/wrongtokenwrongtoken').get()
  ));
  await ck('未ログインは invite も読めない', assertFails(inv(e).get()));

  await ck('間違った token では参加できない', assertFails(href(b).update({
    joinPresentedToken: 'wrongtokenwrongtoken',
    'members.bob': { joinedAt: 2 },
  })));

  await ck('正しい token なら自分の uid を members に足せる', assertSucceeds(href(b).update({
    joinPresentedToken: token,
    'members.bob': { joinedAt: 2 },
  })));

  await ck('参加後は支払いを読める', assertSucceeds(pay(b, 'p1').get()));
  await ck('参加後は支払いを書ける', assertSucceeds(pay(b, 'p2').set({
    id: 'p2', month: '2026-11', amount: 3000,
  })));

  await ck('3人目は参加できない', assertFails(href(c).update({
    joinPresentedToken: token,
    'members.carol': { joinedAt: 3 },
  })));

  await ck('未参加は支払いを書けない', assertFails(pay(c, 'p3').set({ id: 'p3', amount: 1 })));
  await ck('members を3人に増やす普通の更新は拒否', assertFails(href(a).update({
    'members.carol': { joinedAt: 3 },
  })));
  await ck('inviteToken はメンバーでも変えられない', assertFails(href(a).update({
    inviteToken: 'newtokennewtoken12',
  })));
  await ck('household の削除はできない', assertFails(href(a).delete()));
  await ck('別パスは全部拒否', assertFails(alice.firestore().doc('other/x').set({ a: 1 })));

  await env.cleanup();
  if (fails) { console.log('FAILED ' + fails); process.exit(1); }
  console.log('rules.test.js ok');
})().catch((e) => { console.error(e); process.exit(1); });
