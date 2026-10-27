import type { InputSlots, MediaKind, ModelSchema, ParamDef } from '../types';
import { normKey } from './keys';
import { lyricsParam } from './audio';

export function castOption(p: ParamDef, value: string): string | number {
  const match = p.options?.find((o) => String(o) === String(value));
  if (match != null) return match;
  if (p.type === 'integer' || p.type === 'number') return Number(value);
  return value;
}

// Video inputs

/**
 * Route video inputs. First image is the start frame when supported; remaining images and videos are references.
 */
export function routeVideoInputs<T>(slots: InputSlots, images: T[], videos: T[], firstFrame?: T): { firstFrame?: T; images: T[]; videos: T[] } {
  // Keyframe models pin every image, the start frame first.
  if (slots.keyframes) return { firstFrame: undefined, images: firstFrame ? [firstFrame, ...images] : [...images], videos };
  const rest = [...images];
  let first = firstFrame;
  if (!first && slots.firstFrame && rest.length && slots.frameRules?.refsWithFirst !== false) first = rest.shift();
  if (first && !slots.firstFrame && (slots.images || slots.mixedRefs)) {
    rest.unshift(first);
    first = undefined;
  }
  return { firstFrame: first, images: rest, videos };
}

/** Audio inputs: the first track to a single-track field when there is one, the rest as references. */
export function audioInputProblem(slots: InputSlots, audios: number): string | null {
  if (slots.mixedRefs) return null; // counted with the other references
  const max = (slots.audio ? 1 : 0) + (slots.refAudios?.max ?? 0);
  if (audios > max) return max ? `accepts up to ${max} audio track${max > 1 ? 's' : ''}.` : 'does not accept audio.';
  if (slots.audio?.required && audios < 1) return 'needs an audio track.';
  if (audios < (slots.refAudios?.min ?? 0) + (slots.audio?.required ? 1 : 0)) return 'needs reference audio.';
  return null;
}

/** Why these video inputs are unsupported, or null. */
export function videoInputProblem(slots: InputSlots, n: { firstFrame: boolean; lastFrame: boolean; sourceVideo: boolean; images: number; videos: number; audios?: number; resolution?: string }): string | null {
  const rules = slots.frameRules;
  const refAudios = slots.mixedRefs ? n.audios ?? 0 : slots.refAudios ? Math.max(0, (n.audios ?? 0) - (slots.audio ? 1 : 0)) : 0;
  const references = n.images + n.videos + refAudios;
  if (rules?.refsWithFirst === false && n.firstFrame && references) return 'cannot combine reference media with a start frame.';
  if (rules?.refsWithLast === false && n.lastFrame && references) return 'cannot combine reference media with a last frame.';
  if (rules?.sourceWithLast === false && n.sourceVideo && n.lastFrame) return 'cannot combine a source video with a last frame.';
  if (rules?.lastNeedsFirst && n.lastFrame && !n.firstFrame) return 'needs a start image when using a last frame.';
  if (rules?.firstFrameResolutions && n.firstFrame && n.resolution && !rules.firstFrameResolutions.includes(n.resolution)) return `does not support ${n.resolution} with a start image.`;
  if (n.firstFrame && !slots.firstFrame) return 'cannot start from an image.';
  const audioProblem = audioInputProblem(slots, n.audios ?? 0);
  if (audioProblem) return audioProblem;
  const mixed = slots.mixedRefs;
  if (mixed) {
    const total = n.images + n.videos + (n.audios ?? 0);
    if (total > mixed.max) return `accepts up to ${mixed.max} references.`;
    // Audio alone is not a reference set (MiniMax H3): at least one image or video.
    if (n.images + n.videos < mixed.min) return 'needs at least one reference image or video.';
    return null;
  }
  const kf = slots.keyframes;
  const imageMax = kf?.max ?? slots.images?.max ?? 0;
  const what = kf ? 'keyframe images' : 'reference images';
  if (n.images > imageMax) return imageMax ? `accepts up to ${imageMax} ${what}.` : slots.firstFrame ? 'takes one start image.' : 'does not accept reference images.';
  if (n.images < (kf?.min ?? slots.images?.min ?? 0)) return kf ? 'needs at least one keyframe image.' : 'needs a reference image.';
  const videos = slots.clips ?? slots.refVideos;
  const videoMax = videos?.max ?? 0;
  if (n.videos > videoMax) return videoMax ? `accepts up to ${videoMax} reference ${slots.clips ? 'clip' : 'video'}${videoMax > 1 ? 's' : ''}.` : 'does not accept reference videos (use Extract frame to start from a still).';
  if (videos && n.videos < videos.min) return slots.clips ? 'needs a reference video clip.' : 'needs a reference video.';
  if (slots.firstFrame?.required && !n.firstFrame) return 'needs a start image.';
  return null;
}

/** BFL FLUX 3 frame indices; user seconds win, and indices stay within the clip. */
export function placeKeyframes(count: number, duration: number, fps: number, seconds: Array<number | null | undefined> = []): number[] {
  const last = Math.max(0, Math.round(duration * fps));
  const frames: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = seconds[i];
    let f = at != null && Number.isFinite(at) ? Math.round(Math.min(Math.max(at, 0), duration) * fps) : count === 1 ? 0 : Math.round((i * last) / (count - 1));
    // Nudge collisions to the nearest free frame.
    for (let d = 1; frames.includes(f) && d <= last; d++) f = !frames.includes(f + d) && f + d <= last ? f + d : f - d >= 0 && !frames.includes(f - d) ? f - d : f;
    frames.push(f);
  }
  return frames;
}

