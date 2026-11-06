// 画面の上に重ねる UI（タイトル、ロビー、HUD、加護の選択、結果）
import { CLASSES, CLASS_IDS, BOONS, RARITY, PLAYER } from "./data.js";
import { createFrame } from "../vendor/pixelfx/src/core/fx.js";
import { drawRig, recolorMap } from "./draw.js";
import { STANCE } from "./kits.js";
import { audio } from "./audio.js";

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 職業のドット絵を canvas に（ロビーと HUD 用） */
export function portrait(cls, k = 3, pose) {
  const W = 40, H = 50, f = createFrame(W, H);
  drawRig(f, pose ?? STANCE[cls], 20, 46, { map: recolorMap(CLASSES[cls].colors) });
  const c = document.createElement("canvas");
  c.width = W; c.height = H; c.style.width = W * k + "px"; c.style.height = H * k + "px"; c.className = "px";
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(f.color.buffer), W, H), 0, 0);
  return c;
}

export class UI {
  constructor() {
    this.root = $("#ui");
    this.screens = {};
    for (const s of this.root.querySelectorAll("[data-screen]")) this.screens[s.dataset.screen] = s;
    this.hud = $("#hud");
  }
  show(name) {
    for (const [k, s] of Object.entries(this.screens)) s.classList.toggle("on", k === name);
    this.hud.classList.toggle("on", name === "game");
  }
  toast(msg) {
    const t = el("div", "toast", esc(msg));
    $("#toasts").append(t);
    setTimeout(() => t.classList.add("out"), 2600);
    setTimeout(() => t.remove(), 3200);
  }
  error(msg) { this.toast(msg); audio.play("hurt"); }

  // ---- ロビー
  renderLobby(state, me, isHost, solo, onClass, onReady, onStart) {
    const L = this.screens.lobby;
    $(".code", L).textContent = solo ? "ソロ" : state.code;
    $(".code-box", L).classList.toggle("hide", solo);
    const slots = $(".slots", L);
    slots.innerHTML = "";
    for (let i = 0; i < (solo ? 1 : 4); i++) {
      const r = state.roster[i];
      const d = el("div", "slot" + (r ? "" : " empty") + (i === me ? " me" : ""));
      d.style.setProperty("--pc", ["#ff6a5a", "#4ca8ff", "#6cdc5a", "#ffc83c"][i]);
      if (r) {
        d.append(portrait(r.cls, 2));
        d.append(el("div", "who", `<b>P${i + 1} ${esc(r.name)}</b><span>${CLASSES[r.cls].name}</span>${solo ? "" : (i === 0 ? "<i>ホスト</i>" : "") + (r.ready || i === 0 ? '<em class="ok">準備OK</em>' : "<em>準備中…</em>")}`));
      } else d.append(el("div", "who", "<span>空き</span><small>コードを教えて招待</small>"));
      slots.append(d);
    }
    const cards = $(".classes", L);
    const mine = state.roster[me]?.cls;
    if (cards.dataset.built !== "1") {
      cards.innerHTML = "";
      for (const id of CLASS_IDS) {
        const c = CLASSES[id], card = el("button", "class-card");
        card.dataset.cls = id;
        card.style.setProperty("--ac", c.accent);
        card.append(portrait(id, 3));
        card.append(el("div", "cinfo", `<h3>${c.name}<small>${c.en}</small></h3><p>${c.desc}</p>
          <ul><li><b>攻撃</b>${c.atk.name}</li><li><b>技</b>${c.skill.name}</li><li><b>奥義</b>${c.ult.name}</li></ul>
          <div class="bars"><span>HP</span><i style="--v:${c.hp / 130}"></i><span>速さ</span><i style="--v:${c.speed / 102}"></i></div>`));
        card.onclick = () => { audio.play("select"); onClass(id); };
        cards.append(card);
      }
      cards.dataset.built = "1";
    }
    for (const c of cards.children) c.classList.toggle("sel", c.dataset.cls === mine);
    const ready = $(".ready", L), start = $(".start", L);
    ready.classList.toggle("hide", isHost);
    ready.textContent = state.roster[me]?.ready ? "準備を取り消す" : "準備OK";
    ready.onclick = () => { audio.play("select"); onReady(); };
    start.classList.toggle("hide", !isHost);
    const allReady = Object.entries(state.roster).every(([s, r]) => s === "0" || r.ready);
    start.disabled = !allReady;
    start.textContent = allReady ? "出発する" : "全員の準備を待っています";
    start.onclick = () => { audio.play("boon"); onStart(); };
  }

