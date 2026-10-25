export type SupportedParam =
  | { type: 'range'; min: number | null; max: number | null }
  | { type: 'enum'; values: string[] }
  | { type: 'boolean' };

export interface ImageEndpoint {
  provider_slug?: string;
  supported_parameters?: Record<string, SupportedParam>;
  allowed_passthrough_parameters?: string[];
  pricing?: Array<{ billable: string; unit: string; cost_usd: number; resolution?: string }>;
}

/**
 * OpenRouter's per-endpoint capabilities are authoritative when it may choose
 * any endpoint. Enum values are retained only when every endpoint accepts them.
 * An endpoint that declares no capabilities is unknown, not empty: it is left
 * out, and undefined (no endpoint declares any) means use the catalog.
 * Source: https://openrouter.ai/blog/announcements/image-api/
 */
export function commonImageParameters(endpoints: ImageEndpoint[]): Record<string, SupportedParam> | undefined {
  const declared = endpoints.filter((endpoint) => endpoint.supported_parameters);
  if (!declared.length) return undefined;
  const [first, ...rest] = declared;
  const out: Record<string, SupportedParam> = {};
  for (const [key, parameter] of Object.entries(first.supported_parameters ?? {})) {
    const peers = rest.map((endpoint) => endpoint.supported_parameters?.[key]);
    if (peers.some((peer) => !peer || peer.type !== parameter.type)) continue;
    if (parameter.type === 'enum') {
      const accepted = peers as Array<Extract<SupportedParam, { type: 'enum' }>>;
      const values = parameter.values.filter((value) => accepted.every((peer) => peer.values.includes(value)));
      if (values.length) out[key] = { type: 'enum', values };
    } else if (parameter.type === 'range') {
      const ranges = peers as Array<Extract<SupportedParam, { type: 'range' }>>;
      const mins = [parameter, ...ranges].map((range) => range.min).filter((value): value is number => value != null);
      const maxes = [parameter, ...ranges].map((range) => range.max).filter((value): value is number => value != null);
      const min = mins.length ? Math.max(...mins) : null;
      const max = maxes.length ? Math.min(...maxes) : null;
      if (min == null || max == null || min <= max) out[key] = { type: 'range', min, max };
    } else out[key] = { type: 'boolean' };
  }
  return out;
}

/**
 * Build provider.options strictly from endpoint slugs and their allowlists.
 * Source: https://openrouter.ai/blog/announcements/image-api/
 */
export function imageProviderOptions(endpoints: ImageEndpoint[], settings: Record<string, unknown>): Record<string, unknown> | undefined {
  const options: Record<string, Record<string, unknown>> = {};
  for (const endpoint of endpoints) {
    const slug = endpoint.provider_slug;
    if (!slug || !Array.isArray(endpoint.allowed_passthrough_parameters)) continue;
    const allowed: Record<string, unknown> = {};
    for (const key of endpoint.allowed_passthrough_parameters) {
      if (!Object.hasOwn(settings, key)) continue;
      const value = settings[key];
      // Recraft controls and text_layout are structured JSON documents, not free-form text.
      if ((key === 'controls' || key === 'text_layout') && (!value || typeof value !== 'object')) continue;
      if (typeof value === 'string' && !value.trim()) continue;
      allowed[key] = value;
    }
    if (Object.keys(allowed).length) options[slug] = allowed;
  }
  return Object.keys(options).length ? { options } : undefined;
}
