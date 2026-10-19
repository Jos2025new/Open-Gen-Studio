import { OPS } from './ops';
import { PLACE_LABEL, type Mode, type Place } from './placeTypes';
import type { Generation, OpId, Workspace } from './types';

/** Where a launch happens: an open Space wins over the workspace underneath it. */
export function placeFor(ui: { space?: 'create' | 'tools' }, workspace: Workspace): Place {
  if (ui.space === 'create') return 'space-create';
  if (ui.space === 'tools') return 'space-tools';
  return workspace === 'node' ? 'canvas' : workspace === 'designer' ? 'designer' : 'studio';
}

/** What was chosen to make it; an operation says its tab's kind, the composer its mode. */
export function modeFor(composerMode: Mode, op?: OpId): Mode {
  return op ? OPS[op].input : composerMode;
}

export function placeLabel(g: Pick<Generation, 'place'>): string {
  return g.place ? PLACE_LABEL[g.place] : '';
}
