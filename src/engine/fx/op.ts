import { beginRender } from '../../lib/renderTrace';
import type { AdvancedValue } from '../types';
import { FX_DEFS, FX_KINDS, fxParams, isFxKind } from './defs';
import { applyFx } from './canvas';
import type { FxKind, FxOp } from './types';

/*
 * The `fx` operation on assets and nodes (ADR 0011, D6): the same registry as the Designer's FX layers, applied once
 * to an image, which gives a new image (the original stays). `effect` names the filter or effect, `amount` its main
 * value; any other parameter of that effect can be passed by its own key (radius, x, color…).
 */

export const FX_OP_CHOICES = FX_KINDS.map((k) => ({ value: k, label: `${FX_DEFS[k].group === 'filter' ? 'Filter' : 'Effect'} · ${FX_DEFS[k].label}` }));

export function fxOpFromParams(params: Record<string, AdvancedValue>): FxOp {
  const kind: FxKind = isFxKind(params.effect) ? params.effect : 'brightness';
  const primary = FX_DEFS[kind].primary;
  const amount = typeof params.amount === 'string' ? params.amount.trim() : params.amount;
  const given: Record<string, unknown> = { ...params };
  if (amount !== '' && amount != null) given[primary] = amount;
  return { id: 'op', kind, enabled: true, params: fxParams(kind, given) };
}

/** The result of the operation on an image, at its own resolution (lengths in image px). */
export function fxOnCanvas(src: HTMLCanvasElement, params: Record<string, AdvancedValue>): HTMLCanvasElement {
  const { context, end } = beginRender('asset-fx', { page: `${src.width}x${src.height}` });
  try { return applyFx(src, [fxOpFromParams(params)], { scale: 1, clip: false, trace: context }); }
  finally { end?.(); }
}

/** Words that name one filter or effect, in Spanish and English (normalized text: lower case, no accents). */
const FX_NAMES: Array<[FxKind, RegExp]> = [
  ['grayscale', /\b(blanco y negro|black and white|escala de grises|grayscale|greyscale|desatura\w*|desaturate)\b/],
  ['sepia', /\bsepia\b/],
  ['invert', /\b(invierte|invertir|invert)( (los|the))? colou?res|\bnegativo\b|\bnegative\b/],
  ['blur', /\b(desenfoca\w*|desenfoque|difumina\w*|blur\w*)\b/],
  ['glow', /\b(glow|resplandor|halo)\b/],
  ['flare', /\b(destello|lens flare|flare)\b/],
  ['shadow', /\b(sombra paralela|drop shadow)\b/],
  ['levels', /\b(niveles|levels)\b/],
  ['curves', /\b(curvas|curves)\b/],
  ['brightness', /\b(brillo|brightness)\b/],
  ['contrast', /\b(contraste|contrast)\b/],
  ['saturation', /\b(saturacion|saturation)\b/],
  ['hue', /\b(tono|matiz|hue)\b/],
];
/** Any of those names, for the keyword trigger (fx/op.ts is the one list). Brightness, contrast, saturation and hue need a verb there. */
export const FX_WORDS = new RegExp(FX_NAMES.slice(0, 7).map(([, re]) => re.source).join('|'));

export function fxKindIn(normalized: string): FxKind | undefined {
  return FX_NAMES.find(([, re]) => re.test(normalized))?.[0];
}

/** "Effect · Glow (strength 1.2)" for cards and history. */
export function fxOpDetail(params: Record<string, AdvancedValue>): string {
  const op = fxOpFromParams(params), d = FX_DEFS[op.kind];
  return `${d.label} (${d.params[0].label.toLowerCase()} ${op.params[d.primary]})`;
}
