import type { AdvancedValue, GenSettings, MediaKind, ModelSchema, ModelSummary, OpId, ProviderId, RemoteJob } from '../types';

export interface MediaInput {
  assetId: string;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
}

export interface GenRequest {
  kind: MediaKind;
  model: ModelSummary;
  schema: ModelSchema;
  prompt: string;
  settings: GenSettings;
  /** Outputs requested from this single provider call. */
  count: number;
  /** Reference (or source) images. */
  refs: MediaInput[];
  /** Reference videos, for models with `refVideos` or `mixedRefs`. */
  refVideos?: MediaInput[];
  /** Keyframe images with their frame index, for models with a `keyframes` slot. */
  keyframes?: Array<{ input: MediaInput; frame: number }>;
  /** Reference clips with their trim in seconds, for models with a `clips` slot. */
  clips?: Array<{ input: MediaInput; start: number; end: number }>;
  firstFrame?: MediaInput;
  lastFrame?: MediaInput;
  /** Source video for video-to-video models. */
  video?: MediaInput;
  /** Set for operations; remote providers only use the instruction prompt, the local demo applies the op itself. */
  op?: { id: OpId; params: Record<string, AdvancedValue> };
  apiKey: string;
  signal: AbortSignal;
  onStatus: (text: string, progress?: number) => void;
  onRemoteJob: (job: RemoteJob) => void;
}

export interface GenOutput {
  blob?: Blob;
  url?: string;
  mime?: string;
}

export interface GenResult {
  outputs: GenOutput[];
  costUsd?: number;
}

export interface ResumeContext {
  kind: MediaKind;
  apiKey: string;
  signal: AbortSignal;
  onStatus: (text: string, progress?: number) => void;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  /** Model catalog. Public catalogs may be listed without a key. */
  listModels(apiKey: string | undefined, signal?: AbortSignal): Promise<ModelSummary[]>;
  loadSchema(model: ModelSummary, apiKey: string | undefined): Promise<ModelSchema>;
  generate(req: GenRequest): Promise<GenResult>;
  /** Continue polling a job submitted before a reload. */
  resume?(job: RemoteJob, ctx: ResumeContext): Promise<GenResult>;
  /** Spendable USD on the account, when the provider exposes it to a normal API key. */
  balance?(apiKey: string, signal?: AbortSignal): Promise<number | undefined>;
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  local: 'Local demo',
  openrouter: 'OpenRouter',
  fal: 'fal.ai',
  nanogpt: 'NanoGPT',
  atlas: 'Atlas Cloud',
};

export function modelRef(provider: ProviderId, id: string): string {
  return `${provider}::${id}`;
}

export function parseModelRef(ref: string): { provider: ProviderId; id: string } | null {
  const i = ref.indexOf('::');
  if (i <= 0) return null;
  const provider = ref.slice(0, i) as ProviderId;
  if (!['local', 'openrouter', 'fal', 'nanogpt', 'atlas'].includes(provider)) return null;
  return { provider, id: ref.slice(i + 2) };
}
