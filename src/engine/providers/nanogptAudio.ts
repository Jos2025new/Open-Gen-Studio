import { cacheDb } from '../../lib/idb';
import { extractErrorMessage, JobFailedError, requestJson } from '../../lib/http';
import { extensionForMime } from '../../lib/media';
import type { ModelSchema, ModelSummary, ParamDef, PriceRule, RemoteJob, TranscriberSummary } from '../types';
import { JSON_HEADERS, numberOrUndefined as num, POLL_TIMEOUT_MS, pollJob } from './shared';
import type { GenRequest, GenResult, ResumeContext, TranscribeRequest } from './types';
import { modelRef } from './types';

/*
 * NanoGPT audio: speech-to-text (transcription) and, since 2026-10-08, text-to-speech and sound effects.
 * Kept apart from nanogpt.ts, which may not grow (ADR 0008). Voice and effect models are the ones the user chose
 * (docs/catalogo-voz-y-efectos.md); the others in the catalog stay hidden.
 */

const BASE = 'https://nano-gpt.com/api';
const DAY = 24 * 3600 * 1000;
type Loose = Record<string, unknown>;

export function nanoHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'x-api-key': key };
}

export interface NanoAudioModel {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  architecture?: { input_modalities?: string[] };
  pricing?: { per_minute?: number; per_thousand_chars?: number; per_second?: number; minimum?: number };
  capabilities?: { speech_to_text?: boolean; diarization?: boolean; text_to_speech?: boolean; text_to_audio?: boolean };
  supported_parameters?: { max_request_body_mb?: number; supported_languages?: string[]; voices?: string[]; max_chars?: number; max_duration?: number; turn_input?: { maxInputBytes?: number } };
}

export async function fetchAudioModels(): Promise<NanoAudioModel[]> {
  const cached = await cacheDb.get<NanoAudioModel[]>('nano:v1:audio', DAY / 2);
  if (cached) return cached;
  const res = await requestJson<{ data: NanoAudioModel[] }>(`${BASE}/v1/audio-models?detailed=true`);
  await cacheDb.set('nano:v1:audio', res.data);
  return res.data;
}

// ---------------------------------------------------------------------------
// Text-to-speech and sound effects

/**
 * The voice and effect models offered (user's choice, 2026-10-08). The first speech model is the default for speech
 * when the user names none: Gemini Flash TTS ranks in the top three of the Artificial Analysis Speech Arena and costs
 * 0.05 USD per 1000 characters. Sound effects have one model.
 */
export const SPEECH_MODELS = ['google/gemini-3.8-flash-tts', 'gpt-4o-mini-tts-2025-12-15', 'elevenlabs/eleven-v4-turbo', 'elevenlabs/eleven-v4', 'Minimax-Speech-2.8-Turbo', 'Minimax-Speech-2.8-HD'];
export const SFX_MODEL = 'elevenlabs/sound-effects/v2';
export const DEFAULT_SPEECH_REF = modelRef('nanogpt', SPEECH_MODELS[0]);
export const DEFAULT_SFX_REF = modelRef('nanogpt', SFX_MODEL);
/** Models that take delivery instructions ("calm, warm, slow"); the others ignore the field. */
const TAKES_INSTRUCTIONS = /gpt-4o-mini-tts|gemini/i;

const speechRaw = new Map<string, NanoAudioModel>();

function speechPrice(m: NanoAudioModel): PriceRule | undefined {
  const perK = num(m.pricing?.per_thousand_chars);
  if (perK != null) return { skus: [{ unit: 'kchar', usd: perK }], note: `${perK} USD per 1000 characters` };
  // Effects: the model picks the length (up to max_duration), so one effect is priced at the longest: an upper bound.
  const perS = num(m.pricing?.per_second);
  const longest = num(m.supported_parameters?.max_duration) ?? 22;
  if (perS != null) return { skus: [{ unit: 'output', usd: perS * longest }], approximate: true, note: `${perS} USD per second; priced at the longest sound (${longest} s)` };
  return undefined;
}

/** The chosen voice and effect models present in the live catalog, as audio models. */
export async function speechSummaries(): Promise<ModelSummary[]> {
  const models = await fetchAudioModels().catch(() => [] as NanoAudioModel[]);
  const wanted = new Set([...SPEECH_MODELS, SFX_MODEL]);
  return models.filter((m) => wanted.has(m.id)).map((m) => {
    speechRaw.set(m.id, m);
    return { ref: modelRef('nanogpt', m.id), provider: 'nanogpt', id: m.id, name: m.name ?? m.id, kind: 'audio', acceptsText: true, acceptsImage: false, tags: [m.id === SFX_MODEL ? 'sound effects' : 'speech'], description: m.description, price: speechPrice(m) };
  });
}

export function isSpeechModel(id: string): boolean {
  return id === SFX_MODEL || SPEECH_MODELS.includes(id);
}

/** Speech: the prompt is the text spoken, with a voice and, where taken, delivery instructions. Effects: a description. */
export async function speechSchema(model: ModelSummary): Promise<ModelSchema> {
  if (!speechRaw.has(model.id)) await speechSummaries();
  const raw = speechRaw.get(model.id);
  if (!raw) throw new Error(`Unknown NanoGPT audio model ${model.id}`);
  const sp = raw.supported_parameters ?? {};
  const params: ParamDef[] = [];
  const voices = sp.voices ?? [];
  if (voices.length) params.push({ key: 'voice', label: 'Voice', role: 'other', type: 'enum', options: voices, default: voices[0] });
  if (TAKES_INSTRUCTIONS.test(model.id)) params.push({ key: 'instructions', label: 'Delivery', role: 'other', type: 'string', default: '', description: 'How it is spoken: tone, pace, emotion (not billed as text).' });
  const promptMax = num(sp.max_chars) ?? num(sp.turn_input?.maxInputBytes);
  const price = speechPrice(raw);
  return { ref: model.ref, params, slots: { prompt: 'input', promptRequired: true, ...(promptMax ? { promptMax } : {}) }, price, source: 'catalog' };
}

