import { mulberry32 } from '../../lib/rng';
import type { Stroke } from '../types';
import { n, xmlEscape } from './export';
import { drawSolidStroke, solidStrokeSvg, strokeBox, strokeSamples } from './strokes';

/*
 * Textured strokes: a small stamp repeated along the stroke's centerline, following its direction, pressure
 * and a seeded jitter. The texture bends with the curve (it is not a fill clipped to the outline). Stamps are
 * generated in code, so there are no third-party texture files. Each stroke keeps a rendered cache that goes
 * away with the stroke object (an edit makes a new object); only the stroke being drawn is re-stamped live.
 */

export interface StampDef {
  id: string;
  label: string;
  /** Fills a size×size alpha stamp (white on transparent). */
  paint: (ctx: CanvasRenderingContext2D, size: number, rnd: () => number) => void;
}

const STAMP_PX = 64;
/** Stamps per stroke; past this the spacing grows so long strokes stay cheap to draw and export. */
export const MAX_STAMPS = 1500;

export const STAMPS: StampDef[] = [
  {
    id: 'pencil',
    label: 'Pencil grain',
    paint: (ctx, size, rnd) => {
      for (let i = 0; i < 260; i++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * size * 0.45;
        ctx.globalAlpha = 0.25 + rnd() * 0.6;
        ctx.fillRect(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, 1.4, 1.4);
      }
    },
  },
  {
    id: 'chalk',
    label: 'Chalk',
    paint: (ctx, size, rnd) => {
      for (let i = 0; i < 70; i++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * size * 0.42;
        ctx.globalAlpha = 0.15 + rnd() * 0.35;
        ctx.beginPath();
        ctx.arc(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, 1 + rnd() * size * 0.07, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  {
    id: 'bristle',
    label: 'Dry bristle',
    // Parallel hairs across the stroke direction (the stamp is rotated to the tangent).
    paint: (ctx, size, rnd) => {
      for (let i = 0; i < 14; i++) {
        const y = size * (0.1 + 0.8 * (i / 13)) + (rnd() - 0.5) * 2;
        ctx.globalAlpha = 0.35 + rnd() * 0.5;
        ctx.fillRect(size * (0.3 + rnd() * 0.1), y, size * (0.3 + rnd() * 0.2), 1 + rnd() * 1.5);
      }
    },
  },
];

export function stampDef(id: string): StampDef {
  return STAMPS.find((s) => s.id === id) ?? STAMPS[0];
}

export interface StampPlacement {
  x: number;
  y: number;
  /** Radians. */
  angle: number;
  /** Stamp diameter in document px. */
  size: number;
}

/**
 * Where each stamp goes: every `spacing × size` px along the centerline, turned to the local direction,
 * sized by pressure like the solid stroke, with seeded rotation/offset jitter. Same stroke → same stamps.
 */
export function stampPlacements(s: Stroke): StampPlacement[] {
  const tex = s.texture;
  if (!tex) return [];
  const samples = strokeSamples(s);
  if (!samples.length) return [];
  const total = samples[samples.length - 1].runningLength;
  let step = Math.max(0.5, tex.spacing * s.size);
  if (total / step > MAX_STAMPS) step = total / MAX_STAMPS;
  const rnd = mulberry32(tex.seed);
  const out: StampPlacement[] = [];
  // perfect-freehand's radius is size × (0.5 − thinning × (0.5 − pressure)); this is the matching diameter.
  const widthAt = (p: number) => s.size * (1 - 2 * s.thinning * (0.5 - p));
  let j = 0;
  for (let d = 0; d <= total; d += step) {
    while (j < samples.length - 2 && samples[j + 1].runningLength < d) j++;
    const a = samples[j];
    const b = samples[Math.min(j + 1, samples.length - 1)];
    const span = b.runningLength - a.runningLength;
    const t = span > 0 ? (d - a.runningLength) / span : 0;
    const x = a.point[0] + (b.point[0] - a.point[0]) * t;
    const y = a.point[1] + (b.point[1] - a.point[1]) * t;
    const pressure = a.pressure + (b.pressure - a.pressure) * t;
    const dx = b.point[0] - a.point[0];
    const dy = b.point[1] - a.point[1];
    const angle = Math.atan2(dy, dx) + (rnd() - 0.5) * tex.jitter * Math.PI * 0.5;
    const size = Math.max(0.5, widthAt(s.simulatePressure ? 0.5 : pressure));
    const off = (rnd() - 0.5) * tex.jitter * size * 0.5;
    const len = Math.hypot(dx, dy) || 1;
    out.push({ x: x - (dy / len) * off, y: y + (dx / len) * off, angle, size });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Canvas

const stampCanvases = new Map<string, HTMLCanvasElement>();

/** The stamp tinted with a color (cached per stamp + color). */
function tintedStamp(id: string, color: string): HTMLCanvasElement {
  const key = `${id}|${color}`;
  let c = stampCanvases.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = STAMP_PX;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    stampDef(id).paint(ctx, STAMP_PX, mulberry32(0x5eed));
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, STAMP_PX, STAMP_PX);
    stampCanvases.set(key, c);
  }
  return c;
}

/** Rendered textured stroke per stroke object, in document px (×2 for zoom, bounded). */
const strokeCache = new WeakMap<Stroke, { canvas: HTMLCanvasElement; x: number; y: number; scale: number }>();

function renderTextured(s: Stroke) {
  let c = strokeCache.get(s);
  if (c) return c;
  const box = strokeBox(s);
  const pad = s.size;
  const x = (box?.x ?? 0) - pad;
  const y = (box?.y ?? 0) - pad;
  const w = (box?.w ?? 0) + pad * 2;
  const h = (box?.h ?? 0) + pad * 2;
  const scale = Math.max(0.25, Math.min(2, 4096 / Math.max(w, h, 1)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w * scale));
  canvas.height = Math.max(1, Math.ceil(h * scale));
  const ctx = canvas.getContext('2d')!;
  const stamp = tintedStamp(s.texture!.stamp, s.color);
  ctx.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
  for (const p of stampPlacements(s)) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.drawImage(stamp, -p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  }
  c = { canvas, x, y, scale };
  strokeCache.set(s, c);
  return c;
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  if (!s.texture) {
    drawSolidStroke(ctx, s);
    return;
  }
  const c = renderTextured(s);
  ctx.save();
  ctx.globalAlpha *= s.opacity;
  ctx.drawImage(c.canvas, c.x, c.y, c.canvas.width / c.scale, c.canvas.height / c.scale);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// SVG: one embedded stamp per stroke in <defs>, reused by <use> with a transform per placement.

const stampUrls = new Map<string, string>();

async function stampHref(id: string, color: string): Promise<string> {
  const key = `${id}|${color}`;
  let url = stampUrls.get(key);
  if (!url) {
    url = tintedStamp(id, color).toDataURL('image/png');
    stampUrls.set(key, url);
  }
  return url;
}

export function texturedStrokeSvg(s: Stroke, href: string): string {
  const id = `stamp-${xmlEscape(s.id)}`;
  const k = 1 / STAMP_PX;
  const uses = stampPlacements(s)
    .map((p) => `<use href="#${id}" transform="translate(${n(p.x)} ${n(p.y)}) rotate(${n((p.angle * 180) / Math.PI)}) scale(${n(p.size * k)})"/>`)
    .join('');
  return `<g${s.opacity < 1 ? ` opacity="${n(s.opacity)}"` : ''}><defs><image id="${id}" x="${-STAMP_PX / 2}" y="${-STAMP_PX / 2}" width="${STAMP_PX}" height="${STAMP_PX}" href="${href}"/></defs>${uses}</g>`;
}

export async function strokeSvg(s: Stroke): Promise<string> {
  if (!s.texture) return solidStrokeSvg(s, xmlEscape);
  return texturedStrokeSvg(s, await stampHref(s.texture.stamp, s.color));
}
