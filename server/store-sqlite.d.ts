export class DatabaseSync {
  constructor(path: string, opts?: { readOnly?: boolean });
  exec(sql: string): void;
  close(): void;
}
export function sqliteHead(dir: string): { savedAt: number; version: number; order: string[] } | null;
export function stripSqliteKeys(file: string): void;

export function createSqliteStore(dir: string, opts?: { synchronous?: string; fault?: (point: string) => void }): {
  read(): string | null;
  readHead(): Promise<{ savedAt: number; version: number; order: string[] } | null>;
  commit(body: { savedAt: number; baseAt: number; version: number; globals: string; order: string[]; sessions?: Record<string, string>; keep?: unknown }): { status: number; reason?: string; savedAt?: number; snapshotError?: string };
  commitLegacy(text: string): { status: number; reason?: string; savedAt?: number };
  lastStats(): { recGets: number; recWrites: number; posUpdates: number };
  lastDelta(): { order?: unknown } | null;
  sizes(): { wal: number };
  idle(): number;
  close(): void;
  file: string;
};
