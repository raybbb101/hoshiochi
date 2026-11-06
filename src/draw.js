// キャラ・影・部屋の背景を pixelfx のフレームに描く
import { hex, mix, scale, PAL } from "../vendor/pixelfx/src/core/color.js";
import { posed } from "../vendor/pixelfx/src/core/rig.js";
import { DUMMY_PAL } from "../vendor/pixelfx/src/core/actor.js";
import { ROOM_W, ROOM_H, WALL_H } from "./data.js";

const WHITE = hex("#ffffff");

// ---- 乱数（シード付き）
export function rng(seed) {
  let s = seed >>> 0 || 1;
  const f = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a, b) => a + (b - a) * f();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  return f;
}

// ---- 色の置き換え表（ダミーの灰色 → 職業の色）
export function recolorMap(colors) {
  const m = new Map();
  for (const [k, v] of Object.entries(DUMMY_PAL)) m.set(hex(v) >>> 0, colors[k] ? hex(colors[k]) : hex(v));
  return m;
}

function putPx(f, x, y, c) {
  x -= f.ox; y -= f.oy;
  if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
  f.color[y * f.w + x] = c;
}
function addLight(f, x, y, c, k) {
  x -= f.ox; y -= f.oy;
  if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
  const i = y * f.w + x, d = f.light[i];
  const r = Math.min(255, (d & 255) + (c & 255) * k) | 0, g = Math.min(255, ((d >>> 8) & 255) + ((c >>> 8) & 255) * k) | 0, b = Math.min(255, ((d >>> 16) & 255) + ((c >>> 16) & 255) * k) | 0;
  f.light[i] = (255 << 24) | (b << 16) | (g << 8) | r;
}

/**
 * 骨格キャラを描く。pose は rig のポーズ、(x, y) は足元。
 * o: { map: 色置き換え, flip, flash (0..1 白く光る), alpha, k (拡大率), rim: 輪郭光の色, ghost }
 */
export function drawRig(f, pose, x, y, o = {}) {
  const r = posed(pose), k = o.k ?? 1, map = o.map, fl = o.flip ? -1 : 1, a = o.alpha ?? 1;
  const X = Math.round(x), Y = Math.round(y + (pose.y ?? 0) * k);
  for (let i = 0; i < r.n; i++) {
    let c = r.color[i] >>> 0;
    if (map && map.has(c)) c = map.get(c);
    if (o.flash > 0) c = mix(c, WHITE, o.flash);
    if (o.tint) c = mix(c, o.tint, o.tintK ?? 0.5);
    if (a < 1 && ((r.xs[i] + r.ys[i]) & 1) && a < 0.6) continue;
    const px = X + r.xs[i] * fl * k, py = Y + r.ys[i] * k;
    if (k === 1) putPx(f, px, py, c);
    else for (let j = 0; j < k * k; j++) putPx(f, px + (j % k) * fl, py + ((j / k) | 0), c);
  }
  if (o.rim) {
    // 足元のふちに光（HD-2D の逆光っぽさ）
    const rc = hex(o.rim);
    for (let i = 0; i < r.n; i++) if (r.ys[i] < -6 && (i % 3 === 0)) addLight(f, X + r.xs[i] * fl * k, Y + r.ys[i] * k, rc, 0.06);
  }
  return r;
}

/** 楕円のやわらかい影（下の色を暗くする） */
export function drawShadow(f, x, y, rx, ry, k = 0.55) {
  const x0 = Math.floor(x - rx), x1 = Math.ceil(x + rx), y0 = Math.floor(y - ry), y1 = Math.ceil(y + ry);
  for (let sy = y0; sy <= y1; sy++)
    for (let sx = x0; sx <= x1; sx++) {
      const dx = (sx + 0.5 - x) / rx, dy = (sy + 0.5 - y) / ry, d = dx * dx + dy * dy;
      if (d > 1) continue;
      const lx = sx - f.ox, ly = sy - f.oy;
      if (lx < 0 || ly < 0 || lx >= f.w || ly >= f.h) continue;
      const i = ly * f.w + lx, c = f.color[i], m = 1 - k * (d < 0.55 ? 1 : 0.55);
      f.color[i] = (c & 0xff000000) | (((((c >>> 16) & 255) * m) & 255) << 16) | (((((c >>> 8) & 255) * m) & 255) << 8) | (((c & 255) * m) & 255);
    }
}

/** 足元のリング（プレイヤー色） */
export function drawRing(f, x, y, rx, ry, color, t) {
  const c = hex(color);
  const n = 28;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + t * 1.5;
    if (i % 4 === 3) continue;
    const px = Math.round(x + Math.cos(a) * rx), py = Math.round(y + Math.sin(a) * ry);
    putPx(f, px, py, c);
    addLight(f, px, py, c, 0.35);
  }
}

