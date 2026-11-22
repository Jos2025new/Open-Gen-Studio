import type { MediaKind, RemoteProviderId } from './types';

export interface RemoteJob {
  provider: RemoteProviderId;
  id: string;
  /** Provider specific polling data (status/response URLs, endpoint id). */
  meta: Record<string, string>;
}

export type SendStatus = 'intent' | 'sent' | 'done' | 'uncertain' | 'failed';

/** Durable per-request send record stored inside `Generation.sends`. */
export interface SendRecord {
  id: string;
  index: number;
  status: SendStatus;
  remoteJob?: RemoteJob;
  /** What this request cost once it delivered: reported, quoted, or its share of the estimate. Unset when unknown. */
  costUsd?: number;
  /** `costUsd` is an estimate (no reported cost and no quote), or the price was unknown (`costUsd` unset). */
  estimated?: boolean;
  /** Already booked to Spending: a record is booked once (sendLedger). Unset when the cost was unknown. */
  bookedUsd?: number;
  /** True when already booked to Spending with an unknown price (`bookedUsd` stays unset, never 0). */
  bookedUnknown?: boolean;
}

/** Where money went: the agent's model calls and each paid generation. */
export type SpendCategory = 'agent' | MediaKind | 'text';

export interface SpendEntry {
  at: number;
  usd: number;
  /** True when the provider did not report the cost and it comes from published prices. */
  estimated: boolean;
  /** True when neither provider nor catalog had a price (`usd` is 0 as a placeholder, never a confirmed $0 charge). */
  unknownPrice?: boolean;
  category: SpendCategory;
  provider: string;
  /** Model ref, or the LLM id for agent calls. */
  model: string;
  sessionId: string;
}
