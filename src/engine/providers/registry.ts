import type { ProviderId, RemoteProviderId } from '../types';
import { atlas } from './atlas';
import { local } from './demo';
import { fal } from './fal';
import { nanogpt } from './nanogpt';
import { openrouter } from './openrouter';
import type { ProviderAdapter } from './types';

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  local,
  openrouter,
  fal,
  nanogpt,
  atlas,
};

export const REMOTE_PROVIDERS = ['openrouter', 'fal', 'nanogpt', 'atlas'] as const;

export const PROVIDER_SITES: Record<Exclude<ProviderId, 'local'>, { keys: string; docs: string }> = {
  openrouter: { keys: 'https://openrouter.ai/settings/keys', docs: 'https://openrouter.ai/docs' },
  fal: { keys: 'https://fal.ai/dashboard/keys', docs: 'https://fal.ai/docs' },
  nanogpt: { keys: 'https://nano-gpt.com/api', docs: 'https://docs.nano-gpt.com' },
  atlas: { keys: 'https://www.atlascloud.ai/console/api-keys', docs: 'https://www.atlascloud.ai/docs' },
};

/**
 * Preferred defaults per provider, tried in order against the live catalog.
 * Only used to pick sensible defaults; users can choose any listed model.
 */
export const PREFERRED: Record<
  Exclude<ProviderId, 'local'>,
  { image: string[]; video: string[]; edit: string[]; upscale: string[]; removeBg: string[]; videoUpscale: string[]; videoEdit: string[]; videoExtend: string[]; transcribe: string[]; inpaint: string[]; removeObject: string[] }
> = {
  openrouter: {
    image: ['google/gemini-3-pro-image', 'google/gemini-3.1-flash-image', 'bytedance-seed/seedream-4.5', 'openai/gpt-image-2'],
    video: ['google/veo-3.1-fast', 'kwaivgi/kling-v3.0-pro', 'bytedance/seedance-2.0'],
    edit: ['google/gemini-3-pro-image', 'google/gemini-3.1-flash-image', 'openai/gpt-image-2'],
    upscale: [],
    removeBg: [],
    videoUpscale: [],
    videoEdit: [],
    videoExtend: [],
    transcribe: [],
    inpaint: [],
    removeObject: [],
  },
  fal: {
    image: ['fal-ai/nano-banana-pro', 'fal-ai/nano-banana-2', 'fal-ai/bytedance/seedream/v4/text-to-image'],
    video: ['fal-ai/veo3.1/fast', 'fal-ai/kling-video/v3/pro/text-to-video', 'fal-ai/kling-video/v2.6/pro/text-to-video'],
    edit: ['fal-ai/nano-banana-pro/edit', 'fal-ai/nano-banana-2/edit', 'fal-ai/nano-banana/edit'],
    upscale: ['fal-ai/clarity-upscaler', 'fal-ai/seedvr/upscale/image'],
    removeBg: ['fal-ai/bria/background/remove', 'fal-ai/birefnet/v2'],
    videoUpscale: ['fal-ai/bytedance-upscaler/upscale/video', 'fal-ai/seedvr/upscale/video'],
    videoEdit: ['google/gemini-omni-flash/v1.1/edit', 'fal-ai/kling-video/o3/standard/video-to-video/edit', 'bytedance/seedance-2.5/reference-to-video'],
    // IDs from the live snapshot (tests/fixtures/live, 2026-09-25).
    transcribe: [],
    // Mask models (live snapshot 2026-09-25): white-mask inpainting first, GPT Image (alpha mask) after.
    inpaint: ['fal-ai/ideogram/v3/edit', 'fal-ai/qwen-image-edit/inpaint', 'openai/gpt-image-2.5/flare/edit', 'openai/gpt-image-2/edit', 'fal-ai/z-image/turbo/inpaint'],
    removeObject: ['fal-ai/ideogram/object-removal'],
    videoExtend: ['fal-ai/veo3.1/fast/extend-video', 'xai/grok-imagine-video/extend-video', 'blackforestlabs/flux-3/extend-video', 'minimax/h3-max/extend-video', 'bytedance/seedance-2.5/reference-to-video'],
  },
  nanogpt: {
    image: ['nano-banana-pro', 'nano-banana-2', 'seedream-4.5-alternative'],
    video: ['kling-v30-pro', 'bytedance/seedance-2.5', 'alibaba/wan-3.0/text-to-video'],
    edit: ['nano-banana-pro-edit', 'nano-banana-pro', 'nano-banana-edit'],
    // Faithful first (SeedVR2 $0.01, P-Image $0.005), then Clarity creative ($0.05, adds detail).
    upscale: ['seedvr2-image', 'pruna-ai/p-image/upscale', 'clarity-ai-creative-upscaler'],
    removeBg: ['birefnet/v2'],
    videoUpscale: ['bytedance-seedance-upscaler', 'bytedance-video-enhancement-standard', 'clarity-ai/crystal-video-upscaler'],
    videoEdit: ['alibaba/wan-3.0/video-edit', 'grok-imagine-video-edit', 'pruna-ai/p-video/edit', 'blackforestlabs/flux-3/edit-video', 'google/gemini-omni-flash/v1.1', 'bytedance/seedance-2.5'],
    // Speech-to-text chosen by the user (2026-09-25), cheapest first.
    inpaint: [],
    removeObject: [],
    transcribe: ['Whisper-Large-V3', 'xai/speech-to-text/v1', 'gpt-4o-mini-transcribe', 'Elevenlabs-STT'],
    videoExtend: ['alibaba/wan-3.0/video-extend', 'grok-imagine-video-extend', 'veo3-1-fast-extend', 'bytedance-seedance-2-0-video-extend', 'bytedance/seedance-2.5'],
  },
  atlas: {
    image: ['google/nano-banana-pro/text-to-image', 'google/nano-banana-2/text-to-image', 'black-forest-labs/flux-2-pro/text-to-image'],
    video: ['google/veo3.1-fast/text-to-video', 'kwaivgi/kling-v3.0-pro/text-to-video', 'bytedance/seedance-2.0/text-to-video'],
    edit: ['google/nano-banana-pro/edit', 'google/nano-banana-2/edit', 'black-forest-labs/flux-2-pro/edit'],
    upscale: ['atlascloud/image-upscaler', 'tencent/image/upscaler'],
    removeBg: ['youchuan/v8.2/remove-background'],
    videoUpscale: ['byteplus/video/upscaler', 'atlascloud/video-upscaler', 'tencent/video/upscaler'],
    videoEdit: ['google/gemini-omni-1.1-flash/video-edit', 'alibaba/wan-2.7/video-edit', 'xai/grok-imagine-video/edit-video', 'bytedance/seedance-2.5/reference-to-video'],
    transcribe: [],
    inpaint: ['openai/gpt-image-2.5-flare/edit', 'openai/gpt-image-2.5-sunburst/edit'],
    removeObject: [],
    videoExtend: ['google/gemini-omni-1.1-flash/video-extend', 'xai/grok-imagine-video/extend-video', 'black-forest-labs/flux-3/extend-video', 'bytedance/seedance-2.5/reference-to-video'],
  },
};

