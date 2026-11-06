// バランス確認: 画面なしで自動操作のプレイを回す。
//   node tools/sim.mjs blade 3        剣士で3回
//   node tools/sim.mjs all 2 2        全職業を2回ずつ、2人プレイ（2人とも同じ職業）
import { loadFx } from "../src/fx.js";
import { buildActions } from "../src/kits.js";
import { Game } from "../src/game.js";
import { Input } from "../src/input.js";
import { makeBot } from "../src/bot.js";
import { BOONS } from "../src/data.js";

globalThis.document = { querySelector: () => null };
const [, , which = "all", runsArg = "2", playersArg = "1"] = process.argv;
const classes = which === "all" ? ["blade", "mage", "gunner", "cleric"] : [which];
const runs = +runsArg, players = +playersArg;

await loadFx();
buildActions();

const noop = () => {};
function fakeInput() {
  const I = Object.create(Input.prototype);
  Object.assign(I, { keys: new Set(), pressed: new Set(), mouse: { x: 0, y: 0, down: false, moved: -1e9 }, pad: null, usingPad: false, padPrev: {} });
  I.poll = noop;
  return I;
}

function play(cls, seed) {
  // 1台で全員分を動かす: プレイヤー0がホスト、それ以外は同じ世界の中で自分を操作する
  const games = [], bots = [];
  const ui = { toast: noop, banner: noop, hint: noop, setRoom: noop, worldText: noop, ultCut: noop, showResult: noop, hideBoons: noop, updateHud: noop };
  const net = { isHost: true, solo: true, send: noop, sendExcept: noop, sendTo: noop };
  const g = new Game({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }), width: 960, height: 540 }, { ...ui, showBoons: (ids, pick) => pick(ids[0]) }, fakeInput(), net);
  const roster = {};
  for (let s = 0; s < players; s++) roster[s] = { name: "P" + s, cls };
  g.start(seed, roster, 0);
  g.post = { render() {} }; // 描画処理（WebGL 以外）も毎回通してエラーがないか確かめる
  const bot = makeBot();
  const rooms = [], setTimeout0 = [];
  let cur = null;
  const oh = g.handle.bind(g);
  g.handle = (m) => {
    if (m.t === "boons") setTimeout0.push(() => { for (const p of others) g.world.pick(p.slot); });
    if (m.t === "room") cur = { i: m.i, kind: m.kind, start: g.world.time };
    if (m.t === "phase" && m.p === "fight" && cur) cur.f = g.world.time;
    if (m.t === "clear" && cur) { cur.fight = g.world.time - cur.f; cur.hp = Math.round(g.players[0].hp); rooms.push(cur); }
    return oh(m);
  };
  // 他のプレイヤーは簡易的に: ホストの近くをうろついて敵に体当たり攻撃する代わりに、同じ deal を使う
  const src = {};
  const oHurt = g.hurt.bind(g);
  g.hurt = (p, dmg, from) => { const hp = p.hp, r = oHurt(p, dmg, from); if (r) { const k = from?.type ?? ["shot", "zone", "arc", "ring"][from?.kind] ?? "?"; src[k] = (src[k] ?? 0) + Math.round(hp - Math.max(0, p.hp)); } return r; };
  const others = Object.values(g.players).filter((p) => p.slot !== 0);
  const dt = 1 / 60;
  for (;;) { const f = setTimeout0.shift(); if (!f) break; f(); }
  for (let i = 0; i < 60 * 60 * 45 && !g.over; i++) {
    bot.step(g, g.input);
    g.update(dt);
    while (setTimeout0.length) setTimeout0.shift()();
    if (i % 6 === 0) g.render(i / 60);
    // 仲間の分の火力を足す（同じ職業の通常攻撃を一定間隔で一番近い敵へ）
    for (const p of others) {
      p.cd = (p.cd ?? 0) - dt;
      const me = g.players[0];
      p.x += (me.x + (p.slot * 20 - 30) - p.x) * 0.05; p.y += (me.y - p.y) * 0.05;
      p.tx = p.x; p.ty = p.y; p.seen = true;
      if (p.cd <= 0) {
        p.cd = 0.3;
        const e = g.nearestEnemy(p, 120);
        if (e) {
          const prev = g.me; g.me = p.slot;
          g.deal(p, [e], { base: 18, kb: 60, basic: true });
          g.me = prev;
        }
      }
    }
  }
  const me = g.players[0], w = g.world;
  if (!g.over) console.log("  止まった:", JSON.stringify({ phase: w.phase, phaseT: Math.round(w.phaseT), wave: w.wave, waves: w.waves, pending: w.pending, q: w.queue.length, me: [me.x | 0, me.y | 0, me.down, Math.round(me.hp)], en: [...w.enemies.values()].map((e) => [e.type, e.x | 0, e.y | 0, Math.round(e.hp), e.ai.s, e.spawnT.toFixed(1)]), portal: w.portal, picked: [...w.picked] }));
  return { win: g.over && g.world.phase === "over" && g.world.boss === null && g.world.roomIndex >= 17, reached: g.world.roomIndex, time: Math.round(g.world.time), kills: me.kills, combo: me.maxCombo, boons: me.boons.length, hurt: Math.round(bot.log.hurt), rooms, src };
}

for (const cls of classes) {
  for (let r = 0; r < runs; r++) {
    const t0 = Date.now(), res = play(cls, 1000 + r * 77);
    const fights = res.rooms.filter((x) => x.kind !== "rest");
    const avg = (k) => (fights.length ? (fights.filter((x) => x.kind === k).reduce((a, x) => a + x.fight, 0) / Math.max(1, fights.filter((x) => x.kind === k).length)).toFixed(0) : "-");
    console.log(`${cls.padEnd(6)} run${r} ${res.win ? "CLEAR" : "dead@" + res.reached} 時間${Math.floor(res.time / 60)}分${res.time % 60}秒 撃破${res.kills} 最大コンボ${res.combo} 被ダメ${res.hurt} 戦闘平均${avg("fight")}s 精鋭${avg("elite")}s ボス[${res.rooms.filter((x) => x.kind === "boss").map((x) => x.fight.toFixed(0) + "s").join(",")}] ${JSON.stringify(res.src)}`);
  }
}
