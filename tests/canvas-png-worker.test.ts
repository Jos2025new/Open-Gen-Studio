import { afterEach, describe, expect, it, vi } from 'vitest';

const fallback = vi.fn(async (canvas: { tag: string }) => Object.assign(new Blob([canvas.tag]), { tag: canvas.tag }));
vi.mock('../src/lib/media', () => ({ canvasToBlob: (canvas: { tag: string }) => fallback(canvas) }));

type Reply = { id: number; blob?: Blob; error?: string; unsupported?: boolean };
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<Reply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  posts: Array<{ data: { id: number }; transfer: Transferable[] }> = [];
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(data: { id: number }, transfer: Transferable[]) { this.posts.push({ data, transfer }); }
  terminate() { this.terminated = true; }
}

const bitmap = () => ({ close: vi.fn() }) as unknown as ImageBitmap;
const canvas = (tag = 'pixels') => ({ width: 4, height: 3, tag }) as unknown as HTMLCanvasElement;
async function loadEncoder(create: () => Promise<ImageBitmap> = async () => bitmap()) {
  FakeWorker.instances = [];
  fallback.mockClear();
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('createImageBitmap', create);
  return import('../src/lib/canvasPngWorker');
}
const waitForPost = async (worker: FakeWorker) => vi.waitFor(() => expect(worker.posts.length).toBeGreaterThan(0));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

describe('canvas PNG worker', () => {
  it('sends a transferable bitmap and resolves the matching worker blob', async () => {
    const close = vi.fn();
    const encoder = await loadEncoder(vi.fn(async () => ({ close }) as unknown as ImageBitmap));
    const result = encoder.canvasToPngBlob(canvas());
    const worker = FakeWorker.instances[0];
    await waitForPost(worker);
    const sent = worker.posts[0];
    expect(sent.transfer).toHaveLength(1);
    expect(sent.data.id).toBeGreaterThan(0);
    const blob = new Blob(['encoded'], { type: 'image/png' });
    worker.onmessage?.({ data: { id: sent.data.id, blob } } as MessageEvent<Reply>);
    await expect(result).resolves.toBe(blob);
    expect(close).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('correlates concurrent PNG replies when the worker finishes out of order', async () => {
    const encoder = await loadEncoder();
    const first = encoder.canvasToPngBlob(canvas('first'));
    const second = encoder.canvasToPngBlob(canvas('second'));
    const worker = FakeWorker.instances[0];
    await vi.waitFor(() => expect(worker.posts).toHaveLength(2));
    const [a, b] = worker.posts;
    const blobA = new Blob(['A']);
    const blobB = new Blob(['B']);
    worker.onmessage?.({ data: { id: b.data.id, blob: blobB } } as MessageEvent<Reply>);
    worker.onmessage?.({ data: { id: a.data.id, blob: blobA } } as MessageEvent<Reply>);
    await expect(Promise.all([first, second])).resolves.toEqual([blobA, blobB]);
  });

  it('falls back when worker support is missing or the worker reports unsupported', async () => {
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('createImageBitmap', undefined);
    let encoder = await import('../src/lib/canvasPngWorker');
    await expect(encoder.canvasToPngBlob(canvas('local'))).resolves.toMatchObject({ tag: 'local' });
    expect(fallback).toHaveBeenCalledOnce();

    encoder = await loadEncoder();
    const results = [encoder.canvasToPngBlob(canvas('unsupported')), encoder.canvasToPngBlob(canvas('also-unsupported'))];
    const worker = FakeWorker.instances[0];
    await waitForPost(worker);
    await vi.waitFor(() => expect(worker.posts).toHaveLength(2));
    worker.onmessage?.({ data: { id: worker.posts[0].data.id, unsupported: true, error: 'missing OffscreenCanvas' } } as MessageEvent<Reply>);
    await expect(Promise.all(results)).resolves.toEqual([
      expect.objectContaining({ tag: 'unsupported' }), expect.objectContaining({ tag: 'also-unsupported' }),
    ]);
    expect(worker.terminated).toBe(true);
    expect(fallback).toHaveBeenCalledTimes(2);
  });

  it('falls back when bitmap preparation or worker posting fails', async () => {
    const encoder = await loadEncoder(vi.fn(async () => { throw new Error('createImageBitmap failed'); }));
    await expect(encoder.canvasToPngBlob(canvas('prepare'))).resolves.toMatchObject({ tag: 'prepare' });
    expect(fallback).toHaveBeenCalledOnce();

    vi.resetModules();
    const next = await loadEncoder();
    const result = next.canvasToPngBlob(canvas('transfer'));
    const worker = FakeWorker.instances[0];
    worker.postMessage = () => { throw new Error('post failed'); };
    await expect(result).resolves.toMatchObject({ tag: 'transfer' });
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('drains concurrent requests after worker errors and bounds silent hangs', async () => {
    const encoder = await loadEncoder();
    const first = encoder.canvasToPngBlob(canvas('one'));
    const second = encoder.canvasToPngBlob(canvas('two'));
    const worker = FakeWorker.instances[0];
    await waitForPost(worker);
    await vi.waitFor(() => expect(worker.posts).toHaveLength(2));
    worker.onmessageerror?.({} as MessageEvent);
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ tag: 'one' }), expect.objectContaining({ tag: 'two' }),
    ]);
    expect(worker.terminated).toBe(true);
    expect(fallback).toHaveBeenCalledTimes(2);

    vi.resetModules();
    const hanging = await loadEncoder();
    vi.useFakeTimers();
    const result = hanging.canvasToPngBlob(canvas('timeout'));
    const hangingWorker = FakeWorker.instances[0];
    await vi.waitFor(() => expect(hangingWorker.posts).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(result).resolves.toMatchObject({ tag: 'timeout' });
    expect(hangingWorker.terminated).toBe(true);

    vi.resetModules();
    const slowBitmap = await loadEncoder(() => new Promise<ImageBitmap>(() => {}));
    const slowResult = slowBitmap.canvasToPngBlob(canvas('bitmap-timeout'));
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(slowResult).resolves.toMatchObject({ tag: 'bitmap-timeout' });
  });
});
