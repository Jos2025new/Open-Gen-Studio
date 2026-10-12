// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ write: vi.fn(async () => 'ok'), pixels: vi.fn(async () => undefined) }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: mocks.write, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined, putAssetBlob: async () => undefined,
}));
vi.mock('../src/engine/design/raster', () => ({ flushRaster: mocks.pixels }));
import { saveNow, setUi, useStore } from '../src/store/store';
import { hasPendingSave, resetSaveStatus, saveStatus } from '../src/store/saveStatus';
afterEach(() => { vi.useRealTimers(); resetSaveStatus(); mocks.write.mockReset().mockResolvedValue('ok'); mocks.pixels.mockClear(); });

describe('explicit state and raster save', () => {
  it('does not confirm a version until the real disk receipt arrives', async () => {
    await vi.waitFor(() => expect(useStore.getState().hydrated).toBe(true));
    vi.useFakeTimers();
    let resolve!: (value: string) => void;
    mocks.write.mockImplementationOnce(() => new Promise<string>((r) => { resolve = r; }));
    setUi({ brush: { ...useStore.getState().ui.brush, size: 41 } });
    const writing = saveNow();
    expect(saveStatus.getState().phase).toBe('saving');
    setUi({ brush: { ...useStore.getState().ui.brush, size: 42 } });
    resolve('ok');
    await writing;
    expect(saveStatus.getState().phase).toBe('unsaved');
    expect(hasPendingSave()).toBe(true);
    await saveNow();
    expect(saveStatus.getState().phase).toBe('saved');
    expect(mocks.pixels).toHaveBeenCalledTimes(2);
  });
  it('keeps a failed copy pending and retries the latest state without another edit', async () => {
    vi.useFakeTimers();
    mocks.write.mockResolvedValueOnce('fail');
    setUi({ brush: { ...useStore.getState().ui.brush, size: 43 } });
    await saveNow();
    expect(saveStatus.getState().phase).toBe('error');
    await saveNow();
    expect(saveStatus.getState().phase).toBe('saved');
  });
  it('never retries a 409, including with Ctrl+S action', async () => {
    vi.useFakeTimers();
    mocks.write.mockResolvedValueOnce('conflict');
    setUi({ brush: { ...useStore.getState().ui.brush, size: 44 } });
    await saveNow();
    expect(saveStatus.getState().conflict).toBe(true);
    const n = mocks.write.mock.calls.length;
    await saveNow();
    expect(mocks.write.mock.calls.length).toBe(n);
  });
});
