import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { command, run } from '../src/engine/commands';
import { addDoc, getDoc, undoDoc } from '../src/engine/design/actions';
import { createDoc } from '../src/engine/design/doc';
import { FX_DO } from '../src/engine/design/fx.commands';
import { historyDepth } from '../src/engine/design/history';
import { useStore } from '../src/store/store';
import type { DesignDoc } from '../src/engine/types';
import type { FxLayer } from '../src/engine/fx/types';

const sid = useStore.getState().activeSessionId;
let doc: DesignDoc;
const on = () => ({ session: sid, doc: doc.id });
const now = () => getDoc(sid, doc.id)!;
beforeEach(() => {
  useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], docs: [], activeDocId: null } } }));
  doc = createDoc('FX', 100, 100);
  addDoc(sid, doc);
});

describe('Designer FX commands', () => {
  it('registers every FX operation', () => {
    for (const id of Object.values(FX_DO)) expect(command(id), id).toBeDefined();
    expect(Object.keys(FX_DO)).toHaveLength(7);
  });
  it('groups a sequence into one undo step', async () => {
    const before = now();
    const result = await run({ on: on(), seq: [
      { cmd: FX_DO.add, args: { group: 'filter' } },
      { cmd: FX_DO.add_op, args: { layer: '$1.layer', kind: 'blur' } },
      { cmd: FX_DO.set_op, args: { layer: '$1.layer', op: 'first', params: { radius: 6 } } },
    ] }, { caller: 'agent' });
    expect(result.ok).toBe(true);
    expect((now().layers[0] as FxLayer).ops[0].params.radius).toBe(6);
    expect(historyDepth(doc.id).undo).toBe(1);
    undoDoc(sid, doc.id);
    expect(now().layers).toEqual(before.layers);
  });
  it('rolls back a sequence when the operation kind is unknown', async () => {
    const before = now();
    const depth = historyDepth(doc.id);
    const result = await run({ on: on(), seq: [
      { cmd: FX_DO.add, args: { group: 'filter' } },
      { cmd: FX_DO.add_op, args: { layer: '$1.layer', kind: 'does-not-exist' } },
    ] }, { caller: 'agent' });
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('unknown filter or effect') }, rolledBack: true });
    expect(now()).toEqual(before);
    expect(historyDepth(doc.id)).toEqual(depth);
  });
  it('rejects missing layers and extra fields without changes', async () => {
    const before = now();
    const depth = historyDepth(doc.id);
    expect(await run({ on: on(), cmd: FX_DO.delete, args: { layer: 'missing' } }, { caller: 'agent' })).toMatchObject({ ok: false });
    expect(await run({ on: on(), cmd: FX_DO.add, args: { group: 'filter', extra: true } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(now()).toEqual(before);
    expect(historyDepth(doc.id)).toEqual(depth);
  });
});
