import { drawDoc } from '../../src/engine/design/render';
import { fxPlan } from '../../src/engine/fx/plan';
import type { DesignDoc, Layer, RasterLayer, RasterStroke } from '../../src/engine/types';
import type { FxLayer } from '../../src/engine/fx/types';
import type { Engine, View } from './types';
import type { Scene } from './scene';

/*
 * WebGL2 with our own shaders (Tarea 2). Scope: what the professional document uses. Layers are textures composed
 * with premultiplied 'over'; editable strokes are point sprites (size, hardness, opacity from the stroke); FX: blur
 * (separable Gaussian), colour matrix (saturation, hue), levels and curves (33-entry table), drop shadow, glow.
 * Not reproduced: W3C blend modes other than normal and multiply (the document uses only normal); curves are a
 * piecewise-linear table, not OGS's monotone spline.
 */

const FX_MAX_PX = 16_000_000;
const VS_QUAD = `#version 300 es
in vec2 a_pos; uniform vec4 u_rect; uniform vec2 u_res; out vec2 v_uv;
void main() { vec2 p = u_rect.xy + a_pos * u_rect.zw; gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0); v_uv = a_pos; }`;
const FS_TEX = `#version 300 es
precision highp float; in vec2 v_uv; uniform sampler2D u_tex; uniform float u_alpha; out vec4 o;
void main() { o = texture(u_tex, v_uv) * u_alpha; }`;
const FS_BLUR = `#version 300 es
precision highp float; in vec2 v_uv; uniform sampler2D u_tex; uniform vec2 u_step; uniform float u_w[17]; uniform int u_n; out vec4 o;
void main() { vec4 s = vec4(0.0); for (int i = -16; i <= 16; i++) { if (abs(i) > u_n) continue; s += texture(u_tex, v_uv + u_step * float(i)) * u_w[abs(i)]; } o = s; }`;
const FS_COLOR = `#version 300 es
precision highp float; in vec2 v_uv; uniform sampler2D u_tex; uniform mat4 u_m; uniform float u_lut[33]; uniform int u_lut_on; out vec4 o;
float lut(float x) { float t = clamp(x, 0.0, 1.0) * 32.0; int i = int(floor(min(t, 31.999))); return mix(u_lut[i], u_lut[i + 1], t - float(i)); }
void main() { vec4 c = texture(u_tex, v_uv); float a = c.a; vec3 rgb = a > 0.0 ? c.rgb / a : vec3(0.0);
  rgb = (u_m * vec4(rgb, 1.0)).rgb; if (u_lut_on == 1) rgb = vec3(lut(rgb.r), lut(rgb.g), lut(rgb.b));
  rgb = clamp(rgb, 0.0, 1.0); o = vec4(rgb * a, a); }`;
const FS_SHADOW = `#version 300 es
precision highp float; in vec2 v_uv; uniform sampler2D u_src; uniform sampler2D u_blur; uniform vec2 u_off; uniform vec4 u_col; out vec4 o;
void main() { vec4 s = texture(u_src, v_uv); float sa = texture(u_blur, v_uv - u_off).a * u_col.a; vec4 sh = vec4(u_col.rgb * sa, sa); o = s + sh * (1.0 - s.a); }`;
const FS_GLOW = `#version 300 es
precision highp float; in vec2 v_uv; uniform sampler2D u_src; uniform sampler2D u_blur; uniform float u_k; out vec4 o;
void main() { vec4 s = texture(u_src, v_uv); vec4 b = texture(u_blur, v_uv) * u_k; o = s + b - s * b; }`;
const FS_POINT = `#version 300 es
precision highp float; in vec4 v_col; in float v_hard; uniform float u_alpha; out vec4 o;
void main() { vec2 c = gl_PointCoord * 2.0 - 1.0; float d = length(c); float a = 1.0 - smoothstep(v_hard, 1.0, d); float al = v_col.a * a * u_alpha; o = vec4(v_col.rgb * al, al); }`;
const VS_POINT = `#version 300 es
in vec2 a_p; in float a_size; in vec4 a_col; in float a_hard; uniform vec2 u_scale; uniform vec2 u_res; out vec4 v_col; out float v_hard;
void main() { vec2 p = a_p * u_scale; gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0); gl_PointSize = a_size * u_scale.x; v_col = a_col; v_hard = a_hard; }`;

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
type Target = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number; busy: boolean };
type Batch = { buf: WebGLBuffer; count: number; hard: number; multiply: boolean };

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Dabs along each segment, as [x, y, size, r, g, b, a, hardness, multiply] per dab, in document px. */
function dabsOf(s: RasterStroke): Float32Array {
  const [r, g, b] = hexRgb(s.color), hard = s.tip?.hardness ?? 1, mult = s.tip?.blend === 'multiply' ? 1 : 0;
  const out: number[] = [];
  for (const [ax, ay, bx, by, w] of s.segments) {
    const len = Math.hypot(bx - ax, by - ay), step = Math.max(0.5, w / 4), n = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      out.push(ax + (bx - ax) * t + s.x, ay + (by - ay) * t + s.y, Math.max(1, w), r, g, b, s.opacity, hard, mult);
    }
  }
  return Float32Array.from(out);
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string, uniforms: string[], attribs: string[] = ['a_pos']): Prog {
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader'); return s; };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return { p, u: Object.fromEntries(uniforms.map((n) => [n, gl.getUniformLocation(p, n)])) };
}

