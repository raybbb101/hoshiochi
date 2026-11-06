// 効果音とBGMはすべてその場で合成する（音声ファイルなし）
let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null, comp = null;
const last = new Map();

export const audio = {
  volume: 0.8, music: 0.45,
  init() {
    if (ctx) { ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.15;
    master = ctx.createGain(); master.gain.value = this.volume;
    sfxBus = ctx.createGain(); musicBus = ctx.createGain(); musicBus.gain.value = this.music;
    sfxBus.connect(comp); musicBus.connect(comp); comp.connect(master); master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  },
  setVolume(v) { this.volume = v; if (master) master.gain.value = v; },
  setMusic(v) { this.music = v; if (musicBus) musicBus.gain.value = v; },
  play(name, k = 1) {
    if (!ctx || !SFX[name]) return;
    // 同じ音が一瞬に重なりすぎないように
    const now = ctx.currentTime, l = last.get(name) ?? 0;
    if (now - l < (SFX[name].gap ?? 0.03)) return;
    last.set(name, now);
    SFX[name](now, k);
  },
};

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function tone(t, { type = "square", f0, f1 = f0, dur = 0.1, vol = 0.2, a = 0.004, bus = sfxBus, detune = 0 }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.detune.value = detune;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  env(g, t, a, vol, dur);
  o.connect(g); g.connect(bus);
  o.start(t); o.stop(t + a + dur + 0.05);
}
function noise(t, { dur = 0.1, vol = 0.2, f0 = 2000, f1 = f0, q = 1, type = "bandpass", a = 0.002, bus = sfxBus }) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; s.loop = true;
  f.type = type; f.Q.value = q;
  const ny = ctx.sampleRate / 2 - 200;
  f.frequency.setValueAtTime(Math.min(ny, f0), t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, Math.min(ny, f1)), t + dur);
  env(g, t, a, vol, dur);
  s.connect(f); f.connect(g); g.connect(bus);
  s.start(t, Math.random() * 0.5); s.stop(t + a + dur + 0.05);
}
const rnd = (a, b) => a + Math.random() * (b - a);

