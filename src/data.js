// 数値とデータはすべてここ。バランス調整はこのファイルだけ触れば済むようにしてある。
import { PAL } from "../vendor/pixelfx/src/core/color.js";

export const VIEW_W = 480, VIEW_H = 270;
export const ROOM_W = 576, ROOM_H = 300;
export const WALL_H = 76; // 奥の壁の高さ（床はこの下から）

// ---- 爽快感まわり
export const JUICE = {
  hitstop: { normal: 0.05, crit: 0.09, kill: 0.07, finisher: 0.12, ult: 0.18 },
  shake: { normal: 1.2, crit: 2.4, kill: 1.8, explode: 4, ult: 7 },
  lastKillSlowmo: 0.55, // 部屋の最後の1体でスロー
  knockback: 120,
};

// ---- プレイヤー共通
export const PLAYER = {
  radius: 7,
  dash: { dist: 74, time: 0.17, cd: 0.85, iframes: 0.26 },
  hurtIframes: 0.8,
  reviveTime: 2.2, reviveRange: 30, reviveHp: 0.4,
  ultCharge: 900, // 与ダメージでこの値貯まるとULT
  critBase: 0.08, critMult: 2.0,
  pickupRange: 26,
  contactK: 0.5,   // 体当たりダメージの倍率
  clearHeal: 0.2,  // 部屋クリアで最大HPの20%回復
};

// ---- 職業
// atk: 通常攻撃 / skill: スキル / ult: 奥義。dmg は1ヒットあたり
export const CLASSES = {
  blade: {
    name: "剣士", en: "BLADE", desc: "3段コンボで切り込む前衛。攻撃中は被ダメージ-35%。",
    hp: 145, speed: 96, weapon: "sword",
    colors: { A: "#d8e2f0", B: "#9aa6ba", C: "#6e7a90", D: "#4a5468", E: "#3a3046", F: "#2c2238", G: "#1d1626", J: "#151020", m: "#ff4a5a", k: "#0b0a10" },
    accent: "#ff6a5a",
    guard: 0.65, // 攻撃中の被ダメージ倍率
    atk: { name: "三段斬り", combo: [15, 15, 32], rate: 0.27, range: 50, arc: 2.3, comboWindow: 0.55 },
    skill: { name: "旋風斬", dmg: 26, hits: 2, radius: 66, cd: 5 },
    ult: { name: "星断ち", dmg: 150, radius: 120 },
  },
  mage: {
    name: "魔導士", en: "MAGE", desc: "火球で焼き、氷で止める。元素コンボの起点。",
    hp: 88, speed: 90, weapon: null,
    colors: { A: "#c684ff", B: "#9a48ec", C: "#6b2cc0", D: "#481c88", E: "#ffe066", F: "#c48412", G: "#2b1252", J: "#140a26", m: "#ffe066", k: "#0b0a10" },
    accent: "#c684ff",
    atk: { name: "火球", dmg: 17, rate: 0.3, speed: 270, splash: 20, splashK: 0.5, life: 1.1 },
    skill: { name: "氷華", dmg: 22, radius: 96, freeze: 1.6, cd: 7 },
    ult: { name: "隕石召喚", dmg: 220, radius: 108 },
  },
  gunner: {
    name: "銃士", en: "GUNNER", desc: "連射と爆撃。単体火力と殲滅力を両立する。",
    hp: 100, speed: 102, weapon: "pistol",
    colors: { A: "#4ce8d8", B: "#18b4b0", C: "#108088", D: "#0c5260", E: "#b47c40", F: "#6a421e", G: "#2e1a0c", J: "#160c06", m: "#ffd23c", k: "#0b0a10" },
    accent: "#4ce8d8",
    atk: { name: "連射", dmg: 7, rate: 0.105, speed: 560, spread: 0.06, life: 0.6 },
    skill: { name: "ロケット", dmg: 48, radius: 54, speed: 250, cd: 3.5 },
    ult: { name: "雷撃掃射", dmg: 70, strikes: 10, radius: 34 },
  },
  cleric: {
    name: "聖職者", en: "CLERIC", desc: "鎚で殴り、仲間を癒やし、倒れた者を蘇らせる。",
    hp: 118, speed: 92, weapon: "hammer",
    colors: { A: "#fffbe6", B: "#fff09a", C: "#d8a428", D: "#9a6c18", E: "#e4dcc8", F: "#8a806c", G: "#3a352c", J: "#1a1814", m: "#3ec466", k: "#0b0a10" },
    accent: "#ffd84a",
    atk: { name: "聖鎚", dmg: 22, rate: 0.42, range: 46, arc: 2.0, healAllies: 1.5 },
    skill: { name: "癒しの環", dmg: 26, heal: 32, radius: 112, cd: 8 },
    ult: { name: "聖柱", dmg: 160, radius: 130, shield: 3 },
  },
};
export const CLASS_IDS = ["blade", "mage", "gunner", "cleric"];
export const PLAYER_COLORS = ["#ff6a5a", "#4ca8ff", "#6cdc5a", "#ffc83c"];

