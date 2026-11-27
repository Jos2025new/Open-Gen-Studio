import type { CustomExportPreset } from '../engine/design/exportSettings';
import type { AgentTier, LlmModel } from '../engine/providers/llm';
import type { AgentStyle, ComposerMode, GenSettings, LlmProviderId, MediaKind, ModelSchema, ModelSummary, ProviderId, RemoteProviderId, TranscriberSummary } from '../engine/types';

/* Plain state types of the store: settings, composer, catalog and toasts. */

export interface Settings {
  designExportPresets?: CustomExportPreset[];
  /** Export options the user pinned to the main panel (by option key), for every document. */
  designExportPinned?: string[];
  keys: Record<RemoteProviderId, string>;
  agent: { provider: LlmProviderId | 'offline'; model: string; /** True only when the user pinned this exact director model. */ modelPinned?: boolean; tier: AgentTier; effort: 'none' | 'low' | 'medium' | 'high'; showThinking?: boolean; updateComposerDefaults?: boolean };
  guidedRounds: number;
  budgetUsd: number;
  /** false: no spending limit, spending is only shown. */
  budgetOn: boolean;
  /** Older "Continue anyway": as budgetNoAsk while budgetUsd is the same. */
  budgetAccepted?: number | null;
  /** Over-limit runs never ask. */
  budgetNoAsk?: boolean;
  /** When a provider is out of credit and the same model (same price or less) is elsewhere: ask first (default), switch on its own, or never switch by itself. */
  autoSwitchProvider?: 'ask' | 'always' | 'never';
  /** Notices silenced with "Don't show again" (ids in engine/notices.ts); the user brings them back in Settings. */
  mutedNotices?: string[];
  /** % over approval before a step waits (default 5). */
  priceMargin?: number | 'off';
  /** Browser notification when generations finish in a hidden tab (default off; permission is asked only when turned on). */
  notify?: boolean;
  /** Tab title while hidden when a generation finishes. */
  notifications: { tabTitle: boolean };
  /** What is attached to a message also stays in Library (default on). */
  keepAttachments?: boolean;
  /** How brand kit changes (tokens, linked logos, components) propagate to open designs: automatic (default) or on demand. */
  brandSyncMode?: 'auto' | 'manual';
  peopleLook?: string;
  ops: { edit: string | null; upscale: string | null; removeBg: string | null; video: string | null; videoUpscale: string | null; videoEdit: string | null; videoExtend: string | null; transcribe: string | null; editRegion: string | null; removeObject: string | null };
}

export interface ComposerState {
  mode: ComposerMode;
  agentStyle: AgentStyle;
  skillId: string | null;
  /** Library entry (moodboard, design system or brand kit) the agent works with. */
  kitId?: string | null;
  workflowId: string | null;
  text: string;
  image: { modelRef: string; settings: GenSettings };
  video: { modelRef: string; settings: GenSettings };
  /** '' until an audio provider is connected (there is no local audio model). */
  audio: { modelRef: string; settings: GenSettings };
  /** 3D stays separate from image settings: resolutions/face counts are model-specific. */
  model3d: { modelRef: string; settings: GenSettings };
  attachments: string[];
  /** Kinds whose model the user picked by hand in the model selector (C2); unset: an app default. */
  userPicked?: Partial<Record<MediaKind, boolean>>;
  /** Agent-only video overrides by input shape; absent routes keep the existing global/default routing. */
  videoRoutes?: Partial<Record<'text' | 'image' | 'reference', string>>;
  /** Keyframe second per attached image (keyframe models); unset ones are spread evenly. */
  times?: Record<string, number>;
  /** Trim [start, end] per attached video (clip models). */
  trims?: Record<string, [number, number]>;
  editing: { generationId: string } | null;
  designerTarget: 'new' | 'replace';
}

export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CatalogState {
  models: Record<string, ModelSummary>;
  schemas: Record<string, ModelSchema>;
  status: Record<ProviderId, CatalogStatus>;
  errors: Partial<Record<ProviderId, string>>;
  llm: Partial<Record<LlmProviderId, LlmModel[]>>;
  llmStatus: Partial<Record<LlmProviderId, CatalogStatus>>;
  /** Speech-to-text models (Transcribe operation). */
  transcribers?: Record<string, TranscriberSummary>;
  /** On-demand price lookups (OpenRouter image models): «loading» while the request is out, «failed» when it errored. */
  priceState: Record<string, 'loading' | 'failed'>;
}

export interface Toast {
  id: string;
  text: string;
  level: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}
