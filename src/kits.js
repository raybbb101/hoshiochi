// 4職業の技。ポーズは pixelfx の技（act）の骨格アニメをそのまま借り、ゲームの速さに合わせて時間を縮める。
import { poseAt } from "../vendor/pixelfx/src/core/act.js";
import { READY } from "../vendor/pixelfx/src/core/poses.js";
import { PAL } from "../vendor/pixelfx/src/core/color.js";
import { MODS } from "./fx.js";
import { CLASSES, JUICE } from "./data.js";
import { EL } from "./world.js";

let A = null;
const track = (id) => MODS[id].act.poses;

// 職業ごとの構え
export const STANCE = {
  blade: { ...READY, weapon: "sword", fx: 12, fy: -21, sa: -0.85 },
  mage: { ...READY, crouch: 2, fx: 9, fy: -20, bx: 7, by: -19 },
  gunner: { ...READY, weapon: "pistol", sa: 0.9, fx: 10, fy: -17, bx: 7, by: -16 },
  cleric: { ...READY, weapon: "hammer", two: true, sa: 0.62, fx: 11, fy: -21, crouch: 3 },
};
const GUN_AIM = { ...STANCE.gunner, crouch: 3, lean: 2, fx: 18, fy: -28, sa: 0, bx: 12, by: -25, ffx: 11, fbx: -9 };
const GUN_KICK = { ...GUN_AIM, lean: 0, fx: 16, fy: -33, sa: -0.45, by: -28 };
const CAST = { ...STANCE.mage, lean: 3, fx: 19, fy: -27, bx: 4, by: -22, ffx: 10, fbx: -8 };
const CAST_PULL = { ...STANCE.mage, lean: -3, crouch: 3, fx: -4, fy: -24, bx: 10, by: -26 };
const HIGH = { turn: 1.15, crouch: 0, fx: -7, fy: -44, bx: 8, by: -44, ffx: -5, fbx: 6 };
const SLAM = { turn: 1.15, crouch: 8, lean: 3, fx: -9, fy: -8, bx: 11, by: -8, ffx: -8, fbx: 9 };

export function buildActions() {
  A = {
    // track: 骨格アニメ、a0..a1 がその区間、ah が当たる瞬間
    b0: { track: track("melee/sword-slash"), a0: -0.3, ah: 0.06, a1: 0.42 },
    b1: { track: track("melee/double-slash"), a0: -0.12, ah: 0.16, a1: 0.45 },
    b2: { track: track("melee/heavy-cleave"), a0: -0.32, ah: 0.335, a1: 0.85, over: { weapon: "sword" } },
    bs: { track: track("melee/spin-slash"), a0: -0.2, ah: 0.0, a1: 0.56 },
    bu: { track: track("melee/heavy-cleave"), a0: -0.62, ah: 0.335, a1: 1.3, over: { weapon: "greatsword" } },
    ca: { track: track("melee/hammer-smash"), a0: -0.44, ah: 0.15, a1: 0.62 },
    cs: { track: [[-0.3, STANCE.cleric], [0, { ...HIGH, weapon: "hammer", sa: -1.6 }], [0.1, { ...SLAM, weapon: "hammer", sa: 0.3 }, "snap"], [0.6, STANCE.cleric]], a0: -0.3, ah: 0.1, a1: 0.6 },
    cu: { track: [[-0.5, STANCE.cleric], [0, { ...HIGH, weapon: "hammer", sa: -1.6, crouch: -2 }], [0.12, { ...SLAM, weapon: "hammer", sa: 0.3 }, "snap"], [0.9, STANCE.cleric]], a0: -0.5, ah: 0.12, a1: 0.9 },
    ma: { track: [[-0.1, CAST_PULL], [0, CAST, "snap"], [0.25, STANCE.mage]], a0: -0.1, ah: 0, a1: 0.25 },
    ms: { track: track("ice/frost-nova"), a0: -0.04, ah: 0.42, a1: 0.95 },
    mu: { track: [[-0.4, STANCE.mage], [0, { ...HIGH, crouch: -1 }], [0.15, { ...CAST, fy: -40, by: -38 }, "snap"], [0.6, STANCE.mage]], a0: -0.4, ah: 0.15, a1: 0.6 },
    ga: { track: [[-0.05, GUN_AIM], [0, GUN_KICK, "snap"], [0.1, GUN_AIM]], a0: -0.05, ah: 0, a1: 0.1 },
    gs: { track: [[-0.15, GUN_AIM], [0, { ...GUN_KICK, lean: -4, fy: -36, sa: -0.8 }, "snap"], [0.3, GUN_AIM]], a0: -0.15, ah: 0, a1: 0.3 },
    gu: { track: [[-0.3, GUN_AIM], [0, { ...GUN_AIM, fy: -44, sa: -1.5, crouch: -1 }], [1.4, { ...GUN_AIM, fy: -44, sa: -1.5 }], [1.6, GUN_AIM]], a0: -0.3, ah: 0, a1: 1.6 },
  };
}