// ---- 元素
// burn: 継続ダメ / chill: 鈍足→3スタックで凍結 / shock: 連鎖 / holy: 撃破時に回復
export const ELEM = {
  burn: { dps: 0.3, time: 3 },        // 元のヒットの30%/秒
  chill: { slow: 0.4, time: 2.5, stacks: 3, freeze: 1.4 },
  shock: { time: 3, chain: 2, k: 0.5, range: 80 },
  holy: { time: 4, heal: 3 },
};
export const COMBOS = {
  steam:   { name: "蒸気爆発", dmg: 40, k: 0.8, radius: 56 },   // 燃焼 + 氷
  shatter: { name: "粉砕",     mult: 2.5, radius: 40, splash: 30 }, // 凍結 + 重い一撃
  overload:{ name: "過負荷",   dmg: 70, radius: 64 },               // 感電 + 炎
  judge:   { name: "裁き",     dmg: 50, radius: 50 },               // 聖印 + 撃破
};

// ---- 加護（部屋クリア報酬）
// r: レア度 1=普通 2=レア 3=伝説。apply(s) はプレイヤーのステータスを書き換える
export const BOONS = [
  { id: "dmg", name: "鋭刃", r: 1, el: "none", text: "与ダメージ +20%", apply: (s) => (s.dmg *= 1.2) },
  { id: "dmg2", name: "覇者の刃", r: 2, el: "none", text: "与ダメージ +35%", apply: (s) => (s.dmg *= 1.35) },
  { id: "aspd", name: "迅速", r: 1, el: "none", text: "攻撃速度 +18%", apply: (s) => (s.aspd *= 1.18) },
  { id: "crit", name: "会心", r: 1, el: "none", text: "会心率 +8%", apply: (s) => (s.crit += 0.08) },
  { id: "critd", name: "致命", r: 2, el: "none", text: "会心ダメージ +60%", apply: (s) => (s.critMult += 0.6) },
  { id: "hp", name: "鉄壁", r: 1, el: "none", text: "最大HP +30（全回復）", apply: (s) => { s.maxHp += 30; s.hp = s.maxHp; } },
  { id: "cd", name: "詠唱短縮", r: 1, el: "none", text: "スキルのクールダウン -22%", apply: (s) => (s.cdr *= 0.78) },
  { id: "area", name: "拡散", r: 2, el: "none", text: "攻撃とスキルの範囲 +25%", apply: (s) => (s.area *= 1.25) },
  { id: "multi", name: "多重撃", r: 2, el: "none", text: "飛び道具 +1 / 近接の衝撃波", apply: (s) => (s.multi += 1) },
  { id: "speed", name: "疾風", r: 1, el: "none", text: "移動速度 +12% / ダッシュ回数 +1", apply: (s) => { s.speed *= 1.12; s.dashes += 1; } },
  { id: "dashdmg", name: "迅雷の踏込", r: 2, el: "shock", text: "ダッシュで触れた敵に 30 の雷ダメージ", apply: (s) => (s.dashDmg += 30) },
  { id: "ult", name: "共鳴", r: 1, el: "none", text: "奥義ゲージの溜まり +35%", apply: (s) => (s.ultGain *= 1.35) },
  { id: "leech", name: "吸命", r: 2, el: "none", text: "撃破するたびHP 2 回復", apply: (s) => (s.killHeal += 2) },
  { id: "chainx", name: "連鎖爆破", r: 3, el: "burn", text: "撃破した敵が爆発（最大HPの35%）", apply: (s) => (s.killBoom += 0.35) },
  { id: "fire", name: "炎の加護", r: 1, el: "burn", text: "攻撃が敵を燃やす", apply: (s) => (s.elems.burn = 1) },
  { id: "ice", name: "氷の加護", r: 1, el: "chill", text: "攻撃が敵を冷やす（3回で凍結）", apply: (s) => (s.elems.chill = 1) },
  { id: "thunder", name: "雷の加護", r: 1, el: "shock", text: "攻撃が感電させ、近くへ連鎖", apply: (s) => (s.elems.shock = 1) },
  { id: "holy", name: "聖の加護", r: 1, el: "holy", text: "聖印の敵を倒すと味方全員回復", apply: (s) => (s.elems.holy = 1) },
  { id: "elemup", name: "元素の極み", r: 3, el: "none", text: "元素コンボのダメージ ×2", apply: (s) => (s.comboMult *= 2) },
  { id: "giant", name: "巨星の一撃", r: 3, el: "none", text: "4回目ごとの攻撃が 3倍 + 必ず会心", apply: (s) => (s.giant = 1) },
  { id: "thorns", name: "茨の鎧", r: 2, el: "none", text: "被ダメージ -20%、受けた分を周囲へ反射", apply: (s) => { s.armor *= 0.8; s.thorns = 1; } },
  { id: "magnet", name: "星の引力", r: 1, el: "none", text: "回収範囲 ×2 / コイン +30%", apply: (s) => { s.pickup *= 2; s.gold *= 1.3; } },
];
export const RARITY = { 1: { name: "コモン", w: 70, color: "#9aa6ba" }, 2: { name: "レア", w: 25, color: "#4ca8ff" }, 3: { name: "レジェンド", w: 6, color: "#ffc83c" } };

