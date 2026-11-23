import type { DraftMode } from './agent/draftFirst';
import type { ChatMessageMeta } from './feedMeta';
import type { GraphEdge, GraphNode } from './graphTypes';
import type { ShapeSpec } from './shapeSpec';
import type {
  AdvancedValue, AgentStyle, ComposerMode, Estimate, GenSettings, LayerType, OpId, SubjectKind, TextStyle, Workspace,
} from './types';

/* Agent questions, plans and conversation feed types. Re-exported by types.ts. */

// ---------------------------------------------------------------------------
// Agent: questions & plans

export interface AgentQuestion {
  id: string;
  question: string;
  options: string[];
  allowCustom: boolean;
  multi: boolean;
  /** Recommended option, preselected in the card. */
  default?: string;
}

export type StepRef = string; // "s1", "s1#2", "asset:<id>", "layer:<id>"

interface StepBase {
  /** Local node identities, resolved through the existing step executor. */
  nodeSubjects?: PlanSubject[];
  id: string;
  title: string;
  /** Extra steps this one waits for without using their output (a @Name subject made by that step). */
  after?: string[];
}

export interface TextStep extends StepBase {
  kind: 'text';
  text: string;
}

export interface ImageStep extends StepBase {
  kind: 'image';
  prompt: string;
  /** Several candidates: one short variation per result, appended to the shared prompt (one request each). */
  variations?: string[];
  promptFrom?: StepRef;
  modelRef: string;
  settings: GenSettings;
  refs: StepRef[];
}

/** A 3D model generated from text or one or more reference images. */
export interface Model3dStep extends StepBase {
  kind: 'model3d';
  prompt: string;
  promptFrom?: StepRef;
  modelRef: string;
  settings: GenSettings;
  refs: StepRef[];
}

export interface VideoStep extends StepBase {
  kind: 'video';
  prompt: string;
  promptFrom?: StepRef;
  modelRef: string;
  settings: GenSettings;
  firstFrame?: StepRef;
  lastFrame?: StepRef;
  /** Reference images or videos (reference-to-video, keyframes, clips). */
  refs?: StepRef[];
  /** Keyframe seconds, parallel to `refs` (FLUX 3 keyframes); missing entries are spread evenly. */
  times?: Array<number | null>;
}

/** Music (MiniMax Music) or, with a text-output model, song lyrics (MiniMax Lyrics). */
export interface AudioStep extends StepBase {
  kind: 'audio';
  prompt: string;
  promptFrom?: StepRef;
  /** Text of an earlier step (a lyrics step, a text step, a transcription) sent as the song lyrics. */
  lyricsFrom?: StepRef;
  modelRef: string;
  settings: GenSettings;
  /** The model answers with text (lyrics), so the step's output is text. */
  textOutput?: boolean;
}

export interface OpStep extends StepBase {
  kind: 'op';
  op: OpId;
  input: StepRef;
  /** join_clips: the clips after `input`, in order. */
  more?: StepRef[];
  /** Extra images with the role they play (lighting, pose, background…); the op's source is Image 1. */
  refs?: Array<{ ref: StepRef; role?: string; note?: string }>;
  params: Record<string, AdvancedValue>;
  note?: string;
}

export interface LayerStep extends StepBase {
  kind: 'layer';
  layerType: LayerType;
  /** raster: image step/asset to place. */
  source?: StepRef;
  /** raster only: 'base' = layer 1, 'new' = new layer above active, or an existing raster layer id. */
  target: 'base' | 'new' | string;
  text?: string;
  style?: Partial<TextStyle>;
  box?: { x: number; y: number; width: number };
  shapes?: ShapeSpec[];
  /** Freehand strokes in document px: vector → Lineart strokes; raster → painted on a new layer. */
  strokes?: StrokeSpec[];
}

export interface StrokeSpec {
  points: Array<[number, number, number]>;
  /** False when the agent gave no pressure: perfect-freehand simulates it. */
  pressure: boolean;
  color: string;
  size: number;
}

export type PlanStep = TextStep | ImageStep | Model3dStep | VideoStep | AudioStep | OpStep | LayerStep;

/** A subject the plan saves: an existing image (saved when the plan runs) or an image step (saved when it ends). */
export interface PlanSubject {
  name: string;
  kind?: SubjectKind;
  from: StepRef;
  description?: string;
}

export interface PlanContinuity {
  source: StepRef;
  preserve: string;
  steps: string[];
}

export interface Plan {
  id: string;
  title: string;
  summary: string;
  workspace: Workspace;
  steps: PlanStep[];
  /** Named image references: asset sources save/reuse library entries; step sources stay temporary (F3). */
  subjects?: PlanSubject[];
  /** Declared preservation relationships; no implicit saving or extra execution. */
  continuity?: PlanContinuity[];
  /** Style block appended to every image and video prompt (already in the prompts). */
  style?: string;
  adjustments: string[];
  /** Agent-voiced revision notes (told to the agent only). */
  agentNotes?: string[];
}

export type StepState = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'review';

// ---------------------------------------------------------------------------
// Feed (conversation canvas)

interface FeedBase {
  id: string;
  createdAt: number;
  workspace: Workspace;
  meta?: ChatMessageMeta;
}

export interface UserFeedItem extends FeedBase {
  type: 'user';
  text: string;
  mode: ComposerMode;
  attachments: string[];
}

export interface AssistantFeedItem extends FeedBase {
  type: 'assistant';
  text: string;
  streaming?: boolean;
  engine: string;
}

export interface QuestionsFeedItem extends FeedBase {
  type: 'questions';
  intro?: string;
  questions: AgentQuestion[];
  round: number;
  maxRounds: number;
  status: 'pending' | 'answered' | 'skipped';
  answers?: Record<string, string>;
  /** The agent's call this card answers: lets the user reopen it later and answer again. */
  toolCallId?: string;
}

