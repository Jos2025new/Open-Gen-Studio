import type { FitState } from '../agent/fit';
import type { RoleRef } from '../refRoles';
import type { AssetKind, GenSettings, MediaKind, ModelSchema, ModelSummary, PlanContinuity, PlanStep, SettingsChoice, Subject, SubjectKind, Workspace } from '../types';
import type { RefSpec } from '../refRoles';
import type { Realism } from '../realism';
import type { RouteMode } from '../routing';
import type { VariantRoute } from '../variants';

export interface RawStep {
  id?: string;
  kind?: string;
  title?: string;
  prompt?: string;
  prompt_from?: string;
  /** Audio steps: the text of an earlier step used as song lyrics. */
  lyrics_from?: string;
  model?: string;
  user_requested?: boolean;
  /** Video purpose. */
  purpose?: string;
  aspect?: string;
  resolution?: string;
  count?: number;
  /** Image: one short variation per result (candidates that differ). */
  variations?: string[];
  duration?: number;
  audio?: boolean;
  seed?: number;
  refs?: RefSpec[];
  realism?: Realism;
  shot?: string;
  capture?: unknown;
  times?: Array<number | null>;
  shots?: Array<{ prompt: string; duration: number }>;
  first_frame?: string;
  last_frame?: string;
  op?: string;
  input?: string;
  /** join_clips: the clips after `input`, in order. */
  more?: string[];
  params?: Record<string, unknown>;
  text?: string;
  layer_type?: string;
  source?: string;
  target?: string;
  style?: Record<string, unknown>;
  box?: { x?: number; y?: number; width?: number };
  shapes?: Array<Record<string, unknown>>;
  strokes?: Array<Record<string, unknown>>;
}

export interface RawPlan {
  continuity?: PlanContinuity[];
  title?: string;
  summary?: string;
  /** Seconds the video steps add up to; split over the video steps without their own duration. */
  total_duration?: number;
  steps?: RawStep[];
  /** Subjects to save: { name, from: an image step or asset:<id>, description? }. */
  subjects?: Array<{ name?: string; kind?: SubjectKind; from?: string; description?: string }>;
  /** One style block the app appends to every image and video prompt. */
  style?: string;
  /** Notes of what a revision copied from the plan it replaces (set by the app, not the agent). */
  carried?: string[];
}

export type OutputKind = AssetKind | 'text' | 'layer';

export interface PlanContext {
  workspace: Workspace;
  getModel: (ref: string) => Promise<{ model: ModelSummary; schema: ModelSchema } | null>;
  defaultModel: (kind: MediaKind, needsImage: boolean) => string | null;
  defaultSettings: (kind: MediaKind) => Partial<GenSettings>;
  asset: (id: string) => { kind: AssetKind; width?: number; height?: number } | undefined;
  layer: (id: string) => { type: string } | undefined;
  maxSteps?: number;
  /**
   * Whether the user picked the composer's model by hand (C2). When false, video steps without a model follow
   * the purpose table; when true, or when not given, the composer's model is the default as before.
   */
  composerChosen?: (kind: MediaKind) => boolean;
  /** Optional Agent-composer override for one exact video input route. */
  routeModel?: (mode: RouteMode) => string | undefined;
  /** Closest supported ref for a wrong model id ("did you mean"); no LLM call. */
  suggestModel?: (ref: string, kind: MediaKind, needsImage: boolean) => string | undefined;
  /** Exact input route within the confirmed model line and provider; no fuzzy name search. */
  variantModel?: (ref: string, route: VariantRoute) => string | undefined;
  /** True when the user picked this kind's model by hand but it has no variant for these inputs and a stand-in is used. */
  defaultIsFallback?: (kind: MediaKind, needsImage: boolean) => boolean;
  /** What the user wrote (messages, answers): a model the plan names wins over the composer's pick only if it is named here. */
  userText?: () => string;
  /** Images attached to the current request: the start frame a model needs when the plan forgot it. */
  requestImages?: () => string[];
  /** Sources for known @Name references. */
  librarySubjects?: () => Subject[];
  /** Library names for callers that do not need source assets. */
  subjectNames?: () => string[];
  /** New proposals require recurring continuity coverage. */
  strictContinuity?: boolean;
  /** Settings the user confirmed (phase 2): model, resolution, duration and aspect for every step of that kind. */
  confirmed?: (kind: MediaKind) => SettingsChoice | undefined;
  /** Every confirmed part of that kind, in card order: several when the card compared models (A/B in one plan). */
  confirmedParts?: (kind: MediaKind) => SettingsChoice[];
  /** The request being handled: its message and its answers. What a fitted operation parameter is read from. */
  requestText?: () => string;
  switchedTo?: (kind: MediaKind) => SettingsChoice | undefined;
  /** Angle values already made from this source image, so "a different angle" takes one that is not made yet. */
  usedAngles?: (assetId: string) => string[];
  /** Direct mode: no questions, so an ambiguity takes the operation's visible default instead of asking. */
  direct?: () => boolean;
  /** A question round is left in this request, and whether the user already answered one (fit.ts asks once). */
  canAsk?: () => boolean;
  answered?: () => boolean;
  /** The image model an image-model operation runs on: the confirmed one (Auto, Guided) or the composer's (Direct). */
  opModel?: () => string | undefined;
}

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
  share: number | undefined;
  stepRoles: Map<string, RoleRef[]>;
  fit: FitState;
  refKind(ref: string | undefined, where: string): OutputKind | 'raster' | null;
  expectImage(ref: string | undefined, where: string): void;
  inputAspect(ref: string | undefined): string | undefined;
  frameOf(ref: string, which: 'first' | 'last', forId: string): string;
}

/** One normalizer per step kind: validates the raw step, pushes its normalized step(s) and its errors in the agent's wording. */
export type NormalizeStep = (s: RawStep, env: StepEnv) => Promise<void>;
