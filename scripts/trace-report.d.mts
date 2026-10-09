export interface Stats { n: number; p50: number | null; p95: number | null; max: number | null; total: number }
export function stats(values: unknown[]): Stats;
export function parseTrace(text: string): Array<Record<string, any>>;
export function report(events: Array<Record<string, any>>): Record<string, any>;
export function reportText(report: Record<string, any>, file: string): string;