const SFX = {
  slash: (t, k) => { noise(t, { dur: 0.09, vol: 0.32 * k, f0: 5200, f1: 1400, q: 1.2 }); tone(t, { type: "sawtooth", f0: rnd(700, 820), f1: 240, dur: 0.07, vol: 0.06 }); },
  heavy: (t) => { noise(t, { dur: 0.2, vol: 0.45, f0: 3000, f1: 300, q: 0.8 }); tone(t, { type: "square", f0: 160, f1: 50, dur: 0.22, vol: 0.22 }); },
  hit: (t, k) => { noise(t, { dur: 0.06, vol: 0.4 * k, f0: rnd(1800, 2600), f1: 600, q: 1.5 }); tone(t, { type: "square", f0: rnd(220, 260), f1: 90, dur: 0.06, vol: 0.12 * k }); },
  hit2: (t) => { tone(t, { type: "triangle", f0: 140, f1: 45, dur: 0.12, vol: 0.4 }); noise(t, { dur: 0.08, vol: 0.3, f0: 1200, f1: 300 }); },
  crit: (t) => { tone(t, { type: "square", f0: 1320, f1: 1760, dur: 0.06, vol: 0.12 }); tone(t + 0.04, { type: "square", f0: 1760, f1: 2640, dur: 0.1, vol: 0.1 }); noise(t, { dur: 0.12, vol: 0.4, f0: 3000, f1: 800 }); },
  kill: (t) => { noise(t, { dur: 0.16, vol: 0.3, f0: 900, f1: 120, q: 0.7 }); tone(t, { type: "square", f0: 520, f1: 1040, dur: 0.07, vol: 0.07 }); },
  shot: (t) => { tone(t, { type: "square", f0: rnd(900, 1000), f1: 180, dur: 0.05, vol: 0.09 }); noise(t, { dur: 0.04, vol: 0.18, f0: 4000, f1: 1500 }); },
  fireball: (t) => { noise(t, { dur: 0.18, vol: 0.22, f0: 600, f1: 2400, q: 0.8 }); tone(t, { type: "sawtooth", f0: 180, f1: 320, dur: 0.12, vol: 0.05 }); },
  boom: (t, k) => { noise(t, { dur: 0.5 * k, vol: 0.6, f0: 1400, f1: 60, q: 0.6, type: "lowpass" }); tone(t, { type: "sine", f0: 120, f1: 30, dur: 0.45, vol: 0.55 }); },
  bigboom: (t) => { noise(t, { dur: 1.1, vol: 0.7, f0: 2000, f1: 40, q: 0.5, type: "lowpass" }); tone(t, { type: "sine", f0: 90, f1: 22, dur: 1, vol: 0.7 }); tone(t, { type: "square", f0: 70, f1: 30, dur: 0.5, vol: 0.18 }); },
  ice: (t) => { for (let i = 0; i < 5; i++) tone(t + i * 0.03, { type: "triangle", f0: rnd(1800, 3200), f1: rnd(900, 1400), dur: 0.12, vol: 0.06 }); noise(t, { dur: 0.3, vol: 0.2, f0: 6000, f1: 2500, q: 2 }); },
  shatter: (t) => { for (let i = 0; i < 8; i++) tone(t + i * 0.012, { type: "square", f0: rnd(2000, 4200), f1: rnd(600, 1200), dur: 0.08, vol: 0.05 }); noise(t, { dur: 0.25, vol: 0.4, f0: 7000, f1: 1200 }); },
  zap: (t) => { for (let i = 0; i < 4; i++) tone(t + i * 0.025, { type: "sawtooth", f0: rnd(300, 1400), f1: rnd(80, 300), dur: 0.05, vol: 0.09 }); noise(t, { dur: 0.15, vol: 0.25, f0: 5000, f1: 2000, q: 3 }); },
  thunder: (t) => { noise(t, { dur: 0.9, vol: 0.55, f0: 3000, f1: 80, q: 0.4, type: "lowpass" }); for (let i = 0; i < 6; i++) tone(t + i * 0.02, { type: "sawtooth", f0: rnd(200, 1600), f1: 60, dur: 0.08, vol: 0.08 }); },
  holy: (t) => { [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.05, { type: "triangle", f0: f, dur: 0.5, vol: 0.08, a: 0.02 })); },
  heal: (t) => { [784, 988, 1175].forEach((f, i) => tone(t + i * 0.06, { type: "sine", f0: f, dur: 0.3, vol: 0.09, a: 0.01 })); },
  dash: (t) => { noise(t, { dur: 0.14, vol: 0.25, f0: 800, f1: 4000, q: 0.9 }); },
  coin: (t) => { tone(t, { type: "square", f0: 1568, dur: 0.05, vol: 0.06 }); tone(t + 0.05, { type: "square", f0: 2093, dur: 0.12, vol: 0.06 }); },
  hurt: (t) => { tone(t, { type: "sawtooth", f0: 300, f1: 70, dur: 0.2, vol: 0.25 }); noise(t, { dur: 0.15, vol: 0.3, f0: 900, f1: 200 }); },
  down: (t) => { [392, 330, 262, 196].forEach((f, i) => tone(t + i * 0.1, { type: "triangle", f0: f, dur: 0.18, vol: 0.15 })); },
  revive: (t) => { [262, 330, 392, 523, 659, 784].forEach((f, i) => tone(t + i * 0.06, { type: "triangle", f0: f, dur: 0.25, vol: 0.1 })); },
  select: (t) => { tone(t, { type: "square", f0: 880, f1: 1320, dur: 0.06, vol: 0.06 }); },
  boon: (t) => { [523, 784, 1047, 1568].forEach((f, i) => tone(t + i * 0.07, { type: "square", f0: f, dur: 0.15, vol: 0.06 })); noise(t + 0.2, { dur: 0.6, vol: 0.12, f0: 8000, f1: 3000, q: 4 }); },
  clear: (t) => { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(t + i * 0.08, { type: "square", f0: f, dur: 0.18, vol: 0.07 })); },
  portal: (t) => { tone(t, { type: "sine", f0: 200, f1: 900, dur: 0.6, vol: 0.15, a: 0.1 }); noise(t, { dur: 0.6, vol: 0.12, f0: 500, f1: 3000, q: 3 }); },
  enemyShot: (t) => { tone(t, { type: "sine", f0: 600, f1: 300, dur: 0.12, vol: 0.06 }); },
  warn: (t) => { tone(t, { type: "square", f0: 440, dur: 0.07, vol: 0.05 }); },
  roar: (t) => { noise(t, { dur: 1.2, vol: 0.5, f0: 300, f1: 120, q: 2 }); tone(t, { type: "sawtooth", f0: 90, f1: 60, dur: 1.1, vol: 0.2, a: 0.1 }); },
  ult: (t) => { tone(t, { type: "sawtooth", f0: 110, f1: 880, dur: 0.5, vol: 0.18, a: 0.05 }); noise(t, { dur: 0.6, vol: 0.3, f0: 400, f1: 6000, q: 1 }); },
  combo: (t, k) => { tone(t, { type: "square", f0: 660 * Math.pow(1.06, Math.min(k, 24)), dur: 0.08, vol: 0.07 }); },
};
for (const k of ["hit", "shot", "coin", "slash"]) SFX[k].gap = 0.035;

