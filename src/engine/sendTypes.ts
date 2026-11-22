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
  /** What this request cost once it delivered: reported, quoted, or its share of the estimate. */
  costUsd?: number;
  /** `costUsd` is an estimate (no reported cost and no quote). */
  estimated?: boolean;
  /** Already booked to Spending: a record is booked once (sendLedger). */
  bookedUsd?: number;
}

/** Where money went: the agent's model calls and each paid generation. */
export type SpendCategory = 'agent' | MediaKind | 'text';

export interface SpendEntry {
  at: number;
  usd: number;
  /** True when the provider did not report the cost and it comes from published prices. */
  estimated: boolean;
  category: SpendCategory;
  provider: string;
  /** Model ref, or the LLM id for agent calls. */
  model: string;
  sessionId: string;
}
