export const EXCLUDED: Map<string, string>;
export function globToRegExp(glob: string): RegExp;
export function readVitestInclude(configPath: string): { patterns: string[]; line: number; error?: undefined } | { error: string; patterns?: undefined; line?: undefined };
export function check(root?: string, opts?: { excluded?: Map<string, string> }): string[];
