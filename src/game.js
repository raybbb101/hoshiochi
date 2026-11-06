// クライアント本体: 自分のキャラの操作、全員の画面の描画、通信の受け渡し。
// ホストは World も動かす。全員が自分のキャラを動かし、当たり判定も自分の画面で行い、結果をホストへ送る。
import { createFrame, clearFrame, createFx } from "../vendor/pixelfx/src/core/fx.js";
import { hex, mix, scale, PAL } from "../vendor/pixelfx/src/core/color.js";
import { createFrame as mkFrame } from "../vendor/pixelfx/src/core/fx.js";
import { VIEW_W, VIEW_H, ROOM_W, ROOM_H, WALL_H, CLASSES, PLAYER, PLAYER_COLORS, JUICE, AREAS, ENEMIES, BOSSES, SCALE, ELITE, BOONS, baseStats, ROOM_PLAN } from "./data.js";
import { FxManager, MODS, NUM_PAL, blit } from "./fx.js";
import { Post } from "./post.js";
import { drawRig, drawShadow, drawRing, drawPillar, buildRoom, recolorMap, rng } from "./draw.js";
import { World, TYPE_IDS, EL, F, HZ, PK, FLOOR } from "./world.js";
import { KITS, actionPose, movePose, DASH_POSE, DOWN_POSE, HURT_POSE, STANCE } from "./kits.js";
import { audio, playMusic } from "./audio.js";

const SKEL_COLORS = { A: "#fffaf0", B: "#e4dcc8", C: "#b8ad96", D: "#8a806c", E: "#5e5648", F: "#3a352c", G: "#2a2620", J: "#1a1814", m: "#ff3b30", k: "#0b0a10" };
const KNIGHT_COLORS = { A: "#8048b8", B: "#5e3290", C: "#432468", D: "#2c1a4a", E: "#e4dcc8", F: "#8a806c", G: "#1c1230", J: "#0f0a18", m: "#ff3b30", k: "#050308" };
const lightRGB = (h) => { const c = hex(h); return [(c & 255) / 255, ((c >>> 8) & 255) / 255, ((c >>> 16) & 255) / 255]; };
const WARM = lightRGB("#ffb46a"), LANTERN = lightRGB("#ffe2b0");

export class Game {
  constructor(canvas, ui, input, net) {
    this.canvas = canvas; this.ui = ui; this.input = input; this.net = net;
    this.fxm = new FxManager();
    this.world = null; this.players = {}; this.me = 0;
    this.view = { enemies: new Map(), hazards: new Map(), pickups: new Map(), portal: null, phase: "none", bossHp: -1, bossName: "" };
    this.frame = createFrame(VIEW_W, VIEW_H); this.overlay = createFrame(VIEW_W, VIEW_H);
    this.cam = { x: 0, y: 0 }; this.fxState = { shake: 0, hitstop: 0, slowmo: 0, flash: 0, zoom: 1, hurt: 0 };
    this.projs = []; this.timers = []; this.bolts = []; this.lightsExtra = [];
    this.time = 0; this.running = false; this.room = null; this.gold = 0;
    this.maps = Object.fromEntries(Object.entries(CLASSES).map(([k, c]) => [k, recolorMap(c.colors)]));
    this.maps.skel = recolorMap(SKEL_COLORS); this.maps.knight = recolorMap(KNIGHT_COLORS);
    this.scratch = new Map();
  }
  init() { this.post = new Post(this.canvas, VIEW_W, VIEW_H); }
  get isHost() { return this.net.isHost; }

  // ---- 人と通信
  slots() { return Object.keys(this.players).map(Number); }
  playerCount() { return this.slots().length; }
  alivePlayers() { return Object.values(this.players).filter((p) => !p.down && p.hp > 0); }
  makePlayer(slot, name, cls) {
    const c = CLASSES[cls], stats = baseStats(cls);
    return {
      slot, name, cls, color: PLAYER_COLORS[slot], x: ROOM_W / 2 + (slot - 1.5) * 26, y: ROOM_H - 50, vx: 0, vy: 0, tx: 0, ty: 0,
      face: 1, aim: -Math.PI / 2, hp: c.hp, maxHp: c.hp, down: false, act: null, comboStep: 0, comboT: 0,
      dashT: 0, dashCd: 0, dashCharges: 1, dashDir: [1, 0], dashHit: new Set(), inv: 0, shield: 0, ult: 0, skillCd: 0,
      stats, boons: [], walk: 0, moving: false, flash: 0, trail: [], reviveT: 0, atkCount: 0,
      kills: 0, dmg: 0, maxCombo: 0, combo: 0, comboTimer: 0, soloLife: 0, hurtT: 0, pickup: 1,
    };
  }
  /** 自分の画面で起きたことを全員へ（自分にも適用） */
  cast(m) {
    this.handle(m);
    if (this.net.solo) return;
    if (this.isHost) this.net.send(m); else this.net.send({ t: "relay", m });
  }
  castFx(id, o, ex) { this.cast({ t: "fx", id, o, ex }); }
  castSfx(n, k) { this.cast({ t: "sfx", n, k }); }
  /** ホスト: 全員へ */
  broadcast(m) { this.handle(m); this.net.send(m); }
  broadcastExcept(slot, m) { if (slot !== this.me) this.handle(m); this.net.sendExcept(slot, m); }

  onMessage(slot, m) {
    if (this.isHost) {
      if (m.t === "ps") { this.applyPs(slot, m); this.net.sendExcept(slot, m); return; }
      if (m.t === "hits") { this.world?.applyHits(slot, m.h); return; }
      if (m.t === "relay") { this.handle(m.m); this.net.sendExcept(slot, m.m); return; }
      if (m.t === "pick") { if (this.players[slot]) this.players[slot].boons = m.boons; this.world?.pick(slot); return; }
      if (m.t === "hz") { this.world?.consume(m.id); return; }
      if (m.t === "pause") return;
    } else {
      if (m.t === "snap") { this.applySnap(m); return; }
      if (m.t === "ps") { this.applyPs(m.s, m); return; }
      this.handle(m);
    }
  }
  playerLeft(slot) {
    const p = this.players[slot];
    if (!p) return;
    delete this.players[slot];
    this.ui.toast(`${p.name} が抜けました`);
    if (this.isHost) { this.world?.picked.delete(slot); this.net.send({ t: "left", s: slot }); }
  }

  // ---- 開始
  start(seed, roster, me) {
    this.me = me; this.players = {};
    for (const [s, r] of Object.entries(roster)) this.players[s] = this.makePlayer(+s, r.name, r.cls);
    const mine = this.players[me];
    if (this.net.solo) mine.soloLife = 1;
    this.gold = 0; this.time = 0; this.runStart = performance.now();
    this.view.enemies.clear(); this.view.hazards.clear(); this.view.pickups.clear();
    this.fxm.list = []; this.projs = []; this.timers = [];
    this.running = true; this.over = false;
    if (this.isHost) { this.world = new World(this); this.world.startRun(seed); }
  }
  stop() { this.running = false; this.world = null; }

