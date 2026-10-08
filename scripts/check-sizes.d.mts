export const MAX_BYTES: number;
export function sizeViolations(files: Array<{ path: string; bytes: number }>, baseline: Record<string, number>): string[];
export function checkSizes(root: string): void;
