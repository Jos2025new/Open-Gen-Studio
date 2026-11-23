import type { DesignDoc } from './design/docType';
export type { DesignDoc } from './design/docType';

/* Shared store, engine, agent and UI types. */

import type { SentRequest } from '../lib/debug';
import type { Mode, Place } from './placeTypes';
import type { DraftMode } from './agent/draftFirst';
import type { FxLayer } from './fx/types';
import type { RemoteJob, SendRecord } from './sendTypes';
export type { RemoteJob, SendRecord, SendStatus, SpendCategory, SpendEntry } from './sendTypes';

export type Workspace = 'chat' | 'node' | 'designer';
/** auto (card if missing), guided (asks), direct (no card). */
export type AgentStyle = 'auto' | 'guided' | 'direct';
/** Generated media types are persistable assets. */
export const MEDIA_KINDS = ['image', 'video', 'audio', 'model3d'] as const;
export type MediaKind = typeof MEDIA_KINDS[number];
export type AssetKind = MediaKind;
/** Composer modes: the agent plus every generated media kind. */
export const COMPOSER_MODES = ['agent', ...MEDIA_KINDS] as const;
export type ComposerMode = typeof COMPOSER_MODES[number];
/** Model reference media kinds: LLM plus every generated media kind. */
export const MODEL_MEDIA_KINDS = ['llm', ...MEDIA_KINDS] as const;
/** Visual generation kinds with frames (image and video). */
export const VISUAL_MEDIA_KINDS = ['image', 'video'] as const;
export type VisualMediaKind = typeof VISUAL_MEDIA_KINDS[number];
/** Media kinds a vision-capable agent can inspect (images, video frames, 3D views). */
export const VIEWABLE_MEDIA_KINDS = ['image', 'video', 'model3d'] as const;

export type ProviderId = 'local' | 'openrouter' | 'fal' | 'nanogpt' | 'atlas';
export type RemoteProviderId = Exclude<ProviderId, 'local'>;
export type LlmProviderId = 'openrouter' | 'nanogpt' | 'atlas';

// ---------------------------------------------------------------------------
// Model catalog (normalized across providers)

export type ParamRole = 'aspect' | 'resolution' | 'duration' | 'count' | 'audio' | 'seed' | 'negative' | 'other';

export interface ParamDef {
  /** Wire name sent to the provider. */
  key: string;
  label: string;
  role: ParamRole;
  /** Structured values live in `settings.extras`; 'text' has a free id, 'textList' strings matching `pattern`. */
  type: 'enum' | 'integer' | 'number' | 'boolean' | 'string' | 'multi' | 'color' | 'colors' | 'palette' | 'text' | 'textList';
  /** 'textList' / 'text': what each value must look like (regex source). */
  pattern?: string;
  /** 'text': long free text edited in a text area (song lyrics). */
  multiline?: boolean;
  /** 'text': tags the editor inserts on their own line ([Verse], [Chorus]…). */
  tags?: string[];
  options?: Array<string | number>;
  min?: number;
  max?: number;
  step?: number;
  default?: string | number | boolean;
  description?: string;
  /** Option that means "let the model decide": chosen in the UI, never sent. */
  omit?: string;
}

export type ImageInputFormat = 'content-part' | 'url' | 'data-url';

