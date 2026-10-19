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
  it('review: a late ok of an older version does not hide the failed browser write of a newer one (saveNow rejects)', async () => {
    let resolveA!: (value: string) => void;
    mocks.write.mockImplementationOnce(() => new Promise<string>((r) => { resolveA = r; }));
    mocks.write.mockImplementationOnce(async () => { throw new DOMException('quota', 'QuotaExceededError'); });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setUi({ brush: { ...useStore.getState().ui.brush, size: 61 } });
    const first = saveNow().catch(() => undefined); // A waits for its disk receipt
    setUi({ brush: { ...useStore.getState().ui.brush, size: 62 } });
    const second = saveNow(); // B: IndexedDB fails
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2));
    resolveA('ok');
    await first;
    await expect(second).rejects.toThrow(/browser storage/);
    mocks.write.mockResolvedValue('ok');
    await expect(saveNow()).resolves.toBeUndefined(); // the retry writes B and clears it
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
  // A 409 no longer stops the local save: stateDb.set keeps writing IndexedDB and holds the disk sends (save-guard-client.test.ts).
  it('keeps saving locally after a 409, including with the Ctrl+S action; the conflict stays shown', async () => {
    vi.useFakeTimers();
    mocks.write.mockResolvedValueOnce('conflict');
    setUi({ brush: { ...useStore.getState().ui.brush, size: 44 } });
    await saveNow();
    expect(saveStatus.getState().conflict).toBe(true);
    const n = mocks.write.mock.calls.length;
    await saveNow();
    expect(mocks.write.mock.calls.length).toBe(n + 1);
    expect(saveStatus.getState().conflict).toBe(true);
  });
});