// ---- BGM: エリアごとの短い進行を繰り返すだけの簡単なシーケンサ
const SONGS = {
  title: { bpm: 84, root: 57, prog: [[0, 3, 7], [-4, 0, 3], [-7, -3, 0], [-2, 2, 5]], lead: [12, 15, 19, 17, 15, 12, 10, 7], drums: false },
  crypt: { bpm: 112, root: 50, prog: [[0, 3, 7], [0, 3, 8], [-2, 2, 5], [-5, -2, 2]], lead: [12, 10, 7, 10, 12, 15, 14, 10], drums: true },
  frost: { bpm: 120, root: 52, prog: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]], lead: [7, 12, 15, 14, 12, 7, 10, 12], drums: true },
  summit: { bpm: 128, root: 49, prog: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]], lead: [16, 19, 21, 19, 16, 14, 12, 14], drums: true },
  boss: { bpm: 148, root: 45, prog: [[0, 3, 7], [1, 4, 8], [0, 3, 7], [-2, 1, 5]], lead: [12, 13, 12, 10, 12, 15, 13, 12], drums: true, hard: true },
};
let song = null, nextBeat = 0, beat = 0, timer = null;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export function playMusic(name) {
  if (!ctx) return;
  if (song === SONGS[name]) return;
  song = SONGS[name] ?? null;
  beat = 0; nextBeat = ctx.currentTime + 0.1;
  if (!timer) timer = setInterval(schedule, 50);
}
function schedule() {
  if (!song || !ctx) return;
  const spb = 60 / song.bpm / 2; // 8分音符
  while (nextBeat < ctx.currentTime + 0.2) {
    const t = nextBeat, bar = Math.floor(beat / 8) % song.prog.length, step = beat % 8, chord = song.prog[bar];
    if (step === 0) chord.forEach((n) => tone(t, { type: "triangle", f0: mtof(song.root + 12 + n), dur: spb * 7.5, vol: 0.035, a: 0.08, bus: musicBus }));
    if (step % 2 === 0) tone(t, { type: song.hard ? "sawtooth" : "square", f0: mtof(song.root - 12 + chord[0] + (step === 6 ? 7 : 0)), dur: spb * 1.6, vol: 0.05, bus: musicBus });
    if (song.drums) {
      if (step === 0 || step === 4 || (song.hard && step === 6)) tone(t, { type: "sine", f0: 140, f1: 40, dur: 0.16, vol: 0.22, bus: musicBus });
      if (step === 2 || step === 6) noise(t, { dur: 0.1, vol: 0.08, f0: 2500, f1: 1200, bus: musicBus });
      noise(t, { dur: 0.03, vol: 0.025, f0: 9000, f1: 7000, q: 3, bus: musicBus });
    }
    if ((beat >> 3) % 4 >= 2 || !song.drums) {
      const n = song.lead[(step + bar * 3) % song.lead.length];
      if (step % (song.drums ? 1 : 2) === 0 && (step !== 7)) tone(t, { type: "square", f0: mtof(song.root + n + 12), dur: spb * 0.8, vol: 0.022, bus: musicBus, a: 0.005 });
    }
    nextBeat += spb; beat++;
  }
}
