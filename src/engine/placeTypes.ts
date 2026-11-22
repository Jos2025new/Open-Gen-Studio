/* Where a result was made and what was chosen to make it. Mode derives from ComposerMode in types.ts. */
import type { ComposerMode } from './types';

export type Place = 'studio' | 'canvas' | 'designer' | 'space-create' | 'space-tools';
export type Mode = ComposerMode;

export const PLACE_LABEL: Record<Place, string> = {
  studio: 'Studio',
  canvas: 'Canvas',
  designer: 'Designer',
  'space-create': 'Create',
  'space-tools': 'Tools',
};

export const MODE_LABEL: Record<Mode, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  model3d: '3D',
  agent: 'Agent',
};
