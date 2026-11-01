import type { OpId } from '../../engine/types';

/** The selection panel's sections, in order: try other takes, change it, take it elsewhere, finish it. */
export type OpGroupId = 'explore' | 'edit' | 'reuse' | 'finalize';

export const OP_GROUP_ORDER: OpGroupId[] = ['explore', 'edit', 'reuse', 'finalize'];

export const OP_GROUP_LABEL: Record<OpGroupId, string> = { explore: 'Explore', edit: 'Edit', reuse: 'Reuse', finalize: 'Finalize' };

/** Every op with one input has a section, so a new op cannot silently vanish from the panel (a test checks it). */
export const OP_GROUPS: Record<Exclude<OpId, 'join_clips'>, OpGroupId> = {
  variations: 'explore',
  angle: 'explore',
  relight: 'explore',
  reference_sheet: 'explore',
  continue: 'explore',
  video_extend: 'explore',
  edit: 'edit',
  edit_region: 'edit',
  remove_object: 'edit',
  remove_bg: 'edit',
  replace_background: 'edit',
  reframe: 'edit',
  fx: 'edit',
  video_edit: 'edit',
  animate: 'reuse',
  contact_sheet: 'reuse',
  grid_split: 'reuse',
  extract_frame: 'reuse',
  transcribe: 'reuse',
  create_voice: 'reuse',
  upscale: 'finalize',
  video_upscale: 'finalize',
};

export function opGroup(id: OpId): OpGroupId {
  return (OP_GROUPS as Record<OpId, OpGroupId | undefined>)[id] ?? 'edit';
}