// ---- 背景（部屋）
// 床はタイル、奥は高い壁（アーチと燭台）、左右は暗い壁。HD-2D らしく奥ほど暗く、手前ほどタイルが大きい。
export function buildRoom(area, seed, kind) {
  const R = rng(seed), W = ROOM_W, H = ROOM_H, buf = new Uint32Array(W * H);
  const F = area.floor.map(hex), Wl = area.wall.map(hex), S = PAL.stone.map(hex);
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = c; };
  const get = (x, y) => buf[y * W + x];
  // 床の色（暗→明）。壁より明るくして「上から光が当たる床」に見せる
  const FL = {
    crypt: ["#141012", "#2a2422", "#3e3632", "#4e453e", "#605548", "#786a58", "#94846c"],
    frost: ["#0a1228", "#16284a", "#203a64", "#2c4c7e", "#3c6296", "#5a86b8", "#8cb4dc"],
    summit: ["#120c22", "#22183c", "#322452", "#423266", "#54427c", "#6c5896", "#9a84c0"],
  }[area.id].map(hex);
  // 床: 遠近法の敷石。縦の目地は奥の一点へ集まり、横の目地は手前ほど間が広い
  const TW = 34, cx0 = W / 2;
  const rows = [];
  for (let y = WALL_H, r = 0; y < H; r++) { const d = (y - WALL_H) / (H - WALL_H), th = Math.round(12 + d * 12); rows.push([y, th, r]); y += th; }
  for (const [rowY, th, row] of rows) {
    for (let y = rowY; y < Math.min(H, rowY + th); y++) {
      const depth = (y - WALL_H) / (H - WALL_H), s = 0.7 + depth * 0.55, ly = y - rowY;
      for (let x = 0; x < W; x++) {
        const u = (x - cx0) / s + 4000, tx = Math.floor(u / TW), lu = u - tx * TW, lx = lu * s;
        const h = ((tx * 73856093) ^ (row * 19349663) ^ seed) >>> 0, v = (h % 100) / 100, n = ((x * 7 + y * 13 + h) % 23) / 23;
        let tone = 3 + ((tx + row) % 2 === 0 ? 0 : -0) + (v > 0.7 ? 1 : 0) - (v < 0.18 ? 1 : 0);
        if (ly === 0 || lx < 1) tone = 0; // 目地
        else if (ly === 1 || lx < 2) tone += 1; // 石のふち（光）
        else if (ly === th - 1 || lx > TW * s - 1.5) tone -= 1; // 影
        else if (n > 0.94) tone -= 1; // ざらつき
        if (v > 0.88 && ly > 2 && Math.abs(lx - ly * 1.4 - (h % 9)) < 0.7) tone = 1; // ひび
        set(x, y, scale(FL[Math.max(0, Math.min(FL.length - 1, tone))], 0.7 + depth * 0.4));
      }
    }
  }
  // 床の汚れ・水たまり・苔
  for (let i = 0; i < 70; i++) {
    const cx = R.range(20, W - 20), cy = R.range(WALL_H + 10, H - 6), r = R.range(3, 11);
    const tint = area.id === "crypt" ? hex(R() < 0.5 ? "#2a3a24" : "#1a1820") : area.id === "frost" ? hex("#d8f4ff") : hex("#481c88");
    for (let y = -r; y <= r; y++) for (let x = -r * 1.8; x <= r * 1.8; x++) {
      const d = (x * x) / (r * r * 3.24) + (y * y) / (r * r);
      if (d > 1 || ((x + y) & 1 && d > 0.6)) continue;
      const px = Math.round(cx + x), py = Math.round(cy + y);
      if (py < WALL_H || py >= H || px < 0 || px >= W) continue;
      set(px, py, mix(get(px, py), tint, area.id === "frost" ? 0.18 : 0.3));
    }
  }
  // 骨や瓦礫
  for (let i = 0; i < 26; i++) {
    const x = R.int(30, W - 30), y = R.int(WALL_H + 14, H - 8);
    const c = area.id === "crypt" && R() < 0.5 ? hex(PAL.bone[4]) : S[R.int(3, 5)];
    set(x, y, c); set(x + 1, y, scale(c, 0.8)); if (R() < 0.5) set(x, y - 1, scale(c, 1.15));
    set(x, y + 1, S[0]); set(x + 1, y + 1, S[0]);
  }
  // 奥の壁
  const wallTone = (i) => Wl[Math.max(0, Math.min(Wl.length - 1, i))];
  for (let y = 0; y < WALL_H; y++)
    for (let x = 0; x < W; x++) {
      const bh = 8, bw = 16, row = Math.floor(y / bh), off = (row % 2) * 8, lx = (x + off) % bw, ly = y % bh;
      const h = ((Math.floor((x + off) / bw) * 9301) ^ (row * 49297) ^ seed) >>> 0;
      let t = 2 + ((h % 5) === 0 ? 1 : 0) - ((h % 7) === 0 ? 1 : 0);
      if (ly === 0 || lx === 0) t = 0;
      else if (ly === 1) t += 1;
      const fade = y / WALL_H; // 下ほど明るい
      set(x, y, scale(wallTone(t), 0.3 + fade * 0.4));
    }
  // 空の見えるエリア（星海の頂）: 壁の上半分は夜空
  if (area.id === "summit") {
    const N = PAL.night.map(hex);
    for (let y = 0; y < 34; y++) for (let x = 0; x < W; x++) {
      const t = y / 34, c = N[Math.min(N.length - 1, Math.floor(t * N.length + (((x ^ y) & 3) === 0 ? 0.5 : 0)))];
      set(x, y, c);
    }
    for (let i = 0; i < 90; i++) { const x = R.int(0, W - 1), y = R.int(0, 30); set(x, y, R() < 0.2 ? hex("#ffffff") : hex("#a970e0")); }
    // 胸壁
    for (let x = 0; x < W; x++) for (let y = 30; y < 38; y++) if ((x % 24) < 14 || y > 33) set(x, y, wallTone(y === 30 || y === 34 ? 4 : 2));
  }
  // アーチ窓（聖堂はステンドグラス）
  const arches = [];
  for (let ax = 56; ax < W - 40; ax += 116) {
    const aw = 26, top = area.id === "summit" ? 38 : 10, bot = WALL_H - 10;
    arches.push(ax);
    for (let y = top; y < bot; y++) for (let x = -aw / 2; x <= aw / 2; x++) {
      const ry = y - (top + aw / 2);
      if (ry < 0 && x * x + ry * ry > (aw / 2) ** 2) continue;
      const edge = Math.abs(x) > aw / 2 - 2 || (ry < 0 && x * x + ry * ry > (aw / 2 - 2) ** 2);
      let c;
      if (edge) c = wallTone(4);
      else if (area.id === "frost") c = mix(hex(PAL.ice[2 + ((Math.floor(x / 4) + Math.floor(y / 5)) & 3)]), hex(PAL.arcane[4]), ((x * 3 + y) % 11) / 30);
      else if (area.id === "summit") c = hex(PAL.night[1]);
      else c = scale(wallTone(0), 0.6);
      set(Math.round(ax + x), y, c);
    }
  }
  // 壁の付け根: 腰石の段（上面は光、正面は暗い）と床に落ちる影
  for (let x = 0; x < W; x++) {
    set(x, WALL_H - 7, scale(FL[5], 0.9)); set(x, WALL_H - 6, scale(FL[4], 0.8));
    for (let y = WALL_H - 5; y < WALL_H; y++) set(x, y, scale(FL[(x % 24 === 0) ? 0 : 2], 0.55));
    for (let y = WALL_H; y < WALL_H + 7; y++) set(x, y, scale(get(x, y), 0.45 + (y - WALL_H) * 0.08));
  }
  // 左右の壁（暗い縁）
  for (let y = 0; y < H; y++) for (let x = 0; x < 18; x++) {
    const k = 0.25 + x / 18 * 0.4;
    set(x, y, scale(get(x, y), k)); set(W - 1 - x, y, scale(get(W - 1 - x, y), k));
  }
  // 柱（当たり判定あり）。部屋の種類で配置を変える
  const pillars = [];
  const layouts = [
    [[150, 140], [426, 140], [150, 240], [426, 240]],
    [[200, 190], [376, 190]],
    [[110, 135], [466, 135], [288, 230]],
    [[160, 128], [416, 128], [96, 250], [480, 250]],
  ];
  const L = kind === "boss" || kind === "rest" ? [[90, 128], [486, 128]] : layouts[R.int(0, layouts.length - 1)];
  for (const [x, y] of L) pillars.push({ x, y, r: 11 });
  // 燭台（光源）: 壁のアーチの間
  const torches = [];
  for (let i = 0; i < arches.length - 1; i++) torches.push({ x: Math.round((arches[i] + arches[i + 1]) / 2), y: WALL_H - 22 });
  return { buf, pillars, torches, arches };
}

