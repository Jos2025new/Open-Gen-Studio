/* Domain model shared by the store, engine, agent and UI. */

export type Workspace = 'chat' | 'node' | 'designer';
export type ComposerMode = 'agent' | 'image' | 'video';
export type AgentStyle = 'auto' | 'guided';
export type MediaKind = 'image' | 'video';

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
  type: 'enum' | 'integer' | 'number' | 'boolean' | 'string';
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
  /** Reference / source images. */
  images?: { key: string; max: number; min: number; multiple: boolean; format: ImageInputFormat };
  /** Image models with a source image and a separate reference list (Ideogram Character remix): the first input image. */
  source?: { key: string; format: ImageInputFormat };
  firstFrame?: { key: string; format: ImageInputFormat };
  lastFrame?: { key: string; format: ImageInputFormat };
  /** Source video for video-to-video models. */
  video?: { key: string; format: ImageInputFormat };
  /** Reference videos (multi-reference models). */
  refVideos?: { key: string; max: number; min: number; format: ImageInputFormat };
  /** One list for every reference medium, each item `{ url, type }` (Atlas `refers`). Replaces `images` and `refVideos`. */
  mixedRefs?: { key: string; max: number; min: number };
}

export interface PriceSku {
  unit: 'output' | 'second' | 'megapixel';
  usd: number;
  resolution?: string;
  audio?: boolean;
  mode?: 'text' | 'image';
  duration?: number;
}

export interface PriceRule {
  skus: PriceSku[];
  audioMultiplier?: number;
  minimumUsd?: number;
  note?: string;
  /** true when the provider bills something we cannot predict (tokens, GPU time). */
  approximate?: boolean;
  /** The published price is the cheapest configuration; higher resolution or audio cost more. Shown as "≥". */
  lowerBound?: boolean;
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
}

// ---------------------------------------------------------------------------
// Generation settings chosen in the composer / by the agent

export type AdvancedValue = string | number | boolean;

export interface GenSettings {
  aspect?: string;
  resolution?: string;
  count: number;
  duration?: number;
  audio?: boolean;
  seed?: number;
  negative?: string;
  advanced: Record<string, AdvancedValue>;
}

