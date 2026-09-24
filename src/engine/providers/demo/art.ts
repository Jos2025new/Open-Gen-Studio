import { hashString, mulberry32 } from '../../../lib/rng';

/* Procedural "generations" for the local demo provider. Deterministic per prompt + seed. */

export interface Palette {
  sky: [string, string, string];
  accent: string;
  ink: string;
  light: string;
}

type Scene = 'landscape' | 'orbs' | 'portrait' | 'product' | 'city';

const KEYWORDS: Array<{ words: string[]; palette: Palette }> = [
  { words: ['sunset', 'atardecer', 'dusk', 'ocaso', 'golden', 'dorada'], palette: { sky: ['#2b1b3d', '#c2456b', '#ffb46b'], accent: '#ffd08a', ink: '#1a0f24', light: '#ffe2b8' } },
  { words: ['ocean', 'sea', 'mar', 'océano', 'playa', 'beach', 'underwater', 'agua', 'water'], palette: { sky: ['#03152b', '#0b5b7c', '#6fd3d8'], accent: '#bff3ef', ink: '#021021', light: '#e3fbff' } },
  { words: ['forest', 'bosque', 'jungle', 'selva', 'nature', 'naturaleza', 'green', 'verde', 'plant', 'planta'], palette: { sky: ['#0b1f14', '#2f6b3f', '#a8d58a'], accent: '#e7f5b0', ink: '#07140c', light: '#f1ffd8' } },
  { words: ['neon', 'cyber', 'cyberpunk', 'synthwave', 'futur', 'sci-fi', 'rave'], palette: { sky: ['#0a0418', '#5b1e8c', '#ff3fa4'], accent: '#35f2ff', ink: '#06020f', light: '#ffd1f0' } },
  { words: ['night', 'noche', 'moon', 'luna', 'stars', 'estrellas', 'space', 'espacio', 'galaxy'], palette: { sky: ['#02030a', '#141a3d', '#3a4b8f'], accent: '#e8ecff', ink: '#010108', light: '#c9d4ff' } },
  { words: ['desert', 'desierto', 'sand', 'arena', 'dune', 'duna', 'canyon'], palette: { sky: ['#3b2415', '#c47a3d', '#f3d29a'], accent: '#fff0cc', ink: '#241308', light: '#ffeccc' } },
  { words: ['snow', 'nieve', 'winter', 'invierno', 'ice', 'hielo', 'arctic'], palette: { sky: ['#1b2838', '#7d9bb8', '#eef4fa'], accent: '#ffffff', ink: '#0f1824', light: '#ffffff' } },
  { words: ['luxury', 'lujo', 'gold', 'oro', 'premium', 'elegant', 'elegante', 'black', 'negro'], palette: { sky: ['#050505', '#1c1812', '#4a3b22'], accent: '#e2bf6a', ink: '#000000', light: '#f5deaa' } },
  { words: ['pastel', 'soft', 'suave', 'candy', 'dulce', 'kawaii'], palette: { sky: ['#f2d5e9', '#d4dcf7', '#fbeed4'], accent: '#ffffff', ink: '#8a6f9e', light: '#ffffff' } },
  { words: ['coffee', 'café', 'cafe', 'chocolate', 'wood', 'madera', 'autumn', 'otoño'], palette: { sky: ['#1e120b', '#6b3f22', '#d19a62'], accent: '#f7d9b0', ink: '#140a05', light: '#ffe7c6' } },
  { words: ['red', 'rojo', 'fire', 'fuego', 'lava'], palette: { sky: ['#1a0303', '#8c1414', '#ff6a3d'], accent: '#ffd0b0', ink: '#0d0101', light: '#ffe0cc' } },
  { words: ['blue', 'azul', 'sky', 'cielo'], palette: { sky: ['#07122e', '#1f4fa8', '#8fc2ff'], accent: '#e4f1ff', ink: '#040a1c', light: '#eaf4ff' } },
  { words: ['purple', 'morado', 'violet', 'violeta', 'lavender'], palette: { sky: ['#12061f', '#5a2a8c', '#c79bff'], accent: '#f2e3ff', ink: '#0a0314', light: '#f6ecff' } },
  { words: ['pink', 'rosa'], palette: { sky: ['#2a0a1c', '#c43d7e', '#ffb3d1'], accent: '#fff0f6', ink: '#1a0612', light: '#fff0f6' } },
];