/** 柱: 立体感のある円柱。y は足元 */
export function drawPillar(f, p, area) {
  const S = (area.id === "frost" ? PAL.metal : area.id === "summit" ? PAL.arcane : PAL.stone).map(hex), h = 62, r = p.r;
  drawShadow(f, p.x + 4, p.y + 1, r + 7, 5, 0.5);
  for (let y = -h; y <= 0; y++) {
    const cap = y < -h + 6 || y > -6;
    const rr = cap ? r + 2 : r;
    for (let x = -rr; x <= rr; x++) {
      const u = (x + rr) / (2 * rr); // 0 左 .. 1 右
      let t = u < 0.15 ? 2 : u < 0.4 ? 5 : u < 0.7 ? 4 : u < 0.88 ? 3 : 2;
      if (cap && (y === -h + 5 || y === -5)) t = 1;
      if (!cap && (x === -rr || x === rr)) t = 1;
      if (!cap && x % 5 === 0 && t > 2) t -= 1; // 溝
      putPx(f, Math.round(p.x + x), Math.round(p.y + y), S[Math.min(S.length - 1, t)]);
    }
  }
}

/** 炎のない燭台の台座（火は pixelfx の torch） */
export function drawSconce(f, x, y, area) {
  const M = PAL.metal.map(hex);
  for (let i = -3; i <= 3; i++) putPx(f, x + i, y, M[i === -3 ? 2 : 4]);
  for (let i = 1; i <= 4; i++) putPx(f, x, y + i, M[3]);
}
