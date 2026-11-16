export class DatabaseSync {
  constructor(path: string, opts?: { readOnly?: boolean });
  exec(sql: string): void;
  close(): void;
}
export function sqliteHead(dir: string): { savedAt: number; version: number; order: string[] } | null;
export function stripSqliteKeys(file: string): void;
export function canonicalStateText(text: string): string;
export function stateSha(text: string): string;
export function migrateFromV2(
  dir: string,
  opts?: { synchronous?: string; fault?: (point: string) => void },
): Promise<{
  ok: boolean;
  format: 1 | 2;
  savedAt: number;
  sessions: number;
  bytes: number;
  sha: string;
  rawShaMatch: boolean;
  backupDir: string;
  readSource: string | null;
}>;
export const migrateToSqlite: typeof migrateFromV2;

export function createSqliteStore(dir: string, opts?: { synchronous?: string; fault?: (point: string) => void }): {
  read(): string | null;
  readHead(): Promise<{ savedAt: number; version: number; order: string[] } | null>;
  commit(body: { savedAt: number; baseAt: number; version: number; globals?: string; delta?: unknown; order: string[]; sessions?: Record<string, string>; keep?: unknown }): { status: number; reason?: string; savedAt?: number; snapshotError?: string };
  commitLegacy(text: string): { status: number; reason?: string; savedAt?: number };
  lastStats(): { recGets: number; recWrites: number; posUpdates: number };
  lastDelta(): { order?: unknown } | null;
  sizes(): { wal: number };
  idle(): number;
  close(): void;
  file: string;
};