export function webgl2Engine(): Engine {
  let gl: WebGL2RenderingContext, canvas: HTMLCanvasElement;
  let quad: WebGLBuffer, progTex: Prog, progBlur: Prog, progColor: Prog, progShadow: Prog, progGlow: Prog, progPoint: Prog;
  const baseTex = new WeakMap<HTMLCanvasElement, WebGLTexture>();
  const vecTex = new Map<string, { layer: Layer; tex: WebGLTexture }>();
  const allTex: WebGLTexture[] = [], allFb: WebGLFramebuffer[] = [], allBuf: WebGLBuffer[] = [];
  const dabs = new WeakMap<RasterStroke, Float32Array>();
  const layerBatches = new Map<string, { layer: RasterLayer; batches: Batch[] }>();
  const fbos: Target[] = [];
  let texBytes = 0, scene: Scene;

  const tex = (w: number, h: number, data?: TexImageSource) => {
    const t = gl.createTexture()!; allTex.push(t);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  };
  const target = (w: number, h: number): Target => {
    const t = tex(w, h), fb = gl.createFramebuffer()!; allFb.push(fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { fb, tex: t, w, h, busy: false };
  };
  /** A free render target of this size, marked busy until its user sets busy = false. */
  const pool = (w: number, h: number): Target => {
    let f = fbos.find((x) => x.w === w && x.h === h && !x.busy);
    if (!f) { f = target(w, h); fbos.push(f); texBytes += w * h * 4; }
    f.busy = true;
    return f;
  };
  /** One full-target pass. `over` composites onto the target (premultiplied over); otherwise it replaces it. */
  const draw = (prog: Prog, bindTex: (unit: number) => void, rect: number[], res: [number, number], set: () => void = () => {}, over = false) => {
    if (over) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
    gl.useProgram(prog.p); bindTex(0); set();
    gl.uniform4f(prog.u.u_rect, rect[0], rect[1], rect[2], rect[3]); gl.uniform2f(prog.u.u_res, res[0], res[1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  const bindTexOf = (t: WebGLTexture) => (unit: number) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
  const blurPass = (src: WebGLTexture, sw: number, sh: number, sigma: number, out: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }) => {
    // Two passes through a scratch target of the same size: horizontal into scratch, vertical back into out.
    const n = Math.max(1, Math.min(16, Math.ceil(3 * sigma)));
    const w = Array.from({ length: 17 }, (_, i) => (i <= n ? Math.exp(-(i * i) / (2 * sigma * sigma)) : 0));
    const sum = w[0] + 2 * w.slice(1).reduce((a, b) => a + b, 0);
    const norm = w.map((v) => v / sum);
    const mid = pool(sw, sh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, mid.fb); gl.viewport(0, 0, sw, sh);
    draw(progBlur, bindTexOf(src), [0, 0, sw, sh], [sw, sh], () => { gl.uniform2f(progBlur.u.u_step, 1 / sw, 0); gl.uniform1fv(progBlur.u.u_w, norm); gl.uniform1i(progBlur.u.u_n, n); });
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb); gl.viewport(0, 0, sw, sh);
    draw(progBlur, bindTexOf(mid.tex), [0, 0, sw, sh], [sw, sh], () => { gl.uniform2f(progBlur.u.u_step, 0, 1 / sh); gl.uniform1fv(progBlur.u.u_w, norm); gl.uniform1i(progBlur.u.u_n, n); });
    mid.busy = false;
  };
  const colorMatrix = (m3: number[]) => { const M = new Float32Array(16); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[c * 4 + r] = m3[r * 3 + c]; M[15] = 1; return M; };
    const saturateM = (a: number) => [0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a, 0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a, 0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a];
  const hueM = (deg: number) => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283, 0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072]; };
  const toneLut = (op: { kind: string; params: Record<string, number | string> }) => {
    const v = (k: string, d: number) => Number(op.params[k] ?? d);
    return Array.from({ length: 33 }, (_, i) => {
      const x = i / 32;
      if (op.kind === 'levels') {
        const b = v('inBlack', 0), w = Math.max(b + 1e-3, v('inWhite', 1)), g = Math.max(0.1, v('gamma', 1));
        const t = Math.min(1, Math.max(0, (x - b) / (w - b)));
        return v('outBlack', 0) + Math.pow(t, 1 / g) * (v('outWhite', 1) - v('outBlack', 0));
      }
      const pts: Array<[number, number]> = [[0, 0], [0.25, v('shadows', 0.25)], [0.5, v('midtones', 0.5)], [0.75, v('highlights', 0.75)], [1, 1]];
      for (let k = 1; k < pts.length; k++) if (x <= pts[k][0]) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]; return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); }
      return 1;
    });
  };
  /** Applies one FX op to `cur` (a target texture of size sw×sh), returning the target holding the result. */
  const applyOp = (cur: { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number }, op: { kind: string; enabled: boolean; params: Record<string, number | string> }, scale: number, sw: number, sh: number) => {
    if (!op.enabled) return cur;
    const num = (k: string, d: number) => Number(op.params[k] ?? d);
    const out = pool(sw, sh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb); gl.viewport(0, 0, sw, sh);
    if (op.kind === 'blur') {
      const tmp = pool(sw, sh);
      blurPass(cur.tex, sw, sh, Math.max(0.01, num('radius', 4) * scale), tmp);
      // blurPass wrote into tmp: copy to out through the texture pass.
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb);
      draw(progTex, bindTexOf(tmp.tex), [0, 0, sw, sh], [sw, sh], () => gl.uniform1f(progTex.u.u_alpha, 1));
      tmp.busy = false; return out;
    }
    if (['saturation', 'hue', 'levels', 'curves'].includes(op.kind)) {
      const m = op.kind === 'saturation' ? saturateM(num('amount', 1)) : op.kind === 'hue' ? hueM(num('degrees', 0)) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
      const M = colorMatrix(m);
      const lut = op.kind === 'levels' || op.kind === 'curves' ? toneLut(op as never) : Array(33).fill(0);
      draw(progColor, bindTexOf(cur.tex), [0, 0, sw, sh], [sw, sh], () => {
        gl.uniformMatrix4fv(progColor.u.u_m, false, M); gl.uniform1fv(progColor.u.u_lut, Float32Array.from(lut));
        gl.uniform1i(progColor.u.u_lut_on, op.kind === 'levels' || op.kind === 'curves' ? 1 : 0);
      });
      return out;
    }
    if (op.kind === 'shadow') {
      const sigma = Math.max(0.01, (num('blur', 12) * scale) / 2);
      const blurred = pool(sw, sh);
      blurPass(cur.tex, sw, sh, sigma, blurred);
      const [r, g, b] = hexRgb(String(op.params.color ?? '#000000'));
      draw(progShadow, (u) => { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, cur.tex); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, blurred.tex); }, [0, 0, sw, sh], [sw, sh], () => {
        gl.uniform1i(progShadow.u.u_src, 0); gl.uniform1i(progShadow.u.u_blur, 1);
        gl.uniform2f(progShadow.u.u_off, (num('x', 8) * scale) / sw, (num('y', 8) * scale) / sh);
        gl.uniform4f(progShadow.u.u_col, r, g, b, num('opacity', 0.6));
      });
      blurred.busy = false;
      return out;
    }
    if (op.kind === 'glow') {
      const blurred = pool(sw, sh);
      blurPass(cur.tex, sw, sh, Math.max(0.01, num('radius', 12) * scale), blurred);
      draw(progGlow, (u) => { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, cur.tex); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, blurred.tex); }, [0, 0, sw, sh], [sw, sh], () => {
        gl.uniform1i(progGlow.u.u_src, 0); gl.uniform1i(progGlow.u.u_blur, 1); gl.uniform1f(progGlow.u.u_k, num('strength', 0.8));
      });
      blurred.busy = false;
      return out;
    }
    out.busy = false;
    return cur; // unsupported kinds leave the image as it is (flare, not in the document)
  };
  const chain = (start: { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number }, ops: Array<{ kind: string; enabled: boolean; params: Record<string, number | string> }>, scale: number, sw: number, sh: number) => {
    let cur = start;
    for (const op of ops) cur = applyOp(cur, op, scale, sw, sh);
    return cur;
  };
  const batchesOf = (layer: RasterLayer): Batch[] => {
    const groups = new Map<string, Float32Array[]>();
    for (const s of layer.paintStrokes ?? []) {
      const d = dabs.get(s) ?? dabsOf(s); dabs.set(s, d);
      const key = `${s.tip?.hardness ?? 1}|${s.tip?.blend === 'multiply' ? 1 : 0}`;
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
    return [...groups.entries()].map(([key, parts]) => {
      const [hard, mult] = key.split('|');
      const total = parts.reduce((n, p) => n + p.length, 0), all = new Float32Array(total);
      let off = 0; for (const p of parts) { all.set(p, off); off += p.length; }
      const buf = gl.createBuffer()!; allBuf.push(buf); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, all, gl.STATIC_DRAW);
      return { buf, count: total / 9, hard: Number(hard), multiply: mult === '1' };
    });
  };
  const drawBatches = (layer: RasterLayer, scale: number, W: number, H: number, alpha: number) => {
    let entry = layerBatches.get(layer.id);
    if (!entry || entry.layer !== layer) entry = { layer, batches: batchesOf(layer) };
    layerBatches.set(layer.id, entry);
    gl.useProgram(progPoint.p);
    gl.uniform2f(progPoint.u.u_scale, scale, scale); gl.uniform2f(progPoint.u.u_res, W, H); gl.uniform1f(progPoint.u.u_alpha, alpha);
    for (const b of entry.batches) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 36, 0);  // a_p
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 36, 8);  // a_size
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 36, 12); // a_col
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 36, 28); // a_hard
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(b.multiply ? gl.DST_COLOR : gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, b.count);
    }
  };
  const pageSize = (doc: DesignDoc, scale: number) => [Math.max(1, Math.floor(doc.width * scale)), Math.max(1, Math.floor(doc.height * scale))];
  const scaleOf = (doc: DesignDoc, zoom: number) => Math.min(zoom, Math.sqrt(FX_MAX_PX / Math.max(1, doc.width * doc.height)));

  const pageInto = (doc: DesignDoc, scale: number) => {
    const [W, H] = pageSize(doc, scale);
    const acc = pool(W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fb); gl.viewport(0, 0, W, H);
    gl.clearColor(...(doc.background ? hexRgb(doc.background) : [0, 0, 0]), doc.background ? 1 : 0); gl.clear(gl.COLOR_BUFFER_BIT);
    for (const s of fxPlan(doc.layers)) {
      if (s.t === 'draw') {
        const l = s.layer;
        if (l.type === 'raster') {
          const base = scene.bases.get(l.id);
          let t = base && baseTex.get(base);
          if (base && !t) { t = tex(0, 0, base); baseTex.set(base, t); texBytes += base.width * base.height * 4; }
          gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fb); gl.viewport(0, 0, W, H);
          if (t) draw(progTex, bindTexOf(t), [l.x * scale, l.y * scale, l.width * scale, l.height * scale], [W, H], () => gl.uniform1f(progTex.u.u_alpha, l.opacity), true);
          drawBatches(l, scale, W, H, l.opacity);
        } else {
          let t = vecTex.get(l.id)?.layer === l ? vecTex.get(l.id)!.tex : undefined;
          if (!t) {
            const old = vecTex.get(l.id); if (old) gl.deleteTexture(old.tex);
            const c = document.createElement('canvas'); c.width = doc.width; c.height = doc.height;
            drawDoc(c.getContext('2d')!, { ...doc, background: null, layers: [l] }, { resolution: 'document' });
            t = tex(0, 0, c); vecTex.set(l.id, { layer: l, tex: t }); texBytes += c.width * c.height * 4; c.width = 0;
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fb); gl.viewport(0, 0, W, H);
          draw(progTex, bindTexOf(t), [0, 0, W, H], [W, H], () => gl.uniform1f(progTex.u.u_alpha, l.opacity), true);
        }
      } else if (s.t === 'below') {
        const r = chain(acc, (s.fx as FxLayer).ops, scale, W, H);
        if (r !== acc) { gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fb); gl.viewport(0, 0, W, H); draw(progTex, bindTexOf(r.tex), [0, 0, W, H], [W, H], () => gl.uniform1f(progTex.u.u_alpha, 1)); r.busy = false; }
      } else {
        // A layer with FX on it: the layer alone, filtered, then composited with its opacity.
        const own = pool(W, H);
        gl.bindFramebuffer(gl.FRAMEBUFFER, own.fb); gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        const l = s.layer;
        if (l.type === 'raster') {
          const base = scene.bases.get(l.id); const t = base && baseTex.get(base);
          if (t) draw(progTex, bindTexOf(t), [l.x * scale, l.y * scale, l.width * scale, l.height * scale], [W, H], () => gl.uniform1f(progTex.u.u_alpha, 1));
          drawBatches(l, scale, W, H, 1);
        }
        let cur = own;
        for (const fx of s.fx) cur = chain(cur, fx.ops, scale, W, H);
        gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fb); gl.viewport(0, 0, W, H);
        draw(progTex, bindTexOf(cur.tex), [0, 0, W, H], [W, H], () => gl.uniform1f(progTex.u.u_alpha, l.opacity), true);
        if (cur !== own) cur.busy = false;
        own.busy = false;
      }
    }
    acc.busy = false;
    return acc;
  };

  return {
    name: 'webgl2',
    async init(sc, cv) {
      scene = sc; canvas = cv;
      const ctx = cv.getContext('webgl2', { antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
      if (!ctx) throw new Error('WebGL2 unavailable');
      gl = ctx;
      gl.getExtension('EXT_color_buffer_float');
      quad = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      const uTex = ['u_rect', 'u_res', 'u_alpha', 'u_tex'];
      progTex = compile(gl, VS_QUAD, FS_TEX, uTex);
      progBlur = compile(gl, VS_QUAD, FS_BLUR, ['u_rect', 'u_res', 'u_tex', 'u_step', 'u_w', 'u_n']);
      progColor = compile(gl, VS_QUAD, FS_COLOR, ['u_rect', 'u_res', 'u_tex', 'u_m', 'u_lut', 'u_lut_on']);
      progShadow = compile(gl, VS_QUAD, FS_SHADOW, ['u_rect', 'u_res', 'u_src', 'u_blur', 'u_off', 'u_col']);
      progGlow = compile(gl, VS_QUAD, FS_GLOW, ['u_rect', 'u_res', 'u_src', 'u_blur', 'u_k']);
      progPoint = compile(gl, VS_POINT, FS_POINT, ['u_scale', 'u_res', 'u_alpha'], ['a_p', 'a_size', 'a_col', 'a_hard']);
      // Bases: uploaded once here, as every engine holds its own copy of the flattened layers.
      for (const [, base] of sc.bases) { baseTex.set(base, tex(0, 0, base)); texBytes += base.width * base.height * 4; }
    },
    layerChanged(_doc, layerId) { layerBatches.delete(layerId); },
    dispose() {
      for (const t of allTex) gl.deleteTexture(t);
      for (const f of allFb) gl.deleteFramebuffer(f);
      for (const b of allBuf) gl.deleteBuffer(b);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.width = 0;
    },
    render(doc, view) {
      const scale = scaleOf(doc, view.zoom);
      const acc = pageInto(doc, scale);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, view.width, view.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      draw(progTex, bindTexOf(acc.tex), [view.x, view.y, doc.width * view.zoom, doc.height * view.zoom], [view.width, view.height], () => gl.uniform1f(progTex.u.u_alpha, 1));
    },
    sync() { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); },
    fullPage(doc) {
      const acc = pageInto(doc, 1);
      const out = new Uint8Array(doc.width * doc.height * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fb);
      gl.readPixels(0, 0, doc.width, doc.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
      // Rows come bottom-up from the framebuffer: flip to top-first.
      const row = doc.width * 4, flipped = new Uint8ClampedArray(out.length);
      for (let y = 0; y < doc.height; y++) flipped.set(out.subarray((doc.height - 1 - y) * row, (doc.height - y) * row), y * row);
      acc.busy = false;
      return flipped;
    },
    textureBytes: () => texBytes,
  };
}