const SCENES: Array<{ scene: Scene; words: string[] }> = [
  { scene: 'portrait', words: ['portrait', 'retrato', 'woman', 'mujer', 'man', 'hombre', 'person', 'persona', 'girl', 'chica', 'boy', 'chico', 'model', 'modelo', 'face', 'rostro', 'character', 'personaje'] },
  { scene: 'product', words: ['product', 'producto', 'bottle', 'botella', 'perfume', 'shoe', 'zapat', 'sneaker', 'package', 'packaging', 'watch', 'reloj', 'can', 'lata', 'cosmetic', 'cosmético', 'mockup'] },
  { scene: 'city', words: ['city', 'ciudad', 'building', 'edificio', 'street', 'calle', 'skyline', 'urban', 'urbano', 'architecture', 'arquitectura'] },
  { scene: 'landscape', words: ['landscape', 'paisaje', 'mountain', 'montaña', 'valley', 'valle', 'sunset', 'atardecer', 'desert', 'desierto', 'lake', 'lago'] },
];

export function paletteFor(prompt: string, seed: number): Palette {
  const p = prompt.toLowerCase();
  for (const k of KEYWORDS) if (k.words.some((w) => p.includes(w))) return k.palette;
  const rnd = mulberry32(hashString(prompt) ^ seed);
  const h = Math.floor(rnd() * 360);
  const h2 = (h + 30 + Math.floor(rnd() * 60)) % 360;
  return {
    sky: [`hsl(${h} 45% 8%)`, `hsl(${h} 50% 32%)`, `hsl(${h2} 70% 68%)`],
    accent: `hsl(${h2} 85% 82%)`,
    ink: `hsl(${h} 40% 5%)`,
    light: `hsl(${h2} 90% 92%)`,
  };
}

export function sceneFor(prompt: string, seed: number): Scene {
  const p = prompt.toLowerCase();
  for (const s of SCENES) if (s.words.some((w) => p.includes(w))) return s.scene;
  return mulberry32(hashString(prompt) + seed)() > 0.5 ? 'landscape' : 'orbs';
}

