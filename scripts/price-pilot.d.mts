export function savePilotFixtures(root: string, fixtures: unknown[]): Promise<void>;
export function estimatePilot(fixtures: any[]): any;
export function reserveCall(ledger: any, row: any): void;
export function settleCall(ledger: any, row: any, reportedUsd: unknown): void;
export function sampleRequest(body: any, key: string, fetcher?: typeof fetch): Promise<any>;
export function readPilot(root: string): Promise<any>;
