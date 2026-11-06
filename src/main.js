// 起動・タイトル・ロビー・メインループ
import { loadFx } from "./fx.js";
import { buildActions } from "./kits.js";
import { Game } from "./game.js";
import { UI, portrait } from "./ui.js";
import { Input } from "./input.js";
import { Net, normalizeCode } from "./net.js";
import { audio, playMusic } from "./audio.js";
import { CLASS_IDS } from "./data.js";
import { makeBot, runHeadless } from "./bot.js";

const QS = new URLSearchParams(location.search);
const bot = QS.get("bot") ? makeBot() : null, SPEED = +(QS.get("speed") ?? 1);
window.__bot = bot;

const $ = (s) => document.querySelector(s);
const canvas = $("#game"), ui = new UI(), input = new Input(canvas);
let net = new Net(), game = null;
const lobby = { code: "", roster: {} };
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
}
addEventListener("resize", resize);
resize();

async function boot() {
  ui.show("loading");
  try {
    await loadFx((p) => ($("#load-bar i").style.width = p * 100 + "%"));
  } catch (e) {
    $("#load-msg").textContent = "読み込みに失敗しました: " + e.message;
    return;
  }
  buildActions();
  game = new Game(canvas, ui, input, net);
  window.__game = game;
  if (bot) window.__run = (cls, sec = 1800) => runHeadless(game, bot, cls, sec);
  try { game.init(); } catch (e) { $("#load-msg").textContent = "このブラウザでは動きません（WebGL2 が必要です）"; return; }
  const name = $("#name");
  name.value = store.get("hoshiochi.name", "");
  name.addEventListener("change", () => store.set("hoshiochi.name", name.value.trim()));
  const vol = $("#vol"), mus = $("#mus");
  vol.value = store.get("hoshiochi.vol", 0.8); mus.value = store.get("hoshiochi.mus", 0.45);
  vol.oninput = () => { audio.setVolume(+vol.value); store.set("hoshiochi.vol", vol.value); };
  mus.oninput = () => { audio.setMusic(+mus.value); store.set("hoshiochi.mus", mus.value); };
  audio.volume = +vol.value; audio.music = +mus.value;
  // タイトルのキャラ
  const row = $("#title-chars");
  for (const c of CLASS_IDS) row.append(portrait(c, 3));
  const code = new URLSearchParams(location.search).get("room");
  if (code) $("#join-code").value = normalizeCode(code);
  ui.show("title");
  requestAnimationFrame(loop);
}

const playerName = () => ($("#name").value.trim() || "旅人").slice(0, 10);
const firstAudio = () => { audio.init(); playMusic("title"); };
addEventListener("pointerdown", () => audio.init(), { once: true });

// ---- タイトルのボタン
$("#btn-solo").onclick = () => {
  firstAudio();
  net.close(); net = new Net(); game.net = net;
  lobby.code = ""; lobby.roster = { 0: { name: playerName(), cls: store.get("hoshiochi.cls", "blade"), ready: true } };
  showLobby();
};
$("#btn-host").onclick = async () => {
  firstAudio();
  const b = $("#btn-host");
  b.disabled = true; b.textContent = "部屋を作っています…";
  net.close(); net = new Net(); game.net = net;
  try {
    lobby.code = await net.createRoom();
    lobby.roster = { 0: { name: playerName(), cls: store.get("hoshiochi.cls", "blade"), ready: true } };
    wireHost();
    showLobby();
  } catch (e) { ui.error(e.message); }
  b.disabled = false; b.textContent = "部屋を作る";
};
$("#btn-join").onclick = async () => {
  firstAudio();
  const code = normalizeCode($("#join-code").value);
  if (code.length !== 5) return ui.error("5文字のルームコードを入れてください");
  const b = $("#btn-join");
  b.disabled = true; b.textContent = "接続中…";
  net.close(); net = new Net(); game.net = net;
  wireGuest();
  try {
    await net.joinRoom(code, { t: "hello", name: playerName(), cls: store.get("hoshiochi.cls", "blade") });
    lobby.code = code;
  } catch (e) { ui.error(e.message); net.close(); }
  b.disabled = false; b.textContent = "参加する";
};
$("#join-code").addEventListener("input", (e) => (e.target.value = normalizeCode(e.target.value)));
$("#join-code").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btn-join").click(); });
$("#btn-copy").onclick = () => {
  const url = `${location.origin}${location.pathname}?room=${lobby.code}`;
  navigator.clipboard?.writeText(url).then(() => ui.toast("招待リンクをコピーしました"), () => ui.toast(lobby.code));
};
$("#btn-leave").onclick = () => backToTitle();
$("#btn-retry").onclick = () => backToTitle(true);
$("#btn-resume").onclick = () => togglePause(false);
$("#btn-quit").onclick = () => { togglePause(false); backToTitle(); };
$("#btn-help").onclick = () => $("#help").classList.toggle("on");
$("#help").onclick = () => $("#help").classList.remove("on");

