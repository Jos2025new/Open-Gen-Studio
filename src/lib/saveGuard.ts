/*
 * What this tab knows about the disk copy, kept apart from idb.ts and the store (plan: save protection, phase 1).
 *  - `acked`: the session texts the disk confirmed (only a 204 advances them). What is sent is what differs from them.
 *  - `pending`: the local revision the disk has not confirmed, with the disk state (`baseAt`) it was built on.
 *  - `problem`: why the disk is not taking this tab's saves ('conflict': another tab saved; 'possible-loss': the server
 *    kept a shrinking session aside). The tab keeps saving to IndexedDB either way.
 */
export interface Pending { rev: number; baseAt: number }
export interface SaveProblem {
  reason: 'conflict' | 'possible-loss';
  /** The refused session (absent for a total loss or a conflict). */
  sessionId?: string;
  rejectedFile?: string;
  /** sha256 of the session text on disk, from the 409: the `keep` payload's diskHash. */
  diskHash?: string;
  /** Every shrinking session of the refused commit (the first one is also in sessionId/diskHash). */
  losses?: Array<{ sessionId: string; diskHash?: string }>;
  /** The commit removes most sessions: the disk order's hash, approved together with the candidate order. */
  total?: { diskOrderHash: string };
}

export const guard = {
  acked: new Map<string, string>(),
  ackedRev: 0,
  /** Local revision counter: one per commit, continued from `pending.rev` after a reload. */
  rev: 0,
  /** savedAt of the disk state this tab last saw or wrote. */
  diskAt: 0,
  pending: undefined as Pending | undefined,
  /** True after a startup conflict: the disk copy differs from the base of the unsent work, so nothing is sent. */
  held: false,
  /** True while the disk version is being adopted: late writes of the old memory state must not reach storage. */
  discarding: false,
  problem: null as SaveProblem | null,
};

let listener: ((p: SaveProblem) => void) | null = null;
export function setProblem(p: SaveProblem | null): void {
  guard.problem = p;
  if (p) listener?.(p);
}
/** The status store listens here; a problem found before it listens (at startup) is replayed. */
export function onProblem(fn: (p: SaveProblem) => void): void {
  listener = fn;
  if (guard.problem) fn(guard.problem);
}

export function guardPending(): boolean { return guard.pending !== undefined; }

/** sha256 of the UTF-8 bytes of a text, lowercase hex (what the server computes for `keep`). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
