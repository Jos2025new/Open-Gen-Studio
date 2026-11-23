import type { ExecContext, StepOutput } from '../../executor';
import type { placeFor } from '../../place';
import type { Estimate, GenerationOrigin, GenSettings, PlanStep, StepAuthorization, Subject } from '../../types';

/** A step of one kind, for the runner and the estimator of that kind. */
export type StepOf<K extends PlanStep['kind']> = Extract<PlanStep, { kind: K }>;

/** What a step runner may use of the plan being executed (built once per `executeSteps`). */
export interface RunEnv {
  ctx: ExecContext;
  outputs: Map<string, StepOutput>;
  /** What every generation of this step carries: session, origin, place, planId, stepId. */
  base: { sessionId: string; origin: GenerationOrigin; place: ReturnType<typeof placeFor>; mode: 'agent'; planId?: string; stepId: string; approvalTicketId?: string; approvedFingerprint?: string; passStepKey?: string; batchToken?: symbol };
  requireAsset(ref: string, what?: string): Promise<string>;
  resolveAsset(ref: string | undefined): Promise<string | null>;
  promptFor(s: { prompt: string; promptFrom?: string }): string;
  inputsFor<T extends object>(inputs: T): T & { subjects?: Subject[] };
  runSettled(id: string): Promise<string[]>;
  stepOutputs(generationId: string, assetIds: string[]): StepOutput;
}

export type RunStep<K extends PlanStep['kind']> = (s: StepOf<K>, env: RunEnv) => Promise<StepOutput>;

/** What an estimator may read: the whole plan, the node's operation choices and the composer's video settings. */
export interface EstimateEnv {
  steps: PlanStep[];
  nodeOperations?: ExecContext['nodeOperations'];
  videoSettings: GenSettings;
}

/** The price of one step and what the user authorizes for it: the approved price is the sent one. */
export interface StepPrice { estimate: Estimate; authorization: StepAuthorization }

export type EstimateStep<K extends PlanStep['kind']> = (s: StepOf<K>, env: EstimateEnv) => StepPrice;
