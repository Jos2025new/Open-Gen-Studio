import { ensureSchema, modelSummary } from '../catalog';
import { aspectLabel, durationChoices, paramByRole } from '../params';
import type { ModelSchema } from '../types';
import { useStore } from '../../store/store';
import { indexedModels } from './modelIndex';

/*
 * What a model can make (docs/features/agente-auto-tarjeta.md, "Límites del modelo"): the agent reads it before it plans
 * (find_models, confirm_settings), so a length or resolution the model does not have is known up front. Read from the
 * model's own schema, the same one the settings card shows; nothing here calls the provider beyond loading that schema.
 */

const schemaOf = (ref: string): ModelSchema | undefined => useStore.getState().catalog.schemas[ref];
const seconds = (schema: ModelSchema | undefined) => durationChoices(schema).filter((d) => d > 0);
const resolutions = (schema: ModelSchema | undefined) => (paramByRole(schema, 'resolution')?.options ?? []).map(String).filter((r) => !/auto|default/i.test(r));

/** The images a model takes, in the words the validator uses ("1 start image, no reference images"), so a plan is written for them. */
function imagesLine(schema: ModelSchema | undefined): string {
  const sl = schema?.slots;
  if (!sl) return '';
  if (sl.mixedRefs) return `up to ${sl.mixedRefs.max} references (images, videos, audio)`;
  const start = sl.firstFrame ? '1 start image' : '';
  const max = sl.keyframes?.max ?? sl.images?.max ?? 0;
  const refs = max ? `up to ${max} ${sl.keyframes ? 'keyframe' : 'reference'} images` : 'no reference images';
  return [start, refs].filter(Boolean).join(', ');
}

/** "720p, 1080p · 5–12 s · 16:9, 9:16 · 1 start image, no reference images" from the loaded schema; empty when it has none of them. */
export function limitsLine(ref: string): string {
  const schema = schemaOf(ref);
  const s = seconds(schema);
  const aspects = (paramByRole(schema, 'aspect')?.options ?? []).map(String).filter((a) => !/auto/i.test(a));
  return [
    resolutions(schema).join(', '),
    s.length ? (s.length > 2 && s[s.length - 1] - s[0] === s.length - 1 ? `${s[0]}–${s[s.length - 1]} s` : `${s.join(', ')} s`) : '',
    aspects.length && aspects.length <= 8 ? aspects.map(aspectLabel).join(', ') : '',
    modelSummary(ref)?.kind === 'video' ? imagesLine(schema) : '',
  ].filter(Boolean).join(' · ');
}

/** Load the schemas of these models at once, bounded so a slow provider never holds the agent up. */
export async function loadLimits(refs: string[], ms = 2500): Promise<void> {
  await Promise.race([Promise.all(refs.map((r) => ensureSchema(r).catch(() => null))), new Promise((done) => setTimeout(done, ms))]);
}

/** The seconds the user asked for in their words ("45 segundos", "12 s", "1 minuto"), if any. */
export function askedSeconds(text: string): number | undefined {
  const min = /(\d+(?:[.,]\d+)?)\s*(?:min\b|minutos?|minutes?)/i.exec(text);
  if (min) return Math.round(Number(min[1].replace(',', '.')) * 60);
  const sec = /(\d+(?:[.,]\d+)?)\s*(?:s\b|seg\b|segs\b|segundos?|seconds?|secs?\b)/i.exec(text);
  return sec ? Math.round(Number(sec[1].replace(',', '.'))) : undefined;
}

/** Video models of the connected providers whose clips reach `secs` (loaded schemas only), cheapest listed first. */
function longerModels(secs: number, except: string): string[] {
  return indexedModels()
    .filter((m) => m.kind === 'video' && m.ref !== except && Math.max(0, ...seconds(schemaOf(m.ref))) >= secs)
    .slice(0, 3)
    .map((m) => `${m.name} (${m.ref})`);
}

/**
 * A length the model cannot make in one clip: the plan waits and the agent asks the user how to go on (several clips,
 * another model that reaches it, or one shorter clip). Undefined when it fits, when the schema is not known, or once
 * the user answered this request's question (then only a length the model cannot take is sent back).
 */
export function durationProblem(ref: string, partSeconds: number | undefined, requestText: string, answered: boolean): string | undefined {
  const s = seconds(schemaOf(ref));
  if (!s.length) return undefined;
  const max = Math.max(...s);
  const name = modelSummary(ref)?.name ?? ref;
  // Once the user answered, their choice decides; only a length the model cannot take is sent back.
  if (answered) return (partSeconds ?? 0) > max ? `Not confirmed: ${name} takes at most ${max} s per clip (${limitsLine(ref)}). Follow the user's answer: call confirm_settings with a duration it takes, and for a longer piece plan several clips joined with join_clips.` : undefined;
  const want = Math.max(partSeconds ?? 0, askedSeconds(requestText) ?? 0);
  if (want <= max) return undefined;
  const clips = Math.ceil(want / max);
  const each = Math.ceil(want / clips);
  const others = longerModels(want, ref);
  const options = [
    `"${clips} clips de unos ${each} s unidos" (${clips} video steps of ≤${max} s and one join_clips step)`,
    others.length ? `"Cambiar a un modelo que llegue a ${want} s" (${others.join(', ')})` : '',
    `"Un solo clip de ${max} s" (compress the content into one ${max}-second clip)`,
  ].filter(Boolean);
  return `Not confirmed: ${want} s were asked, but ${name} makes clips of at most ${max} s (it takes ${limitsLine(ref)}). Do not plan yet. Say it in one short sentence and ask the user with ask_questions (one question, these options): ${options.join('; ')}. If ask_questions is not available, say the choice in one line. Then call confirm_settings again with the chosen model and a duration it takes (for several clips, the length of each), and only after that plan the clips.`;
}

const OWED = 'ask the user with ask_questions (one question';
/** The length question is owed to the user: the last thing told to the agent was the length problem, and the user has not answered since. */
export function durationOwed(history: Array<{ role: string; content?: unknown }>): boolean {
  const last = [...history].reverse().find((m) => m.role === 'tool' && typeof m.content === 'string' && (m.content.includes(OWED) || m.content.startsWith('User answers')));
  return Boolean(last && String(last.content).includes(OWED));
}

/** A resolution named in the request that the model does not have: the agent says so in one line and goes on. */
export function resolutionNote(ref: string, requestText: string): string {
  const res = resolutions(schemaOf(ref));
  const asked = /\b(\d{3,4}p|[1-8]k)\b/i.exec(requestText)?.[1];
  if (!asked || !res.length || res.some((r) => r.toLowerCase() === asked.toLowerCase())) return '';
  const name = modelSummary(ref)?.name ?? ref;
  return `\nThe user asked for ${asked}; ${name} has ${res.join(', ')}. Tell them in one line that it goes in the closest one, and go on.`;
}
