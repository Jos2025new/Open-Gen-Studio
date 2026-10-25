import type { ModelSchema } from './types';

/** The exact change that makes a video step's inputs fit its model (O2: constructive errors, one round). */
export function videoFix(slots: ModelSchema['slots'], n: { firstFrame?: string; lastFrame?: boolean; sourceVideo?: boolean; images: string[]; videos: string[]; audios?: number; resolution?: string }, named: boolean): string {
  const other = named ? ' Or leave "model" out: the app picks a model for these inputs.' : '';
  const rules = slots.frameRules;
  const refs = n.images.length + n.videos.length + (slots.mixedRefs ? n.audios ?? 0 : slots.refAudios ? Math.max(0, (n.audios ?? 0) - (slots.audio ? 1 : 0)) : 0);
  if (rules?.refsWithFirst === false && n.firstFrame && refs) return `use first_frame "${n.firstFrame}" or refs, not both: drop first_frame or drop refs.${other}`;
  if (rules?.refsWithLast === false && n.lastFrame && refs) return 'use last_frame or refs, not both: drop last_frame or drop refs.' + other;
  if (rules?.sourceWithLast === false && n.sourceVideo && n.lastFrame) return 'use the source video or last_frame, not both: remove one of them.' + other;
  if (rules?.lastNeedsFirst && n.lastFrame && !n.firstFrame) return `add first_frame (an image step or asset:<id>) for last_frame.${other}`;
  if (rules?.firstFrameResolutions && n.firstFrame && n.resolution && !rules.firstFrameResolutions.includes(n.resolution)) return `choose a resolution supported with first_frame (${rules.firstFrameResolutions.join(', ')}), or drop first_frame "${n.firstFrame}".${other}`;
  if (n.firstFrame && !slots.firstFrame) return `move first_frame "${n.firstFrame}" into refs, or drop it.${other}`;
  const imageMax = slots.mixedRefs?.max ?? slots.keyframes?.max ?? slots.images?.max ?? 0;
  if (n.images.length > imageMax) {
    if (!imageMax && slots.firstFrame && !n.firstFrame) return `first_frame: the image the clip opens on (a character or scene, never a storyboard sheet) and drop refs.${other}`;
    return imageMax ? `refs: [${n.images.slice(0, imageMax).map((r) => `"${r}"`).join(', ')}] (drop ${n.images.slice(imageMax).join(', ')}).${other}` : `drop ${n.images.join(', ')} from refs (this model takes only first_frame).${other}`;
  }
  const videoMax = slots.mixedRefs?.max ?? (slots.clips ?? slots.refVideos)?.max ?? 0;
  if (n.videos.length > videoMax) return `keep ${videoMax} video(s) in refs (drop ${n.videos.slice(videoMax).join(', ')}).${other}`;
  if (slots.firstFrame?.required && !n.firstFrame) return `set first_frame to an image step or asset:<id>.${other}`;
  return `add the missing input (an image step or asset:<id> in refs).${other}`;
}

/** A storyboard or panel sheet only guides the shots: as a start or end frame the clip would show the sheet itself. */
export function storyboardProblem(s: { storyboard?: string; first_frame?: string; last_frame?: string }): string | undefined {
  if (!s.storyboard || (s.first_frame !== s.storyboard && s.last_frame !== s.storyboard)) return undefined;
  return `${s.storyboard} is the storyboard sheet: as a start or end frame the clip would open on the sheet. Fix: put it in refs on a model that takes reference images (leave "model" out), or cut its first panel with op grid_split and use that panel, or a character image, as first_frame.`;
}