export interface InputSlots {
  /** Key for the text prompt (absent when the model takes no prompt). */
  prompt?: string;
  promptRequired?: boolean;
  /** Longest prompt the provider takes, in characters (schema maxLength or "up to N characters"). */
  promptMax?: number;
  /** How the prompt cites references ("@Image1", "<IMAGE_0>"…), from the provider's schema. */
  promptRefs?: string;
  /** Reference or source images; `from`/`total`: officialLimits.ts. */
  images?: { key: string; max: number; min: number; multiple: boolean; format: ImageInputFormat; from?: 'official' | 'assumed'; total?: number };
  frameRules?: { refsWithFirst?: boolean; refsWithLast?: boolean; sourceWithLast?: boolean; lastNeedsFirst?: boolean; firstFrameResolutions?: string[] };
  /** Models with a source image and a separate reference list (Ideogram Character remix). */
  source?: { key: string; format: ImageInputFormat };
  /** `required`: the model cannot run without it (talking avatars, lip-sync). */
  firstFrame?: { key: string; format: ImageInputFormat; required?: boolean };
  lastFrame?: { key: string; format: ImageInputFormat };
  /** Source video for video-to-video models. */
  video?: { key: string; format: ImageInputFormat };
  /** Reference videos (multi-reference models). */
  refVideos?: { key: string; max: number; min: number; format: ImageInputFormat };
  /** Typed references; replaces `images` and `refVideos`. */
  mixedRefs?: { key: string; max: number; min: number };
  /** Images pinned to frame positions (FLUX 3, 24 fps). Takes every input image. */
  keyframes?: { key: string; max: number; min: number; imageKey: string; indexKey: string; fps: number };
  /** One audio track: lip-sync / avatar speech (required there) or a soundtrack. */
  audio?: { key: string; required: boolean; format: ImageInputFormat };
  /** Reference audio list (`reference_audios`, `audio_urls`, `reference_audio_urls`). */
  refAudios?: { key: string; max: number; min: number; format: ImageInputFormat };
  /** Reusable subjects mentioned as @Name and sent as provider elements. */
  elements?: {
    key: string;
    max: number;
    /** Atlas creates elements inline (element_name…); fal takes image sets (frontal_image_url…). */
    style: 'atlas' | 'fal';
    /** How the prompt names element n: "<<<element_{n}>>>" (Atlas) or "@Element{n}" (fal). */
    mention: string;
    refMax: number;
    video: boolean;
    voice: boolean;
  };
  /** Multi-shot prompts (`multi_prompt`: per-shot prompt + seconds). */
  shots?: {
    key: string;
    max: number;
    indexed: boolean;
    durationAsString: boolean;
    /** Switch and mode fields that turn the storyboard on (Atlas: multi_shot, shot_type=customize). */
    flagKey?: string;
    modeKey?: string;
    /** The top-level prompt and the shots are mutually exclusive (fal). */
    exclusivePrompt: boolean;
  };
  /** Inpainting mask: `white` marks the area to change, `alpha` makes it transparent. */
  mask?: { key: string; required: boolean; convention: 'white' | 'alpha'; format: ImageInputFormat };
  /** Trimmed reference clips (`video_clips: { url, start, ends[, fps] }`). Takes the input videos. */
  clips?: {
    key: string;
    max: number;
    min: number;
    /** Longest trimmed span the model accepts, in seconds. */
    maxSpan?: number;
    /** Whole seconds only (Gemini). */
    integer: boolean;
    /** `ends` default when it means "the whole clip" (Nano Banana: 0). */
    wholeEnd?: number;
    /** Sampling fps field and its default (Nano Banana). */
    fps?: { key: string; value: number };
  };
}

export interface PriceSku {
  unit: 'output' | 'second' | 'megapixel' | 'kchar';
  usd: number;
  resolution?: string;
  audio?: boolean;
  mode?: 'text' | 'image';
  duration?: number;
  /** Render quality priced (NanoGPT FLUX 3: "full" | "draft"); unset = any. */
  quality?: string;
}

export interface PriceRule {
  skus: PriceSku[];
  audioMultiplier?: number;
  minimumUsd?: number;
  note?: string;
  /** true when the provider bills something we cannot predict (tokens, GPU time). */
  approximate?: boolean;
  /** Published price = cheapest configuration; shown as "≥". */
  lowerBound?: boolean;
  /** Price per run for each option set (NanoGPT 3D); the key comes from `variant3dKey`. */
  variants?: Record<string, number>;
}

