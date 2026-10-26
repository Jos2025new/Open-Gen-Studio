import { ensureSchema, modelSummary } from '../catalog';
import { providersIn } from '../modelNamed';
import { PROVIDER_LABELS } from '../providers/types';
import { durationChoices, paramByRole, videoInputProblem } from '../params';
import { lineKey, variantRoute } from '../variants';
import type { ModelSchema, SettingsChoice } from '../types';
import { useStore } from '../../store/store';
import { indexedModels } from './modelIndex';
import { loadLimits } from './modelLimits';
import { refsCap } from '../officialLimits';

/*
 * Auto (docs/features/agente-auto-tarjeta.md, "Proveedor que encaja"): the composer's provider, or the one picked before,
 * may not take what the user asked (a resolution, a length, a frame, the images). The same model and the same variant at
 * another connected provider that takes all of it is used instead, and the agent says so in its message. A provider the
 * user named in words is never changed.
 */

export interface Wanted { resolution?: string; duration?: number; aspect?: string; startImage: boolean; images: number; count?: number }

/** The resolution the user wrote ("480p", "4k"), if any. */
export const askedResolution = (text: string): string | undefined => /\b(\d{3,4}p|[1-8]k)\b/i.exec(text)?.[1]?.toLowerCase();

/** What this model's schema cannot take of `want`, in a few words; empty when it takes all of it (or says nothing about it). */
export function missing(schema: ModelSchema | undefined, want: Wanted): string[] {
  if (!schema) return [];
  const out: string[] = [];
  const res = (paramByRole(schema, 'resolution')?.options ?? []).map((r) => String(r).toLowerCase());
  if (want.resolution && res.length && !res.includes(want.resolution)) out.push(want.resolution);
  const secs = durationChoices(schema).filter((d) => d > 0);
  if (want.duration && secs.length && !secs.includes(want.duration)) out.push(`${want.duration} s`);
  const aspects = (paramByRole(schema, 'aspect')?.options ?? []).map(String);
  if (want.aspect && aspects.length && !aspects.includes(want.aspect)) out.push(want.aspect);
  if ((want.images || want.startImage) && videoInputProblem(schema.slots, { firstFrame: want.startImage, lastFrame: false, sourceVideo: false, images: want.images, videos: 0 })) out.push(`${want.images + (want.startImage ? 1 : 0)} images`);
  const img = schema.slots.images;
  if (want.images && img?.total && want.images > refsCap(img, want.count)) out.push(`${want.images} images with ${want.count ?? 1} result${(want.count ?? 1) > 1 ? 's' : ''}`);
  return out;
}

/** The same model and variant at another connected provider that takes everything asked, or undefined. */
export async function betterProvider(ref: string, want: Wanted, request: string): Promise<{ ref: string; note: string } | undefined> {
  const me = modelSummary(ref);
  if (!me || (me.kind !== 'video' && me.kind !== 'image') || providersIn(request).length) return undefined;
  const lacks = missing(useStore.getState().catalog.schemas[ref] ?? (await ensureSchema(ref)) ?? undefined, want);
  if (!lacks.length) return undefined;
  // Image providers split variants differently (fal: text-to-image and edit; OpenRouter: one model): its schema decides.
  const twins = indexedModels().filter((m) => m.provider !== me.provider && m.kind === me.kind && lineKey(m) === lineKey(me) && (me.kind === 'image' || variantRoute(m) === variantRoute(me)));
  for (const m of twins) {
    const schema = useStore.getState().catalog.schemas[m.ref] ?? (await ensureSchema(m.ref).catch(() => null)) ?? undefined;
    if (schema && !missing(schema, want).length) {
      const note = `\nProvider changed: ${me.name} at ${PROVIDER_LABELS[me.provider]} does not take ${lacks.join(', ')}; at ${PROVIDER_LABELS[m.provider]} the same model takes it, so the app uses ${m.ref}. Tell the user in one line of your message that you changed the provider and why.`;
      return { ref: m.ref, note };
    }
  }
  return undefined;
}

/** The wanted values of a section's choice and the request's words. */
export const wantedOf = (c: SettingsChoice, request: string, images: number): Wanted => ({ resolution: askedResolution(request), duration: c.duration, aspect: c.aspect, startImage: Boolean(c.needsImage) && !images, images });

/**
 * Other connected models of the same kind that take everything asked (the images first of all), the composer's provider
 * first: what the agent offers the user instead of planning with a model that would drop part of the request or fail.
 */
export async function fittingModels(ref: string, want: Wanted, limit = 3): Promise<string[]> {
  const me = modelSummary(ref);
  if (!me) return [];
  const pool = indexedModels()
    .filter((m) => m.kind === me.kind && lineKey(m) !== lineKey(me) && (!(want.images || want.startImage) || m.acceptsImage))
    .sort((a, b) => Number(b.provider === me.provider) - Number(a.provider === me.provider))
    .slice(0, 16);
  await loadLimits(pool.map((m) => m.ref));
  const schemas = useStore.getState().catalog.schemas;
  return pool.filter((m) => schemas[m.ref] && !missing(schemas[m.ref], want).length).slice(0, limit).map((m) => m.ref);
}