/** 動作中のポーズ */
export function actionPose(act) {
  const d = A[act.name];
  if (!d) return null;
  const { t, hitT, dur } = act;
  const at = t < hitT ? d.a0 + (d.ah - d.a0) * (t / hitT) : d.ah + (d.a1 - d.ah) * Math.min(1, (t - hitT) / Math.max(0.01, dur - hitT));
  const p = poseAt(d.track, at);
  return { ...p, ...(d.over ?? {}), x: 0, y: Math.min(0, p.y ?? 0) };
}

/** 移動・待機のポーズ */
export function movePose(cls, phase, moving, aim, face) {
  const base = cls === "gunner" ? GUN_AIM : STANCE[cls];
  if (!moving) {
    const b = Math.sin(phase * 2.2) * 0.8;
    const p = { ...base, crouch: (base.crouch ?? 0) + 1 + b };
    if (cls === "gunner") p.sa = aimSa(aim, face);
    return p;
  }
  const s = Math.sin(phase * 9), c = Math.cos(phase * 9);
  const p = {
    ...base, lean: (base.lean ?? 0) + 3, crouch: (base.crouch ?? 0) + 1.5 + Math.abs(s) * 1.2,
    ffx: 2 + s * 7, ffy: -4 - Math.max(0, c) * 3.5, fbx: -2 - s * 7, fby: -4 - Math.max(0, -c) * 3.5,
  };
  if (cls !== "blade" && cls !== "cleric" && cls !== "gunner") { p.fx = (base.fx ?? 0) - s * 3; p.bx = (base.bx ?? 0) + s * 3; }
  if (cls === "gunner") p.sa = aimSa(aim, face);
  return p;
}
function aimSa(aim, face) {
  // 銃口を狙いの方向へ（画面の上下に±0.9まで）
  const a = face > 0 ? aim : Math.PI - aim;
  let r = Math.atan2(Math.sin(a), Math.cos(a));
  return Math.max(-0.9, Math.min(0.9, r));
}
export const DASH_POSE = { ...READY, lean: 9, crouch: 5, fx: -8, fy: -20, bx: -10, by: -18, ffx: 10, ffy: -6, fbx: -10, fby: -3, ghost: 1 };
export const DOWN_POSE = { ...READY, crouch: 13, lean: 13, fx: 12, fy: -3, bx: 14, by: -3, ffx: 4, fbx: -9 };
export const HURT_POSE = { ...READY, crouch: 4, lean: -6, fx: -4, fy: -24, bx: -2, by: -26 };

// ---- 技の中身
// g: Game、p: 自分のプレイヤー
const sinCos = (a) => [Math.cos(a), Math.sin(a)];
const clampAngle = (a, face) => {
  // 近接エフェクトは左右向き。上下への角度は少しだけつける
  const rel = face > 0 ? a : Math.PI - a;
  const r = Math.atan2(Math.sin(rel), Math.cos(rel));
  return Math.max(-0.55, Math.min(0.55, r)) * (face > 0 ? 1 : -1);
};

