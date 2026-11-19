// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { idbKeyval, resetWorld, settle, until } from './helpers/fakeTabs';

import { viewed } from './helpers/threads';
vi.mock('idb-keyval', () => idbKeyval());
vi.mock('../src/engine/design/raster', () => ({ flushRaster: async () => undefined, pendingRaster: () => [] }));
vi.mock('../src/lib/log', () => ({ logEvent: () => undefined, logged: (_: string, f: unknown) => f, logSettled: async () => undefined }));
vi.stubGlobal('fetch', async (url: string) => (url === '/x/store/ping' ? new Response('ok') : url === '/x/store/blobs' ? new Response('[]') : new Response(null, { status: 204 })));

async function openTab() {
  vi.resetModules();
  const lock = await import('../src/lib/writerLock');
  const store = await import('../src/store/store');
  await import('../src/store/writerHandoff');
  const lanes = await import('../src/engine/agent/lanes');
  const gate = await import('../src/engine/agent/sendGate');
  return { lock, store, lanes, gate, state: () => store.useStore.getState() };
}
type Tab = Awaited<ReturnType<typeof openTab>>;
const hydrated = (t: Tab) => until(() => t.state().hydrated);

beforeEach(() => {
  resetWorld();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
});
afterEach(() => { vi.useRealTimers(); });

describe('adversarial: writerHandoff con agentes en paralelo', () => {
  it('ataque que pasa: una segunda pestaña no roba el lock silenciosamente mientras A corre de fondo y B está en pantalla', async () => {
    const tab1 = await openTab();
    await hydrated(tab1);
    const sid = tab1.state().activeSessionId;
    tab1.lanes.enterLane(sid, 'agentA');
    tab1.lanes.patchLane(sid, 'agentA', { busy: true, phase: 'working' });
    tab1.lanes.enterLane(sid, 'agentB');
    tab1.lanes.patchLane(sid, 'agentB', { busy: false });
    expect(viewed(tab1.state().sessions[sid]).busy).toBe(false);

    const tab2 = await openTab();
    await settle();
    tab2.lock.useHere();
    await until(() => tab2.lock.getWriterState().asking === 'choose');

    expect(tab2.lock.getWriterState().work).toEqual({ transferable: 0, generations: 0, agent: 1 });
    expect(tab1.lock.holdsWriterLock()).toBe(true);
    expect(tab2.lock.holdsWriterLock()).toBe(false);
  });

  // FALLO REAL: writerLock.ts:51 (mayStartWork = !state.requested || hooks.agentBusy()) permite iniciar trabajo NUEVO en B cuando otra pestaña pidió el lock (requested=true) solo porque A está ocupado de fondo.
  it('cuando otra pestaña ya pidió el lock y A corre de fondo, B (idle) no debe poder iniciar un turno nuevo', async () => {
    const tab1 = await openTab();
    await hydrated(tab1);
    const sid = tab1.state().activeSessionId;
    tab1.lanes.enterLane(sid, 'agentA');
    tab1.lanes.patchLane(sid, 'agentA', { busy: true, phase: 'working' });
    tab1.lanes.enterLane(sid, 'agentB');
    tab1.lanes.patchLane(sid, 'agentB', { busy: false });

    const tab2 = await openTab();
    await settle();
    tab2.lock.useHere();
    await until(() => tab2.lock.getWriterState().asking === 'choose');

    expect(tab1.lock.getWriterState().requested).toBe(true);
    // B está ocioso y otra pestaña pidió el lock: no debería aceptar nuevos turnos.
    expect(tab1.gate.agentAccepts('agentB')).toBe(false);
  });
});