export function baseStats(cls) {
  const c = CLASSES[cls];
  return {
    maxHp: c.hp, hp: c.hp, speed: c.speed, dmg: 1, aspd: 1, crit: PLAYER.critBase, critMult: PLAYER.critMult,
    cdr: 1, area: 1, multi: 0, dashes: 1, dashDmg: 0, ultGain: 1, killHeal: 0, killBoom: 0, comboMult: 1,
    giant: 0, armor: 1, thorns: 0, pickup: 1, gold: 1, elems: {},
  };
}

// ---- 敵
// fx: 見た目に使うpixelfxの生き物。ai: 行動パターン
export const ENEMIES = {
  slime:   { name: "スライム", fx: "critters/slime", hp: 34, speed: 44, r: 10, dmg: 7, ai: "hopper", gold: 1, h: 18 },
  bat:     { name: "コウモリ", fx: "critters/bat", hp: 20, speed: 82, r: 8, dmg: 6, ai: "swooper", gold: 1, fly: 16, h: 14 },
  skull:   { name: "炎髑髏", fx: "critters/flying-skull", hp: 42, speed: 36, r: 9, dmg: 8, ai: "shooter", gold: 2, fly: 12, h: 30, shot: { cd: 2.4, speed: 105, kind: "fire" } },
  skel:    { name: "骸骨兵", fx: "rig", hp: 72, speed: 50, r: 8, dmg: 12, ai: "brute", gold: 2, h: 38, weapon: "sword" },
  ghost:   { name: "亡霊", fx: "critters/ghost", hp: 55, speed: 40, r: 10, dmg: 11, ai: "phaser", gold: 2, fly: 4, h: 26 },
  wisp:    { name: "氷霊", fx: "critters/wisp", hp: 40, speed: 64, r: 8, dmg: 9, ai: "shooter", gold: 2, fly: 8, h: 24, shot: { cd: 2.0, speed: 120, kind: "ice" } },
  frog:    { name: "跳蛙", fx: "critters/frog", hp: 48, speed: 70, r: 9, dmg: 12, ai: "hopper", gold: 2, h: 16 },
  eyeball: { name: "凝視の眼", fx: "critters/eyeball", hp: 85, speed: 30, r: 11, dmg: 13, ai: "shooter", gold: 3, fly: 6, h: 34, shot: { cd: 2.6, speed: 140, kind: "arcane", burst: 3 } },
  jelly:   { name: "星海月", fx: "critters/jellyfish", hp: 60, speed: 34, r: 10, dmg: 12, ai: "phaser", gold: 2, fly: 24, h: 30 },
  snake:   { name: "影蛇", fx: "critters/snake", hp: 66, speed: 60, r: 10, dmg: 13, ai: "charger", gold: 3, h: 12 },
};
export const ELITE = { hp: 3.5, dmg: 1.4, size: 1, gold: 5 };

