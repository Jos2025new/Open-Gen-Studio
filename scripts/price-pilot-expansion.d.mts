export const LIMIT_MICRO_USD: number;
export const MAX_OUTPUT_TOKENS: number;
export const MODELS: ReadonlyArray<{ id: string; input: number; output: number; rejectionFeeMicroUsd: number; mediumAdvertised: boolean; subscriptionIncluded: boolean }>;
export function buildExpansion(fixtures: any[], previousLedger: any, priorExpansionLedger?: any): { requests: any[]; report: any };
export function newExpansionLedger(report: any): any;
export function expansionResults(ledger: any): any;
export function runExpansion(fixtures: any[], previousLedger: any, ledger: any, save: (ledger: any) => Promise<void>, env?: Record<string, unknown>, fetcher?: typeof fetch, priorExpansionLedger?: any): Promise<any>;
export function prepareOrRunExpansion2(root: string, execute?: boolean, env?: Record<string, unknown>, fetcher?: typeof fetch): Promise<any>;
