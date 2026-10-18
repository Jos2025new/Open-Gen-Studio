/** Registered by map-contracts.mjs; server, client and banner must agree on the 409 reasons and the keep payload. */
export default [
  {
    id: 'save-guard-409',
    what: 'Un 409 dice por qué: conflict (baseAt: la pestaña pasa a stale y no envía más al disco) o possible-loss (el servidor aparta la copia y devuelve sessionId, rejectedFile, diskHash; la pestaña NO es stale y reintenta). IndexedDB se escribe siempre. "Mantener esta versión" envía keep {sessionId, diskHash, candidateHash} (sha256 de los textos exactos); no salta baseAt ni la pérdida total.',
    sides: [
      ['server/store-v2.js', "reason: 'possible-loss', sessionId: id, diskHash: sha256(prev)"],
      ['server/store-v2.d.ts', 'diskHash?: string;'],
      ['server/local-store.js', 'const conflictBody = ({ reason'],
      ['src/lib/disk.ts', "if (body?.reason !== 'possible-loss') return 'conflict';"],
      ['src/lib/disk.ts', 'export interface KeepVersion'],
      ['src/lib/idb.ts', 'const keep = keepId ? {'],
      ['src/lib/saveGuard.ts', 'export async function sha256Hex'],
      ['src/store/saveReport.ts', "result === 'rejected'"],
      ['src/store/saveRecovery.ts', 'export async function keepThisVersion'],
      ['src/components/shell/SaveGuardBanner.tsx', 'Keep this version'],
    ],
    tests: ['tests/save-guard-server.test.ts', 'tests/save-guard-client.test.ts', 'tests/save-guard-banner.test.ts', 'tests/state-conflict.test.ts'],
  },
  {
    id: 'save-pending-revisions',
    what: 'Lo no confirmado por el disco se conserva: acked (texto confirmado por un 204) decide qué se envía; pending {rev, baseAt} se escribe en la misma transacción que el commit local y solo lo borra el ack de su revisión (una revisión más nueva queda y su base pasa al savedAt del ack). Al arrancar con pending no se adopta la copia del disco: se reenvía con la base conservada o se avisa de conflicto.',
    sides: [
      ['src/lib/saveGuard.ts', 'export interface Pending'],
      ['src/lib/idb.ts', 'async function commitV2(p: V2Parts, pend?: Pending | null)'],
      ['src/lib/idb.ts', 'async function settle('],
      ['src/lib/idb.ts', 'async function resend('],
      ['src/store/saveStatus.ts', 'guardPending()'],
      ['src/store/store.ts', 'reportSave(next.version, result);'],
    ],
    tests: ['tests/save-guard-client.test.ts', 'tests/state-copies.test.ts', 'tests/save-now.test.ts', 'tests/save-status.test.ts'],
  },
];
