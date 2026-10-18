import { ensureSchema, resolveModel } from './catalog';
import { PROVIDER_LABELS } from './providers/types';
import type { ModelSchema, ModelSummary } from './types';
import { useStore } from '../store/store';

/**
 * A 'derived' schema is a display-only stand-in built when the provider's real parameter schema could not be
 * loaded. A request built from it can lack required fields (prompt, image key), so nothing paid is ever sent with
 * one. Every send path goes through `resolveSendable`; plan and node previews use `derivedSchemaErrors`.
 */
export class SchemaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaUnavailableError';
  }
}

export function schemaUnavailableMessage(model: Pick<ModelSummary, 'name' | 'provider'>, ref: string, loadError?: string): string {
  const provider = PROVIDER_LABELS[model.provider] ?? model.provider;
  return `${model.name} (${ref}): its parameters could not be loaded from ${provider}, so the request cannot be built correctly. Nothing was sent and you were not charged. Try again, or pick another model.${loadError ? ` Load error: ${loadError}` : ''}`;
}

const isDerived = (s: ModelSchema | undefined): boolean => s?.source === 'derived';

/** The model and its real schema, or a refusal: a derived schema gets one more load attempt, then the send stops. */
export async function resolveSendable(ref: string): Promise<{ model: ModelSummary; schema: ModelSchema } | null> {
  const resolved = await resolveModel(ref);
  if (!resolved || !isDerived(resolved.schema)) return resolved;
  const again = await ensureSchema(ref);
  if (again && !isDerived(again)) return { model: resolved.model, schema: again };
  throw new SchemaUnavailableError(schemaUnavailableMessage(resolved.model, ref, (again ?? resolved.schema).loadError));
}

type Resolve = (ref: string) => Promise<{ model: ModelSummary; schema: ModelSchema } | null>;

/** Plan steps (and node steps) whose model has only a derived schema: flagged before any price is shown or spent. */
export async function derivedSchemaErrors(steps: Array<{ id: string; kind: string; modelRef?: string; params?: Record<string, unknown> }>, getModel: Resolve): Promise<string[]> {
  const errors: string[] = [];
  for (const s of steps) {
    const ref = s.modelRef ?? (typeof s.params?._modelRef === 'string' ? s.params._modelRef : undefined);
    const got = ref ? await getModel(ref).catch(() => null) : null;
    if (ref && got && isDerived(got.schema)) errors.push(`${s.id}: ${schemaUnavailableMessage(got.model, ref, got.schema.loadError)} Not priced.`);
  }
  return errors;
}

/** Node canvas: the same check, from the schemas already in the store (the preview loads them first). */
export function derivedRefErrors(refs: string[]): string[] {
  const { schemas, models } = useStore.getState().catalog;
  return [...new Set(refs)].filter((r) => isDerived(schemas[r]) && models[r]).map((r) => `${schemaUnavailableMessage(models[r], r, schemas[r].loadError)} Not priced.`);
}
