import { DAB_DEFAULTS, type BrushOptions } from './brushEngine';

/* Flow beside Size and Opacity. The capsule keeps the strongest coverage per pixel, so only the dab engine can accumulate:
   lowering Flow under 100 % turns Dabs on by itself (a graphite grade then paints dabs); at 100 % Dabs stays as it is (the Stroke tab turns it off). */

export const FLOW_MIN = 0.01;
/** Spacing a dab stroke gets when Flow switches it on: dense enough to read as a smooth line. */
export const FLOW_SPACING = 0.1;

type FlowBrush = Pick<BrushOptions, 'dabs' | 'dabFlow'>;

/** The flow in force: the dabs' own while Dabs is on, otherwise a full 1. */
export const flowOf = (brush: FlowBrush): number => (brush.dabs ? brush.dabFlow ?? DAB_DEFAULTS.flow : 1);

/** The patch `v` makes on the brush: under 100 % it also turns Dabs on; nothing for a blocked brush. */
export function withFlow(brush: FlowBrush & Pick<BrushOptions, 'dabSpacing'>, v: number): Partial<BrushOptions> {
  if (!Number.isFinite(v)) return {};
  const flow = Math.min(1, Math.max(FLOW_MIN, v));
  if (brush.dabs) return { dabFlow: flow };
  return flow < 1 ? { dabs: true, dabSpacing: FLOW_SPACING, dabFlow: flow } : {};
}