/** A speech-to-text model (audio → text); kept apart from the image/video catalog. */
export interface TranscriberSummary {
  ref: string;
  provider: RemoteProviderId;
  id: string;
  name: string;
  usdPerMinute?: number;
  /** Largest file sent directly (multipart), in bytes. */
  maxDirectBytes: number;
  /** Also transcribes video files. */
  video: boolean;
  diarization: boolean;
  languages?: string[];
}

export interface ModelSummary {
  /** Globally unique reference: `provider::id`. */
  ref: string;
  provider: ProviderId;
  id: string;
  name: string;
  kind: MediaKind;
  acceptsText: boolean;
  acceptsImage: boolean;
  /** Takes a source video (edit, extend, upscale…); offered for video operations. */
  acceptsVideo?: boolean;
  /** Cannot run without a source video; kept out of the ordinary model pickers. */
  needsVideo?: boolean;
  /** Answers with text, not media (MiniMax Lyrics): its generations are text results. */
  textOutput?: boolean;
  tags: string[];
  description?: string;
  price?: PriceRule;
}

export interface ModelSchema {
  ref: string;
  params: ParamDef[];
  slots: InputSlots;
  /** Values always sent: required fields with a default that the UI does not expose. */
  fixed?: Record<string, unknown>;
  /** Required inputs the app cannot send yet (mask, keyframe list…): the model cannot run from here. */
  missing?: string[];
  price?: PriceRule;
  /** Where the schema came from; 'derived' means reconstructed from catalog metadata. */
  source: 'catalog' | 'openapi' | 'derived' | 'builtin';
  /** 'derived' only: why the real schema failed to load. */
  loadError?: string;
}

// ---------------------------------------------------------------------------
// Generation settings chosen in the composer / by the agent

export type AdvancedValue = string | number | boolean;

export interface GenSettings {
  /** Realism register for realistic image and video prompts; default 'balanced' ('photographic' = cinematic). */
  realism?: 'balanced' | 'everyday' | 'cinematic' | 'photographic' | 'ugc' | 'studio' | 'none';
  /** Shot sheet id (cinematic or ugc families); chosen from the prompt when absent. */
  shot?: string;
  /** Capture style (camera, tone, light, texture), video directives and imperfections; see captureStyles. */
  capture?: import('./captureStyles').CaptureSel;
  aspect?: string;
  resolution?: string;
  count: number;
  duration?: number;
  audio?: boolean;
  seed?: number;
  negative?: string;
  advanced: Record<string, AdvancedValue>;
  /** Multi-shot storyboard (Kling multi_prompt): seconds must add up to `duration`. */
  shots?: Array<{ prompt: string; duration: number }>;
  /** Structured parameter values (lists, colors…), by wire key. */
  extras?: Record<string, unknown>;
}

export interface Estimate {
  /** null = the price cannot be predicted at all. */
  usd: number | null;
  approximate: boolean;
  /** true when some parts are unknown and `usd` only covers the known ones. */
  lowerBound?: boolean;
  /** Nominal estimate whose maximum cannot be verified. */
  unbounded?: boolean;
  note?: string;
  /** The provider's own price for this exact request (Atlas quote), not an estimate from catalog prices. */
  exact?: boolean;
}

// ---------------------------------------------------------------------------
// Assets & generations

export interface AssetRevision { assetId: string; width: number; height: number; mime: string; createdAt: number; label?: string }

export interface Asset {
  id: string;
  name?: string;
  kind: AssetKind;
  mime: string;
  width: number;
  height: number;
  duration?: number;
  sessionId: string;
  generationId?: string;
  origin: 'generated' | 'upload' | 'design' | 'frame' | 'sketch' | 'mask' | 'view3d';
  place?: Place;
  mode?: Mode;
  remoteUrl?: string;
  thumbnailUrl?: string;
  view3d?: SavedView3D;
  viewImageId?: string;
  thumbKey?: string;
  /** Ordered list of versions (index 0 = Original, last = newest saved state). */
  revisions?: AssetRevision[];
  /** Pointer to the currently active version in `revisions`. */
  revisionIndex?: number;
  /** Legacy field kept for reading older persisted assets; migrated in code by `assetRevisions.ts`. */
  originalRevision?: AssetRevision;
  copiedFromAssetId?: string;
  revertedAt?: number;
  stored: boolean;
  favorite: boolean;
  createdAt: number;
}