/** Trim [start, end] for a reference clip: the user's, else the whole clip or the longest span the model takes. */
export function clipTrim(slot: NonNullable<InputSlots['clips']>, seconds: number | undefined, override?: [number, number]): [number, number] {
  let [start, end] = override ?? [0, slot.wholeEnd != null && !slot.maxSpan ? slot.wholeEnd : Math.min(seconds ?? slot.maxSpan ?? 10, slot.maxSpan ?? Infinity)];
  if (slot.maxSpan && end - start > slot.maxSpan) end = start + slot.maxSpan;
  if (slot.integer) {
    start = Math.floor(start);
    end = end === 0 ? 0 : Math.max(start + 1, Math.round(end));
  }
  return [start, end];
}

/** What a model takes as input, in the words the agent's plan uses (refs, first_frame, times…). */
/** The lyrics field of a song model (MiniMax Music / Lyrics), when it has one. */
export function capabilityHints(schema: ModelSchema | undefined, kind: MediaKind): string[] {
  if (!schema) return ['inputs unknown until the model loads'];
  const s = schema.slots;
  const out: string[] = [];
  if (kind === 'video') {
    if (s.firstFrame) out.push('first_frame');
    if (s.lastFrame) out.push('last_frame');
    if (s.keyframes) out.push(`keyframes: up to ${s.keyframes.max} image refs in order, optional times (seconds), ${s.keyframes.fps} fps`);
    if (s.images) out.push(`up to ${s.images.max} reference image refs${s.images.min ? ' (required)' : ''}`);
    if (s.refVideos) out.push(`up to ${s.refVideos.max} reference video refs`);
    if (s.mixedRefs) out.push(`up to ${s.mixedRefs.max} image/video refs${s.mixedRefs.min ? ' (at least one required)' : ''}`);
    if (s.clips) out.push(`${s.clips.max} reference video clip${s.clips.maxSpan ? ` (≤${s.clips.maxSpan} s used)` : ''}${s.clips.min ? ' (required)' : ''}`);
    if (!out.length) out.push('text-to-video only');
  } else if (kind === 'audio') {
    const lyrics = lyricsParam(schema);
    if (lyrics) out.push(`lyrics: params.lyrics (≤${lyrics.max ?? '?'} chars, lines with section tags like [Verse], [Chorus]) or lyrics_from a text step`);
    const has = (key: string) => schema.params.some((p) => normKey(p.key) === key);
    if (has('is_instrumental')) out.push('is_instrumental: true for music without vocals (prompt required)');
    if (has('lyrics_optimizer')) out.push('lyrics_optimizer: true writes the lyrics from the prompt (leave lyrics empty)');
    if (schema.params.some((p) => normKey(p.key) === 'mode' && p.options?.includes('edit'))) out.push('mode edit rewrites the given lyrics; write_full_song takes no lyrics');
    if (!s.audio && !s.refAudios) out.push('text only (no media input)');
  } else {
    if (s.source) out.push('source image first in refs, then references');
    out.push(s.images ? `up to ${s.images.max + (s.source ? 1 : 0)} image refs${s.images.min ? ' (required)' : ''}` : 'no image input');
    if (s.clips) out.push(`${s.clips.max} video clip ref${s.clips.min ? ' (required)' : ''}`);
  }
  if (s.elements) out.push(`subjects: mention session subjects as @Name (up to ${s.elements.max}; each a frontal image + up to ${s.elements.refMax} views${s.elements.video ? ' or a video' : ''}${s.elements.voice ? ', optional voice' : ''})`);
  if (s.shots) out.push(`multi-shot: shots [{prompt, duration}] adding up to the duration (up to ${s.shots.max})`);
  if (s.audio) out.push(`an audio ref${s.audio.required ? ' (required: the speech or track to follow)' : ' (optional soundtrack)'}`);
  if (s.refAudios) out.push(`up to ${s.refAudios.max} reference audio refs`);
  if (s.mixedRefs) out.push('audio refs count among the references');
  if (s.promptRefs) out.push(`prompt: ${s.promptRefs}`);
  if (s.promptMax) out.push(`prompt ≤${s.promptMax} chars`);
  if (schema.missing?.length) out.push(`cannot run from the app (needs ${schema.missing.join(', ')})`);
  return out;
}

/**
 * Subject mentions: "@Name" in the prompt, in order of first appearance. With a template ("@Element{n}",
 * "<<<element_{n}>>>") each mention becomes the provider's element reference; without one, the plain name.
 */
export function shotsProblem(shots: Array<{ prompt: string; duration: number }> | undefined, duration: number | undefined): string | null {
  if (!shots?.length) return null;
  if (shots.some((s) => !s.prompt.trim())) return 'every shot needs a prompt.';
  const total = shots.reduce((t, s) => t + s.duration, 0);
  if (duration != null && duration > 0 && total !== duration) return `shots add up to ${total} s but the clip is ${duration} s.`;
  return null;
}
