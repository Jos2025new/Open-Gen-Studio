import type { RemoteProviderId } from './types';

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
}