export interface Estimate {
  /** null = the price cannot be predicted at all. */
  usd: number | null;
  approximate: boolean;
  /** true when some parts are unknown and `usd` only covers the known ones. */
  lowerBound?: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// Assets & generations

export interface Asset {
  id: string;
  kind: MediaKind;
  mime: string;
  width: number;
  height: number;
  duration?: number;
  sessionId: string;
  generationId?: string;
  /** 'sketch': painted-over copy owned by a node; not listed in the gallery. */
  origin: 'generated' | 'upload' | 'design' | 'frame' | 'sketch';
  /** Provider URL kept when the bytes could not be stored locally. */
  remoteUrl?: string;
  stored: boolean;
  favorite: boolean;
  createdAt: number;
}

export type OpId =
  | 'relight'
  | 'angle'
  | 'upscale'
  | 'remove_bg'
  | 'reframe'
  | 'variations'
  | 'edit'
  | 'animate'
  | 'extract_frame'
  | 'continue'
  | 'contact_sheet'
  | 'grid_split'
  | 'video_upscale'
  | 'video_edit'
  | 'video_extend';

export type GenerationOrigin = 'composer' | 'agent' | 'op' | 'node' | 'designer';
export type GenerationStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled';

export interface RemoteJob {
  provider: RemoteProviderId;
  id: string;
  /** Provider specific polling data (status/response URLs, endpoint id). */
  meta: Record<string, string>;
}

export interface Generation {
  id: string;
  sessionId: string;
  kind: MediaKind;
  prompt: string;
  modelRef: string;
  modelName: string;
  provider: ProviderId;
  settings: GenSettings;
  inputs: { refs: string[]; firstFrame?: string; lastFrame?: string };
  op?: { id: OpId; params: Record<string, AdvancedValue>; sourceAssetId: string };
  origin: GenerationOrigin;
  status: GenerationStatus;
  statusText?: string;
  progress?: number;
  error?: string;
  assetIds: string[];
  estimate: Estimate;
  actualUsd?: number;
  parentId?: string;
  planId?: string;
  stepId?: string;
  remoteJob?: RemoteJob;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

// ---------------------------------------------------------------------------
// Agent: questions & plans

export interface AgentQuestion {
  id: string;
  question: string;
  options: string[];
  allowCustom: boolean;
  multi: boolean;
}

export type StepRef = string; // "s1", "s1#2", "asset:<id>", "layer:<id>"

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
}

export interface ShapeSpec {
  type: 'rect' | 'ellipse' | 'line';
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
}

interface StepBase {
  id: string;
  title: string;
}

export interface TextStep extends StepBase {
  kind: 'text';
  text: string;
}

export interface ImageStep extends StepBase {
  kind: 'image';
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
}

export interface OpStep extends StepBase {
  kind: 'op';
  op: OpId;
  input: StepRef;
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
}

export type PlanStep = TextStep | ImageStep | VideoStep | OpStep | LayerStep;

export interface Plan {
  id: string;
  title: string;
  summary: string;
  workspace: Workspace;
  steps: PlanStep[];
  adjustments: string[];
}

export type StepState = 'pending' | 'running' | 'done' | 'error' | 'skipped';

// ---------------------------------------------------------------------------
// Feed (conversation canvas)

interface FeedBase {
  id: string;
  createdAt: number;
  workspace: Workspace;
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
}

export interface PlanFeedItem extends FeedBase {
  type: 'plan';
  plan: Plan;
  style: AgentStyle;
  status: 'awaiting' | 'running' | 'done' | 'partial' | 'error' | 'canceled';
  stepStates: Record<string, StepState>;
  stepGenerations: Record<string, string>;
  estimate: Estimate;
  error?: string;
}

export interface GenerationFeedItem extends FeedBase {
  type: 'generation';
  generationId: string;
}

export interface NoticeFeedItem extends FeedBase {
  type: 'notice';
  level: 'info' | 'error';
  text: string;
}

export type FeedItem =
  | UserFeedItem
  | AssistantFeedItem
  | QuestionsFeedItem
  | PlanFeedItem
  | GenerationFeedItem
  | NoticeFeedItem;

// ---------------------------------------------------------------------------
// Node graph

export type NodeKind = 'text' | 'image' | 'video' | 'tool' | 'asset';
export type PortType = 'text' | 'image' | 'video';

export interface TextNodeData {
  kind: 'text';
  title: string;
  text: string;
}

export interface GenNodeData {
  kind: 'image' | 'video';
  title: string;
  prompt: string;
  modelRef: string;
  settings: GenSettings;
  generationId?: string;
  outputIndex: number;
  /** Painted-over copy of the result (Sketch). It replaces the result downstream; clearing it restores the original. */
  sketchAssetId?: string;
}

export interface ToolNodeData {
  kind: 'tool';
  title: string;
  op: OpId;
  params: Record<string, AdvancedValue>;
  generationId?: string;
  outputIndex: number;
  /** Painted-over copy of the result (Sketch). It replaces the result downstream; clearing it restores the original. */
  sketchAssetId?: string;
}

export interface AssetNodeData {
  kind: 'asset';
  title: string;
  assetId: string | null;
  /** Painted-over copy of the result (Sketch). It replaces the result downstream; clearing it restores the original. */
  sketchAssetId?: string;
}

export type GraphNodeData = TextNodeData | GenNodeData | ToolNodeData | AssetNodeData;

export interface GraphNode {
  id: string;
  position: { x: number; y: number };
  data: GraphNodeData;
  planId?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** Target port: 'prompt' | 'ref' | 'first' | 'last' | 'input'. */
  targetHandle: string;
  sourceHandle: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

// ---------------------------------------------------------------------------
// Designer

export type LayerType = 'raster' | 'vector' | 'text';
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'soft-light'
  | 'hard-light'
  | 'difference'
  | 'color'
  | 'luminosity';

interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: BlendMode;
}

export interface RasterLayer extends LayerBase {
  type: 'raster';
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
}

export interface VectorLayer extends LayerBase {
  type: 'vector';
  shapes: VectorShape[];
}

export interface TextLayer extends LayerBase, TextStyle {
  type: 'text';
  x: number;
  y: number;
  width: number;
  text: string;
}

export type Layer = RasterLayer | VectorLayer | TextLayer;

export interface DesignDoc {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string | null;
  layers: Layer[];
  activeLayerId: string | null;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Session

export interface LlmMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface AgentState {
  history: LlmMessage[];
  pending?: { toolCallId: string | null; kind: 'questions' | 'plan'; feedItemId: string };
  questionRound: number;
  /** Facts to hand to the model with the next user turn (e.g. execution results). */
  notes: string[];
  busy: boolean;
  /** Offline planner memory for the request being clarified. */
  draft?: { request: string; answers: Record<string, string>; attachments: string[] };
}

export interface Session {
  id: string;
  title: string;
  titleLocked: boolean;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  feed: FeedItem[];
  graph: Graph;
  docs: DesignDoc[];
  activeDocId: string | null;
  agent: AgentState;
  usage: { inputTokens: number; outputTokens: number; llmUsd: number };
}