  // ---- HUD
  setRoom(t) { $("#room-label").textContent = t; }
  hint(t) { const h = $("#hint"); h.textContent = t; h.classList.toggle("on", !!t); }
  banner(text, sub, small) {
    const b = $("#banner");
    b.innerHTML = `<div class="b-sub">${esc(sub ?? "")}</div><div class="b-main">${esc(text)}</div>`;
    b.className = "on" + (small ? " small" : "");
    clearTimeout(this.bt);
    this.bt = setTimeout(() => (b.className = ""), small ? 1600 : 2400);
  }
  worldText(text, pos, kind) {
    const t = el("div", "wtext " + (kind ?? ""), esc(text));
    t.style.left = pos.x + "px"; t.style.top = pos.y + "px";
    $("#wtexts").append(t);
    setTimeout(() => t.remove(), 1400);
  }
  ultCut(p) {
    const c = $("#ultcut");
    c.innerHTML = "";
    c.style.setProperty("--ac", CLASSES[p.cls].accent);
    c.append(portrait(p.cls, 3), el("div", "uname", `<small>${esc(p.name)}</small>${CLASSES[p.cls].ult.name}`));
    c.className = "on";
    clearTimeout(this.ut);
    this.ut = setTimeout(() => (c.className = ""), 700);
  }
  updateHud(g) {
    const party = $("#party"), ps = Object.values(g.players);
    if (party.childElementCount !== ps.length || party.dataset.key !== ps.map((p) => p.slot + p.cls).join()) {
      party.innerHTML = "";
      for (const p of ps) {
        const d = el("div", "pf" + (p.slot === g.me ? " me" : ""));
        d.style.setProperty("--pc", p.color);
        d.append(portrait(p.cls, 1));
        d.append(el("div", "pinfo", `<div class="pn">P${p.slot + 1} ${esc(p.name)}</div><div class="hp"><i></i><span></span></div><div class="ug"><i></i></div>`));
        party.append(d);
      }
      party.dataset.key = ps.map((p) => p.slot + p.cls).join();
    }
    [...party.children].forEach((d, i) => {
      const p = ps[i];
      d.classList.toggle("down", p.down);
      $(".hp i", d).style.width = Math.max(0, (p.hp / p.maxHp) * 100) + "%";
      $(".hp span", d).textContent = p.down ? "戦闘不能" : `${Math.max(0, Math.ceil(p.hp))}/${p.maxHp}`;
      $(".ug i", d).style.width = p.ult * 100 + "%";
      d.classList.toggle("ult", p.ult >= 1);
    });
    const me = g.players[g.me];
    if (me) {
      const c = CLASSES[me.cls], sk = $("#sk-skill"), ul = $("#sk-ult"), da = $("#sk-dash");
      sk.querySelector("b").textContent = c.skill.name;
      sk.style.setProperty("--cd", me.skillCd / (c.skill.cd * me.stats.cdr));
      sk.classList.toggle("ready", me.skillCd <= 0);
      $("small", sk).textContent = me.skillCd > 0 ? me.skillCd.toFixed(1) : "";
      ul.querySelector("b").textContent = c.ult.name;
      ul.style.setProperty("--cd", 1 - me.ult);
      ul.classList.toggle("ready", me.ult >= 1);
      $("small", ul).textContent = me.ult >= 1 ? "準備完了" : Math.floor(me.ult * 100) + "%";
      da.style.setProperty("--cd", me.dashCharges > 0 ? 0 : me.dashCd / PLAYER.dash.cd);
      da.classList.toggle("ready", me.dashCharges > 0);
      $("small", da).textContent = me.stats.dashes > 1 ? `×${me.dashCharges}` : "";
      $("#sk-atk b").textContent = c.atk.name;
    }
    $("#gold").textContent = g.gold;
    const wv = g.view.wave;
    $("#wave").textContent = g.view.phase === "fight" && wv && wv[1] > 0 ? `WAVE ${Math.min(wv[0], wv[1])}/${wv[1]}  残り${g.view.enemies.size}体` : "";
    const bb = $("#bossbar");
    if (g.view.bossHp >= 0 && g.view.bossName) { bb.classList.add("on"); $(".bn", bb).textContent = g.view.bossName; $(".bh i", bb).style.width = g.view.bossHp * 100 + "%"; }
    else bb.classList.remove("on");
    $("#combo-text").textContent = me && me.combo >= 3 ? "" : "";
    $("#vignette").style.opacity = me && !me.down && me.hp / me.maxHp < 0.3 ? 0.5 + Math.sin(performance.now() / 150) * 0.2 : 0;
  }