export interface SavedView3D {
  orbit: string;
  target: string;
  fov: string;
  exposure: number;
  environment: 'neutral' | 'legacy';
  texture: boolean;
  roughness: number | null;
  metalness: number | null;
  grid: boolean;
}

export type OpId = 'relight' | 'angle' | 'upscale' | 'remove_bg' | 'reframe' | 'variations' | 'reference_sheet' | 'edit' | 'animate' | 'extract_frame' | 'continue' | 'contact_sheet' | 'grid_split' | 'video_upscale' | 'video_edit' | 'video_extend' | 'transcribe' | 'create_voice' | 'edit_region' | 'remove_object' | 'join_clips' | 'fx' | 'replace_background';

export type GenerationOrigin = 'composer' | 'agent' | 'op' | 'node' | 'designer';
export type GenerationStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled' | 'review';

export interface Generation {
  /** Its session was deleted while running: it finishes (charged to Spending once), then is removed. */
  discard?: boolean;
  /** One variation per result, appended to the prompt of its own request (candidates that differ). */
  variants?: string[];
  /** The shared approval ticket for this generation, if it came from a larger action. */
  approvalTicketId?: string;
  /** Logical node request at execution time; provider transformations do not affect freshness. */
  nodeRequest?: string;
  id: string;
  sessionId: string;
  /** 'text' for transcriptions: no asset, the result is `text`. */
  kind: MediaKind | 'text';
  prompt: string;
  modelRef: string;
  modelName: string;
  provider: ProviderId;
  settings: GenSettings;
  inputs: {
    refs: string[];
    firstFrame?: string;
    lastFrame?: string;
    /** Keyframe position in seconds per input image (user override; default spread by `placeKeyframes`). */
    times?: Record<string, number>;
    /** Clip trim [start, end] in seconds per input video. */
    trims?: Record<string, [number, number]>;
    /** Plan-local subjects (a reference sheet made by the plan): used for @Name here, not saved to the library. */
    subjects?: Subject[];
    /** Library snapshot approved for a node run; later library edits apply to the next run. */
    nodeLibrary?: Subject[];
  };
  op?: { id: OpId; params: Record<string, AdvancedValue>; sourceAssetId: string };
  origin: GenerationOrigin;
  /** Where it was launched and in what mode (see placeTypes.ts); absent in older data. */
  place?: Place;
  mode?: Mode;
  status: GenerationStatus;
  statusText?: string;
  progress?: number;
  error?: string;
  assetIds: string[];
  /** Text result (transcription). */
  text?: string;
  estimate: Estimate;
  retryBaseEstimate?: Estimate;
  retryTotal?: number;
  actualUsd?: number;
  /** Reported cost. */
  providerReportedUsd?: number;
  parentId?: string;
  /** Regenerate/retry attempts of the same operation share this id. */
  operationId?: string;
  planId?: string;
  stepId?: string;
  remoteJob?: RemoteJob;
  /** The provider job id, kept after it ends so a recovered run is not adopted twice. */
  jobId?: string;
  /** The connection failed before a job id came back: the provider may still have the job (Check status). */
  lostJob?: boolean;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** What came back different from what was asked (O3: "asked 9:16, got 1:1 (640×640)"). */
  delivery?: string[];
  /** What the app did on its own (a retry it made), kept after it ends. */
  notes?: string[];
  /** The last provider request (endpoint, params, try, job id). Never a key or media. */
  sent?: SentRequest;
  /** The request left and no answer came back: still set after a reload, it may have been charged. */
  sending?: number;
  /** Per-request send ledger (optional for backward compatibility with saved generations). */
  sends?: SendRecord[];
}

