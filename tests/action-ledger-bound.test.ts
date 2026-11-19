import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { useStore } from '../src/store/store';
import { LEDGER_LIMIT, adoptPreview, ledgerSize, resetActions, runAction, snapshotById } from '../src/engine/nodecore/action';
import type { NodeRunPreview } from '../src/engine/flow/actions';

describe('the approval ledger stays bounded', () => {
  it('keeps at most LEDGER_LIMIT approvals and runs, and an evicted approval is gone, not reusable', async () => {
    resetActions();
    const sid = useStore.getState().activeSessionId;
    const preview = { runIds: [], inputIds: [], errors: [], count: 0, estimate: { total: 0 } } as unknown as NodeRunPreview;
    const first = adoptPreview(sid, ['x'], true, preview);
    for (let i = 0; i < LEDGER_LIMIT + 50; i++) adoptPreview(sid, ['x'], true, preview);
    expect(ledgerSize().snapshots).toBeLessThanOrEqual(LEDGER_LIMIT);
    expect(snapshotById(first.id)).toBeUndefined();
    const again = await runAction(first, 'late');
    expect(again.status).toBe('stale');
  });
});
