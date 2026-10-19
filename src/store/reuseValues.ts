import type { AdvancedValue, ParamDef } from '../engine/types';

/** Reuse must not reintroduce values the current parameter no longer accepts. */
export function acceptsReuseValue(p: ParamDef, value: AdvancedValue): boolean {
  if (p.options && !p.options.some((o) => String(o) === String(value))) return false;
  if (p.type === 'boolean') return typeof value === 'boolean';
  if (p.type === 'number' || p.type === 'integer') return typeof value === 'number' && Number.isFinite(value)
    && (p.type !== 'integer' || Number.isInteger(value)) && (p.min == null || value >= p.min) && (p.max == null || value <= p.max);
  return typeof value === 'string' || p.type === 'enum';
}
