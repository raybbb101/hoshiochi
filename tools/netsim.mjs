// 通信の確認: ホスト1人 + ゲスト（最大3人）をメモリ上でつなぎ、自動操作で遊ばせる。
// 実際の通信と同じく JSON にしてから渡し、遅延も入れる。  node tools/netsim.mjs 4 300
import { loadFx } from "../src/fx.js";
import { buildActions } from "../src/kits.js";
import { Game } from "../src/game.js";
import { Input } from "../src/input.js";
import { makeBot } from "../src/bot.js";

globalThis.document = { querySelector: () => null };
const N = +(process.argv[2] ?? 2), SECS = +(process.argv[3] ?? 240), LAG = 4; // 4フレーム ≒ 67ms
await loadFx();
buildActions();

const noop = () => {};
const fakeInput = () => { const I = Object.create(Input.prototype); Object.assign(I, { keys: new Set(), pressed: new Set(), mouse: { x: 0, y: 0, down: false, moved: -1e9 }, pad: null, usingPad: false, padPrev: {} }); I.poll = noop; return I; };
const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }), width: 960, height: 540 };
let frame = 0, bytes = 0;
const inbox = []; // [配達フレーム, 宛先slot, 送り元slot, json]
const post = (to, from, m) => { const j = JSON.stringify(m); bytes += j.length; inbox.push([frame + LAG, to, from, j]); };

const games = [];
for (let s = 0; s < N; s++) {
  const net = {
    isHost: s === 0, solo: false, slot: s,
    send: (m) => { if (s === 0) for (let k = 1; k < N; k++) post(k, 0, m); else post(0, s, m); },
    sendExcept: (ex, m) => { for (let k = 1; k < N; k++) if (k !== ex) post(k, 0, m); },
    sendTo: (k, m) => post(k, 0, m),
  };
  const picks = [];
  const ui = { toast: noop, banner: noop, hint: noop, setRoom: noop, worldText: noop, ultCut: noop, showResult: noop, hideBoons: noop, updateHud: noop, autoPickBoon: noop, showBoons: (ids, pick) => picks.push(() => ids.length && pick(ids[0])) };
  const g = new Game(canvas, ui, fakeInput(), net);
  g.post = { render() {} };
  g.picks = picks;
  games.push(g);
}
const cls = ["blade", "mage", "gunner", "cleric"];
const roster = Object.fromEntries(Array.from({ length: N }, (_, s) => [s, { name: "P" + s, cls: cls[s % 4] }]));
games.forEach((g, s) => g.start(12345, roster, s));
const bots = games.map(() => makeBot());
let errors = 0;
for (frame = 0; frame < SECS * 60; frame++) {
  for (let i = inbox.length - 1; i >= 0; i--) {
    const [at, to, from, j] = inbox[i];
    if (at > frame) continue;
    inbox.splice(i, 1);
    try { games[to].onMessage(from, JSON.parse(j)); } catch (e) { errors++; if (errors < 5) console.error("受信エラー", to, e); }
  }
  games.forEach((g, s) => {
    try {
      while (g.picks.length) g.picks.shift()();
      bots[s].step(g, g.input); g.update(1 / 60);
      if (frame % 10 === s) g.render(frame / 60);
    } catch (e) { errors++; if (errors < 5) console.error("更新エラー", s, e); }
  });
  if (games[0].over) break;
}
const h = games[0];
console.log(`${N}人 ${Math.round(frame / 60)}秒 部屋${h.roomIndex} 通信 ${(bytes / 1024 / (frame / 60)).toFixed(1)}KB/秒 エラー${errors}`);
games.forEach((g, s) => {
  const me = g.players[s];
  console.log(`  P${s} ${me.cls.padEnd(6)} 部屋${g.roomIndex} 撃破${me.kills} 与ダメ${Math.round(me.dmg)} HP${Math.round(me.hp)}/${me.maxHp}${me.down ? " 戦闘不能" : ""} 敵表示${g.view.enemies.size}/${h.view.enemies.size} 位置ずれ${Object.values(g.players).filter((p) => p.slot !== s).map((p) => Math.round(Math.hypot(p.x - games[p.slot].players[p.slot].x, p.y - games[p.slot].players[p.slot].y))).join(",")}`);
});