/** Draw one frame. `t` in [0,1] animates the scene (0 for still images). */
export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, prompt: string, seed: number, t = 0): void {
  const pal = paletteFor(prompt, seed);
  const scene = sceneFor(prompt, seed);
  const rnd = mulberry32(hashString(`${prompt}|${seed}`));
  ctx.save();
  // Camera drift for video frames.
  const zoom = 1 + t * 0.08;
  ctx.translate(w / 2, h / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-w / 2 + (rnd() - 0.5) * t * w * 0.04, -h / 2);

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, pal.sky[0]);
  sky.addColorStop(0.55, pal.sky[1]);
  sky.addColorStop(1, pal.sky[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(-w * 0.1, -h * 0.1, w * 1.2, h * 1.2);

  const u = Math.min(w, h);
  switch (scene) {
    case 'landscape': {
      const sunY = h * (0.52 - t * 0.12) + rnd() * h * 0.06;
      const sunX = w * (0.3 + rnd() * 0.4);
      glow(ctx, sunX, sunY, u * 0.42, pal.light, 0.55);
      ctx.fillStyle = pal.accent;
      ctx.beginPath();
      ctx.arc(sunX, sunY, u * (0.07 + rnd() * 0.04), 0, Math.PI * 2);
      ctx.fill();
      for (let layer = 0; layer < 4; layer++) {
        const base = h * (0.58 + layer * 0.1);
        ctx.fillStyle = mix(pal.sky[1], pal.ink, 0.35 + layer * 0.2);
        ctx.beginPath();
        ctx.moveTo(-w * 0.1, h * 1.1);
        const amp = h * (0.12 - layer * 0.02);
        const f1 = 1.5 + rnd() * 2.5;
        const f2 = 4 + rnd() * 5;
        const ph = rnd() * 10 + t * (layer + 1) * 0.4;
        for (let x = -w * 0.1; x <= w * 1.1; x += w / 80) {
          const y = base - amp * (0.6 * Math.sin((x / w) * f1 + ph) + 0.4 * Math.sin((x / w) * f2 + ph * 1.7));
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w * 1.1, h * 1.1);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'orbs': {
      for (let i = 0; i < 7; i++) {
        const x = w * rnd() + Math.sin(t * Math.PI * 2 + i) * w * 0.03;
        const y = h * rnd() + Math.cos(t * Math.PI * 2 + i) * h * 0.03;
        glow(ctx, x, y, u * (0.18 + rnd() * 0.35), i % 2 ? pal.accent : pal.light, 0.35 + rnd() * 0.3);
      }
      ctx.strokeStyle = withAlpha(pal.light, 0.25);
      ctx.lineWidth = Math.max(1, u * 0.002);
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.5, u * (0.15 + i * 0.08 + t * 0.02), 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'portrait': {
      glow(ctx, w * 0.5, h * 0.42, u * 0.55, pal.light, 0.45);
      const cx = w * 0.5 + Math.sin(t * Math.PI) * u * 0.01;
      ctx.fillStyle = pal.ink;
      ctx.beginPath();
      ctx.ellipse(cx, h * 0.4, u * 0.12, u * 0.155, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - u * 0.36, h * 1.02);
      ctx.quadraticCurveTo(cx - u * 0.3, h * 0.6, cx, h * 0.58);
      ctx.quadraticCurveTo(cx + u * 0.3, h * 0.6, cx + u * 0.36, h * 1.02);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = withAlpha(pal.accent, 0.8);
      ctx.lineWidth = u * 0.006;
      ctx.beginPath();
      ctx.ellipse(cx, h * 0.4, u * 0.12, u * 0.155, 0, -Math.PI * 0.45, Math.PI * 0.35);
      ctx.stroke();
      break;
    }
    case 'product': {
      glow(ctx, w * 0.5, h * 0.35, u * 0.6, pal.light, 0.5);
      const py = h * 0.72;
      ctx.fillStyle = mix(pal.sky[2], pal.ink, 0.25);
      ctx.beginPath();
      ctx.ellipse(w * 0.5, py, u * 0.3, u * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(w * 0.5 - u * 0.3, py, u * 0.6, h);
      ctx.fillStyle = withAlpha(pal.ink, 0.35);
      ctx.beginPath();
      ctx.ellipse(w * 0.5 + u * 0.03, py, u * 0.14, u * 0.025, 0, 0, Math.PI * 2);
      ctx.fill();
      const bw = u * 0.16;
      const bh = u * 0.34;
      const bx = w * 0.5 - bw / 2;
      const by = py - bh - Math.sin(t * Math.PI) * u * 0.01;
      const body = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      body.addColorStop(0, pal.ink);
      body.addColorStop(0.35, pal.accent);
      body.addColorStop(0.55, pal.light);
      body.addColorStop(1, pal.ink);
      ctx.fillStyle = body;
      roundRect(ctx, bx, by, bw, bh, bw * 0.18);
      ctx.fill();
      ctx.fillStyle = pal.ink;
      roundRect(ctx, bx + bw * 0.3, by - bh * 0.12, bw * 0.4, bh * 0.14, bw * 0.05);
      ctx.fill();
      break;
    }
    case 'city': {
      glow(ctx, w * (0.3 + rnd() * 0.4), h * 0.45, u * 0.5, pal.light, 0.4);
      let x = -w * 0.05;
      while (x < w * 1.05) {
        const bw = w * (0.04 + rnd() * 0.08);
        const bh = h * (0.2 + rnd() * 0.45);
        ctx.fillStyle = mix(pal.sky[1], pal.ink, 0.55 + rnd() * 0.35);
        ctx.fillRect(x, h - bh, bw, bh);
        ctx.fillStyle = withAlpha(pal.accent, 0.55);
        for (let wy = h - bh + h * 0.02; wy < h - h * 0.03; wy += h * 0.035) {
          for (let wx = x + bw * 0.15; wx < x + bw * 0.85; wx += bw * 0.25) {
            if (rnd() > 0.55 + 0.2 * Math.sin(t * 6 + wx)) ctx.fillRect(wx, wy, bw * 0.1, h * 0.012);
          }
        }
        x += bw + w * 0.004;
      }
      break;
    }
  }
  ctx.restore();

  // Vignette + grain for a photographic finish.
  const v = ctx.createRadialGradient(w / 2, h / 2, u * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, hashString(prompt) + seed + Math.floor(t * 24));
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, withAlpha(color, alpha));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

const grainCache = new Map<number, HTMLCanvasElement>();

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  const key = seed % 8;
  let tile = grainCache.get(key);
  if (!tile) {
    tile = document.createElement('canvas');
    tile.width = 128;
    tile.height = 128;
    const tctx = tile.getContext('2d');
    if (!tctx) return;
    const img = tctx.createImageData(128, 128);
    const rnd = mulberry32(key * 7919 + 1);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(rnd() * 255);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 18;
    }
    tctx.putImageData(img, 0, 0);
    grainCache.set(key, tile);
  }
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Parse a CSS color (hex or hsl()) into an rgba() string with the given alpha. */
export function withAlpha(color: string, alpha: number): string {
  const rgb = toRgb(color);
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

export function mix(a: string, b: string, t: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return `rgb(${Math.round(x[0] + (y[0] - x[0]) * t)},${Math.round(x[1] + (y[1] - x[1]) * t)},${Math.round(x[2] + (y[2] - x[2]) * t)})`;
}

const rgbCache = new Map<string, [number, number, number]>();

export function toRgb(color: string): [number, number, number] {
  const hit = rgbCache.get(color);
  if (hit) return hit;
  let out: [number, number, number] = [128, 128, 128];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const s = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    out = [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  } else {
    const hsl = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(color);
    if (hsl) out = hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100);
  }
  rgbCache.set(color, out);
  return out;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
