/* The few Node APIs the bench uses; the project has no @types/node (browser app). */
interface BenchFile extends Uint8Array {
  toString(encoding?: 'base64' | 'utf8'): string;
}
declare module 'node:fs' {
  export function readFileSync(path: string): BenchFile;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string): void;
}
declare module 'node:child_process' {
  export function execSync(cmd: string): { toString(): string };
}
declare const process: { env: Record<string, string | undefined> };
