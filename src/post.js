// HD-2D の仕上げ: ドット絵の画面に、光源ライティング・ブルーム・ティルトシフト（被写界深度）・色調補正をかける。
// pixelfx のフレームは color（不透明ピクセル）と light（加算光）の2枚。light をぼかしたものが床や壁を照らす。

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

const FS = {
  // 縮小しながらぼかす（4タップのボックス）
  down: `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D t; uniform vec2 px; uniform float thr;
void main(){
  vec3 c = (texture(t, uv+px*vec2(-.5,-.5)).rgb + texture(t, uv+px*vec2(.5,-.5)).rgb + texture(t, uv+px*vec2(-.5,.5)).rgb + texture(t, uv+px*vec2(.5,.5)).rgb)*.25;
  if (thr > 0.) { float l = max(c.r, max(c.g, c.b)); c *= smoothstep(thr, thr+0.35, l); }
  o = vec4(c,1.);
}`,
  blur: `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D t; uniform vec2 dir;
void main(){
  vec3 c = texture(t, uv).rgb*0.227;
  c += (texture(t, uv+dir*1.385).rgb + texture(t, uv-dir*1.385).rgb)*0.316;
  c += (texture(t, uv+dir*3.231).rgb + texture(t, uv-dir*3.231).rgb)*0.070;
  o = vec4(c,1.);
}`,
  // ライティング: 色 × (環境光 + 点光源 + 効果の光) + 効果の光そのもの
  lit: `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D col, lgt, ill; uniform vec3 amb; uniform vec2 size;
uniform vec4 L[48]; uniform vec3 LC[48]; uniform int nL; uniform float illK;
void main(){
  vec2 q = vec2(uv.x, 1.-uv.y);
  vec4 c = texture(col, q); vec3 l = texture(lgt, q).rgb; vec3 il = texture(ill, q).rgb;
  vec2 p = q*size; vec3 acc = amb;
  for (int i=0;i<48;i++){ if(i>=nL) break; vec4 a=L[i]; vec2 d=(p-a.xy)*vec2(1.,1.35); float f=clamp(1.-length(d)/a.z,0.,1.); acc += LC[i]*a.w*f*f; }
  acc += il*illK;
  vec3 rgb = c.rgb*acc + l;
  o = vec4(rgb, 1.);
}`,
  final: `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D lit, b1, b2, dof, ocol, olgt; uniform vec2 size, scale; uniform vec4 box;
uniform float zoom, flash, tilt, time, desat, bloomK; uniform vec3 tint;
vec3 sharp(sampler2D t, vec2 u){ vec2 p=u*size; vec2 f=fract(p); vec2 a=clamp(f*scale,0.,.5)+clamp((f-1.)*scale+.5,0.,.5); return texture(t,(floor(p)+a)/size).rgb; }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec2 s = (gl_FragCoord.xy - box.xy)/box.zw; // 0..1 ゲーム画面内
  if (s.x<0.||s.y<0.||s.x>1.||s.y>1.) { o=vec4(0.,0.,0.,1.); return; }
  vec2 u = (s-.5)/zoom+.5;
  vec3 c = sharp(lit, u);
  // ティルトシフト: 画面の上と下をぼかしてミニチュア感を出す
  float y = 1.-s.y; float m = (1.-smoothstep(0.,0.30,y))*0.95 + smoothstep(0.80,1.,y)*0.9;
  c = mix(c, texture(dof, u).rgb, clamp(m*tilt,0.,1.));
  c += texture(b1,u).rgb*0.35*bloomK + texture(b2,u).rgb*0.45*bloomK;
  c *= tint;
  c = aces(c*1.08);
  // 色調: 影は青紫に、光は暖色に
  float lum = dot(c, vec3(.299,.587,.114));
  c = mix(c, c*vec3(.86,.9,1.14)+vec3(.012,.01,.03), (1.-smoothstep(0.,.45,lum))*.55);
  c = mix(c, c*vec3(1.06,1.,.9), smoothstep(.55,1.,lum)*.4);
  c = mix(c, vec3(lum), desat);
  vec2 v = s-.5; c *= 1.-dot(v,v)*0.85;
  c += (hash(gl_FragCoord.xy+time)-.5)*0.025;
  c = mix(c, vec3(1.), flash);
  // UI とダメージ数字はライティング・ぼかしなしで上に
  vec2 uo = vec2(s.x, s.y);
  vec2 po = uo*size; vec2 fo=fract(po); vec2 ao=clamp(fo*scale,0.,.5)+clamp((fo-1.)*scale+.5,0.,.5);
  vec2 ou = (floor(po)+ao)/size;
  vec4 oc = texture(ocol, vec2(ou.x, 1.-ou.y));
  vec3 ol = texture(olgt, vec2(uo.x, 1.-uo.y)).rgb;
  c = mix(c, oc.rgb, oc.a) + ol;
  o = vec4(c,1.);
}`,
};

