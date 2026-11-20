import type { PlanContext, OutputKind, RawPlan, RawStep } from '../plan';
import type { FitState } from '../agent/fit';
import type { RoleRef } from '../refRoles';
import type { PlanStep } from '../types';

/** What one step normalizer sees of the plan being normalized: the plan's shared lists and the ref checkers. */
export interface StepEnv {
  ctx: PlanContext;
  raw: RawPlan;
  rawSteps: RawStep[];
  errors: string[];
  adjustments: string[];
  /** The normalized steps so far; a normalizer pushes its own. */
  steps: PlanStep[];
  st: Map<string, boolean>;
  ids: Set<string>;
  share: number | undefined;
  total: number;
  stepRoles: Map<string, RoleRef[]>;
  fit: FitState;
  refKind(ref: string | undefined, where: string): OutputKind | 'raster' | null;
  expectImage(ref: string | undefined, where: string): void;
  inputAspect(ref: string | undefined): string | undefined;
  frameOf(ref: string, which: 'first' | 'last', forId: string): string;
  frames: Map<string, string>;
}

/** One normalizer per step kind: validates the raw step, pushes its normalized step(s) and its errors in the agent's wording. */
export type NormalizeStep = (s: RawStep, env: StepEnv) => Promise<void>;
