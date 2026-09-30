import type { ShapeSpec } from '../types';

/* SVG path shapes the agent writes: absolute commands only (M L C Q S T Z), so their box can be read
   from the numbers and the shape moves and scales like the others. */

const ARGS: Record<string, number> = { M: 2, L: 2, T: 2, C: 6, S: 4, Q: 4, Z: 0 };
export const MAX_PATH_LENGTH = 20000;

export type PathBox = { x: number; y: number; w: number; h: number };

export function parsePath(d: string): { box: PathBox } | { error: string } {
  if (!d.trim()) return { error: 'empty path' };
  if (d.length > MAX_PATH_LENGTH) return { error: `path longer than ${MAX_PATH_LENGTH} characters` };
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  if (tokens.join('').length < d.replace(/[\s,]/g, '').length) return { error: 'unexpected characters (use numbers and M L C Q S T Z)' };
  const xs: number[] = [];
  const ys: number[] = [];
  let i = 0;
  let cmd = '';
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) {
      cmd = tokens[i++];
      if (!(cmd in ARGS)) return { error: `command "${cmd}" is not allowed; use absolute M L C Q S T Z` };
      if (xs.length === 0 && cmd !== 'M') return { error: 'a path starts with M' };
      if (cmd === 'Z') continue;
    } else if (!cmd || cmd === 'Z') return { error: 'numbers without a command' };
    const n = ARGS[cmd];
    const nums = tokens.slice(i, i + n).map(Number);
    if (nums.length < n || nums.some((v) => !Number.isFinite(v))) return { error: `"${cmd}" needs ${n} numbers` };
    for (let k = 0; k < n; k += 2) {
      xs.push(nums[k]);
      ys.push(nums[k + 1]);
    }
    i += n;
  }
  if (!xs.length) return { error: 'no points' };
  const x = Math.min(...xs), y = Math.min(...ys);
  return { box: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y } };
}

/** Maps the path's own coordinates onto the shape's current box (it may have been moved or scaled). */
export function pathTransform(s: ShapeSpec): { sx: number; sy: number; tx: number; ty: number } {
  const b = s.box0 ?? { x: s.x, y: s.y, w: s.w, h: s.h };
  const sx = b.w ? s.w / b.w : 1;
  const sy = b.h ? s.h / b.h : 1;
  return { sx, sy, tx: s.x - b.x * sx, ty: s.y - b.y * sy };
}
