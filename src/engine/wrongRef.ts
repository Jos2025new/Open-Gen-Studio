import type { Asset } from './types';

const KIND_NAME: Record<string, string> = { image: 'an image', video: 'a video', audio: 'an audio clip', model3d: 'a 3D model' };

/** The first reference of another kind than the model takes, said by position and kind; null when all fit. */
export function wrongRef(ids: string[], assets: Record<string, Asset>, takes: 'image' | 'audio'): string | null {
  const i = ids.findIndex((id) => assets[id].kind !== takes);
  return i < 0 ? null : `Reference ${i + 1} is ${KIND_NAME[assets[ids[i]].kind]}; ${takes === 'audio' ? 'music' : '3D'} models only take ${takes === 'audio' ? 'audio' : 'images'}.`;
}
