import type { AdvancedValue } from '../types';

const ASPECT_ALIASES: Record<string, string> = {
  square_hd: '1:1',
  square: '1:1',
  landscape: '16:9',
  portrait: '9:16',
};

/** Ratio for a size preset. fal writes "portrait_4_3", Krea/Ideogram "portrait_3_4": both are 3:4. */
function presetAspect(v: string): string | undefined {
  const m = /^(portrait|landscape)_(\d+)_(\d+)$/.exec(v);
  if (!m) return ASPECT_ALIASES[v];
  const [short, long] = [Number(m[2]), Number(m[3])].sort((a, b) => a - b);
  return m[1] === 'portrait' ? `${short}:${long}` : `${long}:${short}`;
}

/** Numeric w/h ratio for an aspect-ish value ("16:9", "landscape_4_3", "1280x720"), or null. */
export function ratioOf(value: string | number | undefined): number | null {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  const src = presetAspect(v) ?? v;
  const m = /^(\d+(?:\.\d+)?)\s*[:x*]\s*(\d+(?:\.\d+)?)$/.exec(src);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? w / h : null;
}

export function aspectLabel(value: string | number | undefined): string {
  if (value == null) return '';
  const v = String(value);
  const alias = presetAspect(v.toLowerCase());
  if (alias) return v.toLowerCase().includes('hd') ? `${alias} HD` : alias;
  if (v === 'auto') return 'Auto';
  return v.replace('*', '×').replace(/(\d)x(\d)/, '$1×$2');
}

const PIXEL_SIZE = /^(\d+)\s*[x×*]\s*(\d+)$/i;
const COMMON_RATIOS: Array<[number, number]> = [[1, 1], [4, 3], [3, 4], [3, 2], [2, 3], [16, 9], [9, 16], [21, 9], [9, 21], [5, 4], [4, 5], [2, 1], [1, 2]];

/** Split exact pixel sizes into provider options grouped by area tier and ratio. */
export function pixelSizes(options: Array<string | number> | undefined): {
  tiers: string[];
  ratios: string[];
  of: (value: string | undefined) => { tier?: string; ratio?: string };
  pick: (tier: string | undefined, ratio: string | undefined) => string | undefined;
} | null {
  if (!options?.length) return null;
  const rows: Array<{ value: string; tier: string; ratio: string; tierN: number }> = [];
  for (const o of options) {
    const m = PIXEL_SIZE.exec(String(o).trim());
    if (!m) return null;
    const w = Number(m[1]), h = Number(m[2]);
    const tierN = Math.max(1, Math.round(Math.sqrt(w * h) / 512)) / 2;
    const near = COMMON_RATIOS.find(([a, b]) => Math.abs(w / h / (a / b) - 1) < 0.04);
    rows.push({ value: String(o), tierN, tier: `${tierN}K`, ratio: near ? `${near[0]}:${near[1]}` : `${w}:${h}` });
  }
  const tiers = [...new Set(rows.sort((a, b) => a.tierN - b.tierN).map((r) => r.tier))];
  const ratios = [...new Set(rows.map((r) => r.ratio))];
  return {
    tiers,
    ratios,
    of: (value) => {
      const r = rows.find((x) => x.value === value);
      return { tier: r?.tier, ratio: r?.ratio };
    },
    pick: (tier, ratio) => {
      const same = rows.filter((r) => r.ratio === ratio);
      const pool = same.length ? same : rows;
      const want = rows.find((r) => r.tier === tier)?.tierN ?? pool[0].tierN;
      return pool.reduce((best, r) => (Math.abs(r.tierN - want) < Math.abs(best.tierN - want) ? r : best), pool[0]).value;
    },
  };
}

/** Options that mean "let the model decide" (P Image: match_input_image; Seedance: adaptive). */
/** An option that keeps the input's shape ("match_input_image", "adaptive"); "auto" lets the model choose. */
export function matchInputOption(options: Array<string | number>): string | undefined {
  const o = options.find((x) => /^(match_input_image|adaptive)$/.test(String(x)));
  return o == null ? undefined : String(o);
}

export function isAutoOption(o: string | number): boolean {
  return /^(auto|match_input_image|adaptive)$/.test(String(o));
}

/** Pixel area of a "1024x768" / "1024*768" option, else null. */
export function pixelArea(o: string | number | undefined): number | null {
  const m = /^(\d+)\s*[x*]\s*(\d+)$/.exec(String(o ?? '').trim());
  return m ? Number(m[1]) * Number(m[2]) : null;
}

/**
 * Pick the option whose ratio is closest to `target` (a ratio string or number). Among sizes of the same
 * ratio (1024x1024, 2048x2048) the one closest in area to `like` wins, so the scale is kept.
 */
export function nearestAspect(options: Array<string | number>, target: string | number | undefined, like?: string | number): string | undefined {
  if (!options.length) return undefined;
  const tr = typeof target === 'number' ? target : ratioOf(target);
  if (target != null && options.some((o) => String(o) === String(target))) return String(target);
  if (tr == null) return undefined;
  const scored = options.flatMap((o) => {
    const r = ratioOf(o);
    return r == null ? [] : [{ o: String(o), d: Math.abs(Math.log(r / tr)) }];
  });
  if (!scored.length) return undefined;
  const bestD = Math.min(...scored.map((x) => x.d));
  const near = scored.filter((x) => x.d <= bestD + 0.02);
  const area = pixelArea(like);
  if (area == null || near.length === 1) return near[0].o;
  return near.reduce((a, b) => (Math.abs((pixelArea(b.o) ?? 0) - area) < Math.abs((pixelArea(a.o) ?? 0) - area) ? b : a)).o;
}

/** Output pixel dimensions for an aspect ratio at a long-edge size. */
export function dimsFor(ratio: number, longEdge: number): { width: number; height: number } {
  if (ratio >= 1) return { width: longEdge, height: Math.round(longEdge / ratio) };
  return { width: Math.round(longEdge * ratio), height: longEdge };
}

export function numericValue(v: AdvancedValue | undefined): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Rough long-edge pixels for a resolution token, used for megapixel estimates. */
export function longEdgeFor(resolution: string | undefined): number {
  if (!resolution) return 1024;
  const r = resolution.toLowerCase();
  const size = /(\d+)\s*[x*]\s*(\d+)/.exec(r);
  if (size) return Math.max(Number(size[1]), Number(size[2]));
  if (r === '512') return 512;
  if (r.endsWith('k')) return Math.round(parseFloat(r) * 1024) || 1024;
  if (r.endsWith('p')) {
    const p = parseInt(r, 10);
    return Math.round((p * 16) / 9);
  }
  return 1024;
}

// ---------------------------------------------------------------------------
// JSON-schema (OpenAPI) → ParamDef + InputSlots