export class Post {
  constructor(canvas, w, h) {
    this.w = w; this.h = h;
    const gl = (this.gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false }));
    if (!gl) throw new Error("WebGL2 が使えません");
    this.hdr = !!gl.getExtension("EXT_color_buffer_float");
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.progs = Object.fromEntries(Object.entries(FS).map(([k, src]) => [k, this.program(src)]));
    const tex = (filter) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.tex = { col: tex(gl.NEAREST), lgt: tex(gl.LINEAR), ocol: tex(gl.LINEAR), olgt: tex(gl.LINEAR) };
    for (const k in this.tex) { gl.bindTexture(gl.TEXTURE_2D, this.tex[k]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); }
    const fbo = (fw, fh) => {
      const t = tex(gl.LINEAR);
      if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, fw, fh, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { t, f, w: fw, h: fh };
    };
    const q = (d) => [Math.ceil(w / d), Math.ceil(h / d)];
    this.fb = {
      lit: fbo(w, h),
      i1: fbo(...q(4)), i2: fbo(...q(4)),
      h1: fbo(...q(2)), h2: fbo(...q(2)),
      q1: fbo(...q(4)), q2: fbo(...q(4)),
      d1: fbo(...q(2)), d2: fbo(...q(2)),
    };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.lights = new Float32Array(48 * 4);
    this.lightCol = new Float32Array(48 * 3);
  }
  program(fs) {
    const gl = this.gl, sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, "p");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {};
    return { p, u: (n) => (loc[n] ??= gl.getUniformLocation(p, n)) };
  }
  pass(name, target, uniforms, texs) {
    const gl = this.gl, P = this.progs[name];
    gl.useProgram(P.p);
    if (target) { gl.bindFramebuffer(gl.FRAMEBUFFER, target.f); gl.viewport(0, 0, target.w, target.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, gl.canvas.width, gl.canvas.height); }
    let unit = 0;
    for (const [n, t] of Object.entries(texs)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(P.u(n), unit++);
    }
    for (const [n, v] of Object.entries(uniforms)) {
      const l = P.u(n);
      if (l === null) continue;
      if (typeof v === "number") gl.uniform1f(l, v);
      else if (v.int) gl.uniform1i(l, v.int);
      else if (v.v4) gl.uniform4fv(l, v.v4);
      else if (v.v3) gl.uniform3fv(l, v.v3);
      else if (v.length === 2) gl.uniform2fv(l, v);
      else if (v.length === 3) gl.uniform3fv(l, v);
      else if (v.length === 4) gl.uniform4fv(l, v);
    }
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  upload(t, u32) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.w, this.h, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(u32.buffer));
  }
  /**
   * world/overlay: pixelfx frames. lights: [{x, y, r, k, c:[r,g,b]}] in view pixels.
   * fx: { ambient:[r,g,b], zoom, flash, tilt, desat, tint:[r,g,b] }
   */
  render(world, overlay, lights, fx, time) {
    const gl = this.gl, F = this.fb, W = this.w, H = this.h;
    this.upload(this.tex.col, world.color);
    this.upload(this.tex.lgt, world.light);
    this.upload(this.tex.ocol, overlay.color);
    this.upload(this.tex.olgt, overlay.light);
    const px = (fb) => [1 / fb.w, 1 / fb.h];
    // 効果の光を大きくぼかして、周りを照らす光にする
    this.pass("down", F.i1, { px: [4 / W, 4 / H], thr: 0 }, { t: this.tex.lgt });
    this.pass("blur", F.i2, { dir: [px(F.i1)[0] * 1.6, 0] }, { t: F.i1.t });
    this.pass("blur", F.i1, { dir: [0, px(F.i1)[1] * 1.6] }, { t: F.i2.t });
    this.pass("blur", F.i2, { dir: [px(F.i1)[0] * 3.2, 0] }, { t: F.i1.t });
    this.pass("blur", F.i1, { dir: [0, px(F.i1)[1] * 3.2] }, { t: F.i2.t });
    const n = Math.min(48, lights.length), L = this.lights, C = this.lightCol;
    for (let i = 0; i < n; i++) {
      const l = lights[i];
      L[i * 4] = l.x; L[i * 4 + 1] = l.y; L[i * 4 + 2] = l.r; L[i * 4 + 3] = l.k;
      C[i * 3] = l.c[0]; C[i * 3 + 1] = l.c[1]; C[i * 3 + 2] = l.c[2];
    }
    this.pass("lit", F.lit, { amb: fx.ambient, size: [W, H], L: { v4: L }, LC: { v3: C }, nL: { int: n || -1 }, illK: 1.0 }, { col: this.tex.col, lgt: this.tex.lgt, ill: F.i1.t });
    // ブルーム（2段）
    this.pass("down", F.h1, { px: px(F.lit), thr: 0.8 }, { t: F.lit.t });
    this.pass("blur", F.h2, { dir: [px(F.h1)[0], 0] }, { t: F.h1.t });
    this.pass("blur", F.h1, { dir: [0, px(F.h1)[1]] }, { t: F.h2.t });
    this.pass("down", F.q1, { px: px(F.h1), thr: 0 }, { t: F.h1.t });
    this.pass("blur", F.q2, { dir: [px(F.q1)[0] * 1.5, 0] }, { t: F.q1.t });
    this.pass("blur", F.q1, { dir: [0, px(F.q1)[1] * 1.5] }, { t: F.q2.t });
    // 被写界深度用のぼかし
    this.pass("down", F.d1, { px: px(F.lit), thr: 0 }, { t: F.lit.t });
    this.pass("blur", F.d2, { dir: [px(F.d1)[0] * 1.2, 0] }, { t: F.d1.t });
    this.pass("blur", F.d1, { dir: [0, px(F.d1)[1] * 1.2] }, { t: F.d2.t });
    // 画面へ。整数倍でなくてもドットが揃う sharp bilinear
    const cw = gl.canvas.width, ch = gl.canvas.height, k = Math.min(cw / W, ch / H);
    const bw = W * k, bh = H * k, bx = (cw - bw) / 2, by = (ch - bh) / 2;
    this.pass("final", null, {
      size: [W, H], scale: [k, k], box: [bx, by, bw, bh], zoom: fx.zoom ?? 1, flash: fx.flash ?? 0, tilt: fx.tilt ?? 1,
      time: time % 100, desat: fx.desat ?? 0, bloomK: fx.bloom ?? 1, tint: fx.tint ?? [1, 1, 1],
    }, { lit: F.lit.t, b1: F.h1.t, b2: F.q1.t, dof: F.d1.t, ocol: this.tex.ocol, olgt: this.tex.olgt });
  }
}
