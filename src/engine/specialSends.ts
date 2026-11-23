/* Sends that are not a media generation: transcribe, create a voice, create a style (moved out of jobs.ts, Opus #4). */
import { checkStepAuthorization, costAuthorization } from './priceAuthorization';
import { apiKeyFor } from './catalog';
import { InputError } from './errors';
import { ADAPTERS, preferredProviderLabel } from './providers/registry';
import { PROVIDER_LABELS, parseModelRef, type GenResult, type ProviderAdapter } from './providers/types';
import type { Generation, RemoteJob } from './types';
import { patchGeneration, useStore } from '../store/store';
import { flushSendSave } from './sendMark';
import { sendGenerationViaPaidGate } from './money/storeBridge';
import { finishText, requestEstimate } from './jobState';
import { mediaInput } from './assetIO';

const get = useStore.getState;

async function runSpecialSend(
  g: Generation,
  signal: AbortSignal,
  send: (hooks: { onStatus: (text: string) => void; onRemoteJob: (job: RemoteJob) => void }) => Promise<GenResult>,
): Promise<void> {
  const authorize = g.planId ? () => checkStepAuthorization(g, costAuthorization(g.modelRef, g.settings, requestEstimate(g))) : undefined;
  signal.throwIfAborted();
  authorize?.();
  const outcome = await sendGenerationViaPaidGate({
    g,
    index: 0,
    signal,
    beforeTransport: authorize,
    send: async ({ onRemoteJob }) => {
      const value = await send({
        onStatus: (text) => patchGeneration(g.id, { statusText: text }),
        onRemoteJob,
      });
      return { value, costUsd: value.costUsd ?? g.estimate.usd ?? null, estimated: value.costUsd == null };
    },
  });
  finishText(g.id, outcome.value.text ?? '', outcome.value.costUsd, outcome.sendId);
  await flushSendSave();
}

/** Audio → text with the transcriber recorded on the generation. */
export async function runTranscribe(g: Generation, signal: AbortSignal): Promise<void> {
  const model = get().catalog.transcribers?.[g.modelRef];
  if (!model) throw new Error(`${g.modelName} is not available. Connect ${preferredProviderLabel('transcribe')} or pick another model in Settings → Operations.`);
  const adapter = ADAPTERS[model.provider];
  const apiKey = apiKeyFor(model.provider);
  if (!adapter.transcribe || !apiKey) throw new Error(`Add your ${PROVIDER_LABELS[model.provider]} key in Settings.`);
  const input = await mediaInput(g.op!.sourceAssetId);
  if (input.blob.size > model.maxDirectBytes) {
    const mb = (n: number) => (n / 1048576).toFixed(1);
    throw new InputError('AUDIO_TOO_LARGE', `${model.name} takes files up to ${mb(model.maxDirectBytes)} MB from the app; this one is ${mb(input.blob.size)} MB. Use a shorter or compressed (MP3) clip.`);
  }
  await runSpecialSend(g, signal, (hooks) => adapter.transcribe!({
    model,
    input,
    language: String(g.op!.params.language ?? 'auto'),
    apiKey,
    signal,
    ...hooks,
  }));
}

/** Adapter (by parseModelRef) and key for the one-off creations. */
function creatorOf(g: Generation, what: string): { adapter: ProviderAdapter; apiKey: string } {
  const provider = parseModelRef(g.modelRef)?.provider;
  const adapter = provider ? ADAPTERS[provider] : undefined;
  const apiKey = provider ? apiKeyFor(provider) : undefined;
  if (!provider || !adapter || !apiKey) throw new Error(`Add your ${PROVIDER_LABELS[provider ?? 'local']} key in Settings to create ${what}.`);
  return { adapter, apiKey };
}

/** Custom voice (Kling): 5–30 s of speech → voice_id. */
export async function runCreateVoice(g: Generation, signal: AbortSignal): Promise<void> {
  const { adapter, apiKey } = creatorOf(g, 'Kling voices');
  if (!adapter.createVoice) throw new Error(`${adapter.label} cannot create voices.`);
  const seconds = get().assets[g.op!.sourceAssetId]?.duration;
  if (seconds != null && (seconds < 5 || seconds > 30)) throw new InputError('VOICE_DURATION', `Kling voices need 5–30 s of speech; this clip is ${seconds.toFixed(1)} s.`);
  const input = await mediaInput(g.op!.sourceAssetId);
  await runSpecialSend(g, signal, (hooks) => adapter.createVoice!({ input, apiKey, signal, ...hooks }));
}

/** Custom style (Recraft V4): the generation's reference images → style_id. */
export async function runCreateStyle(g: Generation, signal: AbortSignal): Promise<void> {
  const { adapter, apiKey } = creatorOf(g, 'Recraft styles');
  if (!adapter.createStyle) throw new Error(`${adapter.label} cannot create styles.`);
  const images = g.inputs.refs.filter((r) => get().assets[r]?.kind === 'image');
  if (!images.length || images.length > 10) throw new InputError('STYLE_IMAGES', `A Recraft style needs 1–10 reference images; ${images.length} given.`);
  const inputs = await Promise.all(images.map((r) => mediaInput(r)));
  await runSpecialSend(g, signal, (hooks) => adapter.createStyle!({ images: inputs, apiKey, signal, ...hooks }));
}