export const BOSSES = {
  slimeKing: { name: "スライム王 グラトニア", fx: "critters/slime", hp: 4200, r: 30, dmg: 16, scale: 3, speed: 40, h: 56 },
  boneKnight: { name: "骸骨騎士 ヴァルド", fx: "rig", hp: 10500, r: 14, dmg: 22, scale: 2, speed: 56, h: 76 },
  starEye: { name: "星喰いの瞳 オルビス", fx: "critters/eyeball", hp: 21000, r: 22, dmg: 24, scale: 2, speed: 30, h: 66 },
};

// ---- 人数・進行によるスケール
export const SCALE = {
  enemyHpPerRoom: 1.12,      // 部屋ごとに敵HP ×1.12
  enemyDmgPerRoom: 1.05,
  countPerPlayer: 0.4,       // 雑魚の数 ×(1 + 0.4×(人数-1))
  bossHpPerPlayer: 0.75,     // ボスHP ×(1 + 0.75×(人数-1))
  maxAlive: 20,              // 同時に出る雑魚の上限（+ 人数×7）
  maxAlivePerPlayer: 7,
};

// ---- エリアと部屋
export const AREAS = [
  {
    id: "crypt", name: "地下墓所", sub: "I", ambient: [0.46, 0.46, 0.6], floor: PAL.stone, wall: PAL.stone, accent: PAL.fire,
    enemies: { slime: 5, bat: 3, skull: 2, skel: 2 }, boss: "slimeKing", light: "#ffae35", weather: "dust",
  },
  {
    id: "frost", name: "氷晶の聖堂", sub: "II", ambient: [0.42, 0.48, 0.64], floor: PAL.ice, wall: PAL.metal, accent: PAL.ice,
    enemies: { ghost: 3, wisp: 3, skel: 3, bat: 2, frog: 2 }, boss: "boneKnight", light: "#9bdcff", weather: "snow",
  },
  {
    id: "summit", name: "星海の頂", sub: "III", ambient: [0.44, 0.4, 0.6], floor: PAL.arcane, wall: PAL.night, accent: PAL.arcane,
    enemies: { eyeball: 2, jelly: 2, snake: 3, skull: 2, bat: 2, skel: 2 }, boss: "starEye", light: "#c684ff", weather: "stars",
  },
];
// 各エリア: 戦闘×4 → 休息 → ボス
export const ROOM_PLAN = ["fight", "fight", "elite", "fight", "rest", "boss"];
export function wavesFor(roomIndex, kind, players) {
  const n = Math.round((11 + roomIndex * 0.8) * (1 + SCALE.countPerPlayer * (players - 1)));
  if (kind === "elite") return [n, Math.round(n * 1.1), -1, Math.round(n * 0.8)]; // -1: エリート戦
  return [n, Math.round(n * 1.2), Math.round(n * 1.1), Math.round(n * 1.3)];
}
