// ホストだけが動かす世界: 部屋の進行、敵のAI、敵の攻撃、ダメージ計算、元素コンボ、ドロップ。
// ゲストには snapshot() とイベントで状態を送る。
import { ENEMIES, BOSSES, ELITE, ELEM, COMBOS, SCALE, AREAS, ROOM_PLAN, ROOM_W, ROOM_H, WALL_H, BOONS, RARITY, wavesFor, JUICE } from "./data.js";
import { rng, buildRoom } from "./draw.js";
import { PAL } from "../vendor/pixelfx/src/core/color.js";

export const TYPE_IDS = [...Object.keys(ENEMIES), ...Object.keys(BOSSES)];
export const EL = { burn: 1, chill: 2, shock: 4, holy: 8 };
export const F = { elite: 1, boss: 2, burn: 4, chill: 8, frozen: 16, shock: 32, holy: 64, tele: 128, spawn: 256 };
export const HZ = { shot: 0, zone: 1, arc: 2, ring: 3, beam: 4 };
export const PK = { coin: 0, heart: 1, gem: 2 };
const FLOOR = { x0: 26, x1: ROOM_W - 26, y0: WALL_H + 10, y1: ROOM_H - 10 };
export { FLOOR };

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class World {
  constructor(game) {
    this.game = game;
    this.enemies = new Map(); this.hazards = new Map(); this.pickups = new Map();
    this.nextId = 1; this.time = 0; this.queue = [];
    this.phase = "none"; this.portal = null; this.picked = new Set();
  }
  emit(m) { this.game.broadcast(m); }
  fx(id, o, ex) { this.emit({ t: "fx", id, o, ex }); }
  sfx(n, k) { this.emit({ t: "sfx", n, k }); }
  get players() { return this.game.alivePlayers(); }
  get count() { return Math.max(1, this.game.playerCount()); }

  // ---- 進行
  startRun(seed) {
    this.seed = seed; this.R = rng(seed); this.roomIndex = -1; this.time = 0;
    this.startTime = performance.now();
    this.nextRoom();
  }
  nextRoom() {
    this.roomIndex++;
    const areaIdx = Math.floor(this.roomIndex / ROOM_PLAN.length);
    if (areaIdx >= AREAS.length) return this.finish(true);
    const kind = ROOM_PLAN[this.roomIndex % ROOM_PLAN.length];
    const seed = (this.seed * 31 + this.roomIndex * 977) >>> 0;
    this.enemies.clear(); this.hazards.clear(); this.pickups.clear(); this.queue = [];
    this.portal = null; this.picked.clear(); this.boss = null; this.pending = 0;
    this.area = AREAS[areaIdx]; this.kind = kind;
    this.room = buildRoom(this.area, seed, kind);
    this.waves = kind === "fight" || kind === "elite" ? wavesFor(this.roomIndex, kind, this.count) : [];
    this.wave = -1; this.waveT = 0; this.phase = "intro"; this.phaseT = 0;
    this.emit({ t: "room", i: this.roomIndex, area: areaIdx, kind, seed });
  }
  setPhase(p) { this.phase = p; this.phaseT = 0; this.emit({ t: "phase", p }); }
  finish(win) {
    this.phase = "over";
    this.emit({ t: "over", win, time: (performance.now() - this.startTime) / 1000, room: this.roomIndex });
  }

  update(dt) {
    this.time += dt; this.phaseT += dt;
    // 予約された処理（連鎖爆発など）
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if ((q.t -= dt) <= 0) { this.queue.splice(i, 1); q.fn(); }
    }
    const P = this.players;
    if (this.phase === "intro" && this.phaseT > 1.4) {
      if (this.kind === "rest") { this.setPhase("rest"); this.restRoom(); }
      else if (this.kind === "boss") { this.spawnBoss(); this.setPhase("fight"); }
      else { this.setPhase("fight"); this.nextWave(); }
    }
    if (this.phase === "fight") {
      this.waveT += dt;
      const alive = this.enemies.size + (this.pending ?? 0);
      if (this.kind !== "boss" && this.wave < this.waves.length - 1 && (alive <= Math.max(2, this.waveSize * 0.3) || this.waveT > 14)) this.nextWave();
      if (this.enemies.size === 0 && this.queue.length === 0 && (this.kind === "boss" ? !this.boss : this.wave >= this.waves.length - 1) && this.phaseT > 1) this.roomClear();
    }
    if (this.phase === "clear" && this.phaseT > 1.6) this.offerBoons();
    if (this.phase === "boons") {
      const need = this.game.slots().filter((s) => !this.picked.has(s));
      // 選ばない人がいても30秒で先へ（その人の画面では門に入るときに自動で選ばれる）
      if (need.length === 0 || this.phaseT > 30) this.openPortal();
    }
    if (this.phase === "portal") {
      const all = this.game.slots().map((s) => this.game.players[s]).filter((p) => p && !p.down);
      const inside = all.filter((p) => Math.hypot(p.x - this.portal.x, (p.y - this.portal.y) * 1.4) < 26);
      if (inside.length) this.portal.wait = (this.portal.wait ?? 0) + dt; else this.portal.wait = 0;
      if (inside.length === all.length && all.length || this.portal.wait > 4) { this.setPhase("leave"); this.sfx("portal"); }
    }
    if (this.phase === "leave" && this.phaseT > 0.9) this.nextRoom();
    if (this.phase === "fight" && P.length === 0 && this.game.slots().length) this.finish(false);

    for (const e of this.enemies.values()) this.updateEnemy(e, dt, P);
    this.separate();
    for (const h of this.hazards.values()) this.updateHazard(h, dt);
    for (const k of this.pickups.values()) this.updatePickup(k, dt);
  }

  // ---- 波の出現
  nextWave() {
    this.wave++; this.waveT = 0;
    const n = this.waves[this.wave];
    if (n === -1) { this.spawnElites(); return; }
    this.waveSize = n;
    const pool = Object.entries(this.area.enemies), total = pool.reduce((a, [, w]) => a + w, 0);
    const cap = SCALE.maxAlive + SCALE.maxAlivePerPlayer * this.count;
    const slots = Math.max(0, Math.min(n, cap - this.enemies.size));
    this.waveSize = slots;
    for (let i = 0; i < slots; i++) {
      let r = this.R() * total, type = pool[0][0];
      for (const [t, w] of pool) if ((r -= w) <= 0) { type = t; break; }
      this.pending = (this.pending ?? 0) + 1;
      this.queue.push({ t: i * 0.12 + this.R() * 0.5, fn: () => { this.pending--; this.spawnEnemy(type, this.spawnPoint()); } });
    }
    if (this.wave > 0) this.sfx("warn");
  }
  spawnElites() {
    const pool = Object.keys(this.area.enemies), n = 1 + Math.floor(this.count / 2);
    this.waveSize = n;
    for (let i = 0; i < n; i++) this.spawnEnemy(pool[(i * 3 + this.roomIndex) % pool.length], this.spawnPoint(), true);
    for (let i = 0; i < 4 + this.count * 2; i++) { this.pending = (this.pending ?? 0) + 1; this.queue.push({ t: 0.8 + i * 0.1, fn: () => { this.pending--; this.spawnEnemy(pool[i % pool.length], this.spawnPoint()); } }); }
  }
  spawnPoint() {
    const P = this.players;
    for (let k = 0; k < 40; k++) {
      const x = this.R.range(FLOOR.x0 + 20, FLOOR.x1 - 20), y = this.R.range(FLOOR.y0 + 10, FLOOR.y1 - 10);
      if (P.some((p) => Math.hypot(p.x - x, p.y - y) < 100)) continue;
      if (this.room.pillars.some((q) => Math.hypot(q.x - x, q.y - y) < q.r + 16)) continue;
      return { x, y };
    }
    return { x: this.R.range(FLOOR.x0, FLOOR.x1), y: FLOOR.y0 + 20 };
  }
  spawnEnemy(type, at, elite = false) {
    const d = ENEMIES[type], ri = this.roomIndex;
    const hp = d.hp * Math.pow(SCALE.enemyHpPerRoom, ri) * (elite ? ELITE.hp : 1);
    const e = {
      id: this.nextId++, type, def: d, x: at.x, y: at.y, vx: 0, vy: 0, hp, maxHp: hp, r: d.r * (elite ? 1.3 : 1),
      dmg: d.dmg * Math.pow(SCALE.enemyDmgPerRoom, ri) * (elite ? ELITE.dmg : 1), speed: d.speed * (elite ? 1.1 : 1),
      elite, boss: false, face: 1, st: {}, spawnT: 0.75, ai: { s: "idle", t: this.R() * 1.2 }, tele: 0, flash: 0,
    };
    this.enemies.set(e.id, e);
    if (elite) this.fx("spawn/spawn-portal", { x: Math.round(e.x), y: Math.round(e.y), seed: e.id, palette: PAL.blood, light: 0.6 }, { skip: 0.5, life: 1.6 });
    else this.fx("spawn/poof", { x: Math.round(e.x), y: Math.round(e.y), seed: e.id, palette: PAL.shadow, light: 0.4 }, { skip: 0.05 });
    return e;
  }
  spawnBoss() {
    const key = this.area.boss, d = BOSSES[key];
    const hp = d.hp * (1 + SCALE.bossHpPerPlayer * (this.count - 1));
    const e = {
      id: this.nextId++, type: key, def: d, x: ROOM_W / 2, y: WALL_H + 70, vx: 0, vy: 0, hp, maxHp: hp, r: d.r, dmg: d.dmg, speed: d.speed,
      elite: false, boss: true, face: -1, st: {}, spawnT: 1.5, ai: { s: "idle", t: 2, n: 0 }, tele: 0, flash: 0,
    };
    this.enemies.set(e.id, e); this.boss = e;
    this.emit({ t: "boss", id: e.id, name: d.name });
    this.fx("arcane/magic-circle-cast", { x: e.x, y: e.y, seed: 3, palette: this.area.accent }, { skip: 0.6 });
    this.sfx("roar");
    this.emit({ t: "shake", k: 5 });
  }
  restRoom() {
    // 泉で回復 + 宝箱（レア以上の加護）
    this.fx("water/fountain", { x: ROOM_W / 2, y: ROOM_H / 2 + 20, seed: 4 }, { life: 9999 });
    this.emit({ t: "healAll", pct: 0.6, fx: true });
    this.fx("pickups/chest-open", { x: ROOM_W / 2, y: ROOM_H / 2 - 30, seed: 5, coins: 16 });
    this.sfx("heal");
    this.queue.push({ t: 2.2, fn: () => this.offerBoons(2) });
  }
  roomClear() {
    this.setPhase("clear");
    this.emit({ t: "clear", boss: this.kind === "boss" });
    // 倒れていた仲間は部屋クリアで復活
    this.emit({ t: "reviveAll" });
    // 落ちているものを全部吸い寄せる
    for (const k of this.pickups.values()) k.magnet = true;
    if (this.kind === "boss" && Math.floor(this.roomIndex / ROOM_PLAN.length) === AREAS.length - 1) {
      this.queue.push({ t: 2.5, fn: () => this.finish(true) });
      this.phase = "won";
    }
  }
  offerBoons(minR = 1) {
    if (this.phase === "boons" || this.phase === "won" || this.phase === "over") return;
    this.setPhase("boons");
    const offers = {};
    for (const s of this.game.slots()) {
      const owned = this.game.players[s]?.boons ?? [];
      const pool = BOONS.filter((b) => b.r >= minR && !(b.el !== "none" && owned.includes(b.id) && ["fire", "ice", "thunder", "holy"].includes(b.id)) && !(b.id === "giant" && owned.includes("giant")));
      const pick = [];
      while (pick.length < 3 && pool.length) {
        const tot = pool.reduce((a, b) => a + RARITY[b.r].w, 0);
        let r = this.R() * tot, i = 0;
        for (; i < pool.length - 1; i++) if ((r -= RARITY[pool[i].r].w) <= 0) break;
        pick.push(pool.splice(i, 1)[0].id);
      }
      offers[s] = pick;
    }
    this.emit({ t: "boons", offers });
  }
  pick(slot) { this.picked.add(slot); }
  openPortal() {
    this.setPhase("portal");
    this.portal = { x: ROOM_W / 2, y: WALL_H + 22, wait: 0 };
    this.emit({ t: "portal", x: this.portal.x, y: this.portal.y });
  }

  // ---- 敵の行動
  target(e, P) {
    let best = null, bd = Infinity;
    for (const p of P) { const d = dist(e, p) - (p.slot === e.aggro ? 40 : 0); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  updateEnemy(e, dt, P) {
    e.flash = Math.max(0, e.flash - dt);
    const st = e.st;
    // 状態異常
    if (st.burn) {
      st.burn.t -= dt; st.burn.acc += st.burn.dps * dt;
      if (st.burn.acc >= 4 || st.burn.t <= 0) { const v = st.burn.acc; st.burn.acc = 0; this.damage(e, v, { slot: st.burn.src, el: "burn", dot: true }); }
      if (st.burn && st.burn.t <= 0) delete st.burn;
      if (!this.enemies.has(e.id)) return;
    }
    if (st.chill && (st.chill.t -= dt) <= 0) delete st.chill;
    if (st.frozen && (st.frozen -= dt) <= 0) delete st.frozen;
    if (st.shock && (st.shock -= dt) <= 0) delete st.shock;
    if (st.holy && (st.holy.t -= dt) <= 0) delete st.holy;
    // ノックバック
    e.x += e.vx * dt; e.y += e.vy * dt;
    const fr = Math.exp(-dt * 9); e.vx *= fr; e.vy *= fr;
    this.confine(e);
    if (e.spawnT > 0) { e.spawnT -= dt; return; }
    if (st.frozen) return;
    const slow = st.chill ? 1 - ELEM.chill.slow : 1;
    const t = this.target(e, P);
    if (!t) return;
    const dx = t.x - e.x, dy = t.y - e.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    if (Math.abs(dx) > 4 && e.ai.s !== "dash") e.face = dx > 0 ? 1 : -1;
    const ai = e.ai, sp = e.speed * slow;
    ai.t -= dt;
    const move = (vx, vy, k = 1) => { e.x += vx * sp * k * dt; e.y += vy * sp * k * dt; };
    if (e.boss) return this.bossAI(e, dt, t, P, ux, uy, d, slow);
    switch (e.def.ai) {
      case "hopper": {
        if (ai.s === "idle" && ai.t <= 0) { ai.s = "hop"; ai.t = 0.42; ai.dx = ux; ai.dy = uy; }
        else if (ai.s === "hop") { move(ai.dx, ai.dy, 2.6); if (ai.t <= 0) { ai.s = "idle"; ai.t = 0.5 + Math.random() * 0.5; } }
        break;
      }
      case "swooper": {
        if (ai.s === "idle") {
          const a = Math.atan2(e.y - t.y, e.x - t.x) + 1.2 * dt * (e.id % 2 ? 1 : -1), R = 70;
          const gx = t.x + Math.cos(a) * R, gy = t.y + Math.sin(a) * R * 0.8;
          move((gx - e.x) / 40, (gy - e.y) / 40, 1.2);
          if (ai.t <= 0) { ai.s = "tele"; ai.t = 0.45; e.tele = 0.45; }
        } else if (ai.s === "tele") { if (ai.t <= 0) { ai.s = "dash"; ai.t = 0.5; ai.dx = ux; ai.dy = uy; } }
        else if (ai.s === "dash") { move(ai.dx, ai.dy, 3.4); if (ai.t <= 0) { ai.s = "idle"; ai.t = 1.6 + Math.random(); } }
        break;
      }
      case "shooter": {
        const want = 120, k = d > want + 20 ? 1 : d < want - 20 ? -1 : 0;
        const side = (e.id % 2 ? 1 : -1) * 0.6;
        move(ux * k - uy * side, uy * k + ux * side, 0.8);
        if (ai.s === "idle" && ai.t <= 0 && d < 260) { ai.s = "tele"; ai.t = 0.55; e.tele = 0.55; }
        else if (ai.s === "tele" && ai.t <= 0) {
          const sh = e.def.shot, n = sh.burst ?? 1;
          for (let i = 0; i < n; i++) this.queue.push({ t: i * 0.16, fn: () => { if (this.enemies.has(e.id)) this.shoot(e, t, sh, (i - (n - 1) / 2) * 0.18); } });
          ai.s = "idle"; ai.t = sh.cd * (0.8 + Math.random() * 0.4) / (e.elite ? 1.4 : 1);
        }
        break;
      }
      case "brute": {
        if (ai.s === "idle") {
          move(ux, uy, 1);
          if (d < 40 && ai.t <= 0) { ai.s = "tele"; ai.t = 0.55; e.tele = 0.55; ai.dx = ux; ai.dy = uy; }
        } else if (ai.s === "tele" && ai.t <= 0) {
          ai.s = "rec"; ai.t = 0.65;
          const a = Math.atan2(ai.dy, ai.dx);
          this.addHazard({ kind: HZ.arc, x: e.x, y: e.y, r: 46, a, spread: 1.4, delay: 0, life: 0.12, dmg: e.dmg });
          this.fx("melee/sword-slash", { x: Math.round(e.x), y: Math.round(e.y), flip: ai.dx < 0, seed: e.id, palette: PAL.blood }, { skip: 0.02 });
          this.sfx("slash", 0.6);
          move(ai.dx, ai.dy, 6);
        } else if (ai.s === "rec" && ai.t <= 0) { ai.s = "idle"; ai.t = 0.4; }
        break;
      }
      case "phaser": {
        const w = Math.sin(this.time * 2 + e.id) * 0.7;
        move(ux - uy * w, uy + ux * w, 1);
        break;
      }
      case "charger": {
        if (ai.s === "idle") { move(ux, uy, 0.8); if (ai.t <= 0 && d < 200) { ai.s = "tele"; ai.t = 0.6; e.tele = 0.6; ai.dx = ux; ai.dy = uy; } }
        else if (ai.s === "tele" && ai.t <= 0) { ai.s = "dash"; ai.t = 0.6; this.sfx("dash"); }
        else if (ai.s === "dash") { move(ai.dx, ai.dy, 3.6); e.face = ai.dx > 0 ? 1 : -1; if (ai.t <= 0) { ai.s = "idle"; ai.t = 1.5 + Math.random(); } }
        break;
      }
    }
    if (e.tele > 0) e.tele -= dt;
  }
  shoot(e, t, sh, spread = 0, speedK = 1) {
    const a = Math.atan2(t.y - e.y, t.x - e.x) + spread;
    this.addHazard({ kind: HZ.shot, x: e.x, y: e.y, vx: Math.cos(a) * sh.speed * speedK, vy: Math.sin(a) * sh.speed * speedK, r: 5, dmg: e.dmg, life: 3.2, style: sh.kind });
    this.sfx("enemyShot");
  }
  addHazard(h) {
    h.id = this.nextId++; h.age = 0; h.delay ??= 0; h.vx ??= 0; h.vy ??= 0; h.style ??= "none"; h.a ??= 0;
    this.hazards.set(h.id, h);
    return h;
  }
  updateHazard(h, dt) {
    h.age += dt;
    if (h.delay > 0) { h.delay -= dt; if (h.delay <= 0) this.activate(h); return; }
    h.x += h.vx * dt; h.y += h.vy * dt;
    if (h.kind === HZ.ring) h.r += h.grow * dt;
    if (h.kind === HZ.shot && (h.x < 10 || h.x > ROOM_W - 10 || h.y < WALL_H - 10 || h.y > ROOM_H)) h.life = 0;
    if (h.kind === HZ.shot && this.room.pillars.some((q) => Math.hypot(q.x - h.x, q.y - h.y) < q.r)) h.life = 0;
    if ((h.life -= dt) <= 0) this.hazards.delete(h.id);
  }
  activate(h) {
    if (h.onFire) h.onFire();
  }
  consume(id) { this.hazards.delete(id); }

  // ---- ボス
  bossAI(e, dt, t, P, ux, uy, d, slow) {
    const ai = e.ai, hpF = e.hp / e.maxHp, rage = hpF < 0.5;
    if (rage && !ai.raged) { ai.raged = true; this.sfx("roar"); this.emit({ t: "shake", k: 6 }); this.fx("status/rage", { x: e.x, y: e.y }, { life: 2 }); this.emit({ t: "banner", text: "怒り状態！", sub: "攻撃が激しくなる", small: true }); }
    const sp = e.speed * slow * (rage ? 1.25 : 1);
    if (e.type === "slimeKing") {
      if (ai.s === "idle") {
        e.x += ux * sp * dt * 0.6; e.y += uy * sp * dt * 0.6;
        if (ai.t <= 0) {
          ai.n++;
          if (ai.n % 4 === 0) { ai.s = "summon"; ai.t = 0.8; e.tele = 0.8; }
          else if (rage && ai.n % 3 === 0) { ai.s = "spray"; ai.t = 0.7; e.tele = 0.7; }
          else { ai.s = "jump"; ai.t = 0.9; e.tele = 0.5; ai.tx = t.x; ai.ty = t.y; ai.sx = e.x; ai.sy = e.y;
            this.addHazard({ kind: HZ.zone, x: t.x, y: t.y, r: 52, delay: 0.9, life: 0.12, dmg: e.dmg, style: "slam", onFire: () => this.bossLand(e) }); }
        }
      } else if (ai.s === "jump") {
        const u = 1 - Math.max(0, ai.t) / 0.9;
        e.x = ai.sx + (ai.tx - ai.sx) * u; e.y = ai.sy + (ai.ty - ai.sy) * u; e.air = Math.sin(u * Math.PI) * 60;
        if (ai.t <= 0) { e.air = 0; ai.s = "idle"; ai.t = rage ? 0.8 : 1.3; }
      } else if (ai.s === "summon" && ai.t <= 0) {
        for (let i = 0; i < 3 + this.count; i++) { const a = (i / (3 + this.count)) * Math.PI * 2; this.spawnEnemy("slime", { x: e.x + Math.cos(a) * 50, y: e.y + Math.sin(a) * 34 }); }
        this.fx("nature/acid-splash", { x: e.x, y: e.y, seed: 2 }); this.sfx("boom", 0.5);
        ai.s = "idle"; ai.t = 1.2;
      } else if (ai.s === "spray" && ai.t <= 0) {
        for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2 + this.time; this.addHazard({ kind: HZ.shot, x: e.x, y: e.y - 6, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, r: 6, dmg: e.dmg * 0.7, life: 3, style: "acid" }); }
        this.sfx("enemyShot"); ai.s = "idle"; ai.t = 1;
      }
    } else if (e.type === "boneKnight") {
      if (ai.s === "idle") {
        e.x += ux * sp * dt; e.y += uy * sp * dt;
        if (ai.t <= 0) {
          ai.n++;
          if (d < 90 && ai.n % 3 !== 0) { ai.s = "cleave"; ai.t = 0.85; e.tele = 0.85; ai.dx = ux; ai.dy = uy;
            this.addHazard({ kind: HZ.arc, x: e.x, y: e.y, r: 92, a: Math.atan2(uy, ux), spread: 1.9, delay: 0.85, life: 0.12, dmg: e.dmg * 1.3, style: "cleave" }); }
          else if (ai.n % 5 === 0) { ai.s = "summon"; ai.t = 1; e.tele = 1; }
          else if (rage && ai.n % 2 === 0) { ai.s = "skulls"; ai.t = 0.6; e.tele = 0.6; }
          else { ai.s = "charge"; ai.t = 0.7; e.tele = 0.7; ai.dx = ux; ai.dy = uy; }
        }
      } else if (ai.s === "cleave" && ai.t <= 0) {
        this.fx("melee/heavy-cleave", { x: Math.round(e.x), y: Math.round(e.y), flip: ai.dx < 0, seed: 7, palette: PAL.shadow }, { skip: 0.3 });
        this.fx("impacts/ground-slam", { x: Math.round(e.x + ai.dx * 50), y: Math.round(e.y + ai.dy * 30), seed: 2, reach: 80 }, { skip: 0 });
        this.emit({ t: "shake", k: 5 }); this.sfx("heavy");
        ai.s = "rec"; ai.t = 0.7;
      } else if (ai.s === "charge") {
        if (ai.t <= 0 && !ai.going) { ai.going = 0.55; this.sfx("dash"); this.addHazard({ kind: HZ.zone, x: e.x, y: e.y, r: 24, delay: 0, life: 0.55, dmg: e.dmg, follow: e.id }); }
        if (ai.going) { e.x += ai.dx * 330 * dt; e.y += ai.dy * 330 * dt; e.face = ai.dx > 0 ? 1 : -1; if ((ai.going -= dt) <= 0) { ai.going = 0; ai.s = "rec"; ai.t = 0.5; } }
      } else if (ai.s === "summon" && ai.t <= 0) {
        for (let i = 0; i < 2 + this.count; i++) this.spawnEnemy("skel", { x: e.x + (i - 1.5) * 40, y: e.y + 40 });
        this.fx("shadow/necro-skulls", { x: e.x, y: e.y, seed: 4 }, { life: 1.5 }); this.sfx("roar");
        ai.s = "idle"; ai.t = 1.5;
      } else if (ai.s === "skulls" && ai.t <= 0) {
        for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; this.addHazard({ kind: HZ.shot, x: e.x, y: e.y - 20, vx: Math.cos(a) * 95, vy: Math.sin(a) * 95, r: 6, dmg: e.dmg * 0.6, life: 4, style: "void" }); }
        this.sfx("enemyShot"); ai.s = "idle"; ai.t = 1.1;
      } else if (ai.s === "rec" && ai.t <= 0) { ai.s = "idle"; ai.t = rage ? 0.5 : 0.9; }
    } else if (e.type === "starEye") {
      // 一定距離を保ち、弾幕と落雷
      const want = 150, k = d > want ? 1 : -1;
      e.x += (ux * k - uy * 0.5) * sp * dt; e.y += (uy * k + ux * 0.5) * sp * dt;
      if (ai.t <= 0) {
        ai.n++;
        const pat = ai.n % (rage ? 3 : 4);
        if (pat === 0) {
          // 落雷: 全員の足元に予告
          for (const p of P) for (let j = 0; j < (rage ? 3 : 2); j++) {
            const x = p.x + (j ? (Math.random() - 0.5) * 80 : 0), y = p.y + (j ? (Math.random() - 0.5) * 50 : 0);
            this.addHazard({ kind: HZ.zone, x, y, r: 30, delay: 1.1, life: 0.15, dmg: e.dmg, style: "bolt" });
            this.queue.push({ t: 1.1 - 0.76, fn: () => this.fx("lightning/lightning-strike", { x: Math.round(x), y: Math.round(y), seed: j + 1 }) });
            this.queue.push({ t: 1.1, fn: () => { this.sfx("thunder"); this.emit({ t: "shake", k: 3 }); } });
          }
          ai.t = 1.6;
        } else if (pat === 1) {
          // 螺旋弾
          for (let i = 0; i < 36; i++) this.queue.push({ t: i * 0.05, fn: () => { if (!this.enemies.has(e.id)) return; const a = i * 0.55 + this.time; this.addHazard({ kind: HZ.shot, x: e.x, y: e.y - 30, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, r: 5, dmg: e.dmg * 0.55, life: 3.5, style: "arcane" }); } });
          this.sfx("enemyShot"); ai.t = 2.6;
        } else if (pat === 2) {
          // 隕石
          for (let i = 0; i < 5 + this.count; i++) {
            const p = P[i % P.length], x = Math.max(FLOOR.x0, Math.min(FLOOR.x1, p.x + (Math.random() - 0.5) * 160)), y = Math.max(FLOOR.y0, Math.min(FLOOR.y1, p.y + (Math.random() - 0.5) * 100));
            this.queue.push({ t: i * 0.25, fn: () => {
              this.addHazard({ kind: HZ.zone, x, y, r: 40, delay: 0.95, life: 0.15, dmg: e.dmg * 1.1, style: "meteor" });
              this.queue.push({ t: 0.95 - 0.62, fn: () => this.fx("fire/meteor", { x: Math.round(x), y: Math.round(y), seed: i + 3, palette: PAL.arcane }) });
              this.queue.push({ t: 0.95, fn: () => { this.sfx("boom", 0.8); this.emit({ t: "shake", k: 3 }); } });
            } });
          }
          ai.t = 2.4;
        } else {
          // 追尾する闇の玉を召喚 + 眼の手下
          for (let i = 0; i < 2; i++) this.spawnEnemy(i ? "wisp" : "skull", { x: e.x + (i ? 40 : -40), y: e.y + 20 });
          for (let i = 0; i < 3; i++) this.queue.push({ t: i * 0.3, fn: () => this.enemies.has(e.id) && this.shoot(e, t, { speed: 80 }, (i - 1) * 0.4, 1) });
          ai.t = 2;
        }
        e.tele = 0.5;
      }
    }
    if (e.tele > 0) e.tele -= dt;
    // 追従する当たり判定（突進）
    for (const h of this.hazards.values()) if (h.follow === e.id) { h.x = e.x; h.y = e.y; }
  }
  bossLand(e) {
    this.fx("impacts/heavy-landing", { x: Math.round(e.x), y: Math.round(e.y), seed: 3, stone: "#2a6a3a" });
    this.fx("nature/acid-splash", { x: Math.round(e.x), y: Math.round(e.y), seed: 5 });
    this.emit({ t: "shake", k: 6 }); this.sfx("boom", 0.7);
    // 着地の衝撃波
    this.addHazard({ kind: HZ.ring, x: e.x, y: e.y, r: 20, grow: 170, life: 0.55, dmg: e.dmg * 0.6, style: "wave" });
  }

  // ---- 位置の整理
  confine(e) {
    const r = e.r;
    e.x = Math.max(FLOOR.x0 + r, Math.min(FLOOR.x1 - r, e.x));
    e.y = Math.max(FLOOR.y0, Math.min(FLOOR.y1, e.y));
    if (e.def.fly) return;
    for (const q of this.room.pillars) {
      const dx = e.x - q.x, dy = e.y - q.y, d = Math.hypot(dx, dy) || 1, m = q.r + r * 0.7;
      if (d < m) { e.x = q.x + (dx / d) * m; e.y = q.y + (dy / d) * m; }
    }
  }
  separate() {
    const L = [...this.enemies.values()];
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, m = (a.r + b.r) * 0.75;
      if (d < m) {
        const push = (m - d) / 2, ux = dx / d, uy = dy / d, wa = a.boss ? 0.1 : 1, wb = b.boss ? 0.1 : 1;
        a.x -= ux * push * wa; a.y -= uy * push * wa; b.x += ux * push * wb; b.y += uy * push * wb;
      }
    }
  }

  // ---- ダメージ
  /** プレイヤーからのヒット。h: [敵id, ダメ, 会心, 元素bit, kbx, kby, 重い, 爆破率, コンボ倍率] */
  applyHits(slot, hits) {
    for (const h of hits) {
      const e = this.enemies.get(h[0]);
      if (!e) continue;
      this.hit(e, { slot, dmg: h[1], crit: !!h[2], el: h[3] | 0, kbx: h[4] ?? 0, kby: h[5] ?? 0, heavy: !!h[6], boom: h[7] ?? 0, cm: h[8] ?? 1, freeze: h[9] || undefined, shown: true });
    }
  }
  hit(e, o) {
    if (e.spawnT > 0.35) return;
    let dmg = o.dmg;
    const st = e.st, el = o.el, cm = o.cm ?? 1;
    e.aggro = o.slot;
    // 元素コンボ
    if ((el & EL.chill && st.burn) || (el & EL.burn && st.frozen)) {
      delete st.burn; delete st.frozen;
      this.combo("steam", e, o.slot, (COMBOS.steam.dmg + dmg * COMBOS.steam.k) * cm, COMBOS.steam.radius);
    }
    if (st.frozen && o.heavy) {
      delete st.frozen;
      dmg *= COMBOS.shatter.mult;
      this.combo("shatter", e, o.slot, COMBOS.shatter.splash * cm, COMBOS.shatter.radius);
    }
    if (el & EL.burn && st.shock) {
      delete st.shock;
      this.combo("overload", e, o.slot, COMBOS.overload.dmg * cm, COMBOS.overload.radius);
    }
    // 状態異常をつける
    if (el & EL.burn) {
      const was = !!st.burn;
      st.burn = { t: ELEM.burn.time, dps: Math.max(st.burn?.dps ?? 0, dmg * ELEM.burn.dps), acc: st.burn?.acc ?? 0, src: o.slot };
      if (!was) this.emit({ t: "status", id: e.id, s: "burn" });
    }
    if (el & EL.chill && !st.frozen) {
      st.chill = { t: ELEM.chill.time, n: (st.chill?.n ?? 0) + 1 };
      if (st.chill.n >= ELEM.chill.stacks || o.freeze) { delete st.chill; st.frozen = o.freeze ?? ELEM.chill.freeze * (e.boss ? 0.3 : 1); this.emit({ t: "status", id: e.id, s: "frozen", time: st.frozen }); this.sfx("ice"); }
    }
    if (el & EL.shock) {
      st.shock = ELEM.shock.time;
      if (!o.chained) this.chain(e, o, dmg);
    }
    if (el & EL.holy) st.holy = { t: ELEM.holy.time, src: o.slot };
    if (o.boom) e.boom = Math.max(e.boom ?? 0, o.boom);
    const kbk = e.boss ? 0.05 : e.elite ? 0.35 : 1;
    e.vx += o.kbx * kbk; e.vy += o.kby * kbk;
    this.damage(e, dmg, o);
  }
  damage(e, dmg, o) {
    if (!this.enemies.has(e.id)) return;
    e.hp -= dmg; e.flash = 0.1;
    // ダメージ数字: 当てた本人の画面には自分で出しているので、それ以外へ
    const m = { t: "dmg", id: e.id, x: Math.round(e.x), y: Math.round(e.y - (e.def.h ?? 20)), v: Math.round(dmg), c: o.crit ? 1 : 0, el: o.el ?? 0, dot: o.dot ? 1 : 0, by: o.slot };
    if (o.shown && o.slot !== undefined) this.game.broadcastExcept(o.slot, m); else this.emit(m);
    if (e.hp <= 0) this.kill(e, o);
  }
  chain(src, o, dmg) {
    const near = [...this.enemies.values()].filter((e) => e !== src && Math.hypot(e.x - src.x, e.y - src.y) < ELEM.shock.range).sort((a, b) => dist(a, src) - dist(b, src)).slice(0, ELEM.shock.chain);
    for (const e of near) {
      this.fx("lightning/zap-hit", { x: Math.round(e.x), y: Math.round(e.y - 10), seed: e.id }, { skip: 0.05 });
      this.emit({ t: "bolt", x0: Math.round(src.x), y0: Math.round(src.y - 12), x1: Math.round(e.x), y1: Math.round(e.y - 12) });
      this.hit(e, { slot: o.slot, dmg: dmg * ELEM.shock.k, el: EL.shock, kbx: 0, kby: 0, chained: true, cm: o.cm });
    }
    if (near.length) this.sfx("zap");
  }
  combo(kind, e, slot, dmg, radius) {
    const C = COMBOS[kind];
    const fxs = { steam: ["explosions/plasma-explosion", { palette: PAL.water }], shatter: ["ice/ice-shatter", {}], overload: ["explosions/plasma-explosion", { palette: PAL.volt }], judge: ["holy/smite", {}] };
    const [id, o] = fxs[kind];
    this.fx(id, { x: Math.round(e.x), y: Math.round(e.y), seed: e.id, ...o }, { skip: kind === "shatter" ? 0.55 : kind === "judge" ? 0.5 : 0 });
    this.emit({ t: "combo", name: C.name, kind, x: Math.round(e.x), y: Math.round(e.y - 30), by: slot });
    this.sfx(kind === "shatter" ? "shatter" : kind === "judge" ? "holy" : "boom", 0.6);
    this.emit({ t: "shake", k: 3.5 });
    this.queue.push({ t: 0.05, fn: () => this.aoe(e.x, e.y, radius, dmg, slot, { not: e.id }) });
  }
  aoe(x, y, r, dmg, slot, o = {}) {
    for (const e of [...this.enemies.values()]) {
      if (e.id === o.not) continue;
      const d = Math.hypot(e.x - x, (e.y - y) * 1.2);
      if (d > r + e.r) continue;
      const ux = (e.x - x) / (d || 1), uy = (e.y - y) / (d || 1);
      this.hit(e, { slot, dmg, el: o.el ?? 0, kbx: ux * 160, kby: uy * 160, heavy: true, chained: true, cm: 1 });
    }
  }
  kill(e, o) {
    this.enemies.delete(e.id);
    for (const h of this.hazards.values()) if (h.follow === e.id) this.hazards.delete(h.id);
    this.emit({ t: "kill", id: e.id, x: Math.round(e.x), y: Math.round(e.y), type: e.type, by: o.slot, elite: e.elite, boss: e.boss, st: e.st.frozen ? "ice" : e.st.burn ? "fire" : "" });
    if (e.boss) {
      this.boss = null;
      // ボスの手下も消える
      for (const m of [...this.enemies.values()]) { this.enemies.delete(m.id); this.emit({ t: "kill", id: m.id, x: Math.round(m.x), y: Math.round(m.y), type: m.type, by: -1 }); }
      this.hazards.clear();
      this.fx("explosions/big-explosion", { x: Math.round(e.x), y: Math.round(e.y), seed: 2 });
      this.fx("ui/confetti", { x: Math.round(e.x), y: Math.round(e.y - 40), seed: 1 });
    }
    // ドロップ
    const gold = Math.round((e.def.gold ?? 1) * (e.elite ? ELITE.gold : 1) * (e.boss ? 30 : 1));
    for (let i = 0; i < Math.min(gold, 30); i++) this.addPickup(PK.coin, e.x, e.y, 1);
    if (e.elite || Math.random() < 0.05) this.addPickup(PK.heart, e.x, e.y);
    // 聖印: 裁き
    if (e.st.holy && this.time > (this.judgeCd ?? 0)) {
      this.judgeCd = this.time + 0.6; // 連鎖しすぎないように
      this.combo("judge", e, e.st.holy.src, COMBOS.judge.dmg, COMBOS.judge.radius);
      this.emit({ t: "healAll", amount: ELEM.holy.heal });
    }
    // 連鎖爆破
    if (e.boom > 0 && !e.boss) {
      const v = e.maxHp * e.boom;
      this.queue.push({ t: 0.12, fn: () => {
        this.fx("explosions/small-explosion", { x: Math.round(e.x), y: Math.round(e.y), seed: e.id, size: 0.45 });
        this.sfx("boom", 0.4);
        this.emit({ t: "shake", k: 2 });
        this.aoe(e.x, e.y, 46, v, o.slot);
      } });
    }
  }

  // ---- 拾うもの
  addPickup(kind, x, y, v = 1) {
    const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 70;
    const k = { id: this.nextId++, kind, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7, z: 0, vz: 90 + Math.random() * 60, v, age: 0, magnet: false };
    this.pickups.set(k.id, k);
  }
  updatePickup(k, dt) {
    k.age += dt;
    k.vz -= 400 * dt; k.z = Math.max(0, k.z + k.vz * dt);
    if (k.z === 0) { k.vz = Math.abs(k.vz) > 40 ? -k.vz * 0.4 : 0; k.vx *= 0.9; k.vy *= 0.9; }
    k.x += k.vx * dt; k.y += k.vy * dt;
    k.x = Math.max(FLOOR.x0, Math.min(FLOOR.x1, k.x)); k.y = Math.max(FLOOR.y0, Math.min(FLOOR.y1, k.y));
    if (k.age < 0.5) return;
    let best = null, bd = Infinity;
    for (const p of this.players) { const d = Math.hypot(p.x - k.x, p.y - k.y); if (d < bd) { bd = d; best = p; } }
    if (!best) return;
    const range = 26 * (best.pickup ?? 1) * (k.kind === PK.heart ? 0.8 : 3.2);
    if (k.magnet || bd < range) {
      const ux = (best.x - k.x) / (bd || 1), uy = (best.y - k.y) / (bd || 1), sp = 160 + k.age * 120;
      k.x += ux * sp * dt; k.y += uy * sp * dt;
    }
    if (bd < 10) {
      this.pickups.delete(k.id);
      if (k.kind === PK.coin) this.emit({ t: "gold", v: k.v, to: best.slot, x: Math.round(k.x), y: Math.round(k.y) });
      else if (k.kind === PK.heart) { this.emit({ t: "heal", to: best.slot, pct: 0.18 }); this.fx("pickups/collect-burst", { x: Math.round(k.x), y: Math.round(k.y), seed: k.id, palette: PAL.heal }); }
    }
  }

  // ---- ゲストへ送る状態
  snapshot() {
    const e = [], h = [], k = [];
    for (const x of this.enemies.values()) {
      let f = 0;
      if (x.elite) f |= F.elite; if (x.boss) f |= F.boss; if (x.st.burn) f |= F.burn; if (x.st.chill) f |= F.chill;
      if (x.st.frozen) f |= F.frozen; if (x.st.shock) f |= F.shock; if (x.st.holy) f |= F.holy; if (x.tele > 0) f |= F.tele; if (x.spawnT > 0) f |= F.spawn;
      e.push([x.id, TYPE_IDS.indexOf(x.type), Math.round(x.x), Math.round(x.y), Math.round((x.hp / x.maxHp) * 1000), f, x.face, Math.round(x.air ?? 0), x.ai.s === "dash" || x.ai.going ? 1 : 0]);
    }
    for (const x of this.hazards.values()) h.push([x.id, x.kind, Math.round(x.x), Math.round(x.y), Math.round(x.r), Math.round(x.vx), Math.round(x.vy), Math.round(x.delay * 100), x.style, Math.round(x.a * 100), Math.round((x.spread ?? 0) * 100), Math.round(x.dmg), Math.round((x.grow ?? 0))]);
    for (const x of this.pickups.values()) k.push([x.id, x.kind, Math.round(x.x), Math.round(x.y), Math.round(x.z)]);
    return { t: "snap", e, h, k, ph: this.phase, bh: this.boss ? Math.round((this.boss.hp / this.boss.maxHp) * 1000) : -1, pt: this.portal ? [this.portal.x, this.portal.y, Math.round((this.portal.wait ?? 0) * 10)] : null, wv: [this.wave + 1, this.waves.length] };
  }
}
