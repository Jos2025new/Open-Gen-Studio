export function deadExports(files: Array<{ path: string; text: string }>, baseline?: Record<string, string[]>): string[];
export function checkDeadExports(root: string): void;
