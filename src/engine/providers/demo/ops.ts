import { hashString } from '../../../lib/rng';
import { createCanvas, ctx2d } from '../../../lib/media';
import { ratioOf } from '../../params';
import type { AdvancedValue } from '../../types';
import { paletteFor, withAlpha } from './art';

/* Local, deterministic approximations of the image operations (demo provider). */

type Params = Record<string, AdvancedValue>;

function copy(src: HTMLCanvasElement, w = src.width, h = src.height): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

const LIGHT_COLORS: Record<string, string> = {
  'golden-hour': '#ffb04d',
  softbox: '#ffffff',
  overcast: '#d6e0ea',
  rim: '#ffe6c2',
  neon: '#ff3fb4',
  candle: '#ff9433',
  moonlight: '#7ea4ff',
  chiaroscuro: '#fff1d6',
};

export function relight(src: HTMLCanvasElement, p: Params): HTMLCanvasElement {
  const { c, ctx } = copy(src);
  const w = c.width;
  const h = c.height;
  ctx.drawImage(src, 0, 0);
  const strength = p.intensity === 'strong' ? 0.85 : p.intensity === 'subtle' ? 0.35 : 0.6;
  const color = LIGHT_COLORS[String(p.preset)] ?? '#ffffff';
  const dir = String(p.direction);
  const [x0, y0, x1, y1] =
    dir === 'right' ? [w, 0, 0, 0] : dir === 'top' ? [0, 0, 0, h] : dir === 'below' ? [0, h, 0, 0] : dir === 'front' || dir === 'behind' ? [w / 2, h / 2, w, h] : [0, 0, w, 0];
  const g =
    dir === 'front' || dir === 'behind'
      ? ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2)
      : ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, withAlpha(color, strength));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.globalCompositeOperation = dir === 'behind' ? 'screen' : 'soft-light';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (p.preset === 'neon') {
    const g2 = ctx.createLinearGradient(w, 0, 0, 0);
    g2.addColorStop(0, withAlpha('#2ff3ff', strength));
    g2.addColorStop(1, withAlpha('#2ff3ff', 0));
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
  }
  // Shade the far side.
  ctx.globalCompositeOperation = 'multiply';
  const shade = ctx.createLinearGradient(x1, y1, x0, y0);
  const dark = p.preset === 'chiaroscuro' ? 0.75 : p.preset === 'moonlight' ? 0.45 : 0.25 * strength;
  shade.addColorStop(0, `rgba(10,10,20,${dark})`);
  shade.addColorStop(1, 'rgba(10,10,20,0)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

export function changeAngle(src: HTMLCanvasElement, p: Params): HTMLCanvasElement {
  const { c, ctx } = copy(src);
  const w = c.width;
  const h = c.height;
  // Blurred fill so that re-projected edges never show transparency.
  ctx.filter = 'blur(24px) brightness(0.8)';
  ctx.drawImage(src, -w * 0.1, -h * 0.1, w * 1.2, h * 1.2);
  ctx.filter = 'none';
  ctx.save();
  ctx.translate(w / 2, h / 2);
  switch (String(p.angle)) {
    case 'three-quarter-left':
      ctx.transform(0.9, -0.06, 0, 1, 0, 0);
      break;
    case 'three-quarter-right':
      ctx.transform(0.9, 0.06, 0, 1, 0, 0);
      break;
    case 'profile-left':
      ctx.transform(0.72, -0.12, 0, 1, 0, 0);
      break;
    case 'profile-right':
      ctx.transform(0.72, 0.12, 0, 1, 0, 0);
      break;
    case 'back':
      ctx.scale(-1, 1);
      break;
    case 'top-down':
      ctx.transform(1, 0, 0, 0.78, 0, -h * 0.04);
      break;
    case 'high':
      ctx.transform(1, 0, 0.08, 0.9, 0, 0);
      break;
    case 'low':
      ctx.transform(1, 0, -0.08, 1.12, 0, h * 0.04);
      break;
    case 'close-up':
      ctx.scale(1.55, 1.55);
      break;
    case 'wide':
      ctx.scale(0.72, 0.72);
      break;
    default:
      ctx.scale(1.08, 1.08);
  }
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  ctx.restore();
  if (p.angle === 'back') {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, w, h);
  }
  return c;
}

export function upscale(src: HTMLCanvasElement, p: Params): HTMLCanvasElement {
  const factor = Number(p.factor) === 4 ? 4 : 2;
  const long = Math.max(src.width, src.height);
  const scale = Math.min(factor, 4096 / long);
  const { c, ctx } = copy(src, src.width * scale, src.height * scale);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  if (c.width * c.height <= 9_000_000) sharpen(ctx, c.width, c.height, 0.55);
  return c;
}