// ---------------------------------------------------------------------------
// Agent: questions, plans & feed (live in planFeedTypes.ts)

import type { EditLogEntry, FeedItem, SettingsChoice } from './planFeedTypes';
export type {
  ActivityEntry, ActivityFeedItem, AgentQuestion, AssistantFeedItem, AudioStep, CommandApprovalFeedItem,
  CommandApprovalStep, EditLogEntry, FeedItem, GenerationFeedItem, ImageStep, LayerStep, Model3dStep,
  NoticeFeedItem, OpStep, Plan, PlanContinuity, PlanFeedItem, PlanStep, PlanSubject, QuestionsFeedItem,
  SettingsChoice, SettingsFeedItem, SettingsSection, StepAuthorization, StepCostReview, StepRef, StepState,
  StrokeSpec, TextStep, UserFeedItem, VideoStep,
} from './planFeedTypes';

export interface TextStyle extends TextExtras {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
}

import type { ShapeSpec, TextExtras } from './shapeSpec';
export type { ShapeSpec };

// ---------------------------------------------------------------------------
// Node graph

// The node graph types live in graphTypes.ts (types.ts is over the size limit and may not grow).
import type { Graph } from './graphTypes';
export type { NodeKind, PortType, LinkKind, SystemNodeType, ModelAttachMode, PortSpec, NodeTypeSpec, TextNodeData, GenNodeData, ToolNodeData, AssetNodeData, RefNodeData, GraphNodeData, GraphNode, GraphEdge, GraphGroup, Graph } from './graphTypes';

// ---------------------------------------------------------------------------
// Designer

export type LayerType = 'raster' | 'vector' | 'text';
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'soft-light' | 'hard-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

export interface LayerBase extends ObjectDepth {
  id: string;
  name: string;
  /** The folder this layer belongs to (DesignDoc.groups), if any. */
  groupId?: string;
  /**
   * Images and text only: an affine matrix [a, b, c, d, e, f] applied after the layer's own placement (rotation, skew,
   * flips), like an SVG transform. Absent = none. Vector content and painted strokes have it baked into their points.
   */
  transform?: [number, number, number, number, number, number];
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: BlendMode;
}

export interface RasterStroke {
  id: string;
  /** Brush segments in buffer pixels: start x/y, end x/y, width. */
  segments: Array<[number, number, number, number, number]>;
  x: number;
  y: number;
  color: string;
  opacity: number;
  erase: boolean;
  tip?: import('./design/brushEngine').BrushTip;
}

export interface RasterLayer extends LayerBase {
  type: 'raster';
  /** A full-page bucket fill, valid only until its pixels are edited. */
  pageFill?: { color: string; rev: number };
  paintBaseId?: string;
  paintStrokes?: RasterStroke[];
  /** The editable-stroke quota was reached; later brush/eraser gestures edit pixels directly. */
  paintFlattened?: boolean;
  /** Per-layer opt-out for future editable-stroke quotas. */
  paintLimitDisabled?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Pixel buffer size (the layer is drawn scaled into width x height). */
  pxWidth: number;
  pxHeight: number;
  rev: number;
  sourceAssetId?: string;
  /** Images are protected from brush/eraser unless the user allows painting on them. */
  allowPaint?: boolean;
}

export interface VectorShape extends ShapeSpec {
  id: string;
  /** Innermost object group (contiguous members). */
  groupId?: string;
}
export type { ObjectGroup } from './objectMeta';
import type { ObjectDepth, ObjectGroup } from './objectMeta';

export type { Stroke, StrokeStyle, StrokeTexture } from './strokeTypes';
import type { Stroke } from './strokeTypes';

