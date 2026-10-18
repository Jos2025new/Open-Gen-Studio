export const SAFE_ID: RegExp;
export interface V2Commit {
  savedAt: number;
  baseAt: number;
  version: number;
  globals: string;
  order: string[];
  sessions: Record<string, string>;
  /**
   * "Keep this version": approves EVERY loss of this exact commit — each shrinking session when sha256(on-disk text) ===
   * diskHash and sha256(sent text) === candidateHash, and a total loss when both session orders hash as given. Missing
   * one approval refuses the whole commit again. The disk versions are copied to backups/kept-before-* first. Never
   * lifts a baseAt conflict.
   */
  keep?: { sessions: Array<{ sessionId: string; diskHash: string; candidateHash: string }>; total?: { diskOrderHash: string; candidateOrderHash: string } };
}
/** Result of a commit. 409 carries reason 'conflict' (baseAt) or 'possible-loss' (sessionId only for a single session). */
export interface V2Result {
  status: number;
  savedAt?: number;
  reason?: 'conflict' | 'possible-loss' | string;
  sessionId?: string;
  /** sha256 of the on-disk text of the refused session (possible-loss of one session): the client's `keep.diskHash`. */
  diskHash?: string;
  /** Every shrinking session of the refused commit, with its disk hash. */
  losses?: Array<{ sessionId: string; diskHash: string }>;
  /** The commit removes most sessions: sha256 of the disk's session order (JSON). */
  total?: { diskOrderHash: string };
  rejectedFile?: string;
}
export function assembleText(p: { savedAt: number; version: number; globals: string; order: string[]; sessions: Record<string, string> }): string;
export function splitText(text: string): { savedAt: number; baseAt: number; version: number; globals: string; order: string[]; sessions: Record<string, string> };
export function createStoreV2(dir: string): {
  read(): Promise<string | null>;
  commit(body: V2Commit): Promise<V2Result>;
  commitLegacy(text: string): Promise<V2Result>;
  readHead(): Promise<{ format: number; savedAt: number; version: number; order: string[] } | null>;
  headFile: string;
};
export function exportToFormat1(dir: string): Promise<{ exported: boolean }>;