/** Confirmed model and values. */
export interface SettingsChoice {
  modelRef: string;
  resolution?: string;
  /** Seconds per clip (video). */
  duration?: number;
  /** Unset: the input image's shape (a start image), else the model's default. */
  aspect?: string;
  /** The inputs the card was made for: a start or reference image. */
  needsImage: boolean;
  /** Images: how many to generate per image step (1–4, like the composer). */
  count?: number;
}

/** One settings-card part. */
export interface SettingsSection {
  kind: 'video' | 'image';
  /** Clips or images the plan will make with these settings. */
  count: number;
  recommended: SettingsChoice;
  /** A few other models that take the same inputs. */
  alternatives: string[];
  modelSelection?: { requested?: string; reason: string };
  /** Card selection. */
  chosen?: SettingsChoice;
}

export interface SettingsFeedItem extends FeedBase {
  type: 'settings';
  /** What the plan will make (one line). */
  summary?: string;
  /** The plan's kinds, images first. */
  sections: SettingsSection[];
  status: 'pending' | 'confirmed' | 'skipped';
  draft?: DraftMode;
  /** The agent's call this card answers (to reopen). */
  toolCallId?: string;
  /** Switch-model card: the confirmed choice kept for other steps. */
  switchFrom?: SettingsChoice;
  /** With switchFrom: asks whether to continue with the switched model. */
  followUp?: boolean;
  /** Auto: set by the app, no card. */
  inline?: boolean;
}

/** What the user changed back in the conversation (for us, never sent to the agent). */
export interface EditLogEntry {
  at: number;
  kind: 'message' | 'questions' | 'settings';
  itemId: string;
  /** The text, answers or settings before the edit. */
  before: string;
  /** Feed items dropped with it (everything after). */
  removed: number;
}

export interface StepAuthorization {
  modelRef: string;
  parameters: {
    count: number;
    aspect?: string;
    resolution?: string;
    duration?: number;
    audio?: boolean;
    advanced: Record<string, AdvancedValue>;
    shotDurations?: number[];
    operationFactor?: number;
  };
  estimate: Estimate;
}

export interface StepCostReview {
  approved: StepAuthorization;
  proposed: StepAuthorization;
  message: string;
  reason?: string;
  decisions?: import('./agent/priceNotes').StepPriceDecision[];
}

export interface PlanFeedItem extends FeedBase {
  /** Approval of existing node IDs; never materialized again. `runIds` freezes the reviewed preview scope. */
  nodeRun?: { targets: string[]; force: boolean; signature: string; runIds?: string[] };
  type: 'plan';
  comparisonKinds?: Array<'image' | 'video'>;
  plan: Plan;
  style: AgentStyle;
  status: 'awaiting' | 'running' | 'done' | 'partial' | 'error' | 'canceled' | 'review';
  stepStates: Record<string, StepState>;
  stepGenerations: Record<string, string>;
  stepAuthorizations?: Record<string, StepAuthorization>;
  stepCostReviews?: Record<string, StepCostReview>;
  stepVariantNotes?: Record<string, string>;
  stepOutputs?: Record<string, { assetIds: string[]; text?: string; layerId?: string | null }>;
  canceledSteps?: string[];
  estimate: Estimate;
  error?: string;
  /** This plan replaced the pending one after the user asked for a change. */
  revised?: boolean;
  /** Steps the user unchecked before running; they are not run. */
  skipped?: string[];
}

export interface GenerationFeedItem extends FeedBase {
  type: 'generation';
  generationId: string;
  /** A second view of an existing Nodes generation; it never changes which canvas owns the result. */
  mirroredFrom?: 'node';
  /** Result selected by the source node when this feed reference was added. */
  outputIndex?: number;
}

export interface NoticeFeedItem extends FeedBase {
  undoNodes?: { nodes: GraphNode[]; edges: GraphEdge[] };
  undone?: boolean;
  type: 'notice';
  level: 'info' | 'error';
  text: string;
  /** A transient agent failure (connection lost, provider busy): Retry reruns the turn. */
  retry?: { partialItemId?: string };
  /** The model wrote its tool call as text (e.g. DeepSeek's DSML markup): its reply item, which Delete removes. */
  garbledItemId?: string;
  /** Real cost of an unpriced run passed the limit. */
  overLimitFor?: { gen: string; ignored?: boolean };
}

/** One thing the agent did during a turn, shown in its activity block (L3). */
export type ActivityEntry =
  | { kind: 'thinking'; text: string; ms?: number }
  | { kind: 'action'; icon: 'guide' | 'search' | 'questions' | 'plan' | 'fix' | 'schema'; label: string; detail?: string };

/** What the agent is doing in one turn: its reasoning (when streamed) and its actions, with the time it took. */
export interface ActivityFeedItem extends FeedBase {
  type: 'activity';
  startedAt: number;
  endedAt?: number;
  entries: ActivityEntry[];
}

export interface CommandApprovalStep {
  step: number;
  cmd: string;
  title: string;
  effect: 'read' | 'write' | 'spend' | 'delete';
  args: unknown;
  estimate: Estimate;
}

export interface CommandApprovalFeedItem extends FeedBase {
  type: 'commands';
  status: 'awaiting' | 'running' | 'done' | 'error' | 'canceled';
  steps: CommandApprovalStep[];
  totalSteps: number;
  estimate: Estimate;
  error?: string;
}

export type FeedItem =
  | UserFeedItem
  | AssistantFeedItem
  | ActivityFeedItem
  | QuestionsFeedItem
  | SettingsFeedItem
  | PlanFeedItem
  | CommandApprovalFeedItem
  | GenerationFeedItem
  | NoticeFeedItem;