export interface VectorLayer extends LayerBase {
  type: 'vector';
  /** Alpha coverage for a lifted region; vector geometry stays editable. */
  pixelMask?: RasterLayer;
  shapes: VectorShape[];
  /** Object groups over `shapes` (a tree). */
  objectGroups?: ObjectGroup[];
  /** Editable pressure strokes (Lineart tool), drawn above the shapes. */
  strokes?: Stroke[];
}

export interface TextLayer extends LayerBase, TextStyle {
  type: 'text';
  x: number;
  y: number;
  width: number;
  text: string;
}

export type Layer = RasterLayer | VectorLayer | TextLayer | FxLayer;

export interface LayerGroup {
  id: string;
  name: string;
  collapsed?: boolean;
  /** Layers hidden or locked before the group was: showing/unlocking it keeps them so. */
  keptHidden?: string[];
  keptLocked?: string[];
}


// ---------------------------------------------------------------------------
// Session

/** OpenAI-style content part: text, or an image the model looks at (data URL). */
export type LlmContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface LlmMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | null | LlmContentPart[];
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  /** OpenRouter's reasoning blocks, kept verbatim and in order; sent back with the tool calls they belong to. */
  reasoning_details?: unknown[];
}

export interface AgentState {
  history: LlmMessage[];
  pending?: { toolCallId: string | null; kind: 'questions' | 'settings' | 'plan'; feedItemId: string };
  /** Settings confirmed for this work (phase 2); plans apply them. */
  settings?: Partial<Record<'video' | 'image', SettingsChoice>>;
  /** Parts of the last confirmed card, in order (two image models when compared). */
  settingsParts?: Array<SettingsChoice & { kind: 'video' | 'image' }>;
  /** Model added by the last switch, per kind. */
  switchedTo?: Partial<Record<'video' | 'image', SettingsChoice>>;
  draftMode?: DraftMode;
  enhance?: boolean; // off: prompts sent as written
  questionRound: number;
  /** Facts for the model with the next user turn. */
  notes: string[];
  busy: boolean;
  /** What the agent is doing while busy (status row). */
  phase?: 'working' | 'drafting' | 'checking';
  /** Schema loads the plan check awaits now. */
  waiting?: { key: string; name: string; since: number }[];
  /** Plan card the user commented on instead of approving. */
  revising?: string;
  /** Offline planner memory for the request being clarified. */
  draft?: { request: string; answers: Record<string, string>; attachments: string[] };
  /** The open questions card's selection (typing sends it). */
  cardPick?: { itemId: string; answers: Record<string, string> };
  /** Canvas the conversation above belongs to (unset: older sessions). */
  canvas?: Workspace;
  /** The other canvases' conversations, kept while this one is active. */
  parked?: Partial<Record<Workspace, CanvasConversation>>;
}

/** One canvas's agent conversation: what the model saw and what is waiting on the user there. */
export type CanvasConversation = Pick<AgentState, 'history' | 'pending' | 'questionRound' | 'notes' | 'draft' | 'revising'>;

