// pixelfx のエフェクトをゲーム内で再生する。ネットワーク越しには「名前 + 位置 + オプション」だけ送れば、
// どの画面でも同じエフェクトが出る。
import { createFx, createFrame, clearFrame } from "../vendor/pixelfx/src/core/fx.js";
import { PAL } from "../vendor/pixelfx/src/core/color.js";

const IDS = [
  "melee/sword-slash", "melee/double-slash", "melee/heavy-cleave", "melee/spin-slash", "melee/hammer-smash", "melee/claw-swipe", "melee/thrust",
  "fire/fireball", "fire/meteor", "fire/torch", "fire/brazier", "fire/flame-pillar", "fire/fire-ring",
  "ice/frost-nova", "ice/ice-shatter", "ice/ice-lance", "ice/snowflake-burst", "ice/ice-spikes",
  "lightning/lightning-strike", "lightning/zap-hit", "lightning/chain-lightning", "lightning/spark-arc", "lightning/thunderclap",
  "projectiles/bullet-tracer", "projectiles/muzzle-pistol", "projectiles/rocket", "projectiles/magic-missile", "projectiles/plasma-shot", "projectiles/energy-disc",
  "impacts/hit-spark", "impacts/crit-hit", "impacts/blunt-hit", "impacts/bullet-impact", "impacts/ground-slam", "impacts/heavy-landing", "impacts/impact-frame", "impacts/parry",
  "explosions/small-explosion", "explosions/big-explosion", "explosions/plasma-explosion", "explosions/cartoon-pow", "explosions/dirt-explosion", "explosions/implosion", "explosions/firework-burst",
  "holy/heal-aoe", "holy/heal", "holy/holy-pillar", "holy/divine-shield", "holy/smite", "holy/resurrection", "holy/feather-burst", "holy/blessing",
  "shadow/void-orb", "shadow/dark-explosion", "shadow/necro-skulls", "shadow/curse",
  "nature/acid-splash", "nature/earth-spike", "nature/poison-cloud", "nature/spore-burst",
  "water/splash", "water/fountain",
  "arcane/portal", "arcane/magic-circle-cast", "arcane/mana-burst", "arcane/blink-in", "arcane/blink-out", "arcane/rune-circle", "arcane/star-fall",
  "spawn/poof", "spawn/shatter-death", "spawn/dissolve-burn", "spawn/soul-rise", "spawn/spawn-portal", "spawn/summon-rise", "spawn/coin-drop", "spawn/respawn-beam",
  "pickups/coin-spin", "pickups/heart-pickup", "pickups/collect-burst", "pickups/chest-open", "pickups/gem-spin", "pickups/xp-orb", "pickups/loot-beam", "pickups/power-star",
  "status/burning", "status/frozen", "status/stunned", "status/haste", "status/rage",
  "ui/damage-number", "ui/crit-number", "ui/combo-counter", "ui/level-up", "ui/quest-complete", "ui/confetti", "ui/achievement", "ui/exclamation",
  "critters/slime", "critters/bat", "critters/flying-skull", "critters/ghost", "critters/wisp", "critters/frog", "critters/eyeball", "critters/jellyfish", "critters/snake", "critters/butterfly",
  "weather/snow", "weather/fireflies", "weather/fog", "weather/god-rays", "weather/aurora", "weather/shooting-stars", "weather/falling-leaves",
  "transitions/iris", "transitions/diamond-wipe", "transitions/star-iris", "transitions/pixel-dissolve",
  "scifi/force-field",
];
export const MODS = {};
export async function loadFx(onProgress) {
  // 同時に読み込みすぎると落ちるサーバーがあるので、8本ずつ・失敗したら再試行
  let done = 0, next = 0;
  const one = async (id) => {
    for (let k = 0; ; k++) {
      try { MODS[id] = await import(`../vendor/pixelfx/src/fx/${id}.js`); break; }
      catch (e) { if (k >= 3) throw e; await new Promise((r) => setTimeout(r, 300 * (k + 1))); }
    }
    onProgress?.(++done / IDS.length);
  };
  const worker = async () => { while (next < IDS.length) await one(IDS[next++]); };
  await Promise.all(Array.from({ length: 8 }, worker));
}

// 元素ごとのダメージ数字の色
export const NUM_PAL = {
  none: ["#1a0508", "#4a0b12", "#8c1420", "#d42a2e", "#ff5a4a", "#ff9a86", "#ffd8cc", "#ffffff"],
  white: ["#1c1c24", "#42424f", "#7d7d8c", "#a4a4b2", "#d0d0da", "#e8e8f0", "#f4f4fa", "#ffffff"],
  burn: PAL.fire, chill: PAL.ice, shock: PAL.volt, holy: PAL.holy, heal: PAL.heal, arcane: PAL.arcane, poison: PAL.poison,
};