/** POST /v1/audio/speech: the audio comes back in the response (or, for some models, as a JSON with its URL). */
export async function generateSpeech(req: GenRequest): Promise<GenResult> {
  const body: Loose = { model: req.model.id, input: req.prompt };
  const voice = req.settings.advanced.voice;
  if (typeof voice === 'string' && voice) body.voice = voice;
  const instructions = req.settings.advanced.instructions;
  if (typeof instructions === 'string' && instructions.trim() && TAKES_INSTRUCTIONS.test(req.model.id)) body.instructions = instructions.trim();
  req.onStatus('Generating');
  req.onRequest?.({ url: `${BASE}/v1/audio/speech`, body });
  const res = await fetch(`${BASE}/v1/audio/speech`, { method: 'POST', headers: { ...JSON_HEADERS, ...nanoHeaders(req.apiKey) }, body: JSON.stringify(body), signal: req.signal });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('json')) {
    const json = (await res.json().catch(() => ({}))) as Loose;
    const url = typeof json.audioUrl === 'string' ? json.audioUrl : typeof json.url === 'string' ? json.url : undefined;
    if (res.ok && url) return { outputs: [{ url, mime: typeof json.contentType === 'string' ? json.contentType : undefined }], costUsd: num(json.cost) };
    throw new Error(extractErrorMessage(json, `NanoGPT audio failed (HTTP ${res.status})`));
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error('NanoGPT returned no audio');
  return { outputs: [{ blob, mime: blob.type || type || 'audio/mpeg' }] };
}

// ---------------------------------------------------------------------------
// Speech-to-text (moved unchanged from nanogpt.ts)

/** Files sent directly to /transcribe: the docs allow multipart uploads up to 3 MB. */
const TRANSCRIBE_DIRECT_BYTES = 3 * 1024 * 1024;

export function pollTranscription(job: RemoteJob, ctx: ResumeContext): Promise<GenResult> {
  return pollJob(ctx, 'NanoGPT', 3000, async () => {
    const res = await requestJson<Loose>(`${BASE}/transcribe/status`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...nanoHeaders(ctx.apiKey) },
      body: JSON.stringify({ runId: job.id, cost: num(job.meta.cost), paymentSource: job.meta.paymentSource || undefined, isApiRequest: true }),
      signal: ctx.signal,
      timeoutMs: POLL_TIMEOUT_MS,
    });
    const status = String(res.status ?? '').toLowerCase();
    if (status === 'completed' || typeof res.transcription === 'string') {
      return { outputs: [], text: transcriptionText(res), costUsd: num(res.cost) ?? num(job.meta.cost) };
    }
    if (status === 'failed' || status === 'error') throw new JobFailedError(extractErrorMessage(res, 'Transcription failed'));
    return status === 'pending' ? 'Queued' : 'Transcribing';
  });
}

/** The text of a finished transcription: `transcription`, else the diarized segments joined. */
function transcriptionText(res: Loose): string {
  if (typeof res.transcription === 'string') return res.transcription;
  if (typeof res.text === 'string') return res.text;
  const segments = (res.diarization as Loose | undefined)?.segments;
  if (Array.isArray(segments)) return segments.map((s) => `${(s as Loose).speaker ? `${(s as Loose).speaker}: ` : ''}${(s as Loose).text ?? ''}`).join('\n');
  return '';
}

export async function listTranscribers(): Promise<TranscriberSummary[]> {
  const models = await fetchAudioModels();
  return models
    .filter((m) => m.capabilities?.speech_to_text && !/voice-clone/i.test(m.id))
    .map(
      (m): TranscriberSummary => ({
        ref: modelRef('nanogpt', m.id),
        provider: 'nanogpt',
        id: m.id,
        name: m.name ?? m.id,
        usdPerMinute: num(m.pricing?.per_minute),
        maxDirectBytes: Math.min(TRANSCRIBE_DIRECT_BYTES, (num(m.supported_parameters?.max_request_body_mb) ?? 3) * 1024 * 1024),
        video: Boolean(m.architecture?.input_modalities?.includes('video')),
        diarization: Boolean(m.capabilities?.diarization),
        languages: m.supported_parameters?.supported_languages,
      }),
    );
}

export async function transcribe(req: TranscribeRequest): Promise<GenResult> {
  const form = new FormData();
  form.append('audio', req.input.blob, `input.${extensionForMime(req.input.mime || req.input.blob.type)}`);
  form.append('model', req.model.id);
  form.append('language', req.language || 'auto');
  req.onStatus('Transcribing');
  const res = await requestJson<Loose>(`${BASE}/transcribe`, { method: 'POST', headers: nanoHeaders(req.apiKey), body: form, signal: req.signal });
  if (typeof res.transcription === 'string') return { outputs: [], text: res.transcription, costUsd: num((res.metadata as Loose | undefined)?.cost) };
  // Long files run as a job (HTTP 202): keep it so a reload or a failed check can resume.
  const runId = String(res.runId ?? '');
  if (!runId) throw new Error('NanoGPT returned no transcription');
  const job: RemoteJob = { provider: 'nanogpt', id: runId, meta: { kind: 'transcribe', cost: String(res.cost ?? ''), paymentSource: String(res.paymentSource ?? '') } };
  req.onRemoteJob(job);
  return pollTranscription(job, { kind: 'text', apiKey: req.apiKey, signal: req.signal, onStatus: req.onStatus });
}
