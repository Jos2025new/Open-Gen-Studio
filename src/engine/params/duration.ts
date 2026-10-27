import type { ModelSchema, ParamDef } from '../types';
import { numericValue } from './aspect';
import { paramByRole } from './settings';

export function durationOptions(p: ParamDef): number[] {
  if (p.options?.length) return p.options.map((o) => numericValue(o)).filter((n): n is number => n != null);
  if (p.min != null && p.max != null) {
    const out: number[] = [];
    for (let s = Math.ceil(p.min); s <= p.max && out.length < 60; s++) out.push(s);
    return out;
  }
  return [];
}

export function durationChoices(schema: ModelSchema | undefined): number[] {
  const p = paramByRole(schema, 'duration');
  return p ? durationOptions(p) : [];
}

/** Some models take -1 (or 0) for "let the model choose the length". */
export function durationLabel(seconds: number): string {
  return seconds > 0 ? `${seconds}s` : 'Auto';
}

/** "720p" → 720, "2K" → 2000; NaN when the option is not a size ("auto", "standard"). */