  // ---- イベント
  handle(m) {
    const me = this.players[this.me];
    switch (m.t) {
      case "fx": this.fxm.spawn(m.id, m.o, m.ex ?? {}); break;
      case "sfx": audio.play(m.n, m.k ?? 1); break;
      case "room": this.loadRoom(m); break;
      case "phase": this.view.phase = m.p; if (m.p === "leave") this.ui.autoPickBoon?.(); if (m.p === "leave") this.fxm.spawn("transitions/diamond-wipe", { palette: this.area.accent, seed: 2 }, { layer: "overlay", screen: true }); break;
      case "dmg": this.showDamage(m); break;
      case "kill": this.onKill(m); break;
      case "combo": {
        const k = "c" + m.kind, now = performance.now();
        if (now - (this.lastText?.[k] ?? 0) > 500) { (this.lastText ??= {})[k] = now; this.ui.worldText(m.name + "!", this.toScreen(m.x, m.y), "combo"); }
        if (m.by === this.me) this.hitstop(0.06);
        break;
      }
      case "bolt": this.bolts.push({ ...m, t: 0.16 }); break;
      case "shake": this.shake(m.k); break;
      case "status": break;
      case "clear": {
        this.fxState.slowmo = JUICE.lastKillSlowmo; this.fxState.zoom = 1.05;
        audio.play("clear");
        if (me && !me.down) this.heal(me, me.maxHp * PLAYER.clearHeal);
        this.ui.banner(m.boss ? "撃破！" : "部屋クリア", m.boss ? "BOSS DEFEATED" : "ROOM CLEAR", true);
        this.projs = this.projs.filter((p) => p.own);
        break;
      }
      case "boons": if (me) this.ui.showBoons(m.offers[this.me] ?? [], (id) => this.pickBoon(id)); break;
      case "portal": this.view.portal = { x: m.x, y: m.y }; this.portalFx = this.fxm.spawn("arcane/portal", { x: m.x, y: m.y + 8, seed: 4, width: 22, height: 34 }); audio.play("portal"); this.ui.hint("光の門に入ろう（全員で進む）"); break;
      case "boss": this.view.bossName = m.name; this.ui.banner(m.name, "BOSS", false); playMusic("boss"); break;
      case "banner": this.ui.banner(m.text, m.sub, m.small); break;
      case "heal": if (m.to === this.me && me) this.heal(me, m.amount ?? me.maxHp * m.pct); break;
      case "healAll": if (me && !me.down) { this.heal(me, m.amount ?? me.maxHp * m.pct); if (m.fx) this.fxm.spawn("holy/heal", { x: me.x | 0, y: me.y | 0, seed: 2 }); } break;
      case "reviveAll": if (me?.down) this.revive(me, 0.35); break;
      case "shield": if (me && (m.to === this.me || (m.all && Math.hypot(me.x - m.x, me.y - m.y) < m.r))) { me.shield = m.time; if (me.down) this.revive(me, 0.5); this.fxm.spawn("holy/divine-shield", { x: me.x | 0, y: me.y | 0, seed: 8 }, { life: m.time, follow: () => ({ x: me.x | 0, y: me.y | 0 }) }); } break;
      case "gold": this.gold += m.v; if (m.to === this.me) { audio.play("coin"); } break;
      case "proj": if (m.by !== this.me) this.spawnProj({ ...m, own: false }); break;
      case "over": this.gameOver(m); break;
      case "left": this.playerLeft(m.s); break;
    }
  }

  loadRoom(m) {
    this.roomIndex = m.i; this.area = AREAS[m.area]; this.kind = m.kind;
    this.room = this.isHost ? this.world.room : buildRoom(this.area, m.seed, m.kind);
    this.fxm.list = this.fxm.list.filter((f) => f.layer === "overlay" && f.screen);
    this.view.enemies.clear(); this.view.hazards.clear(); this.view.pickups.clear(); this.view.portal = null; this.view.bossName = ""; this.view.bossHp = -1;
    this.projs = []; this.bolts = [];
    // 燭台の炎と天候
    for (const t of this.room.torches) this.fxm.spawn(this.area.id === "frost" ? "fire/brazier" : "fire/torch", { x: t.x, y: t.y + 20, seed: t.x, ...(this.area.id === "frost" ? { palette: PAL.ice } : this.area.id === "summit" ? { palette: PAL.arcane } : {}) }, { scale: 1 });
    const W = { crypt: [["weather/fireflies", { palette: PAL.ember }]], frost: [["weather/snow", { light: 0.4 }]], summit: [["weather/shooting-stars", {}], ["weather/fireflies", { palette: PAL.arcane }]] }[this.area.id];
    for (const [id, o] of W) this.fxm.spawn(id, { seed: m.seed % 97, ...o }, { layer: "weather", screen: true });
    // 自分を入口へ
    const me = this.players[this.me];
    if (me) {
      me.x = ROOM_W / 2 + (this.me - 1.5) * 28; me.y = ROOM_H - 40; me.vx = me.vy = 0; me.act = null;
      this.cam.x = me.x - VIEW_W / 2; this.cam.y = me.y - VIEW_H / 2; this.clampCam();
      this.fxm.spawn("arcane/blink-in", { x: me.x | 0, y: me.y | 0, seed: this.me + 1 });
    }
    const areaNo = m.area + 1, step = (m.i % ROOM_PLAN.length) + 1;
    const kindName = { fight: "", elite: "精鋭", rest: "休息の間", boss: "決戦" }[m.kind];
    this.ui.banner(`${this.area.name}${kindName ? " — " + kindName : ""}`, `AREA ${this.area.sub} · ${step}/${ROOM_PLAN.length}`, false);
    this.ui.setRoom(`${this.area.name} ${step}/${ROOM_PLAN.length}`);
    if (m.kind !== "boss") playMusic(this.area.id);
    this.ui.hint("");
  }

  // ---- 毎フレーム
  update(rdt) {
    if (!this.running) return;
    const S = this.fxState;
    S.shake = Math.max(0, S.shake - rdt * 18);
    S.flash = Math.max(0, S.flash - rdt * 3);
    S.zoom += (1 - S.zoom) * Math.min(1, rdt * 6);
    S.hurt = Math.max(0, S.hurt - rdt * 2);
    if (S.slowmo > 0) S.slowmo -= rdt;
    const ts = S.slowmo > 0 ? 0.3 : 1;
    const frozen = S.hitstop > 0;
    if (frozen) S.hitstop -= rdt;
    const dt = frozen ? 0 : rdt * ts;
    this.time += dt;
    // ホストは世界を進める（ヒットストップでは止めない: 他の人の画面のため）
    if (this.world) {
      this.world.update(rdt * ts);
      this.snapT = (this.snapT ?? 0) - rdt;
      if (this.snapT <= 0 && !this.net.solo) { this.snapT = 1 / 15; this.net.send(this.world.snapshot()); }
      if (!frozen) this.syncFromWorld();
    }
    if (!this.room) return;
    this.input.poll();
    const me = this.players[this.me];
    if (me) this.updateMe(me, dt, rdt);
    for (const p of Object.values(this.players)) if (p.slot !== this.me) this.updateRemote(p, dt);
    this.updateView(dt);
    this.updateProjs(dt);
    for (let i = this.timers.length - 1; i >= 0; i--) { const q = this.timers[i]; if ((q.t -= dt) <= 0) { this.timers.splice(i, 1); q.fn(); } }
    for (const b of this.bolts) b.t -= rdt;
    this.bolts = this.bolts.filter((b) => b.t > 0);
    this.fxm.update(dt);
    // 自分の状態を送る
    this.psT = (this.psT ?? 0) - rdt;
    if (me && this.psT <= 0 && !this.net.solo) { this.psT = 1 / 20; this.net.send(this.psMsg(me)); }
    this.input.endFrame();
  }
  later(t, fn) { this.timers.push({ t, fn }); }
  hitstop(t) { this.fxState.hitstop = Math.max(this.fxState.hitstop, t); }
  shake(k) { this.fxState.shake = Math.max(this.fxState.shake, k); }
  flash(k) { this.fxState.flash = Math.max(this.fxState.flash, k); }

