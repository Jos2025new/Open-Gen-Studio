import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener: () => undefined },
  document: { addEventListener: () => undefined, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { findExternalCommands, runExternalCommands } from '../src/engine/externalCommands';
import { addDoc, getDoc } from '../src/engine/design/actions';
import { createDoc } from '../src/engine/design/doc';
import { useStore } from '../src/store/store';

const session = useStore.getState().activeSessionId;
let doc: ReturnType<typeof createDoc>;
beforeEach(() => {
  useStore.setState((st) => ({ sessions: { ...st.sessions, [session]: { ...st.sessions[session], docs: [], activeDocId: null } } }));
  doc = createDoc('Before', 320, 240);
  addDoc(session, doc);
});

it('finds commands with active context, signatures and one requested args schema', () => {
  expect(findExternalCommands({ area: 'designer', text: 'rename document', schema: 'designer.doc.rename' })).toMatchObject({
    ok: true, context: { session, doc: doc.id },
    commands: [{ id: 'designer.doc.rename', signature: expect.stringContaining('name'), args: { type: 'object' } }],
  });
  const all = findExternalCommands({ area: 'sessions' });
  expect(all).toMatchObject({ ok: true, commands: expect.arrayContaining([expect.objectContaining({ id: 'sessions.list', title: expect.any(String), effect: 'read', signature: expect.any(String) })]) });
  expect(JSON.stringify(all)).not.toContain('sessions.new');
  expect(findExternalCommands({ schema: 'sessions.new' })).toMatchObject({ ok: false, error: { code: 'unknown' } });
});

it('reads immediately and routes explicit targets and new-document references', async () => {
  const approver = vi.fn(() => true);
  const run = (input: unknown) => runExternalCommands(input, approver);
  expect(await run({ cmd: 'designer.doc.read' })).toMatchObject({ ok: true, results: [{ id: doc.id }] });
  expect(approver).not.toHaveBeenCalled();
  expect(await run({ on: { session }, seq: [
    { cmd: 'designer.doc.new', args: { name: 'Created', width: 320, height: 240 } },
    { cmd: 'designer.doc.rename', args: { name: 'Chained' }, on: { session } },
    { cmd: 'designer.doc.read' },
    { cmd: 'designer.doc.read', on: { doc: doc.id } },
  ] })).toMatchObject({ ok: true, results: [{ doc: expect.any(String) }, null, { name: 'Chained' }, { id: doc.id, name: 'Before' }] });
  expect(approver).toHaveBeenCalledOnce();
  expect(approver.mock.calls[0]).toEqual([expect.objectContaining({ caller: 'external' })]);
});

it('leaves documents intact when rejecting a write or when a hidden step appears', async () => {
  const input = { cmd: 'designer.doc.rename', args: { name: 'After' } };
  const reject = vi.fn(() => false);
  expect(await runExternalCommands(input, reject)).toMatchObject({ ok: false, error: { code: 'denied' } });
  expect(getDoc(session, doc.id)).toBe(doc);
  expect(reject).toHaveBeenCalledOnce();
  const approve = vi.fn(() => true);
  expect(await runExternalCommands({ seq: [input, { cmd: 'sessions.new' }] }, approve)).toMatchObject({ ok: false, error: { code: 'denied', step: 2 } });
  expect(approve).not.toHaveBeenCalled();
  expect(getDoc(session, doc.id)).toBe(doc);
  expect(await runExternalCommands(input, approve)).toMatchObject({ ok: true });
  expect(getDoc(session, doc.id)?.name).toBe('After');
});