/**
 * 再生中のエフェクトの一覧。layer: "world"（照明あり）か "overlay"（UI、照明なし）。
 * follow: 毎フレーム位置を返す関数（敵に付く状態異常など）
 */
export class FxManager {
  constructor() {
    this.list = [];
    this.scratch = new Map();
  }
  spawn(id, o = {}, ex = {}) {
    const mod = MODS[id];
    if (!mod) { console.warn("fx?", id); return null; }
    const fx = createFx(mod, o);
    if (ex.skip) fx.update(ex.skip);
    const it = { id, fx, layer: ex.layer ?? "world", follow: ex.follow, life: ex.life ?? Infinity, age: 0, y: o.y ?? 0, scale: ex.scale ?? 1, screen: ex.screen };
    this.list.push(it);
    return it;
  }
  update(dt) {
    for (const it of this.list) {
      it.fx.update(dt);
      it.age += dt;
      if (it.age > it.life) it.fx.stop();
      if (it.follow) {
        const p = it.follow();
        if (!p) it.fx.stop();
        else { it.fx.options.x = p.x; it.fx.options.y = p.y; if (p.flip !== undefined) it.fx.options.flip = p.flip; }
      }
    }
    this.list = this.list.filter((it) => !it.fx.done());
  }
  draw(frame, layer, part) {
    for (const it of this.list) {
      if (it.layer !== layer) continue;
      if (it.scale !== 1 || it.screen) this.drawScaled(frame, it, part);
      else it.fx.draw(frame, part);
    }
  }
  // 小さいフレームに描いてから拡大して貼る（画面全体の天候・トランジション、ボスなど）
  drawScaled(frame, it, part) {
    const m = it.fx.meta, [w, h] = m.size, key = w + "x" + h;
    let s = this.scratch.get(key);
    if (!s) this.scratch.set(key, (s = createFrame(w, h)));
    clearFrame(s);
    const ox = it.fx.options.x, oy = it.fx.options.y;
    if (it.screen) { it.fx.options.x = m.origin[0]; it.fx.options.y = m.origin[1]; }
    else { it.fx.options.x = m.origin[0]; it.fx.options.y = m.origin[1]; }
    it.fx.draw(s, part);
    it.fx.options.x = ox; it.fx.options.y = oy;
    const k = it.screen ? frame.w / w : it.scale;
    const bx = it.screen ? 0 : ox - m.origin[0] * k - frame.ox, by = it.screen ? 0 : oy - m.origin[1] * k - frame.oy;
    blit(s, frame, bx, by, k, it.screen ? frame.h / h : k);
  }
}

/** 小さいフレームを大きいフレームへ（拡大・色はそのまま、光は加算） */
export function blit(src, dst, bx, by, kx, ky = kx, tint) {
  const W = dst.w, H = dst.h;
  const x0 = Math.max(0, Math.floor(bx)), y0 = Math.max(0, Math.floor(by));
  const x1 = Math.min(W, Math.ceil(bx + src.w * kx)), y1 = Math.min(H, Math.ceil(by + src.h * ky));
  for (let y = y0; y < y1; y++) {
    const sy = Math.floor((y - by) / ky);
    if (sy < 0 || sy >= src.h) continue;
    for (let x = x0; x < x1; x++) {
      const sx = Math.floor((x - bx) / kx);
      if (sx < 0 || sx >= src.w) continue;
      const si = sy * src.w + sx, di = y * W + x, c = src.color[si];
      if (c) {
        const a = c >>> 24;
        if (a === 255) dst.color[di] = tint ? tint(c) : c;
        else if (a > 0) {
          const d = dst.color[di], k = a / 255;
          const r = (c & 255) * k + (d & 255) * (1 - k), g = ((c >>> 8) & 255) * k + ((d >>> 8) & 255) * (1 - k), b = ((c >>> 16) & 255) * k + ((d >>> 16) & 255) * (1 - k);
          const da = d >>> 24, oa = Math.max(a, da);
          dst.color[di] = (oa << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
        }
      }
      const l = src.light[si];
      if (l & 0xffffff) {
        const d = dst.light[di];
        const r = Math.min(255, (d & 255) + (l & 255)), g = Math.min(255, ((d >>> 8) & 255) + ((l >>> 8) & 255)), b = Math.min(255, ((d >>> 16) & 255) + ((l >>> 16) & 255));
        dst.light[di] = (255 << 24) | (b << 16) | (g << 8) | r;
      }
    }
  }
}
