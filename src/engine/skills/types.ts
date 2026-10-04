import type { Workspace } from '../types';

/* Skills shape how the agent writes prompts; workflows give it a proven step structure. */

export interface Skill {
  id: string;
  name: string;
  description: string;
  /** Guidance appended to the agent context while the skill is active. */
  guidance: string;
  /** Full guide, returned only by read_guide (never injected in every message like `guidance`). */
  guide?: string;
  /** Short suffix the offline planner appends to prompts. */
  promptHint: string;
}

export interface WorkflowStepTemplate {
  id: string;
  kind: 'image' | 'video' | 'op' | 'text' | 'layer';
  title: string;
  /** `{prompt}` is replaced by the user's request. */
  prompt?: string;
  op?: string;
  input?: string;
  /** join_clips: the clips after `input`, in order. */
  more?: string[];
  params?: Record<string, string>;
  refs?: string[];
  firstFrame?: string;
  aspect?: string;
  layerType?: 'raster' | 'text' | 'vector';
  source?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  workspaces: Workspace[];
  /** Skill applied with this workflow when the user picked none. */
  skill?: string;
  /** Skills the agent loads for particular steps (what each one teaches is in its index line). */
  skills?: Array<{ id: string; for: string }>;
  /** Values the workflow decides and does not ask. Never the resolution: it follows the chosen quality (cost). */
  fixed?: { model?: string; aspect?: string; audio?: boolean };
  /** Inputs the workflow needs; missing ones are asked in the one questions card. */
  needs?: string[];
  /** Formats of the same workflow; only the chosen one is loaded. */
  variants?: Array<{ id: string; name: string; description: string; steps?: WorkflowStepTemplate[] }>;
  /** How steps chain: what an approved result feeds next, and the one identity kept throughout. */
  continuity?: string;
  steps: WorkflowStepTemplate[];
}

