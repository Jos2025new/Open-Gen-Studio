import { ensureSchema, modelSummary } from '../catalog';
import { providersIn } from '../modelNamed';
import { PROVIDER_LABELS } from '../providers/types';
import { durationChoices, paramByRole, videoInputProblem } from '../params';
import { lineKey, variantRoute } from '../variants';
import type { ModelSchema, SettingsChoice } from '../types';
import { useStore } from '../../store/store';
import { indexedModels } from './modelIndex';

/*
 * Auto (docs/features/agente-auto-tarjeta.md, "Proveedor que encaja"): the composer's provider, or the one picked before,
 * may not take what the user asked (a resolution, a length, a frame, the images). The same model and the same variant at
 * another connected provider that takes all of it is used instead, and the agent says so in its message. A provider the
 * user named in words is never changed.
 */

export interface Wanted { resolution?: string; duration?: number; aspect?: string; startImage: boolean; images: number }

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
  if ((want.images || want.startImage) && videoInputProblem(schema.slots, { firstFrame: want.startImage, images: want.images, videos: 0 })) out.push(`${want.images + (want.startImage ? 1 : 0)} images`);
  return out;
}

/** The same model and variant at another connected provider that takes everything asked, or undefined. */
export async function betterProvider(ref: string, want: Wanted, request: string): Promise<{ ref: string; note: string } | undefined> {
  const me = modelSummary(ref);
  if (!me || me.kind !== 'video' || providersIn(request).length) return undefined;
  const lacks = missing(useStore.getState().catalog.schemas[ref] ?? (await ensureSchema(ref)) ?? undefined, want);
  if (!lacks.length) return undefined;
  const twins = indexedModels().filter((m) => m.provider !== me.provider && m.kind === me.kind && lineKey(m) === lineKey(me) && variantRoute(m) === variantRoute(me));
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
