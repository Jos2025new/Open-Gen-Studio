export const SAFE_ID: RegExp;
export interface V2Commit {
  savedAt: number;
  baseAt: number;
  version: number;
  globals: string;
  order: string[];
  sessions: Record<string, string>;
}
export function assembleText(p: { savedAt: number; version: number; globals: string; order: string[]; sessions: Record<string, string> }): string;
export function splitText(text: string): { savedAt: number; baseAt: number; version: number; globals: string; order: string[]; sessions: Record<string, string> };
export function createStoreV2(dir: string): {
  read(): Promise<string | null>;
  commit(body: V2Commit): Promise<{ status: number; savedAt?: number }>;
  commitLegacy(text: string): Promise<{ status: number; savedAt?: number }>;
  readHead(): Promise<{ format: number; savedAt: number; version: number; order: string[] } | null>;
  headFile: string;
};
export function exportToFormat1(dir: string): Promise<{ exported: boolean }>;
