import type { GenSettings, InputSlots, ModelSchema, ParamDef } from '../types';
import { normKey } from './keys';

export function routeAudio<T>(slots: InputSlots, audios: T[]): { audio?: T; refAudios: T[] } {
  if (slots.audio && !slots.mixedRefs && audios.length) return { audio: audios[0], refAudios: audios.slice(1) };
  return { refAudios: [...audios] };
}

/** Why a model cannot take this many audio inputs, or null. */
export function lyricsParam(schema: ModelSchema | undefined): ParamDef | undefined {
  return schema?.params.find((p) => p.type === 'text' && p.multiline && normKey(p.key) === 'lyrics');
}

/** Lyrics from a MiniMax Lyrics result (see atlas `lyricsText`): the "# Title" and "Style:" header lines dropped. */
export function lyricsBody(text: string): string {
  const lines = text.split('\n');
  let i = 0;
  if (/^# /.test(lines[i] ?? '')) i++;
  if (/^Style: /.test(lines[i] ?? '')) i++;
  if (i && !lines[i]?.trim()) i++;
  return lines.slice(i).join('\n').trim();
}

/**
 * The request rules MiniMax publishes as JSON-schema conditions (allOf), checked before sending so a request the
 * provider would reject costs nothing. Driven by which fields the model has, not by its name:
 * music — instrumental needs a prompt; the lyrics optimizer writes the lyrics itself (the field must be empty);
 * otherwise lyrics are required. Lyrics — "edit" needs lyrics to edit, "write_full_song" must get none.
 */
export function songProblem(schema: ModelSchema | undefined, prompt: string, settings: GenSettings): { code: string; message: string } | null {
  const lyricsDef = lyricsParam(schema);
  if (!schema || !lyricsDef) return null;
  const lyrics = String(settings.extras?.[lyricsDef.key] ?? '').trim();
  if (lyricsDef.max != null && lyrics.length > lyricsDef.max) return { code: 'LYRICS_TOO_LONG', message: `lyrics are ${lyrics.length} characters; the limit is ${lyricsDef.max}.` };
  const flag = (key: string) => {
    const p = schema.params.find((x) => x.type === 'boolean' && normKey(x.key) === key);
    return p ? Boolean(settings.advanced[p.key] ?? p.default) : undefined;
  };
  const instrumental = flag('is_instrumental');
  const optimizer = flag('lyrics_optimizer');
  if (instrumental !== undefined) {
    if (instrumental) return prompt.trim() ? null : { code: 'PROMPT_MISSING', message: 'an instrumental needs a description of the music in the prompt.' };
    if (optimizer) {
      if (lyrics) return { code: 'LYRICS_CONFLICT', message: '“Write lyrics for me” is on, so the lyrics must be empty. Turn it off to use your lyrics.' };
      return prompt.trim() ? null : { code: 'PROMPT_MISSING', message: 'to write the lyrics it needs a description of the song in the prompt.' };
    }
    return lyrics ? null : { code: 'LYRICS_MISSING', message: 'needs lyrics, or turn on Instrumental or “write lyrics for me”.' };
  }
  const modeDef = schema.params.find((p) => normKey(p.key) === 'mode' && p.options?.includes('edit'));
  if (modeDef) {
    const mode = String(settings.advanced[modeDef.key] ?? modeDef.default ?? '');
    if (mode === 'edit' && !lyrics) return { code: 'LYRICS_MISSING', message: 'editing needs the lyrics to edit.' };
    if (mode !== 'edit' && lyrics) return { code: 'LYRICS_CONFLICT', message: 'writes a new song from the prompt; clear the lyrics or switch the mode to Edit.' };
  }
  return null;
}
