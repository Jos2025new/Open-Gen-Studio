/* The few Node APIs the bench and the join_clips test use; the project has no @types/node (browser app). */
interface BenchFile extends Uint8Array {
  toString(encoding?: 'base64' | 'utf8'): string;
}
declare module 'node:fs' {
  export function readFileSync(path: string): BenchFile;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string): void;
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, opts?: { recursive?: boolean; force?: boolean }): void;
}
declare module 'node:child_process' {
  export function execSync(cmd: string): { toString(): string };
  export function execFileSync(file: string, args?: string[], opts?: { stdio?: 'ignore' }): { toString(): string };
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare const process: { env: Record<string, string | undefined> };