  // ---- 加護
  showBoons(ids, onPick) {
    const o = $("#boons"), list = $(".cards", o);
    list.innerHTML = "";
    o.classList.add("on");
    let done = false;
    ids.forEach((id, i) => {
      const b = BOONS.find((x) => x.id === id), r = RARITY[b.r];
      const c = el("button", `boon r${b.r} el-${b.el}`, `<div class="rar">${r.name}</div><div class="bico">${ICON[b.el] ?? "✦"}</div><h3>${b.name}</h3><p>${b.text}</p><kbd>${i + 1}</kbd>`);
      c.style.setProperty("--rc", r.color);
      c.style.animationDelay = i * 0.08 + "s";
      c.onclick = () => {
        if (done) return;
        done = true;
        c.classList.add("picked");
        setTimeout(() => o.classList.remove("on"), 450);
        removeEventListener("keydown", key);
        onPick(id);
      };
      list.append(c);
    });
    const key = (e) => { const n = +e.key; if (n >= 1 && n <= ids.length) list.children[n - 1].click(); };
    addEventListener("keydown", key);
    audio.play("boon");
  }
  hideBoons() { $("#boons").classList.remove("on"); }
  /** 選ばないまま次の部屋へ行くときは一番左を選ぶ */
  autoPickBoon() { const c = document.querySelector("#boons.on .boon:not(.picked)"); if (c && !document.querySelector("#boons.on .boon.picked")) c.click(); }

  // ---- 結果
  showResult(r) {
    const R = this.screens.result;
    $(".rt", R).textContent = r.win ? "巡礼、完遂" : "巡礼、途絶える";
    $(".rs", R).textContent = r.win ? "星は再び空へ還った" : `${Math.floor(r.room / 6) + 1}つ目のエリア、${(r.room % 6) + 1}部屋目で力尽きた`;
    const m = Math.floor(r.time / 60), s = Math.floor(r.time % 60);
    $(".rinfo", R).innerHTML = `<div><b>${m}:${String(s).padStart(2, "0")}</b>時間</div><div><b>${r.gold}</b>星屑</div><div><b>${r.maxCombo}</b>最大コンボ</div>`;
    const t = $(".rtable", R);
    t.innerHTML = "<tr><th></th><th>名前</th><th>職業</th><th>撃破</th><th>与ダメージ</th><th>加護</th></tr>" + r.stats.map((p) => `<tr><td><i style="background:${p.color}"></i></td><td>${esc(p.name)}</td><td>${CLASSES[p.cls].name}</td><td>${p.kills}</td><td>${p.dmg.toLocaleString()}</td><td>${p.boons}</td></tr>`).join("");
    R.classList.toggle("win", r.win);
    this.show("result");
  }
}
const ICON = { burn: "炎", chill: "氷", shock: "雷", holy: "聖", none: "星" };