function sharpen(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const s = img.data;
  const out = new Uint8ClampedArray(s.length);
  const k = amount;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const up = y > 0 ? s[i - w * 4 + ch] : s[i + ch];
        const down = y < h - 1 ? s[i + w * 4 + ch] : s[i + ch];
        const left = x > 0 ? s[i - 4 + ch] : s[i + ch];
        const right = x < w - 1 ? s[i + 4 + ch] : s[i + ch];
        out[i + ch] = s[i + ch] * (1 + 4 * k) - k * (up + down + left + right);
      }
      out[i + 3] = s[i + 3];
    }
  }
  img.data.set(out);
  ctx.putImageData(img, 0, 0);
}

/** Key out the dominant border color (works well on studio/flat backgrounds). */
export function removeBackground(src: HTMLCanvasElement): HTMLCanvasElement {
  const { c, ctx } = copy(src);
  ctx.drawImage(src, 0, 0);
  const w = c.width;
  const h = c.height;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 64));
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
    n++;
  };
  for (let x = 0; x < w; x += step) {
    sample(x, 0);
    sample(x, h - 1);
  }
  for (let y = 0; y < h; y += step) {
    sample(0, y);
    sample(w - 1, y);
  }
  r /= n;
  g /= n;
  b /= n;
  const t0 = 38;
  const t1 = 92;
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.hypot(d[i] - r, d[i + 1] - g, d[i + 2] - b);
    const a = dist <= t0 ? 0 : dist >= t1 ? 1 : (dist - t0) / (t1 - t0);
    d[i + 3] = Math.round(d[i + 3] * a);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function reframe(src: HTMLCanvasElement, p: Params): HTMLCanvasElement {
  const ratio = ratioOf(String(p.aspect)) ?? 1;
  const long = Math.max(src.width, src.height);
  const w = ratio >= 1 ? long : Math.round(long * ratio);
  const h = ratio >= 1 ? Math.round(long / ratio) : long;
  const { c, ctx } = copy(src, w, h);
  const cover = Math.max(w / src.width, h / src.height);
  ctx.filter = 'blur(32px) saturate(1.1)';
  ctx.drawImage(src, (w - src.width * cover) / 2, (h - src.height * cover) / 2, src.width * cover, src.height * cover);
  ctx.filter = 'none';
  const contain = Math.min(w / src.width, h / src.height);
  const dw = src.width * contain;
  const dh = src.height * contain;
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return c;
}

export function variation(src: HTMLCanvasElement, p: Params, index: number): HTMLCanvasElement {
  const { c, ctx } = copy(src);
  const strength = p.strength === 'strong' ? 1 : p.strength === 'subtle' ? 0.35 : 0.65;
  const deg = Math.round(((index + 1) * 47 * strength) % 360);
  ctx.save();
  if (index % 2 === 1) {
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
  }
  const zoom = 1 + 0.06 * strength * ((index % 3) + 1);
  ctx.filter = `hue-rotate(${deg}deg) saturate(${1 + 0.2 * strength})`;
  ctx.drawImage(src, (c.width - c.width * zoom) / 2, (c.height - c.height * zoom) / 2, c.width * zoom, c.height * zoom);
  ctx.restore();
  return c;
}

export function promptEdit(src: HTMLCanvasElement, instruction: string): HTMLCanvasElement {
  const { c, ctx } = copy(src);
  const t = instruction.toLowerCase();
  let filter = '';
  if (/black and white|blanco y negro|b&w|grayscale|monochrome|monocrom/.test(t)) filter = 'grayscale(1) contrast(1.1)';
  else if (/vintage|retro|sepia|film|analog/.test(t)) filter = 'sepia(0.55) contrast(1.05) saturate(0.9)';
  else if (/warm|cálid|calid|sunny|soleado/.test(t)) filter = 'sepia(0.25) saturate(1.25) hue-rotate(-8deg)';
  else if (/cool|cold|frí|fri|blue|azul/.test(t)) filter = 'saturate(1.1) hue-rotate(18deg) brightness(0.98)';
  else if (/dark|oscur|night|noche|moody/.test(t)) filter = 'brightness(0.72) contrast(1.15)';
  else if (/bright|brillant|light|clar/.test(t)) filter = 'brightness(1.18) contrast(0.95)';
  else filter = `hue-rotate(${hashString(t) % 60 - 30}deg) saturate(1.15)`;
  ctx.filter = filter;
  ctx.drawImage(src, 0, 0);
  ctx.filter = 'none';
  const pal = paletteFor(instruction, 0);
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = withAlpha(pal.accent, 0.25);
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

/** Image-to-image stylization used when a demo generation receives references. */
export function stylize(src: HTMLCanvasElement, prompt: string, seed: number, w: number, h: number): HTMLCanvasElement {
  const { c, ctx } = copy(src, w, h);
  const cover = Math.max(w / src.width, h / src.height);
  ctx.drawImage(src, (w - src.width * cover) / 2, (h - src.height * cover) / 2, src.width * cover, src.height * cover);
  const pal = paletteFor(prompt, seed);
  ctx.globalCompositeOperation = 'color';
  ctx.fillStyle = withAlpha(pal.sky[1], 0.1);
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'soft-light';
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, withAlpha(pal.light, 0.18));
  g.addColorStop(1, withAlpha(pal.ink, 0.18));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  return c;
}
