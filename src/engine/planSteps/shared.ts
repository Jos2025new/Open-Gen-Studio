import type { PlanContext } from './env';
import type { AdvancedValue, MediaKind } from '../types';

/**
 * A family name instead of a ref ("Wan 3", "Seedance 2.5") resolves to the closest supported model, locally:
 * the agent can follow the default route without a find_models round. Full refs ("provider::id") pass as given.
 */
export function familyRef(ctx: PlanContext, model: string | undefined, kind: MediaKind, needsImage: boolean, stepId: string, adjustments: string[]): string | undefined {
  const raw = model?.trim();
  if (!raw || raw.includes('::')) return raw;
  const ref = ctx.suggestModel?.(raw, kind, needsImage);
  if (!ref) return raw;
  adjustments.push(`${stepId}: model "${raw}" → ${ref}`);
  return ref;
}

export function didYouMean(ctx: PlanContext, ref: string, kind: MediaKind, needsImage: boolean): string {
  const near = ctx.suggestModel?.(ref, kind, needsImage);
  return near ? ` Did you mean "${near}"?` : ' Use a listed model ref, one returned by find_models, or omit "model".';
}

export function num(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function cleanParams(p: Record<string, unknown> | undefined): Record<string, AdvancedValue> {
  const out: Record<string, AdvancedValue> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}
