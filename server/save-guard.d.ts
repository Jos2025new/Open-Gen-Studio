export function sha256(text: string): string;
/** True when `nextText` looks like a loss of the session whose previous text is `prevText` (user content only). */
export function looksLost(prevText: string, nextText: string): boolean;
export type RecordColl = 'generations' | 'assets' | 'library';
export type RecordIndex = Record<RecordColl, Map<string, string | undefined>>;
export interface RecordLosses { coll: RecordColl; lost: string[]; diskHash: string; candidateHash: string }
export const RECORD_COLLS: RecordColl[];
export function mostLost(coll: RecordColl, had: number, lost: number): boolean;
export function idsHash(ids: Iterable<string>): string;
export function recordLosses(prev: RecordIndex, next: RecordIndex, removedSessions?: Set<string>): RecordLosses[];
export function unapprovedRecords(losses: RecordLosses[], keep: unknown): RecordLosses[];
export function recordsBody(losses: RecordLosses[]): Array<{ coll: RecordColl; lost: number; diskHash: string }>;