function backToTitle(keepRoom = false) {
  game.stop();
  ui.hideBoons();
  if (keepRoom && !net.solo && net.isHost) {
    // 同じメンバーでもう一度
    net.locked = false;
    for (const r of Object.values(lobby.roster)) r.ready = false;
    lobby.roster[0].ready = true;
    broadcastLobby();
    return showLobby();
  }
  if (keepRoom && net.solo) return showLobby();
  if (keepRoom && !net.isHost) return showLobby();
  net.close();
  playMusic("title");
  ui.show("title");
}

// ---- ロビー
function showLobby() {
  ui.show("lobby");
  renderLobby();
}
function renderLobby() {
  ui.renderLobby(lobby, net.slot, net.isHost, net.solo,
    (cls) => {
      store.set("hoshiochi.cls", cls);
      if (net.isHost) { lobby.roster[net.slot].cls = cls; broadcastLobby(); renderLobby(); }
      else net.send({ t: "class", cls });
    },
    () => { if (!net.isHost) net.send({ t: "ready", v: !lobby.roster[net.slot]?.ready }); },
    () => startGame());
}
function broadcastLobby() { net.send({ t: "lobby", roster: lobby.roster, code: lobby.code }); }
function startGame() {
  const seed = (Math.random() * 2 ** 31) | 0;
  net.locked = true;
  net.send({ t: "start", seed, roster: lobby.roster });
  begin(seed, lobby.roster);
}
function begin(seed, roster) {
  ui.show("game");
  game.start(seed, roster, net.slot);
}

function wireHost() {
  net.on("join", () => {});
  net.on("message", (slot, m) => {
    if (m.t === "hello") {
      lobby.roster[slot] = { name: String(m.name || "旅人").slice(0, 10), cls: CLASS_IDS.includes(m.cls) ? m.cls : "blade", ready: false };
      net.sendTo(slot, { t: "welcome", slot, roster: lobby.roster, code: lobby.code });
      broadcastLobby(); renderLobby();
      ui.toast(`${lobby.roster[slot].name} が参加しました`); audio.play("select");
      return;
    }
    if (m.t === "class" && lobby.roster[slot] && CLASS_IDS.includes(m.cls)) { lobby.roster[slot].cls = m.cls; broadcastLobby(); renderLobby(); return; }
    if (m.t === "ready" && lobby.roster[slot]) { lobby.roster[slot].ready = !!m.v; broadcastLobby(); renderLobby(); return; }
    if (game.running) game.onMessage(slot, m);
  });
  net.on("leave", (slot) => {
    const r = lobby.roster[slot];
    delete lobby.roster[slot];
    if (game.running) game.playerLeft(slot);
    else if (r) ui.toast(`${r.name} が抜けました`);
    broadcastLobby();
    if (!game.running) renderLobby();
  });
  net.on("error", (msg) => ui.toast(msg));
}
function wireGuest() {
  net.on("message", (_, m) => {
    if (m.t === "welcome" || m.t === "lobby") {
      lobby.roster = m.roster; lobby.code = m.code ?? lobby.code;
      // ホストが「もう一度」を押した: 結果画面からロビーへ
      if (game.running && game.over) { game.stop(); ui.hideBoons(); showLobby(); return; }
      if (!game.running) { if (!ui.screens.lobby.classList.contains("on")) showLobby(); else renderLobby(); }
      return;
    }
    if (m.t === "start") { lobby.roster = m.roster; begin(m.seed, m.roster); return; }
    if (game.running) game.onMessage(0, m);
  });
  net.on("hostLost", () => {
    ui.error("ホストとの接続が切れました");
    game.stop(); net.close(); ui.show("title"); playMusic("title");
  });
  net.on("error", (msg) => ui.toast(msg));
}

// ---- 一時停止（ソロだけ本当に止まる）
let paused = false;
function togglePause(v = !paused) {
  paused = v;
  $("#pause").classList.toggle("on", paused);
}

// ---- メインループ
let last = performance.now(), hudT = 0;
function loop(now) {
  const rdt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game?.running) {
    if (input.pause) togglePause();
    if (window.__hold) {}
    else if (!(paused && net.solo)) for (let i = 0; i < SPEED; i++) { bot?.step(game, input); game.update(rdt); }
    else input.endFrame();
    game.render(now / 1000);
    hudT -= rdt;
    if (hudT <= 0) { hudT = 1 / 15; ui.updateHud(game); }
  }
  requestAnimationFrame(loop);
}

boot();
