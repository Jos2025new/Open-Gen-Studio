import type { AssetKind, ComposerMode, InputSlots, MediaKind, OpId } from '../../engine/types';

import { OPS } from '../../engine/ops';

/** Where "Go" takes a suggested action: the Tools space with that tool, or Create in a mode with the asset as reference. */
export type ActionRoute = { to: 'tools'; op: OpId } | { to: 'create'; mode: MediaKind };

/** Actions that make something new from the asset (a prompt-led result), by the mode that makes it. Everything else is an operation on the asset. */
const CREATE_ROUTE: Partial<Record<OpId, MediaKind>> = {
  animate: 'video',
  continue: 'video',
  variations: 'image',
  edit: 'image',
  reference_sheet: 'image',
  contact_sheet: 'image',
};

export function routeFor(op: OpId): ActionRoute {
  const mode = CREATE_ROUTE[op];
  return mode ? { to: 'create', mode } : { to: 'tools', op };
}

/** What a Tools route needs: the tool takes this kind of asset. */
export const toolTakes = (op: OpId, kind: AssetKind): boolean => OPS[op]?.input === kind;

const NOUN: Record<string, string> = { image: 'an image', video: 'a video', audio: 'an audio clip', model3d: 'a 3D model' };
export const nounOf = (kind: AssetKind): string => NOUN[kind] ?? 'an asset';

/**
 * The composer's own attach rules for one asset (same as its drop and file handlers): `slots` is the chosen model's
 * input slots; `twin` says a text-only variant has a sibling on the same line that takes images (attaching switches to it).
 * Returns why it cannot be attached, or null.
 */
export function attachProblem(kind: AssetKind, mode: ComposerMode, slots: InputSlots | undefined, twin: boolean): string | null {
  if (mode === 'agent') return null;
  if (kind === 'model3d') return 'no model takes a 3D file as input';
  if (kind === 'video') {
    const takes = mode === 'video' ? Boolean(slots?.refVideos || slots?.mixedRefs || slots?.clips) : Boolean(slots?.clips);
    return takes ? null : 'this model takes no reference videos';
  }
  if (kind === 'audio') return slots?.audio || slots?.refAudios || (mode === 'video' && slots?.mixedRefs) ? null : 'this model takes no audio';
  const direct = mode === 'video' ? Boolean(slots?.firstFrame || slots?.images || slots?.mixedRefs || slots?.keyframes) : Boolean(slots?.images || slots?.clips);
  return direct || twin ? null : 'this model takes no input images';
}
