export const PROTECTED_TESTS: string[];
export const DOC: string;
export function protectedViolations(read: (path: string) => string | null): string[];
export function checkProtected(root: string): void;
