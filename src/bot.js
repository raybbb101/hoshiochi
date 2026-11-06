// バランス確認用の自動操作（URL に ?bot=1 を付けると動く）。人間より少し下手なくらいに動かす。
import { CLASSES } from "./data.js";
import { HZ } from "./world.js";

export function makeBot() {
  const log = { rooms: [], hurt: 0, start: performance.now(), roomStart: performance.now(), deaths: 0 };
  let wander = 0, lastRoom = -1, lastHp = null;
  return {
    log,
    step(g, I) {
      const me = g.players[g.me];
      if (!me || !g.room) return;
      I.mouse.moved = -1e9; // 自動照準を使う
      I.keys.clear();
      I.mouse.down = false;
      if (g.roomIndex !== lastRoom) {
        if (lastRoom >= 0) log.rooms.push({ i: lastRoom, kind: g.kind, sec: +((performance.now() - log.roomStart) / 1000).toFixed(1), hp: Math.round(me.hp), max: me.maxHp });
        lastRoom = g.roomIndex; log.roomStart = performance.now();
      }
      if (lastHp !== null && me.hp < lastHp) log.hurt += lastHp - me.hp;
      lastHp = me.hp;
      // 加護は一番上を選ぶ
      const card = !document.querySelector("#boons.on .boon.picked") && document.querySelector("#boons.on .boon");
      if (card) { card.click(); return; }
      if (me.down) return;
      const press = (k) => I.pressed.add(k);
      let tx = null, ty = null;
      // 危険から逃げる
      for (const h of g.view.hazards.values()) {
        const d = Math.hypot(me.x - h.x, me.y - h.y);
        const coming = h.kind !== HZ.shot || ((me.x - h.x) * h.vx + (me.y - h.y) * h.vy) > 0;
        if ((h.kind === HZ.shot && d < 22 && coming) || (h.kind !== HZ.shot && d < h.r + 8 && h.delay < 0.4)) {
          if (Math.random() < 0.25) press("Space");
          tx = me.x + (me.x - h.x) * 3; ty = me.y + (me.y - h.y) * 3;
        }
      }
      const melee = me.cls === "blade" || me.cls === "cleric";
      const e = g.nearestEnemy(me, 999);
      if (g.view.portal && !e) { tx = g.view.portal.x; ty = g.view.portal.y; }
      if (e && (tx === null || Math.random() < 0.5)) {
        const d = Math.hypot(e.x - me.x, e.y - me.y), want = melee ? 26 : 110;
        if (d > want + 10) { tx = e.x; ty = e.y; }
        else if (d < want - 30) { tx = me.x - (e.x - me.x); ty = me.y - (e.y - me.y); }
        else { wander += 0.02; tx = me.x + Math.cos(wander) * 30; ty = me.y + Math.sin(wander) * 30; }
        if (d < (melee ? 60 : 220)) I.keys.add("KeyJ");
        const near = g.enemiesInRadius(me.x, me.y, CLASSES[me.cls].skill.radius ?? 80).length;
        if (me.skillCd <= 0 && (near >= 2 || me.cls === "gunner")) press("KeyK");
        if (me.ult >= 1 && g.enemiesInRadius(me.x, me.y, 150).length >= 3) press("KeyQ");
      }
      // 柱を避けて回り込む
      if (tx !== null) for (const q of g.room.pillars) {
        const dx = tx - me.x, dy = ty - me.y, L = Math.hypot(dx, dy) || 1, qx = q.x - me.x, qy = q.y - me.y;
        const along = (qx * dx + qy * dy) / L, side = (qx * dy - qy * dx) / L;
        if (along > 0 && along < 40 && Math.abs(side) < q.r + 10) { const s2 = side > 0 ? 1 : -1; tx = me.x + (dy / L) * 40 * s2 + (dx / L) * 10; ty = me.y - (dx / L) * 40 * s2 + (dy / L) * 10; }
      }
      // 1秒進めなかったら、しばらく適当な方向へ歩く
      const hist = (this.hist ??= []);
      hist.push([me.x, me.y]);
      if (hist.length > 60) hist.shift();
      const [ox, oy] = hist[0];
      if (this.unstick > 0) { this.unstick--; tx = me.x + Math.cos(this.ua) * 50; ty = me.y + Math.sin(this.ua) * 50; }
      else if (tx !== null && hist.length === 60 && Math.hypot(me.x - ox, me.y - oy) < 10 && Math.hypot(tx - me.x, ty - me.y) > 24) { this.unstick = 40; this.ua = Math.random() * Math.PI * 2; hist.length = 0; }
      if (tx !== null) {
        const dx = tx - me.x, dy = ty - me.y;
        if (dx < -4) I.keys.add("KeyA"); if (dx > 4) I.keys.add("KeyD");
        if (dy < -4) I.keys.add("KeyW"); if (dy > 4) I.keys.add("KeyS");
      }
    },
  };
}

/** 画面を描かずに高速で1回分を遊ばせ、部屋ごとの結果を返す（コンソールから __run("mage", 1800)） */
export async function runHeadless(g, bot, cls, maxSec) {
  document.querySelector("#btn-solo").click();
  await new Promise((r) => setTimeout(r, 200));
  document.querySelector(`.class-card[data-cls=${cls}]`).click();
  document.querySelector(".start").click();
  const I = g.input, ev = [], oh = g.handle.bind(g);
  g.handle = (m) => { if (["room", "clear", "over", "phase"].includes(m.t)) ev.push([m.t, m.p ?? m.i ?? m.win ?? "", +g.time.toFixed(1), Math.round(g.players[g.me]?.hp ?? 0)]); return oh(m); };
  for (let i = 0; i < maxSec * 60; i++) {
    bot.step(g, I); g.update(1 / 60);
    if (i % 300 === 0) await new Promise((r) => setTimeout(r, 0));
    if (g.over) break;
  }
  g.handle = oh;
  const me = g.players[g.me], rooms = [];
  let cur = null;
  for (const e of ev) {
    if (e[0] === "room") cur = { i: e[1], start: e[2] };
    if (e[0] === "phase" && e[1] === "fight" && cur) cur.f = e[2];
    if (e[0] === "clear" && cur) { cur.fight = +(e[2] - cur.f).toFixed(1); cur.hp = e[3]; rooms.push(cur); }
  }
  return { over: g.over, win: ev.find((e) => e[0] === "over")?.[1], t: Math.round(g.time), room: g.roomIndex, kills: me.kills, dmg: Math.round(me.dmg), maxCombo: me.maxCombo, boons: me.boons.join(","), hurt: Math.round(bot.log.hurt), rooms: rooms.map((r) => `${r.i}:${r.fight}s/hp${r.hp}`).join(" ") };
}