/** What one agent request cost in calls, tokens and the agent's own time (not the user's), and how it ended. */
export interface AgentRequestMetrics {
  id: string;
  startedAt: number;
  /** First 120 characters of the request. */
  request: string;
  workspace: Workspace;
  /** Model · provider. */
  engine: string;
  style: AgentStyle;
  skillId?: string;
  workflowId?: string;
  attachments: number;
  llmCalls: number;
  /** Model calls used to summarize a completed plan, tracked separately from request turns. */
  wrapUpCalls?: number;
  inputTokens: number;
  outputTokens: number;
  llmUsd: number;
  /** Time the agent was working (model calls and plan checks), all turns of the request. */
  agentMs: number;
  /** Agent time until the first streamed text or tool call. */
  msToFirstOutput?: number;
  /**
   * Per model call (L4), in ms from sending: first byte from the provider, first reasoning fragment, first text or
   * tool call, and the end; plus reasoning tokens and prompt tokens served from the provider's cache.
   */
  callTimings?: Array<{ ttfbMs: number; reasoningMs?: number; outputMs?: number; toolMs?: number; totalMs: number; reasoningTokens?: number; cachedTokens?: number }>;
  /** Calls that ended in an error: what failed and how long it took (no token sample, there was none). */
  failedCalls?: Array<{ error: string; seconds: number }>;
  /** App time per plan card: from the model call's end to the card in the chat. */
  planCheckMs?: number[];
  /** Agent time until the first plan card. */
  msToPlan?: number;
  questionRounds: number;
  /** Plans shown (the first one plus revisions and replacements). */
  plans: number;
  revisions: number;
  /** Plans the validator sent back. */
  rejectedPlans: number;
  findModels: number;
  /** Skills and workflows loaded with read_guide. */
  guides?: string[];
  /** Models of the latest plan. */
  models: string[];
  /** Estimate of the first plan and of the latest one. */
  estimatedUsd?: number;
  lastEstimatedUsd?: number;
  approvedUsd?: number;
  outcome?: 'approved' | 'canceled' | 'superseded';
}

/** Cumulative totals from trimmed `agentMetrics` entries so session usage stays exact without unbounded lists. */
export interface AgentMetricsAggregate {
  requests: number;
  llmCalls: number;
  wrapUpCalls: number;
  inputTokens: number;
  outputTokens: number;
  llmUsd: number;
  agentMs: number;
  questionRounds: number;
  plans: number;
  revisions: number;
  rejectedPlans: number;
  findModels: number;
}

/** A reusable character or object for Kling elements, kept per session and mentioned as @Name. */
export type SubjectKind = 'character' | 'object' | 'product' | 'location' | 'style';

export interface Subject {
  id: string;
  name: string;
  /** Library tab; older subjects without one are characters. */
  kind?: SubjectKind;
  description?: string;
  /** Main (frontal) image. */
  frontalAssetId?: string;
  /** Extra views (up to 3). */
  refAssetIds: string[];
  /** Or a short video of the subject. */
  videoAssetId?: string;
  /** Provider voice bound to the subject (Kling voice_id). */
  voiceId?: string;
  /** kind 'style' saved from a result: its CTLT, usable as the capture style "Mis estilos". */
  capture?: import('./captureStyles').CaptureCustom;
}

/** A provider style made from reference images (Recraft V4 style_id), kept per session. */
export interface SavedStyle {
  id: string;
  name: string;
  /** Which endpoints accept it: Recraft V4 styles work with the V4 style models. */
  family: 'recraft-v4';
  styleId: string;
}

export interface Session {
  id: string;
  title: string;
  titleLocked: boolean;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  archived?: boolean;
  /** Space container, hidden from session lists and search. */
  hidden?: boolean;
  feed: FeedItem[];
  graph: Graph;
  docs: DesignDoc[];
  activeDocId: string | null;
  /** Every agent's thread by agent node id (see agent/threads.ts). */
  agents: Record<string, AgentState>;
  /** Threads of deleted agent nodes (the last few), so undoing the deletion gives the agent its memory back (agent/threads.ts). */
  retired?: Record<string, AgentState>;
  /** Which thread the UI shows (display only; nothing is written through it). Absent: the session's main thread. */
  agentLane?: string;
  usage: { inputTokens: number; outputTokens: number; llmUsd: number };
  /** Edits the user made back in the conversation, newest last (for us; the agent never sees it). */
  editLog?: EditLogEntry[];
  /** Per-request agent counters (R0), newest last (capped at MAX_METRICS); see agent/metrics.ts. */
  agentMetrics?: AgentRequestMetrics[];
  /** Cumulative totals of agentMetrics entries trimmed past MAX_METRICS. */
  agentMetricsAggregate?: AgentMetricsAggregate;
  subjects?: Subject[];
  styles?: SavedStyle[];
  /** "Don't ask again": over-limit runs here no longer ask. */
  noAskOverLimit?: boolean;
}
