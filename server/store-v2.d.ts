export const SAFE_ID: RegExp;
export interface V2Commit {
  savedAt: number;
  baseAt: number;
  version: number;
  globals: string;
  order: string[];
  sessions: Record<string, string>;
  /**
   * "Keep this version": lifts the possible-loss guard for ONE session when sha256(on-disk session text) === diskHash
   * and sha256(sent text) === candidateHash (hex of the exact UTF-8 texts). The disk version is copied to
   * backups/kept-before-<id>-<ts>.json first. Never lifts a baseAt conflict or the total-loss rule.
   */
  keep?: { sessionId: string; diskHash: string; candidateHash: string };
}
/** Result of a commit. 409 carries reason 'conflict' (baseAt) or 'possible-loss' (sessionId only for a single session). */
export interface V2Result {
  status: number;
  savedAt?: number;
  reason?: 'conflict' | 'possible-loss' | string;
  sessionId?: string;
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
