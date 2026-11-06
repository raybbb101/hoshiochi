// キーボード・マウス・ゲームパッド
export class Input {
  constructor(canvas) {
    this.keys = new Set(); this.pressed = new Set();
    this.mouse = { x: 0, y: 0, down: false, right: false, moved: -99 };
    this.canvas = canvas; this.pad = null; this.padAim = null; this.usingPad = false;
    addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT") return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
      this.usingPad = false;
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => { this.keys.clear(); this.mouse.down = this.mouse.right = false; });
    canvas.addEventListener("mousemove", (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.moved = performance.now(); this.usingPad = false; });
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) { this.mouse.right = true; this.pressed.add("Mouse2"); }
      this.mouse.moved = performance.now();
    });
    addEventListener("mouseup", (e) => { if (e.button === 0) this.mouse.down = false; if (e.button === 2) this.mouse.right = false; });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.padPrev = {};
  }
  poll() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const p = pads[0];
    this.pad = null;
    if (!p) return;
    const dz = (v) => (Math.abs(v) < 0.2 ? 0 : v);
    const b = (i) => !!p.buttons[i]?.pressed;
    const st = { lx: dz(p.axes[0]), ly: dz(p.axes[1]), rx: dz(p.axes[2] ?? 0), ry: dz(p.axes[3] ?? 0), a: b(0), x: b(2), y: b(3), bb: b(1), lb: b(4), rb: b(5), lt: b(6), rt: b(7), start: b(9) };
    const edge = (k) => st[k] && !this.padPrev[k];
    this.pad = { ...st, dash: edge("a") || edge("lb"), skill: edge("y") || edge("lt"), ult: edge("bb") || edge("rb"), attack: st.x || st.rt, start: edge("start") };
    if (Object.values(st).some((v) => v === true || (typeof v === "number" && v !== 0))) this.usingPad = true;
    this.padPrev = st;
  }
  get move() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has("KeyA") || k.has("ArrowLeft")) x -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) x += 1;
    if (k.has("KeyW") || k.has("ArrowUp")) y -= 1;
    if (k.has("KeyS") || k.has("ArrowDown")) y += 1;
    if (this.pad && (this.pad.lx || this.pad.ly)) { x = this.pad.lx; y = this.pad.ly; }
    const l = Math.hypot(x, y);
    return l > 1 ? [x / l, y / l] : [x, y];
  }
  get attack() { return this.mouse.down || this.keys.has("KeyJ") || !!this.pad?.attack; }
  take(code) { const h = this.pressed.has(code); this.pressed.delete(code); return h; }
  get skill() { return this.take("Mouse2") | this.take("KeyK") | this.take("KeyE") | !!this.pad?.skill; }
  get dash() { return this.take("Space") | this.take("ShiftLeft") | this.take("ShiftRight") | this.take("KeyL") | !!this.pad?.dash; }
  get ult() { return this.take("KeyQ") | this.take("KeyR") | this.take("KeyI") | !!this.pad?.ult; }
  get pause() { return this.take("Escape") | !!this.pad?.start; }
  /** 右スティックの向き（なければ null） */
  get stick() { return this.pad && (this.pad.rx || this.pad.ry) ? Math.atan2(this.pad.ry, this.pad.rx) : null; }
  endFrame() { this.pressed.clear(); }
}
