import type { OpSpecInput } from './jobs';
import { isConnected, transcriberFor } from './catalog';
import { useStore } from '../store/store';

/** A replay keeps an available transcriber for this run, without changing Settings. */
export function transcriberForRun(ref?: string) {
  const model = ref ? useStore.getState().catalog.transcribers?.[ref] : undefined;
  return model && isConnected(model.provider) ? model : transcriberFor();
}

/** Fixed-model tools can replay the original run without replacing the user's Settings choice. */
export function reusedOpChoice(input: OpSpecInput): { ref: string; viaEdit: boolean } | null {
  if (!input.modelRef || !input.parentId) return null;
  const st = useStore.getState();
  const original = st.generations[input.parentId];
  const model = st.catalog.models[input.modelRef];
  if (!model || !isConnected(model.provider) || original?.modelRef !== input.modelRef
    || original.op?.id !== input.op || original.op.sourceAssetId !== input.sourceAssetId) return null;
  // opSpecForModel writes an empty prompt for dedicated upscale/background removal, an instruction for edit fallback.
  const viaEdit = (input.op === 'upscale' || input.op === 'remove_bg') && Boolean(original.prompt);
  return { ref: input.modelRef, viaEdit };
}