/** Image-to-video counterparts for providers that split endpoints by task. */
export function i2vCounterpart(provider: ProviderId, id: string): string | null {
  if (provider === 'fal') {
    if (id.endsWith('/text-to-video')) return id.replace(/\/text-to-video$/, '/image-to-video');
    if (/^fal-ai\/veo3(\.1)?(\/fast|\/lite)?$/.test(id)) return `${id}/image-to-video`;
  }
  if (provider === 'atlas' && id.endsWith('/text-to-video')) return id.replace(/\/text-to-video$/, '/image-to-video');
  if (provider === 'nanogpt' && id.endsWith('/text-to-video')) return id.replace(/\/text-to-video$/, '/image-to-video');
  return null;
}

/** Edit (image input) counterparts for providers that split text-to-image and edit endpoints. */
export function editCounterpart(provider: ProviderId, id: string): string | null {
  if (provider === 'fal') {
    if (id.endsWith('/text-to-image')) return id.replace(/\/text-to-image$/, '/edit');
    if (/^fal-ai\/nano-banana(-pro|-2)?$/.test(id)) return `${id}/edit`;
  }
  if (provider === 'atlas' && id.endsWith('/text-to-image')) return id.replace(/\/text-to-image$/, '/edit');
  if (provider === 'nanogpt' && /^nano-banana(-pro)?$/.test(id)) return `${id}-edit`;
  return null;
}

let recommended: Set<string> | null = null;

/** Refs shown by default in model pickers: the preferred defaults above plus their image-input variants. */
export function recommendedRefs(): Set<string> {
  if (recommended) return recommended;
  recommended = new Set();
  for (const [p, lists] of Object.entries(PREFERRED) as Array<[RemoteProviderId, Record<string, string[]>]>) {
    for (const id of Object.values(lists).flat()) {
      for (const v of [id, i2vCounterpart(p, id), editCounterpart(p, id)]) if (v) recommended.add(`${p}::${v}`);
    }
  }
  return recommended;
}
