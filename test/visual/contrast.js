// style.css の色変数から、主な組み合わせのコントラスト比（WCAG 2.x）を出す。README の表はこの出力から作った。
//   node test/visual/contrast.js
const fs = require('fs');
const path = require('path');
const { contrast } = require('../e2e/contrast');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'style.css'), 'utf8');
/* セレクタがちょうど一致するブロックをすべて読み、色の変数を集める */
function vars(selector) {
  const out = {};
  const esc = selector.replace(/[[\]().*+?^$|]/g, '\\$&');
  for (const block of css.matchAll(new RegExp('(?:^|\\n)' + esc + '\\{([^}]*)\\}', 'g'))) {
    for (const m of block[1].matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{3,6})/g)) out[m[1]] = m[2].toUpperCase();
  }
  return out;
}
const light = vars(':root');
const dark = Object.assign({}, light, vars('html[data-theme=dark]'));

const PAIRS = [
  ['本文', 'ink', 'bg'],
  ['本文（カード）', 'ink', 'card'],
  ['補足の文字', 'sub', 'card'],
  ['主ボタン', 'pri-ink', 'pri'],
  ['リンク・強調（ティール）', 'teal-ink', 'card'],
  ['残りの支払い（琥珀）', 'amb', 'amb-bg'],
  ['エラー', 'err', 'card'],
  ['1人目の色（丸・棒）', 'c-y', 'card'],
  ['2人目の色（丸・棒）', 'c-k', 'card'],
  ['「このスマホは」の選択中（1人目）', '#FFF', 'c-y'],
  ['「このスマホは」の選択中（2人目）', '#FFF', 'c-k'],
];
const pick = (theme, v) => (v.startsWith('#') ? v : theme[v]);
const label = (v) => (v.startsWith('#') ? '`' + v + '`' : '`--' + v + '`');
console.log('| 用途 | 文字 / 背景 | ライト | 比 | ダーク | 比 |');
console.log('|---|---|---|---|---|---|');
for (const [name, fg, bg] of PAIRS) {
  const l = contrast(pick(light, fg), pick(light, bg));
  const d = contrast(pick(dark, fg), pick(dark, bg));
  console.log(`| ${name} | ${label(fg)} / ${label(bg)} | ${pick(light, fg)} / ${pick(light, bg)} | ${l.toFixed(2)} | ${pick(dark, fg)} / ${pick(dark, bg)} | ${d.toFixed(2)} |`);
}