  // ---- 自分
  updateMe(p, dt, rdt) {
    const I = this.input, st = p.stats;
    p.flash = Math.max(0, p.flash - rdt * 6);
    if (dt === 0) { I.skill; I.dash; I.ult; return; } // ヒットストップ中は入力を捨てずに待つ…ほどでもないので捨てる
    p.inv = Math.max(0, p.inv - dt); p.shield = Math.max(0, p.shield - dt); p.hurtT = Math.max(0, p.hurtT - dt);
    p.skillCd = Math.max(0, p.skillCd - dt); p.comboT = Math.max(0, p.comboT - dt);
    p.comboTimer -= dt; if (p.comboTimer <= 0) p.combo = 0;
    if (p.dashCharges < st.dashes) { p.dashCd -= dt; if (p.dashCd <= 0) { p.dashCharges++; p.dashCd = PLAYER.dash.cd; } }
    // 狙い: マウス > 右スティック > 一番近い敵 > 移動方向
    const [mx, my] = I.move;
    const stick = I.stick;
    if (stick !== null) p.aim = stick;
    else if (!I.usingPad && performance.now() - I.mouse.moved < 4000) {
      const w = this.screenToWorld(I.mouse.x, I.mouse.y);
      p.aim = Math.atan2(w.y - (p.y - 12), w.x - p.x);
    } else {
      const e = this.nearestEnemy(p, 200);
      if (e) p.aim = Math.atan2(e.y - p.y, e.x - p.x); else if (mx || my) p.aim = Math.atan2(my, mx);
    }
    if (p.down) {
      p.act = null; p.dashT = 0;
      // 近くに仲間がいれば起き上がる
      const near = Object.values(this.players).some((q) => q !== p && !q.down && Math.hypot(q.x - p.x, q.y - p.y) < PLAYER.reviveRange);
      p.reviveT = near ? p.reviveT + dt : Math.max(0, p.reviveT - dt * 0.5);
      if (p.reviveT >= PLAYER.reviveTime) this.revive(p, PLAYER.reviveHp);
      I.skill; I.dash; I.ult;
      return;
    }
    // ダッシュ
    if (I.dash && p.dashCharges > 0 && p.dashT <= 0) {
      p.dashCharges--; if (p.dashCd <= 0) p.dashCd = PLAYER.dash.cd;
      p.dashT = PLAYER.dash.time; p.inv = Math.max(p.inv, PLAYER.dash.iframes);
      p.dashDir = mx || my ? [mx, my] : [Math.cos(p.aim), Math.sin(p.aim)];
      p.dashHit.clear();
      if (p.act && p.act.fired) p.act = null;
      this.castSfx("dash");
      this.castFx("spawn/poof", { x: p.x | 0, y: p.y | 0, seed: 5, palette: PAL.dust }, { skip: 0.2, life: 0.5 });
    }
    // 技
    const kit = KITS[p.cls], busy = p.act && !(p.act.fired && p.act.t > p.act.hitT + 0.02);
    if (I.ult && p.ult >= 1 && p.dashT <= 0) { p.act = null; p.ult = 0; kit.ult(this, p); }
    else if (I.skill && p.skillCd <= 0 && !busy && p.dashT <= 0) { p.act = null; kit.skill(this, p); p.skillCd = CLASSES[p.cls].skill.cd * st.cdr; }
    else if (I.attack && !p.act && p.dashT <= 0) { p.atkCount++; kit.attack(this, p); }
    // 向き
    if (p.act || I.attack) p.face = Math.cos(p.aim) >= 0 ? 1 : -1;
    else if (Math.abs(mx) > 0.1) p.face = mx > 0 ? 1 : -1;
    // 移動
    let sp = st.speed;
    if (p.act) sp *= p.cls === "gunner" ? 0.72 : p.cls === "mage" ? 0.55 : 0.3;
    if (p.dashT > 0) {
      const v = PLAYER.dash.dist / PLAYER.dash.time;
      p.x += p.dashDir[0] * v * dt; p.y += p.dashDir[1] * v * dt * 0.8;
      p.dashT -= dt;
      p.trail.push({ x: p.x, y: p.y, t: 0.22, pose: DASH_POSE, face: p.face });
      if (st.dashDmg > 0) {
        const hits = this.enemiesInRadius(p.x, p.y, 18).filter((e) => !p.dashHit.has(e.id));
        hits.forEach((e) => p.dashHit.add(e.id));
        if (hits.length) { this.deal(p, hits, { base: st.dashDmg, el: EL.shock, kb: 80 }); this.castFx("lightning/zap-hit", { x: p.x | 0, y: (p.y - 10) | 0, seed: 3 }); }
      }
    } else {
      p.x += (mx * sp + p.vx) * dt; p.y += (my * sp * 0.85 + p.vy) * dt;
    }
    const fr = Math.exp(-dt * 10); p.vx *= fr; p.vy *= fr;
    p.moving = (mx || my) && p.dashT <= 0;
    if (p.moving) p.walk += dt; else p.walk += dt * 0.5;
    this.confine(p);
    for (const t of p.trail) t.t -= dt;
    p.trail = p.trail.filter((t) => t.t > 0);
    // 動作
    if (p.act) {
      const a = p.act;
      a.t += dt;
      if (!a.fired && a.t >= a.hitT) { a.fired = true; a.fn(); }
      if (a.t >= a.dur) p.act = null;
    }
    this.checkHazards(p);
  }
  startAct(p, name, dur, hitT, fn) { p.act = { name, t: 0, dur, hitT, fn, fired: false }; }
  confine(p) {
    p.x = Math.max(FLOOR.x0 + 6, Math.min(FLOOR.x1 - 6, p.x));
    p.y = Math.max(FLOOR.y0, Math.min(FLOOR.y1, p.y));
    for (const q of this.room.pillars) {
      const dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy) || 1, m = q.r + 6;
      if (d < m) { p.x = q.x + (dx / d) * m; p.y = q.y + (dy / d) * m; }
    }
  }
  heal(p, v) {
    if (p.down) return;
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + v);
    const got = Math.round(p.hp - before);
    if (got > 0) this.spawnNumber(p.x, p.y - 40, "+" + got, "heal");
  }
  revive(p, k) {
    p.down = false; p.hp = Math.max(1, p.maxHp * k); p.inv = 1.5; p.reviveT = 0;
    this.castFx("holy/resurrection", { x: p.x | 0, y: p.y | 0, seed: 5 }, { skip: 1.2 });
    this.castSfx("revive");
  }
  hurt(p, dmg, from) {
    if (p.inv > 0 || p.shield > 0 || p.dashT > 0 || p.down || this.view.phase === "leave") return false;
    dmg = Math.round(dmg * p.stats.armor * (p.act && CLASSES[p.cls].guard ? CLASSES[p.cls].guard : 1));
    p.hp -= dmg; p.inv = PLAYER.hurtIframes; p.flash = 1; p.hurtT = 0.2;
    this.shake(JUICE.shake.crit); this.hitstop(0.06); this.fxState.hurt = 1;
    audio.play("hurt");
    this.spawnNumber(p.x, p.y - 36, String(dmg), "none", false, true);
    if (from) { const d = Math.hypot(p.x - from.x, p.y - from.y) || 1; p.vx += ((p.x - from.x) / d) * 160; p.vy += ((p.y - from.y) / d) * 120; }
    if (p.stats.thorns) this.deal(p, this.enemiesInRadius(p.x, p.y, 56), { base: dmg * 1.5, kb: 160 });
    if (p.hp <= 0) {
      if (p.soloLife > 0) { p.soloLife--; this.revive(p, 0.5); this.ui.banner("星の加護", "もう一度立ち上がる", true); return true; }
      p.hp = 0; p.down = true; p.act = null; p.reviveT = 0;
      this.castSfx("down");
      this.castFx("spawn/soul-rise", { x: p.x | 0, y: p.y | 0, seed: 7, palette: PAL.holy }, { skip: 0.4 });
      this.ui.hint(this.playerCount() > 1 ? "倒れた…仲間がそばに来ると復活できる" : "");
    }
    return true;
  }
  checkHazards(p) {
    for (const h of this.view.hazards.values()) {
      if (h.delay > 0 || h.hitMe) continue;
      const dx = p.x - h.x, dy = (p.y - h.y) * 1.3, d = Math.hypot(dx, dy);
      let hit = false;
      if (h.kind === HZ.shot) hit = d < h.r + 6;
      else if (h.kind === HZ.zone) hit = d < h.r;
      else if (h.kind === HZ.ring) hit = Math.abs(d - h.r) < 9;
      else if (h.kind === HZ.arc) {
        const a = Math.atan2(dy, dx), da = Math.abs(Math.atan2(Math.sin(a - h.a), Math.cos(a - h.a)));
        hit = d < h.r && (da < h.spread / 2 || d < 14);
      }
      if (hit && this.hurt(p, h.dmg, h)) {
        h.hitMe = true;
        if (h.kind === HZ.shot) {
          this.view.hazards.delete(h.id);
          if (this.isHost) this.world.consume(h.id); else this.net.send({ t: "hz", id: h.id });
          this.fxm.spawn("impacts/hit-spark", { x: p.x | 0, y: (p.y - 12) | 0, seed: 3, palette: PAL.blood });
        }
      }
    }
    // 体当たり
    for (const e of this.view.enemies.values()) {
      if (e.flags & (F.spawn | F.frozen)) continue;
      const d = Math.hypot(p.x - e.x, (p.y - e.y) * 1.3);
      if (d < e.r + 6 && !e.air) this.hurt(p, this.enemyDmg(e) * (e.dash ? 1.3 : 1), e);
    }
  }
  enemyDmg(e) {
    if (e.flags & F.boss) return BOSSES[e.type].dmg * PLAYER.contactK;
    return e.def.dmg * Math.pow(SCALE.enemyDmgPerRoom, this.roomIndex) * (e.flags & F.elite ? ELITE.dmg : 1) * PLAYER.contactK;
  }
  pickBoon(id) {
    const me = this.players[this.me], b = BOONS.find((x) => x.id === id);
    if (!me || !b) return;
    const oldMax = me.stats.maxHp;
    b.apply(me.stats);
    me.boons.push(id);
    me.maxHp = me.stats.maxHp; if (me.stats.maxHp > oldMax) me.hp = me.stats.hp;
    me.pickup = me.stats.pickup;
    audio.play("boon");
    this.castFx("ui/level-up", { x: me.x | 0, y: me.y | 0, seed: 5, text: "UP!" }, { skip: 0.2 });
    if (this.isHost) this.world.pick(this.me); else this.net.send({ t: "pick", id, boons: me.boons });
    this.ui.hint("仲間の選択を待っています…");
  }

  // ---- 攻撃の当たり
  enemiesInRadius(x, y, r) {
    const out = [];
    for (const e of this.view.enemies.values()) {
      if (e.flags & F.spawn) continue;
      if (Math.hypot(e.x - x, (e.y - y) * 1.2) <= r + e.r) out.push(e);
    }
    return out;
  }
  meleeHits(p, range, arc, aim) {
    const out = [];
    for (const e of this.view.enemies.values()) {
      if (e.flags & F.spawn) continue;
      const dx = e.x - p.x, dy = (e.y - p.y) * 1.25, d = Math.hypot(dx, dy);
      if (d > range + e.r) continue;
      const da = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - aim), Math.cos(Math.atan2(dy, dx) - aim)));
      if (da <= arc / 2 || d < e.r + 10) out.push(e);
    }
    return out;
  }
  nearestEnemy(p, r) {
    let best = null, bd = r;
    for (const e of this.view.enemies.values()) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  aimPoint(p, maxD) {
    const I = this.input;
    if (!I.usingPad && performance.now() - I.mouse.moved < 4000) {
      const w = this.screenToWorld(I.mouse.x, I.mouse.y), d = Math.hypot(w.x - p.x, w.y - p.y);
      if (d < maxD) return { x: Math.max(FLOOR.x0, Math.min(FLOOR.x1, w.x)), y: Math.max(FLOOR.y0, Math.min(FLOOR.y1, w.y)) };
    }
    const e = this.nearestEnemy(p, maxD);
    if (e) return { x: e.x, y: e.y };
    return { x: p.x + Math.cos(p.aim) * maxD * 0.6, y: p.y + Math.sin(p.aim) * maxD * 0.4 };
  }
  /** ダメージを与える（自分の画面で即座に演出、ホストへ報告） */
  deal(p, targets, o) {
    if (!targets.length) return;
    const st = p.stats, hits = [];
    let el = o.el ?? 0;
    if (st.elems.burn) el |= EL.burn; if (st.elems.chill) el |= EL.chill; if (st.elems.shock) el |= EL.shock; if (st.elems.holy) el |= EL.holy;
    const giant = st.giant && o.basic && p.atkCount % 4 === 0;
    let anyCrit = false, total = 0;
    for (const e of targets) {
      const crit = giant || Math.random() < st.crit;
      let dmg = o.base * st.dmg * (crit ? st.critMult : 1) * (giant ? 3 : 1);
      dmg = Math.max(1, Math.round(dmg * (0.92 + Math.random() * 0.16)));
      const from = o.from ?? p, dx = e.x - from.x, dy = e.y - from.y, d = Math.hypot(dx, dy) || 1, kb = o.kb ?? 100;
      hits.push([e.id, dmg, crit ? 1 : 0, el, Math.round((dx / d) * kb), Math.round((dy / d) * kb * 0.8), o.heavy ? 1 : 0, st.killBoom, st.comboMult, o.freeze ?? 0]);
      // 自分の画面ではすぐに反応させる
      e.flash = 0.1; e.kx += (dx / d) * Math.min(10, kb / 25); e.ky += (dy / d) * Math.min(6, kb / 40);
      this.spawnNumber(e.x, e.y - (e.def?.h ?? 20) - 4, String(dmg), crit ? "crit" : elName(el), crit);
      const hx = e.x | 0, hy = (e.y - (e.def?.h ?? 20) * 0.5) | 0;
      if (crit) this.fxm.spawn("impacts/crit-hit", { x: hx, y: hy + 12, seed: e.id % 9, flip: dx < 0, height: 12 }, { skip: 0.02 });
      else if (o.heavy) this.fxm.spawn("impacts/blunt-hit", { x: hx, y: hy + 10, seed: e.id % 9, flip: dx < 0, height: 10 }, { skip: 0.02 });
      else this.fxm.spawn("impacts/hit-spark", { x: hx, y: hy + 10, seed: e.id % 9, flip: dx < 0, height: 10, aim: dy / d }, { skip: 0.01 });
      anyCrit ||= crit; total += dmg;
    }
    if (!o.ult) p.ult = Math.min(1, p.ult + (total / PLAYER.ultCharge) * st.ultGain);
    p.dmg += total;
    const H = JUICE.hitstop;
    this.hitstop(o.ult ? H.ult : o.finisher ? H.finisher : anyCrit ? H.crit : H.normal * (p.cls === "gunner" ? 0.4 : 1));
    this.shake(anyCrit ? JUICE.shake.crit : JUICE.shake.normal * (o.heavy ? 1.6 : 1));
    audio.play(anyCrit ? "crit" : o.heavy ? "hit2" : "hit", 1);
    if (this.isHost) this.world.applyHits(this.me, hits); else this.net.send({ t: "hits", h: hits });
  }
  /** 「多重撃」の衝撃波（近接職） */
  wave(p, base, big) {
    this.addProj(p, { kind: "wave", a: p.aim, speed: 300, dmg: base / p.stats.dmg, life: 0.35, r: 12, pierce: true, heavy: big });
  }
  healAllies(p, r, v, fx) {
    for (const q of Object.values(this.players)) {
      if (q.down || Math.hypot(q.x - p.x, q.y - p.y) > r) continue;
      if (q.slot === this.me) this.heal(q, v);
      else this.cast({ t: "heal", to: q.slot, amount: v });
      if (fx && q.slot !== this.me) this.castFx("holy/heal", { x: q.x | 0, y: q.y | 0, seed: 3 }, { skip: 0.3 });
    }
  }
  shieldAll(time, p, r) {
    this.cast({ t: "shield", all: true, x: p.x, y: p.y, r, time });
  }
  ultIntro(p) {
    audio.play("ult");
    this.fxState.zoom = 1.08;
    this.ui.ultCut(p);
    this.castFx("arcane/mana-burst", { x: p.x | 0, y: p.y | 0, seed: 2, palette: PAL[{ blade: "gold", mage: "fire", gunner: "electric", cleric: "holy" }[p.cls]] }, { skip: 0 });
  }
  muzzle(p) { this.lightsExtra.push({ x: p.x + Math.cos(p.aim) * 14, y: p.y - 22, r: 46, k: 0.9, c: lightRGB("#ffd23c"), t: 0.05 }); }

  // ---- 飛び道具（撃った本人が当たりを判定、他の人の画面には見た目だけ）
  addProj(p, o) {
    const sx = p.x + Math.cos(o.a) * 10, sy = p.y + Math.sin(o.a) * 6;
    const m = { t: "proj", kind: o.kind, x: Math.round(sx), y: Math.round(sy), vx: Math.round(Math.cos(o.a) * o.speed), vy: Math.round(Math.sin(o.a) * o.speed * 0.85), life: o.life, by: p.slot };
    this.spawnProj({ ...m, own: true, o });
    if (!this.net.solo) { if (this.isHost) this.net.send(m); else this.net.send({ t: "relay", m }); }
  }
  spawnProj(m) {
    const pr = { ...m, age: 0, hit: new Set(), z: 14 };
    const ang = Math.atan2(m.vy, m.vx);
    const look = {
      fireball: ["fire/fireball", { radius: 4, speed: 200 }],
      bullet: ["projectiles/bullet-tracer", { length: 34, speed: 520 }],
      rocket: ["projectiles/rocket", { speed: 160 }],
      wave: ["projectiles/energy-disc", { palette: PAL.gold }],
    }[m.kind];
    pr.fx = this.fxm.spawn(look[0], { x: m.x, y: m.y - pr.z, angle: ang, seed: (m.x + m.y) % 13, ...look[1] }, { follow: () => (pr.dead ? null : { x: Math.round(pr.x), y: Math.round(pr.y - pr.z) }) });
    this.projs.push(pr);
    return pr;
  }
  updateProjs(dt) {
    for (const pr of this.projs) {
      pr.age += dt; pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      if (pr.age > pr.life || pr.x < FLOOR.x0 - 20 || pr.x > FLOOR.x1 + 20 || pr.y < WALL_H - 20 || pr.y > ROOM_H + 10) { this.endProj(pr); continue; }
      if (this.room.pillars.some((q) => Math.hypot(q.x - pr.x, q.y - pr.y) < q.r + 2)) { this.endProj(pr); continue; }
      for (const e of this.view.enemies.values()) {
        if (pr.dead || pr.hit.has(e.id) || e.flags & F.spawn) continue;
        if (Math.hypot(e.x - pr.x, (e.y - pr.y) * 1.2) > e.r + (pr.o?.r ?? 6)) continue;
        pr.hit.add(e.id);
        if (pr.own) {
          const p = this.players[this.me], o = pr.o;
          if (o.explode) { this.endProj(pr); break; }
          this.deal(p, [e], { base: o.dmg, el: o.el, kb: pr.kind === "bullet" ? 50 : 110, basic: o.basic, from: { x: pr.x - pr.vx * 0.05, y: pr.y - pr.vy * 0.05 }, heavy: o.heavy });
          if (o.splash) {
            const others = this.enemiesInRadius(e.x, e.y, o.splash).filter((x) => x !== e);
            if (others.length) this.deal(p, others, { base: o.dmg * o.splashK, el: o.el, kb: 60, from: e });
            this.fxm.spawn("explosions/plasma-explosion", { x: e.x | 0, y: (e.y - 8) | 0, seed: e.id % 7, palette: PAL.fire }, { scale: 1, life: 0.35 });
          }
        }
        if (!(pr.o?.pierce)) { this.endProj(pr); break; }
      }
    }
    this.projs = this.projs.filter((p) => !p.dead);
  }
  endProj(pr) {
    if (pr.dead) return;
    pr.dead = true; pr.fx?.fx.stop();
    if (pr.kind === "rocket") {
      this.fxm.spawn("explosions/small-explosion", { x: pr.x | 0, y: pr.y | 0, seed: 3, size: 0.6 });
      this.shake(JUICE.shake.explode); audio.play("boom", 0.6);
      if (pr.own) this.deal(this.players[this.me], this.enemiesInRadius(pr.x, pr.y, pr.o.explode), { base: pr.o.dmg, heavy: true, kb: 260, from: pr });
    } else if (pr.kind === "fireball") this.fxm.spawn("impacts/hit-spark", { x: pr.x | 0, y: (pr.y) | 0, seed: 2, palette: PAL.fire, height: 14 }, { skip: 0.02 });
  }

  // ---- 他の人
  psMsg(p) {
    return { t: "ps", s: p.slot, x: Math.round(p.x), y: Math.round(p.y), f: p.face, a: Math.round(p.aim * 100), hp: Math.round(p.hp), mh: p.maxHp, dn: p.down ? 1 : 0,
      an: p.act?.name ?? "", at: p.act ? Math.round(p.act.t * 1000) : 0, ad: p.act ? Math.round(p.act.dur * 1000) : 0, ah: p.act ? Math.round(p.act.hitT * 1000) : 0,
      mv: p.moving ? 1 : 0, sh: p.shield > 0 ? 1 : 0, ds: p.dashT > 0 ? 1 : 0, u: Math.round(p.ult * 100), sc: Math.round(p.skillCd * 10), iv: p.inv > 0 ? 1 : 0,
      k: p.kills, d: Math.round(p.dmg), pu: p.pickup, rv: Math.round(p.reviveT * 10), b: p.boons.length };
  }
  applyPs(slot, m) {
    const p = this.players[slot];
    if (!p) return;
    p.tx = m.x; p.ty = m.y; p.face = m.f; p.aim = m.a / 100; p.hp = m.hp; p.maxHp = m.mh; p.down = !!m.dn;
    if (!p.seen) { p.x = m.x; p.y = m.y; p.seen = true; }
    if (m.an) { if (!p.act || p.act.name !== m.an || m.at < p.act.t * 1000 - 60) p.act = { name: m.an, t: m.at / 1000, dur: m.ad / 1000, hitT: m.ah / 1000 }; }
    else p.act = null;
    p.moving = !!m.mv; p.shield = m.sh; p.dashT = m.ds ? 0.1 : 0; p.ult = m.u / 100; p.skillCd = m.sc / 10; p.inv = m.iv;
    p.kills = m.k; p.dmg = m.d; p.pickup = m.pu; p.reviveT = m.rv / 10;
  }
  updateRemote(p, dt) {
    if (!p.seen) return;
    const k = Math.min(1, dt * 14);
    p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k;
    p.walk += dt * (p.moving ? 1 : 0.5);
    if (p.act) { p.act.t += dt; if (p.act.t > p.act.dur) p.act = null; }
    if (p.dashT > 0) p.trail.push({ x: p.x, y: p.y, t: 0.2, pose: DASH_POSE, face: p.face });
    for (const t of p.trail) t.t -= dt;
    p.trail = p.trail.filter((t) => t.t > 0);
  }

  // ---- 敵・弾・拾い物の表示状態
  syncFromWorld() {
    const W = this.world, V = this.view;
    for (const e of W.enemies.values()) {
      let v = V.enemies.get(e.id);
      if (!v) V.enemies.set(e.id, (v = this.newViewEnemy(e.id, e.type)));
      v.tx = e.x; v.ty = e.y; v.hp = e.hp / e.maxHp; v.face = e.face; v.air = e.air ?? 0; v.dash = e.ai.s === "dash" || !!e.ai.going;
      let f = 0;
      if (e.elite) f |= F.elite; if (e.boss) f |= F.boss; if (e.st.burn) f |= F.burn; if (e.st.chill) f |= F.chill; if (e.st.frozen) f |= F.frozen;
      if (e.st.shock) f |= F.shock; if (e.st.holy) f |= F.holy; if (e.tele > 0) f |= F.tele; if (e.spawnT > 0) f |= F.spawn;
      v.flags = f; v.ai = e.ai.s;
    }
    for (const id of V.enemies.keys()) if (!W.enemies.has(id)) this.dropViewEnemy(id);
    for (const h of W.hazards.values()) {
      let v = V.hazards.get(h.id);
      if (!v) V.hazards.set(h.id, (v = { id: h.id, hitMe: false }));
      Object.assign(v, { kind: h.kind, x: h.x, y: h.y, r: h.r, vx: 0, vy: 0, delay: h.delay, style: h.style, a: h.a, spread: h.spread ?? 0, dmg: h.dmg, grow: 0, age: h.age });
    }
    for (const id of V.hazards.keys()) if (!W.hazards.has(id)) V.hazards.delete(id);
    V.pickups = W.pickups;
    V.portal = W.portal; V.bossHp = W.boss ? W.boss.hp / W.boss.maxHp : -1; V.wave = [W.wave + 1, W.waves.length];
    // ホスト側でもゲストの位置を把握している（拾い物・ポータル判定用）
  }
  applySnap(m) {
    const V = this.view, seen = new Set();
    for (const r of m.e) {
      const [id, ti, x, y, hp, f, face, air, dash] = r;
      seen.add(id);
      let v = V.enemies.get(id);
      if (!v) { V.enemies.set(id, (v = this.newViewEnemy(id, TYPE_IDS[ti]))); v.x = x; v.y = y; }
      v.tx = x; v.ty = y; v.hp = hp / 1000; v.flags = f; v.face = face; v.air = air; v.dash = !!dash;
    }
    for (const id of V.enemies.keys()) if (!seen.has(id)) this.dropViewEnemy(id);
    const hs = new Set();
    for (const r of m.h) {
      const [id, kind, x, y, rr, vx, vy, delay, style, a, spread, dmg, grow] = r;
      hs.add(id);
      let v = V.hazards.get(id);
      if (!v) V.hazards.set(id, (v = { id, hitMe: false, age: 0 }));
      Object.assign(v, { kind, x, y, r: rr, vx, vy, delay: delay / 100, style, a: a / 100, spread: spread / 100, dmg, grow });
    }
    for (const id of V.hazards.keys()) if (!hs.has(id)) V.hazards.delete(id);
    const ks = new Map();
    for (const [id, kind, x, y, z] of m.k) { const old = V.pickups.get(id); ks.set(id, { id, kind, x: old ? old.x : x, y: old ? old.y : y, tx: x, ty: y, z, age: (old?.age ?? 0) }); }
    V.pickups = ks;
    V.phase = m.ph; V.bossHp = m.bh / 1000;
    V.portal = m.pt ? { x: m.pt[0], y: m.pt[1], wait: m.pt[2] / 10 } : null; V.wave = m.wv;
  }
  newViewEnemy(id, type) {
    const def = ENEMIES[type] ?? BOSSES[type];
    const v = { id, type, def, x: 0, y: 0, tx: 0, ty: 0, hp: 1, flags: 0, face: 1, air: 0, flash: 0, kx: 0, ky: 0, r: def.r, k: def.scale ?? 1, born: this.time };
    if (def.fx !== "rig") v.fx = createFx(MODS[def.fx], { seed: id % 7 + 1, light: 0.3, ...(this.area?.id === "summit" && type === "skull" ? { palette: PAL.arcane } : {}), ...(type === "slimeKing" ? { palette: PAL.poison } : {}) });
    v.fx?.update(Math.random() * 2);
    return v;
  }
  dropViewEnemy(id) { this.view.enemies.delete(id); }
  updateView(dt) {
    const k = Math.min(1, dt * (this.isHost ? 60 : 12));
    for (const e of this.view.enemies.values()) {
      e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k;
      if (e.x === 0 && e.y === 0) { e.x = e.tx; e.y = e.ty; }
      e.kx *= Math.exp(-dt * 14); e.ky *= Math.exp(-dt * 14);
      e.flash = Math.max(0, e.flash - dt);
      if (!(e.flags & F.frozen)) e.fx?.update(dt * (e.flags & F.chill ? 0.5 : 1));
      const rig = e.def.fx === "rig";
      if (rig && e.flags & F.elite && !e.aura) e.aura = this.fxm.spawn("status/rage", { x: e.x | 0, y: e.y | 0, seed: e.id % 5 }, { follow: () => (this.view.enemies.has(e.id) ? { x: e.x | 0, y: e.y | 0 } : null) });
      if (rig && e.flags & F.burn && !e.burnFx) e.burnFx = this.fxm.spawn("status/burning", { x: e.x | 0, y: e.y | 0, seed: e.id % 5 }, { follow: () => (this.view.enemies.get(e.id)?.flags & F.burn ? { x: e.x | 0, y: (e.y - e.air) | 0 } : (e.burnFx = null)) });
    }
    if (!this.isHost) {
      for (const h of this.view.hazards.values()) {
        h.age = (h.age ?? 0) + dt;
        if (h.delay > 0) h.delay -= dt; else { h.x += h.vx * dt; h.y += h.vy * dt; h.r += (h.grow ?? 0) * dt; }
      }
      for (const k2 of this.view.pickups.values()) { k2.x += (k2.tx - k2.x) * Math.min(1, dt * 12); k2.y += (k2.ty - k2.y) * Math.min(1, dt * 12); k2.age += dt; }
    }
  }

  // ---- 数字・撃破
  spawnNumber(x, y, text, kind, crit, force) {
    // 数字が多すぎると画面が埋まるので、会心以外は同時に出す数を絞る
    const live = this.fxm.list.filter((f) => f.id === "ui/damage-number").length;
    if (!force && !crit && kind !== "heal" && live > 14) return;
    const pal = kind === "crit" ? NUM_PAL.volt ?? PAL.volt : NUM_PAL[kind] ?? NUM_PAL.white;
    if (crit && kind === "crit") this.fxm.spawn("ui/crit-number", { x: x | 0, y: y | 0, text: text + "!", label: "CRIT", seed: (x + y) & 7 }, { layer: "overlay", skip: 0.05 });
    else this.fxm.spawn("ui/damage-number", { x: (x + (Math.random() - 0.5) * 8) | 0, y: y | 0, text, palette: pal, seed: (x * 3 + y) & 7 }, { layer: "overlay", skip: 0.02 });
  }
  showDamage(m) {
    const e = this.view.enemies.get(m.id);
    if (e) e.flash = 0.08;
    const kind = m.dot ? "burn" : m.c ? "crit" : elName(m.el);
    if (m.dot) this.fxm.spawn("ui/damage-number", { x: m.x | 0, y: m.y | 0, text: String(m.v), palette: PAL.ember, seed: m.v & 7 }, { layer: "overlay", skip: 0.15 });
    else if (m.c || m.v >= 30 || Math.random() < 0.5) this.spawnNumber(m.x, m.y, String(m.v), kind, !!m.c);
  }
  onKill(m) {
    const e = this.view.enemies.get(m.id);
    this.dropViewEnemy(m.id);
    if (m.by === -1) { this.fxm.spawn("spawn/poof", { x: m.x, y: m.y, seed: m.id % 9, palette: PAL.shadow }); return; }
    const def = ENEMIES[m.type] ?? BOSSES[m.type];
    if (m.st === "ice") this.fxm.spawn("ice/ice-shatter", { x: m.x, y: m.y, seed: m.id % 9 }, { skip: 0.6 });
    else if (m.type === "skel" || m.type === "boneKnight") this.fxm.spawn("spawn/shatter-death", { x: m.x, y: m.y, seed: m.id % 9, palette: PAL.bone }, { skip: 0.3 });
    else if (["ghost", "wisp", "jelly"].includes(m.type)) this.fxm.spawn("spawn/soul-rise", { x: m.x, y: m.y, seed: m.id % 9, height: 30 }, { skip: 0.5 });
    else if (m.type === "slime" || m.type === "frog" || m.type === "slimeKing") this.fxm.spawn("nature/acid-splash", { x: m.x, y: m.y, seed: m.id % 9 }, { skip: 0.25 });
    else this.fxm.spawn("spawn/poof", { x: m.x, y: m.y, seed: m.id % 9, palette: PAL.smoke }, { skip: 0.1 });
    if (m.elite || m.boss) { this.fxm.spawn("explosions/firework-burst", { x: m.x, y: m.y - 20, seed: m.id % 5 }); this.shake(m.boss ? 8 : 4); }
    else this.shake(JUICE.shake.kill * 0.6);
    audio.play("kill");
    if (m.by === this.me) {
      const p = this.players[this.me];
      p.kills++;
      p.combo++; p.comboTimer = 2.2; p.maxCombo = Math.max(p.maxCombo, p.combo);
      if (p.stats.killHeal) this.heal(p, p.stats.killHeal);
      this.hitstop(m.boss ? 0.35 : JUICE.hitstop.kill);
      if (p.combo >= 3) {
        this.comboFx?.fx.stop();
        this.comboFx = this.fxm.spawn("ui/combo-counter", { x: (this.cam.x + VIEW_W - 70) | 0, y: (this.cam.y + 46) | 0, count: p.combo, label: "COMBO", seed: p.combo % 7 }, { layer: "overlay", follow: () => ({ x: (this.cam.x + VIEW_W - 70) | 0, y: (this.cam.y + 46) | 0 }) });
        audio.play("combo", p.combo);
        if (p.combo % 25 === 0) this.ui.worldText(`${p.combo} 連鎖！`, this.toScreen(p.x, p.y - 50), "big");
      }
    }
    if (m.boss) { this.fxState.slowmo = 1.4; this.flash(0.6); audio.play("bigboom"); }
  }
  gameOver(m) {
    if (this.over) return;
    this.over = true;
    playMusic(m.win ? "title" : "title");
    const stats = Object.values(this.players).map((p) => ({ name: p.name, cls: p.cls, color: p.color, kills: p.kills, dmg: Math.round(p.dmg), boons: p.boons.length }));
    const me = this.players[this.me];
    setTimeout(() => this.ui.showResult({ win: m.win, time: m.time, room: m.room, gold: this.gold, stats, maxCombo: me?.maxCombo ?? 0 }), m.win ? 1500 : 900);
  }

  // ---- 座標
  clampCam() { this.cam.x = Math.max(0, Math.min(ROOM_W - VIEW_W, this.cam.x)); this.cam.y = Math.max(0, Math.min(ROOM_H - VIEW_H, this.cam.y)); }
  screenToWorld(cx, cy) {
    const r = this.canvas.getBoundingClientRect(), dpr = this.canvas.width / r.width;
    const k = Math.min(this.canvas.width / VIEW_W, this.canvas.height / VIEW_H), bw = VIEW_W * k, bh = VIEW_H * k;
    const bx = (this.canvas.width - bw) / 2, by = (this.canvas.height - bh) / 2;
    const sx = ((cx - r.left) * dpr - bx) / k, sy = ((cy - r.top) * dpr - by) / k;
    return { x: sx + this.cam.x, y: sy + this.cam.y };
  }
  toScreen(x, y) {
    const r = this.canvas.getBoundingClientRect(), k = Math.min(r.width / VIEW_W, r.height / VIEW_H);
    const bx = (r.width - VIEW_W * k) / 2, by = (r.height - VIEW_H * k) / 2;
    return { x: r.left + bx + (x - this.cam.x) * k, y: r.top + by + (y - this.cam.y) * k };
  }

  // ---- 描画
  render(rt) {
    if (!this.room) return;
    const f = this.frame, o = this.overlay, S = this.fxState, me = this.players[this.me];
    if (me) {
      const lx = me.x + Math.cos(me.aim) * 24 - VIEW_W / 2, ly = me.y - 20 + Math.sin(me.aim) * 14 - VIEW_H / 2;
      this.cam.x += (lx - this.cam.x) * 0.12; this.cam.y += (ly - this.cam.y) * 0.12;
      this.clampCam();
    }
    const sh = S.shake, sx = Math.round((Math.random() - 0.5) * sh * 2), sy = Math.round((Math.random() - 0.5) * sh * 2);
    f.ox = Math.round(this.cam.x) + sx; f.oy = Math.round(this.cam.y) + sy; o.ox = f.ox; o.oy = f.oy;
    clearFrame(o);
    // 背景
    const bg = this.room.buf, L = f.light;
    L.fill(0);
    for (let y = 0; y < VIEW_H; y++) {
      const wy = Math.max(0, Math.min(ROOM_H - 1, y + f.oy)), wx = Math.max(0, Math.min(ROOM_W - VIEW_W, f.ox));
      f.color.set(bg.subarray(wy * ROOM_W + wx, wy * ROOM_W + wx + VIEW_W), y * VIEW_W);
    }
    // 床の予告（敵の攻撃範囲）
    this.drawTelegraphs(f);
    if (this.view.portal) this.drawPortalGlow(f);
    this.fxm.draw(f, "world", "back");
    // 影
    for (const p of Object.values(this.players)) drawShadow(f, p.x, p.y + 1, 9, 3.5);
    for (const e of this.view.enemies.values()) drawShadow(f, e.x, e.y + 1, e.r * e.k * 0.9 + 2, 3 + e.k, e.air ? 0.3 : 0.5);
    // 奥から順に
    const items = [];
    for (const q of this.room.pillars) items.push([q.y, () => drawPillar(f, q, this.area)]);
    for (const p of Object.values(this.players)) items.push([p.y, () => this.drawPlayer(f, o, p, rt)]);
    for (const e of this.view.enemies.values()) items.push([e.y, () => this.drawEnemy(f, o, e, rt)]);
    for (const k of this.view.pickups.values()) items.push([k.y, () => this.drawPickup(f, k, rt)]);
    items.sort((a, b) => a[0] - b[0]);
    for (const [, fn] of items) fn();
    this.drawShots(f, rt);
    this.fxm.draw(f, "world", "front");
    for (const b of this.bolts) this.drawBolt(f, b);
    // 天候（画面に固定）
    this.fxm.draw(f, "weather");
    this.fxm.draw(o, "overlay");
    if (this.view.phase === "fight" && this.view.enemies.size <= 5) this.drawArrows(o, rt);
    // 光源
    const lights = [];
    const view = (x, y) => [x - f.ox, y - f.oy];
    const fl = (s) => 0.85 + Math.sin(rt * 9 + s) * 0.08 + Math.sin(rt * 23 + s * 2) * 0.05;
    for (const t of this.room.torches) { const [x, y] = view(t.x, t.y + 6); lights.push({ x, y, r: 150, k: 0.85 * fl(t.x), c: lightRGB(this.area.light) }); }
    for (const p of Object.values(this.players)) { const [x, y] = view(p.x, p.y - 14); lights.push({ x, y, r: 92, k: p.down ? 0.25 : 0.42, c: LANTERN }); }
    for (const pr of this.projs) { const [x, y] = view(pr.x, pr.y - pr.z); lights.push({ x, y, r: pr.kind === "rocket" ? 70 : 46, k: 0.7, c: pr.kind === "bullet" ? lightRGB("#ffd23c") : WARM }); }
    if (this.view.portal) { const [x, y] = view(this.view.portal.x, this.view.portal.y); lights.push({ x, y, r: 130, k: 1.1, c: lightRGB("#c684ff") }); }
    for (const l of this.lightsExtra) { const [x, y] = view(l.x, l.y); lights.push({ ...l, x, y }); l.t -= 1 / 60; }
    this.lightsExtra = this.lightsExtra.filter((l) => l.t > 0);
    const amb = this.area.ambient;
    const hurt = S.hurt * 0.35;
    const downed = me?.down ? 0.75 : 0;
    this.post.render(f, o, lights, { ambient: amb, zoom: S.zoom, flash: S.flash, tilt: 1, desat: downed, tint: [1 + hurt, 1 - hurt * 0.6, 1 - hurt * 0.6], bloom: 1 }, rt);
  }
  drawPlayer(f, o, p, rt) {
    let pose;
    if (p.down) pose = DOWN_POSE;
    else if (p.dashT > 0) pose = DASH_POSE;
    else if (p.act) pose = actionPose(p.act) ?? movePose(p.cls, p.walk, false, p.aim, p.face);
    else if (p.hurtT > 0) pose = { ...HURT_POSE, weapon: STANCE[p.cls].weapon, two: STANCE[p.cls].two, sa: STANCE[p.cls].sa };
    else pose = movePose(p.cls, p.walk, p.moving, p.aim, p.face);
    const map = this.maps[p.cls];
    for (const t of p.trail) drawRig(f, t.pose, t.x, t.y, { map, flip: t.face < 0, tint: hex(p.color), tintK: 0.7, alpha: t.t * 3 });
    const blink = p.inv > 0 && !p.dashT && Math.floor(rt * 20) % 2 === 0 && !p.shield;
    drawRing(f, p.x, p.y, 10, 4, p.color, rt);
    if (!blink) drawRig(f, pose, p.x, p.y, { map, flip: p.face < 0, flash: p.flash, rim: p.color, ...(p.down ? { tint: hex("#3a3046"), tintK: 0.5 } : {}) });
    // 名前（P1..P4）と蘇生ゲージ
    const pc = hex(p.color), tag = "P" + (p.slot + 1);
    const pt = painter(o);
    pt.text(tag, p.x, p.y - 48, pc, { align: "center", outline: hex("#0b0a10") });
    if (p.down) {
      const u = p.reviveT / PLAYER.reviveTime;
      for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2 - Math.PI / 2; pt.px(p.x + Math.cos(a) * 14, p.y - 20 + Math.sin(a) * 14, i / 24 < u ? hex("#7ee88a") : hex("#2c2238")); }
      pt.text("HELP", p.x, p.y - 56, hex("#ff5a50"), { align: "center", outline: hex("#0b0a10") });
    }
  }
  drawEnemy(f, o, e, rt) {
    const flash = e.flash > 0 ? (e.flags & F.boss ? 0.45 : 1) : 0, sp = e.flags & F.spawn, tele = e.flags & F.tele, fr = e.flags & F.frozen;
    let tint = null, tk = 0;
    if (e.def.fx !== "rig" && e.flags & F.burn) { tint = hex("#ff8a2a"); tk = 0.25 + 0.2 * Math.sin(rt * 25 + e.id); }
    if (e.flags & F.elite) drawRing(f, e.x, e.y, e.r + 8, (e.r + 8) * 0.4, "#ff3b30", -rt);
    if (fr) { tint = hex("#9bdcff"); tk = 0.55; } else if (e.flags & F.chill) { tint = hex("#58b4ec"); tk = 0.3; }
    else if (tele) { tint = hex("#ff3b30"); tk = 0.25 + 0.25 * Math.sin(rt * 40); } else if (e.flags & F.shock) { tint = hex("#fff08a"); tk = Math.sin(rt * 50) > 0 ? 0.35 : 0; }
    const x = e.x + e.kx, y = e.y + e.ky - (e.air ?? 0) - (e.def.fly ? e.def.fly + Math.sin(rt * 3 + e.id) * 2 : 0);
    const alpha = sp ? Math.min(1, (this.time - e.born) / 0.7) : 1;
    if (e.def.fx === "rig") {
      const boss = e.flags & F.boss, k = boss ? 2 : 1;
      let pose = { ...STANCE.blade, weapon: boss ? "greatsword" : "sword" };
      if (tele) pose = { ...pose, crouch: 4, lean: -4, fx: -7, fy: -35, sa: -2.65, bx: 9, by: -25, armsFront: true };
      else if (e.dash) pose = { ...DASH_POSE, weapon: pose.weapon };
      else { const s = Math.sin(rt * 8 + e.id); pose = { ...pose, ffx: 2 + s * 5, fbx: -2 - s * 5, crouch: 3 + Math.abs(s) }; }
      drawRig(f, pose, x, y, { map: boss ? this.maps.knight : this.maps.skel, flip: e.face < 0, flash, tint, tintK: tk, k, alpha });
    } else if (e.fx) {
      const m = e.fx.meta, key = m.size.join("x");
      let s = this.scratch.get(key);
      if (!s) this.scratch.set(key, (s = mkFrame(m.size[0], m.size[1])));
      clearFrame(s);
      e.fx.options.x = m.origin[0]; e.fx.options.y = m.origin[1]; e.fx.options.flip = e.face < 0;
      e.fx.draw(s);
      const k = e.k, oy = e.def.fly ? m.origin[1] * 0.5 : 0;
      const tf = flash >= 1 ? (c) => (c & 0xff000000) | 0xffffff : flash ? (c) => mix(c, 0xffffffff, flash) : tint ? (c) => mix(c, tint, tk) : null;
      if (alpha < 1) for (let i = 0; i < s.color.length; i++) if (((i * 7) % 10) / 10 > alpha) s.color[i] = 0;
      blit(s, f, x - m.origin[0] * k - f.ox, y - (m.origin[1] - oy) * k - f.oy - oy, k, k, tf);
      if (e.type === "slimeKing") this.drawCrown(f, x, y - 50 + Math.sin(rt * 6) * 1.5);
    }
    // 小さなHPバー（ボスはUI側）
    if (!(e.flags & F.boss) && e.hp < 0.999) {
      const pt = painter(o), w = e.flags & F.elite ? 24 : 14, bx = Math.round(e.x - w / 2), by = Math.round(e.y - (e.def.h ?? 20) - 8 - (e.def.fly ?? 0));
      pt.rect(bx - 1, by - 1, w + 2, 4, hex("#0b0a10"));
      pt.rect(bx, by, Math.max(1, Math.round(w * e.hp)), 2, e.flags & F.elite ? hex("#ff9a2a") : hex("#ff4a5a"));
    }
    if (e.flags & F.holy) painter(o).text("+", e.x, e.y - (e.def.h ?? 20) - 16, hex("#ffd84a"), { align: "center" });
  }
  drawArrows(o, rt) {
    const pt = painter(o), red = hex("#ff5a50"), cx = o.ox + VIEW_W / 2, cy = o.oy + VIEW_H / 2;
    for (const e of this.view.enemies.values()) {
      const sx = e.x - o.ox, sy = e.y - 10 - o.oy;
      if (sx > 8 && sx < VIEW_W - 8 && sy > 8 && sy < VIEW_H - 8) continue;
      const a = Math.atan2(e.y - cy, e.x - cx), k = Math.min((VIEW_W / 2 - 14) / Math.abs(Math.cos(a) || 1e-3), (VIEW_H / 2 - 14) / Math.abs(Math.sin(a) || 1e-3));
      const x = cx + Math.cos(a) * k, y = cy + Math.sin(a) * k, b = 1 + Math.sin(rt * 10) * 1.5;
      const tip = [x + Math.cos(a) * (6 + b), y + Math.sin(a) * (6 + b)], l = [x + Math.cos(a + 2.5) * 6, y + Math.sin(a + 2.5) * 6], r = [x + Math.cos(a - 2.5) * 6, y + Math.sin(a - 2.5) * 6];
      pt.poly([tip, l, r], red);
      pt.glow(x, y, 10, red, 0.4);
    }
  }
  drawCrown(f, x, y) {
    const rows = ["g..g..g", "gg.g.gg", "ggrgbgg", "ggggggg", "hhhhhhh"];
    const pt = painter(f);
    pt.sprite(rows, { g: "#f0b424", r: "#ff3b30", b: "#3cc8ff", h: "#86520c" }, Math.round(x - 7), Math.round(y - 5), { scale: 2 });
    pt.rect(Math.round(x - 7), Math.round(y - 5), 2, 2, hex("#fff6c4"));
    pt.glow(x, y, 14, hex("#ffe066"), 0.35);
  }
  drawPickup(f, k, rt) {
    const y = k.y - (k.z ?? 0) - 4 - Math.sin(rt * 5 + k.id) * 1.5;
    const pt = painter(f);
    if (k.kind === PK.coin) {
      const ph = Math.floor((rt * 10 + k.id) % 4), w = [3, 2, 1, 2][ph];
      const G = PAL.gold.map(hex);
      pt.rect(Math.round(k.x - w), Math.round(y - 3), w * 2 + 1, 6, G[4]);
      pt.rect(Math.round(k.x - w), Math.round(y - 3), 1, 6, G[6]);
      pt.px(Math.round(k.x), Math.round(y - 2), G[7]);
      pt.glow(k.x, y, 6, G[5], 0.35);
      drawShadow(f, k.x, k.y, 3, 1.2, 0.4);
    } else {
      const H = PAL.blood.map(hex);
      const heart = [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."];
      pt.sprite(heart, { "#": "#ff5a50" }, Math.round(k.x - 3), Math.round(y - 6));
      pt.px(Math.round(k.x - 2), Math.round(y - 5), hex("#ffd8cc"));
      pt.glow(k.x, y - 3, 12, H[5], 0.5);
    }
  }
  drawShots(f, rt) {
    const pt = painter(f);
    const STY = { fire: PAL.fire, ice: PAL.ice, arcane: PAL.arcane, acid: PAL.poison, void: PAL.shadow, none: PAL.blood };
    for (const h of this.view.hazards.values()) {
      if (h.kind !== HZ.shot) continue;
      const R = (STY[h.style] ?? PAL.blood).map(hex), x = h.x, y = h.y - 12, n = R.length;
      const sp = Math.hypot(h.vx, h.vy) || 1, ux = h.vx / sp, uy = h.vy / sp;
      for (let i = 4; i >= 1; i--) pt.disc(x - ux * i * 3, y - uy * i * 3, 3.5 - i * 0.6, R[Math.max(1, n - 3 - i)], 0.6);
      pt.circle(x, y, h.r - 0.5, R[Math.floor(n * 0.55)]);
      pt.circle(x, y, h.r - 2, R[n - 2]);
      pt.circle(x - 1, y - 1, 1.2, R[n - 1]);
      pt.ring(x, y, h.r + 0.5, 1, hex("#0b0a10"), 0.9);
      pt.glow(x, y, 16, R[n - 2], 0.55);
      drawShadow(f, h.x, h.y, 4, 1.5, 0.35);
    }
  }
  drawTelegraphs(f) {
    const pt = painter(f), red = hex("#ff3b30"), dark = hex("#5a0a14");
    for (const h of this.view.hazards.values()) {
      if (h.kind === HZ.shot) continue;
      const pre = h.delay > 0, total = 1, u = pre ? Math.max(0, 1 - h.delay / Math.max(0.3, (h.delay + (h.age ?? 0)))) : 1;
      if (h.kind === HZ.zone) {
        pt.each(h.x - h.r, h.y - h.r, h.x + h.r, h.y + h.r, (lx, ly, sx, sy) => {
          const d = Math.hypot(lx - h.x, (ly - h.y) * 1.3) / h.r;
          if (d > 1) return;
          if (d > 0.92) pt.put(sx, sy, red, 0.95);
          else if (d < u) pt.put(sx, sy, pre ? dark : red, pre ? 0.5 : 0.8);
        });
        pt.glow(h.x, h.y, h.r, red, pre ? 0.12 + u * 0.15 : 0.5);
      } else if (h.kind === HZ.arc) {
        pt.each(h.x - h.r, h.y - h.r, h.x + h.r, h.y + h.r, (lx, ly, sx, sy) => {
          const dx = lx - h.x, dy = (ly - h.y) * 1.3, d = Math.hypot(dx, dy);
          if (d > h.r || d < 6) return;
          const da = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - h.a), Math.cos(Math.atan2(dy, dx) - h.a)));
          if (da > h.spread / 2) return;
          if (d > h.r - 2) pt.put(sx, sy, red, 0.9);
          else if (d / h.r < u) pt.put(sx, sy, pre ? dark : red, pre ? 0.45 : 0.8);
        });
      } else if (h.kind === HZ.ring) {
        pt.each(h.x - h.r - 6, h.y - h.r - 6, h.x + h.r + 6, h.y + h.r + 6, (lx, ly, sx, sy) => {
          const d = Math.hypot(lx - h.x, (ly - h.y) * 1.3);
          if (Math.abs(d - h.r) < 4) pt.put(sx, sy, hex("#a6f06a"), 0.8);
        });
        pt.glowRing(h.x, h.y, h.r, 8, hex("#a6f06a"), 0.4);
      }
    }
  }
  drawPortalGlow(f) {
    const p = this.view.portal, pt = painter(f), c = hex("#c684ff");
    pt.each(p.x - 30, p.y - 14, p.x + 30, p.y + 14, (lx, ly, sx, sy) => {
      const d = Math.hypot(lx - p.x, (ly - p.y) * 2.1) / 30;
      if (d < 1 && d > 0.85) pt.put(sx, sy, c, 0.8);
    });
  }
  drawBolt(f, b) {
    const pt = painter(f), c = hex("#c8f0ff"), n = 8;
    let px = b.x0, py = b.y0;
    for (let i = 1; i <= n; i++) {
      const u = i / n, x = b.x0 + (b.x1 - b.x0) * u + (i < n ? (Math.random() - 0.5) * 10 : 0), y = b.y0 + (b.y1 - b.y0) * u + (i < n ? (Math.random() - 0.5) * 10 : 0);
      pt.line(px, py, x, y, hex("#ffffff")); pt.glowLine(px, py, x, y, 7, c, 0.6);
      px = x; py = y;
    }
  }
}

import { Painter } from "../vendor/pixelfx/src/core/painter.js";
const painters = new WeakMap();
function painter(frame) {
  let p = painters.get(frame);
  if (!p) painters.set(frame, (p = new Painter(frame)));
  p.reset();
  return p;
}
function elName(el) {
  if (el & EL.burn) return "burn";
  if (el & EL.chill) return "chill";
  if (el & EL.shock) return "shock";
  if (el & EL.holy) return "holy";
  return "white";
}
