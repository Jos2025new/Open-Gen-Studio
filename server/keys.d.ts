export const PROVIDERS: string[];
export const KEY_MARKER: string;
export function maskOf(key: string): string;
export function isMarker(v: unknown): boolean;
export function createKeyStore(dir: string, opts?: { tool?: string }): {
  get(provider: string): Promise<string | null>;
  set(provider: string, key: string): Promise<'keyring' | 'file' | null>;
  remove(provider: string): Promise<void>;
  status(): Promise<{ providers: Record<string, { set: boolean; last4?: string; where?: string }>; warning: string }>;
  migrate(): Promise<{ migrated: string[]; backups: string[]; failed: string[] }>;
};
