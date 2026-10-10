import { FX_DEFS, numParam, toneTable } from './defs';
import { glowPasses } from './canvas';
import type { FxLayer, FxOp } from './types';

/*
 * FX as SVG filter primitives, the way Inkscape stores filters (a <filter> in <defs>, referenced from the group).
 * Every filter is sRGB (color-interpolation-filters), as CSS filter functions are and as 212 of Inkscape's 213
 * presets set it; the default linearRGB would shift hue, saturation and blur against the canvas.
 */

const r3 = (v: number) => String(Math.round(v * 1000) / 1000);
const funcs = (inner: (ch: string) => string) => ['R', 'G', 'B'].map((ch) => `<feFunc${ch} ${inner(ch)}/>`).join('');
const matrix = (m: number[]) => `type="matrix" values="${[...m.slice(0, 3), 0, 0, ...m.slice(3, 6), 0, 0, ...m.slice(6, 9), 0, 0, 0, 0, 0, 1, 0].map(r3).join(' ')}"`;

/** The colour matrices of the CSS Filter Effects spec (saturate, grayscale, sepia). */
export function saturateMatrix(s: number): number[] {
  return [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s];
}
function grayscaleMatrix(a: number): number[] {
  const k = 1 - Math.min(1, a);
  return [0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k, 0.2126 - 0.2126 * k, 0.7152 + 0.2848 * k, 0.0722 - 0.0722 * k, 0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k];
}
function sepiaMatrix(a: number): number[] {
  const k = 1 - Math.min(1, a);
  return [0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k, 0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k, 0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k];
}

/** Primitives for one op, reading `src` and leaving its result in `out`; null when SVG has no equivalent (flare). */
export function opPrimitives(op: FxOp, src: string, out: string): string | null {
  const a = numParam(op, 'amount'), io = `in="${src}" result="${out}"`;
  switch (op.kind) {
    case 'brightness': return `<feComponentTransfer ${io}>${funcs(() => `type="linear" slope="${r3(a)}"`)}</feComponentTransfer>`;
    case 'contrast': return `<feComponentTransfer ${io}>${funcs(() => `type="linear" slope="${r3(a)}" intercept="${r3(0.5 - 0.5 * a)}"`)}</feComponentTransfer>`;
    case 'saturation': return `<feColorMatrix ${io} ${matrix(saturateMatrix(a))}/>`;
    case 'hue': return `<feColorMatrix ${io} type="hueRotate" values="${r3(numParam(op, 'degrees'))}"/>`;
    case 'grayscale': return `<feColorMatrix ${io} ${matrix(grayscaleMatrix(a))}/>`;
    case 'sepia': return `<feColorMatrix ${io} ${matrix(sepiaMatrix(a))}/>`;
    case 'invert': return `<feComponentTransfer ${io}>${funcs(() => `type="table" tableValues="${r3(a)} ${r3(1 - a)}"`)}</feComponentTransfer>`;
    case 'levels': case 'curves': return `<feComponentTransfer ${io}>${funcs(() => `type="table" tableValues="${toneTable(op).map(r3).join(' ')}"`)}</feComponentTransfer>`;
    case 'blur': return `<feGaussianBlur ${io} stdDeviation="${r3(numParam(op, 'radius'))}"/>`;
    // CSS drop-shadow(): the blur is a radius, twice the Gaussian standard deviation (Filter Effects spec).
    case 'shadow': return `<feDropShadow ${io} dx="${r3(numParam(op, 'x'))}" dy="${r3(numParam(op, 'y'))}" stdDeviation="${r3(numParam(op, 'blur') / 2)}" flood-color="${String(op.params.color)}" flood-opacity="${r3(numParam(op, 'opacity'))}"/>`;
    case 'glow': {
      // Same passes as the canvas: the blurred source screened over the result, once per unit of strength.
      const blur = `${out}-b`;
      const list = glowPasses(numParam(op, 'strength'));
      let prev = src;
      const passes = list.map((alpha, i) => {
        const faded = `${out}-a${i}`, res = i === list.length - 1 ? out : `${out}-p${i}`;
        const s = `<feComponentTransfer in="${blur}" result="${faded}"><feFuncA type="linear" slope="${r3(alpha)}"/></feComponentTransfer><feBlend mode="screen" in="${faded}" in2="${prev}" result="${res}"/>`;
        prev = res;
        return s;
      });
      return `<feGaussianBlur in="${src}" stdDeviation="${r3(numParam(op, 'radius'))}" result="${blur}"/>${passes.join('') || `<feOffset ${io}/>`}`;
    }
    default: return null;
  }
}

export interface SvgFilter { markup: string | null; skipped: string[] }

/** The <filter> of one FX layer over the page region (as the canvas composes it), and the ops SVG cannot hold. */
export function fxFilter(fx: FxLayer, id: string, width: number, height: number): SvgFilter {
  const parts: string[] = [], skipped: string[] = [];
  let prev = 'SourceGraphic';
  fx.ops.filter((o) => o.enabled).forEach((op, i) => {
    const out = `f${i}`, p = opPrimitives(op, prev, out);
    if (p == null) { skipped.push(FX_DEFS[op.kind].label); return; }
    parts.push(p);
    prev = out;
  });
  if (!parts.length) return { markup: null, skipped };
  return { markup: `<filter id="${id}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" color-interpolation-filters="sRGB">${parts.join('')}</filter>`, skipped };
}
