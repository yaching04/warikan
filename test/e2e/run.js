// E2E をまとめて実行する。静的サーバーを立て、spec を1つずつ別プロセスで動かす。
//   node test/e2e/run.js                 エミュレータ不要の spec だけ
//   node test/e2e/run.js --emulator      Firebase エミュレータが必要な spec だけ（npm run test:e2e:emulator）
//   node test/e2e/run.js ledger history  名前に一致する spec だけ
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { listen } = require('../serve');

const args = process.argv.slice(2);
const wantEmu = args.includes('--emulator');
const filters = args.filter((a) => !a.startsWith('--'));

function findSpecs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return findSpecs(p);
    return d.name.endsWith('.spec.js') ? [p] : [];
  }).sort();
}

const isEmu = (file) => /^\/\/ @emulator/m.test(fs.readFileSync(file, 'utf8').split('\n').slice(0, 5).join('\n'));

function runSpec(file, env) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = '';
    const child = spawn(process.execPath, [file], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out, ms: Date.now() - started }));
  });
}

(async () => {
  const specs = findSpecs(__dirname)
    .filter((f) => isEmu(f) === wantEmu)
    .filter((f) => !filters.length || filters.some((k) => path.relative(__dirname, f).includes(k)));
  const server = await listen(0);
  const env = Object.assign({}, process.env, { APPURL: 'http://127.0.0.1:' + server.address().port + '/index.html' });
  let passed = 0, failed = 0, checks = 0;
  const failedSpecs = [];
  for (const file of specs) {
    const name = path.relative(__dirname, file);
    const r = await runSpec(file, env);
    const ok = (r.out.match(/^(OK|ok) /gm) || []).length;
    const ng = (r.out.match(/^FAIL /gm) || []).length;
    checks += ok + ng;
    if (r.code === 0) passed++;
    else { failed++; failedSpecs.push(name); }
    console.log((r.code === 0 ? 'PASS ' : 'FAIL ') + name + '  (' + ok + ' ok' + (ng ? ', ' + ng + ' fail' : '') + ', ' + (r.ms / 1000).toFixed(1) + 's)');
    if (r.code !== 0 || process.env.VERBOSE) console.log(r.out.replace(/^/gm, '    '));
  }
  server.close();
  console.log('\n' + specs.length + ' specs, ' + passed + ' passed, ' + failed + ' failed, ' + checks + ' checks');
  if (failedSpecs.length) console.log('failed: ' + failedSpecs.join(', '));
  process.exit(failed ? 1 : 0);
})();