export const KITS = {
  blade: {
    attack(g, p) {
      const C = CLASSES.blade.atk, st = p.stats;
      const step = p.comboT > 0 ? (p.comboStep + 1) % 3 : 0;
      const dur = (C.rate / st.aspd) * (step === 2 ? 1.6 : 1);
      g.startAct(p, "b" + step, dur, dur * (step === 2 ? 0.42 : 0.3), () => {
        const fin = step === 2, ang = clampAngle(p.aim, p.face);
        const id = ["melee/sword-slash", "melee/double-slash", "melee/heavy-cleave"][step];
        g.castFx(id, { x: p.x | 0, y: p.y | 0, flip: p.face < 0, angle: ang * 0.6, seed: 1 + step + (p.atkCount % 4) * 3, radius: 42 * st.area }, { skip: fin ? 0.3 : step === 1 ? 0.04 : 0.02 });
        g.castSfx(fin ? "heavy" : "slash");
        const hits = g.meleeHits(p, C.range * st.area * (fin ? 1.2 : 1), C.arc, p.aim);
        g.deal(p, hits, { base: C.combo[step], heavy: fin, kb: fin ? 260 : 120, basic: true, finisher: fin });
        if (st.multi > 0) g.wave(p, C.combo[step] * 0.5 * st.multi, fin);
        p.vx += Math.cos(p.aim) * (fin ? 140 : 70); p.vy += Math.sin(p.aim) * (fin ? 90 : 45);
        if (fin) g.shake(2);
      });
      p.comboStep = step; p.comboT = C.comboWindow + dur;
    },
    skill(g, p) {
      const S = CLASSES.blade.skill, st = p.stats;
      g.startAct(p, "bs", 0.5, 0.1, () => {
        g.castFx("melee/spin-slash", { x: p.x | 0, y: p.y | 0, flip: p.face < 0, seed: 3, radius: 46 * st.area }, { skip: 0 });
        g.castSfx("heavy");
        for (let i = 0; i < S.hits; i++) g.later(i * 0.13, () => {
          g.deal(p, g.enemiesInRadius(p.x, p.y, S.radius * st.area), { base: S.dmg, kb: 180, from: p });
          if (i) g.castSfx("slash");
        });
      });
    },
    ult(g, p) {
      const U = CLASSES.blade.ult, st = p.stats;
      g.ultIntro(p);
      g.startAct(p, "bu", 1.0, 0.5, () => {
        const [cx, cy] = sinCos(p.aim), x = p.x + cx * 40, y = p.y + cy * 26;
        g.castFx("melee/heavy-cleave", { x: p.x | 0, y: p.y | 0, flip: p.face < 0, seed: 9, palette: PAL.gold }, { skip: 0.3 });
        g.castFx("impacts/ground-slam", { x: x | 0, y: y | 0, seed: 4, reach: 110 * st.area, palette: PAL.holy });
        g.castFx("arcane/star-fall", { x: x | 0, y: y | 0, seed: 2 }, { skip: 0.2 });
        g.castSfx("bigboom");
        g.shake(JUICE.shake.ult); g.flash(0.35); g.hitstop(JUICE.hitstop.ult);
        g.deal(p, g.enemiesInRadius(x, y, U.radius * st.area), { base: U.dmg, heavy: true, kb: 380, ult: true, from: { x, y } });
      });
    },
  },
  mage: {
    attack(g, p) {
      const C = CLASSES.mage.atk, st = p.stats, dur = C.rate / st.aspd;
      g.startAct(p, "ma", dur, dur * 0.3, () => {
        const n = 1 + st.multi;
        for (let i = 0; i < n; i++) {
          const a = p.aim + (i - (n - 1) / 2) * 0.16;
          g.addProj(p, { kind: "fireball", a, speed: C.speed, dmg: C.dmg, life: C.life, r: 7, el: EL.burn, splash: C.splash * st.area, splashK: C.splashK, basic: true });
        }
        g.castSfx("fireball");
      });
    },
    skill(g, p) {
      const S = CLASSES.mage.skill, st = p.stats;
      g.startAct(p, "ms", 0.55, 0.2, () => {
        g.castFx("ice/frost-nova", { x: p.x | 0, y: p.y | 0, seed: 4, reach: 104 * st.area }, { skip: 0.42 });
        g.castSfx("ice");
        g.later(0.18, () => g.deal(p, g.enemiesInRadius(p.x, p.y, S.radius * st.area), { base: S.dmg, el: EL.chill, freeze: S.freeze, kb: 200, from: p }));
        g.shake(3);
      });
    },
    ult(g, p) {
      const U = CLASSES.mage.ult, st = p.stats;
      g.ultIntro(p);
      const tgt = g.aimPoint(p, 220);
      g.startAct(p, "mu", 0.6, 0.2, () => {
        g.castFx("fire/meteor", { x: tgt.x | 0, y: tgt.y | 0, seed: 9, size: 1 }, {});
        g.castFx("arcane/magic-circle-cast", { x: tgt.x | 0, y: tgt.y | 0, seed: 2, palette: PAL.fire }, { skip: 1.4, life: 0.6 });
        g.later(0.62, () => {
          g.castSfx("bigboom"); g.shake(JUICE.shake.ult); g.flash(0.3); g.hitstop(JUICE.hitstop.ult);
          g.deal(p, g.enemiesInRadius(tgt.x, tgt.y, U.radius * st.area), { base: U.dmg, el: EL.burn, heavy: true, kb: 340, ult: true, from: tgt });
        });
      });
    },
  },
  gunner: {
    attack(g, p) {
      const C = CLASSES.gunner.atk, st = p.stats, dur = C.rate / st.aspd;
      g.startAct(p, "ga", dur, 0.001, () => {
        const n = 1 + st.multi;
        for (let i = 0; i < n; i++) {
          const a = p.aim + (i - (n - 1) / 2) * 0.12 + (Math.random() - 0.5) * C.spread * 2;
          g.addProj(p, { kind: "bullet", a, speed: C.speed, dmg: C.dmg, life: C.life, r: 5, basic: true });
        }
        if (p.atkCount % 4 === 0) g.castFx("projectiles/muzzle-pistol", { x: (p.x + p.face * 6) | 0, y: p.y | 0, flip: p.face < 0, seed: 3, angle: 0 }, { skip: 0.02, life: 0.4 });
        g.castSfx("shot");
        g.muzzle(p);
      });
    },
    skill(g, p) {
      const S = CLASSES.gunner.skill;
      g.startAct(p, "gs", 0.3, 0.05, () => {
        g.addProj(p, { kind: "rocket", a: p.aim, speed: S.speed, dmg: S.dmg, life: 1.4, r: 8, explode: S.radius * p.stats.area, heavy: true });
        g.castSfx("fireball"); g.shake(1.5);
        p.vx -= Math.cos(p.aim) * 90; p.vy -= Math.sin(p.aim) * 60;
      });
    },
    ult(g, p) {
      const U = CLASSES.gunner.ult, st = p.stats;
      g.ultIntro(p);
      g.startAct(p, "gu", 1.7, 0.2, () => {
        g.castFx("lightning/charge-up" in MODS ? "lightning/charge-up" : "lightning/thunderclap", { x: p.x | 0, y: p.y | 0, seed: 2 }, { life: 1.2 });
        const n = U.strikes + st.multi * 2;
        for (let i = 0; i < n; i++) g.later(i * 0.13, () => {
          const list = g.enemiesInRadius(p.x, p.y, 260).sort(() => Math.random() - 0.5);
          const e = list[0];
          const x = e ? e.x : p.x + (Math.random() - 0.5) * 200, y = e ? e.y : p.y + (Math.random() - 0.5) * 120;
          g.castFx("lightning/lightning-strike", { x: x | 0, y: y | 0, seed: i + 1, light: 0.55 }, { skip: 0.7 });
          g.later(0.06, () => {
            g.castSfx("thunder"); g.shake(3.5); if (i % 4 === 0) g.flash(0.1);
            g.deal(p, g.enemiesInRadius(x, y, U.radius * st.area), { base: U.dmg, el: EL.shock, kb: 120, ult: true, from: { x, y } });
          });
        });
      });
    },
  },
  cleric: {
    attack(g, p) {
      const C = CLASSES.cleric.atk, st = p.stats, dur = C.rate / st.aspd;
      g.startAct(p, "ca", dur, dur * 0.45, () => {
        const [cx, cy] = sinCos(p.aim), x = p.x + cx * 26, y = p.y + cy * 16;
        g.castFx("melee/hammer-smash", { x: p.x | 0, y: p.y | 0, flip: p.face < 0, seed: 2 + (p.atkCount % 3), palette: PAL.holy }, { skip: 0.14, life: 0.9 });
        g.castSfx("hit2");
        const hits = g.meleeHits(p, C.range * st.area, C.arc, p.aim);
        g.deal(p, hits, { base: C.dmg, heavy: true, kb: 200, basic: true });
        if (hits.length) g.healAllies(p, 70, C.healAllies * hits.length, false);
        if (st.multi > 0) g.wave(p, C.dmg * 0.5 * st.multi, true);
        g.shake(1.4);
      });
    },
    skill(g, p) {
      const S = CLASSES.cleric.skill, st = p.stats;
      g.startAct(p, "cs", 0.5, 0.18, () => {
        g.castFx("holy/heal-aoe", { x: p.x | 0, y: p.y | 0, seed: 6, reach: 104 * st.area }, { skip: 0.3 });
        g.castSfx("heal");
        g.healAllies(p, S.radius * st.area, S.heal, true);
        g.deal(p, g.enemiesInRadius(p.x, p.y, S.radius * st.area), { base: S.dmg, el: EL.holy, kb: 160, from: p });
      });
    },
    ult(g, p) {
      const U = CLASSES.cleric.ult, st = p.stats;
      g.ultIntro(p);
      g.startAct(p, "cu", 1.0, 0.45, () => {
        g.castFx("holy/holy-pillar", { x: p.x | 0, y: p.y | 0, seed: 3, shafts: 9 }, { skip: 0.3 });
        g.later(0.36, () => {
          g.castSfx("holy"); g.castSfx("bigboom"); g.shake(JUICE.shake.ult); g.flash(0.4); g.hitstop(JUICE.hitstop.ult);
          g.deal(p, g.enemiesInRadius(p.x, p.y, U.radius * st.area), { base: U.dmg, el: EL.holy, heavy: true, kb: 300, ult: true, from: p });
          g.shieldAll(U.shield, p, U.radius * 1.4);
        });
      });
    },
  },
};
