export function sqliteHead(dir: string): { savedAt: number; version: number; order: string[] } | null;

export function createSqliteStore(dir: string): {
  read(): string | null;
  readHead(): Promise<{ savedAt: number; version: number; order: string[] } | null>;
  commit(body: { savedAt: number; baseAt: number; version: number; globals: string; order: string[]; sessions?: Record<string, string>; keep?: unknown }): { status: number; reason?: string; savedAt?: number };
  commitLegacy(text: string): { status: number; reason?: string; savedAt?: number };
  lastStats(): { recGets: number; recWrites: number; posUpdates: number };
  lastDelta(): { order?: unknown } | null;
  sizes(): { wal: number };
  idle(): number;
  close(): void;
  file: string;
};
