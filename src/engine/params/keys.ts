import type { ParamRole } from '../types';
import { ratioOf } from './aspect';

const ROLE_KEYS: Record<Exclude<ParamRole, 'other'>, string[]> = {
  aspect: ['aspect_ratio', 'aspectratio', 'ratio', 'image_size', 'orientation'],
  resolution: ['resolution', 'resolutions', 'size', 'quality_resolution', 'output_resolution'],
  duration: ['duration', 'seconds', 'duration_seconds', 'video_length'],
  // Not max_images: Seedream uses it for multi-image sets next to num_images.
  count: ['n', 'num_images', 'num_outputs', 'nimages', 'number_of_images'],
  audio: ['generate_audio', 'generateaudio', 'sound', 'audio', 'enable_audio', 'with_audio', 'audio_generation'],
  seed: ['seed'],
  negative: ['negative_prompt', 'negativeprompt'],
};

/** Parameters we never surface (transport flags handled by the adapters). */
const HIDDEN_KEYS = new Set([
  'model',
  'sync_mode',
  'enable_sync_mode',
  'enable_base64_output',
  'webhook',
  'webhook_url',
  'callback_url',
  'stream',
  'response_format',
  'conversationuuid',
  'provider',
  'session_id',
  'limit_generations',
]);

export const PROMPT_KEYS = ['prompt', 'text', 'instruction'];

export const MULTI_IMAGE_KEYS = ['image_urls', 'images', 'input_references', 'reference_images', 'reference_image_urls', 'imagedataurls', 'image_list', 'ref_images'];
export const SINGLE_IMAGE_KEYS = ['image_url', 'image', 'input_image', 'imagedataurl', 'init_image', 'source_image', 'image_input'];
export const FIRST_FRAME_KEYS = ['start_image_url', 'first_frame_image', 'start_image', 'first_frame', 'first_frame_url', 'image_url', 'image', 'imagedataurl', 'input_image'];
// Source video for edit/upscale models (fal: video_url; Atlas: video or video_url).
export const VIDEO_KEYS = ['video_url', 'video', 'input_video', 'source_video', 'video_input'];
// Lists of reference clips (Atlas: reference_videos; fal: video_urls, reference_video_urls).
export const REF_VIDEO_KEYS = ['reference_videos', 'reference_video_urls', 'video_urls'];
// Audio inputs: reference lists, and single tracks (lip-sync speech, soundtrack). `audio` alone is usually the
// "generate audio" switch, so a single-track key only counts when its value is a string.
// Inpainting masks (fal: mask_url, mask_image_url; Atlas GPT Image 2.5: mask).
export const MASK_KEYS = ['mask_url', 'mask_image_url', 'mask', 'mask_image'];
export const REF_AUDIO_KEYS = ['reference_audios', 'reference_audio_urls', 'audio_urls'];
// `audio` counts only as text (InfiniteTalk's track); as a boolean it is the generate-audio switch.
export const AUDIO_KEYS = ['audio_url', 'target_audio_url', 'driving_audio_url', 'input_audio', 'audio_file', 'audio'];
export const LAST_FRAME_KEYS = ['end_image_url', 'last_image', 'tail_image_url', 'end_image', 'last_frame_image', 'last_frame', 'last_frame_url', 'tail_image'];

export function normKey(k: string): string {
  return k.toLowerCase();
}

/**
 * Canonical role of a parameter. An aspect-like key (image_size, orientation...) only
 * counts as 'aspect' when its options read as ratios; otherwise it stays model-specific.
 */
export function roleForKey(key: string, options?: Array<string | number>): ParamRole {
  const k = normKey(key);
  for (const [role, keys] of Object.entries(ROLE_KEYS) as Array<[Exclude<ParamRole, 'other'>, string[]]>) {
    if (!keys.includes(k)) continue;
    if (role === 'aspect' && !options?.some((o) => ratioOf(o) != null)) return 'other';
    return role;
  }
  return 'other';
}

export function isHiddenKey(key: string): boolean {
  return HIDDEN_KEYS.has(normKey(key));
}

export function humanizeKey(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Aspect helpers
