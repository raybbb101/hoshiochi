// ルームコードでつなぐ P2P 通信（WebRTC / PeerJS）。
// ホストが部屋を作り、ゲストは最大3人までコードで参加する。ホストが全員のメッセージを中継する。
const PREFIX = "hoshiochi-v1-";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const MAX_PLAYERS = 4;

export function makeCode() {
  let s = "";
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
export const normalizeCode = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);

export class Net {
  constructor() {
    this.isHost = true; this.solo = true; this.slot = 0; this.code = null;
    this.peer = null; this.conns = new Map(); // slot -> conn（ホスト側）
    this.host = null; // ゲスト側の接続
    this.handlers = {};
    this.bytes = 0;
  }
  on(name, fn) { this.handlers[name] = fn; return this; }
  emit(name, ...a) { this.handlers[name]?.(...a); }

  /** 部屋を作る */
  createRoom() {
    return new Promise((resolve, reject) => {
      if (!window.Peer) return reject(new Error("通信ライブラリを読み込めませんでした"));
      const tryOpen = (n) => {
        const code = makeCode(), peer = new Peer(PREFIX + code, { debug: 0 });
        peer.on("open", () => {
          this.peer = peer; this.code = code; this.isHost = true; this.solo = false; this.slot = 0;
          peer.on("connection", (c) => this.accept(c));
          resolve(code);
        });
        peer.on("error", (e) => {
          if (e.type === "unavailable-id" && n < 4) { peer.destroy(); tryOpen(n + 1); }
          else if (!this.peer) reject(new Error(errorText(e)));
          else this.emit("error", errorText(e));
        });
        peer.on("disconnected", () => { try { peer.reconnect(); } catch {} });
      };
      tryOpen(0);
    });
  }
  accept(c) {
    c.on("open", () => {
      let slot = 1;
      while (this.conns.has(slot)) slot++;
      if (slot >= MAX_PLAYERS || this.locked) { c.send({ t: "full", reason: this.locked ? "ゲームはもう始まっています" : "部屋が満員です" }); setTimeout(() => c.close(), 300); return; }
      this.conns.set(slot, c);
      c.slot = slot;
      c.on("data", (m) => this.emit("message", slot, m));
      c.on("close", () => { if (this.conns.get(slot) === c) { this.conns.delete(slot); this.emit("leave", slot); } });
      c.on("error", () => {});
      this.emit("join", slot);
    });
  }
  /** 部屋に入る */
  joinRoom(code, hello) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) return reject(new Error("通信ライブラリを読み込めませんでした"));
      const peer = new Peer({ debug: 0 });
      let settled = false;
      const fail = (msg) => { if (!settled) { settled = true; peer.destroy(); reject(new Error(msg)); } };
      const to = setTimeout(() => fail("部屋が見つかりません（コードを確認してください）"), 12000);
      peer.on("error", (e) => {
        if (e.type === "peer-unavailable") fail("部屋が見つかりません（コードを確認してください）");
        else if (!settled) fail(errorText(e));
        else this.emit("error", errorText(e));
      });
      peer.on("open", () => {
        const c = peer.connect(PREFIX + code, { reliable: true, serialization: "json" });
        c.on("open", () => {
          this.peer = peer; this.host = c; this.isHost = false; this.solo = false; this.code = code;
          c.on("data", (m) => {
            if (m.t === "full") { fail(m.reason); return; }
            if (m.t === "welcome") { this.slot = m.slot; clearTimeout(to); if (!settled) { settled = true; resolve(m); } }
            this.emit("message", 0, m);
          });
          c.on("close", () => { if (settled) this.emit("hostLost"); else fail("接続が切れました"); });
          // 名前と職業を名乗る → ホストが welcome を返す
          c.send(hello);
        });
        c.on("error", () => fail("接続に失敗しました"));
      });
    });
  }
  /** ゲスト→ホスト、またはホスト→全員 */
  send(m) {
    if (this.solo) return;
    if (this.isHost) for (const c of this.conns.values()) this.raw(c, m);
    else if (this.host) this.raw(this.host, m);
  }
  sendTo(slot, m) { const c = this.conns.get(slot); if (c) this.raw(c, m); }
  /** ホスト: ある人以外の全員へ（中継） */
  sendExcept(slot, m) { for (const [s, c] of this.conns) if (s !== slot) this.raw(c, m); }
  raw(c, m) { try { if (c.open) c.send(m); } catch {} }
  get peers() { return [...this.conns.keys()]; }
  close() { try { this.peer?.destroy(); } catch {} this.peer = null; this.conns.clear(); this.host = null; this.solo = true; this.isHost = true; this.slot = 0; }
}

function errorText(e) {
  const map = {
    "browser-incompatible": "このブラウザは対応していません",
    network: "サーバーにつながりません（ネットワークを確認してください）",
    "server-error": "接続サーバーのエラーです。少し待ってからもう一度",
    "socket-error": "接続サーバーとの通信が切れました",
    "peer-unavailable": "部屋が見つかりません",
  };
  return map[e.type] ?? `通信エラー（${e.type ?? e.message}）`;
}
