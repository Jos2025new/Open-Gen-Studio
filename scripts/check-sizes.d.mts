export const MAX_BYTES: number;
export const WARN_BYTES: number;
export function sizeViolations(files: Array<{ path: string; bytes: number }>, baseline: Record<string, number>): string[];
export function staleBaselines(files: Array<{ path: string; bytes: number }>, baseline: Record<string, number>): string[];
export function sizeWarnings(files: Array<{ path: string; bytes: number }>): string[];
export function ratchetBaseline(files: Array<{ path: string; bytes: number }>, baseline: Record<string, number>): Record<string, number>;
export function updateSizeBaseline(root: string): void;
export function checkSizes(root: string): void;
