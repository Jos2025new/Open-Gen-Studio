import { canvasToBlob } from './media';

type Request = { id: number; width: number; height: number; bitmap: ImageBitmap };
type Reply = { id: number; blob?: Blob; error?: string; unsupported?: boolean };
export type CanvasPngDiagnostic = { phase: 'bitmap' | 'transfer' | 'worker' | 'fallback'; ms?: number; outcome?: string; reason?: string };
export type CanvasPngOptions = { onPhase?: (event: CanvasPngDiagnostic) => void };
type Pending = { canvas: HTMLCanvasElement; resolve: (blob: Blob) => void; reject: (error: unknown) => void; timeout: ReturnType<typeof setTimeout>; options: CanvasPngOptions; sentAt: number };
type PngWorker = Worker & { onmessage: ((event: MessageEvent<Reply>) => void) | null; onerror: ((event: ErrorEvent) => void) | null; onmessageerror: ((event: MessageEvent) => void) | null };

const pending = new Map<number, Pending>();
let worker: PngWorker | null = null;
let unavailable = false;
let nextId = 1;
const REQUEST_TIMEOUT_MS = 15_000;
const closeBitmap = (bitmap: ImageBitmap) => { try { bitmap.close(); } catch { /* Transfer may already own or release it. */ } };
const report = (options: CanvasPngOptions | undefined, event: CanvasPngDiagnostic) => { try { options?.onPhase?.(event); } catch { /* Diagnostics cannot change persistence. */ } };

function makeWorker(): PngWorker {
  const instance = new Worker(new URL('./canvasPng.worker.ts', import.meta.url), { type: 'module' }) as PngWorker;
  instance.onmessage = ({ data }) => {
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    clearTimeout(entry.timeout);
    report(entry.options, { phase: 'worker', ms: performance.now() - entry.sentAt, outcome: data.blob ? 'encoded' : data.unsupported ? 'unsupported' : 'error' });
    if (data.blob) entry.resolve(data.blob);
    else {
      if (data.unsupported) {
        unavailable = true;
        failRequest(instance, 'unsupported');
      }
      void fallback(entry, data.error ?? 'worker-encoding-error');
    }
  };
  const fail = (reason: string) => {
    if (worker === instance) worker = null;
    instance.terminate();
    for (const [id, entry] of pending) {
      pending.delete(id);
      clearTimeout(entry.timeout);
      report(entry.options, { phase: 'worker', ms: performance.now() - entry.sentAt, outcome: 'error', reason });
      void fallback(entry, reason);
    }
  };
  instance.onerror = () => fail('worker-error');
  instance.onmessageerror = () => fail('message-error');
  return instance;
}

async function fallback(entry: Pick<Pending, 'canvas' | 'resolve' | 'reject' | 'options'>, reason: string): Promise<void> {
  report(entry.options, { phase: 'fallback', outcome: 'canvas-to-blob', reason });
  try { entry.resolve(await canvasToBlob(entry.canvas, 'image/png')); }
  catch (error) { entry.reject(error); }
}

/** Encode away from the UI thread when supported; optional timing callbacks are intended for local diagnostics only. */
export async function canvasToPngBlob(canvas: HTMLCanvasElement, options?: CanvasPngOptions): Promise<Blob> {
  if (unavailable || typeof Worker === 'undefined' || typeof createImageBitmap !== 'function') {
    report(options, { phase: 'fallback', outcome: 'canvas-to-blob', reason: unavailable ? 'unsupported' : 'worker-api-missing' });
    return canvasToBlob(canvas, 'image/png');
  }

  let target: PngWorker;
  try { target = worker ?? (worker = makeWorker()); }
  catch {
    report(options, { phase: 'fallback', outcome: 'canvas-to-blob', reason: 'worker-construction' });
    return canvasToBlob(canvas, 'image/png');
  }

  const prepareStart = performance.now();
  let bitmapTask: Promise<ImageBitmap>;
  try { bitmapTask = Promise.resolve(createImageBitmap(canvas)); }
  catch {
    report(options, { phase: 'bitmap', ms: performance.now() - prepareStart, outcome: 'error' });
    report(options, { phase: 'fallback', outcome: 'canvas-to-blob', reason: 'bitmap-error' });
    return canvasToBlob(canvas, 'image/png');
  }
  let prepareTimeout: ReturnType<typeof setTimeout> | undefined;
  let bitmap: ImageBitmap;
  try {
    bitmap = await Promise.race([
      bitmapTask,
      new Promise<never>((_, reject) => { prepareTimeout = setTimeout(() => reject(new Error('ImageBitmap preparation timed out')), REQUEST_TIMEOUT_MS); }),
    ]);
  } catch {
    report(options, { phase: 'bitmap', ms: performance.now() - prepareStart, outcome: 'timeout-or-error' });
    report(options, { phase: 'fallback', outcome: 'canvas-to-blob', reason: 'bitmap-timeout-or-error' });
    void bitmapTask.then(closeBitmap).catch(() => undefined);
    return canvasToBlob(canvas, 'image/png');
  } finally {
    if (prepareTimeout !== undefined) clearTimeout(prepareTimeout);
  }
  report(options, { phase: 'bitmap', ms: performance.now() - prepareStart, outcome: 'ready' });
  if (worker !== target) {
    closeBitmap(bitmap);
    report(options, { phase: 'fallback', outcome: 'canvas-to-blob', reason: 'worker-ended-during-bitmap' });
    return canvasToBlob(canvas, 'image/png');
  }

  const id = nextId++;
  return new Promise<Blob>((resolve, reject) => {
    const entry: Pending = { canvas, resolve, reject, options: options ?? {}, sentAt: 0, timeout: setTimeout(() => {
      if (pending.has(id)) failRequest(target);
    }, REQUEST_TIMEOUT_MS) };
    pending.set(id, entry);
    const transferStart = performance.now();
    try {
      target.postMessage({ id, width: canvas.width, height: canvas.height, bitmap } satisfies Request, [bitmap]);
      entry.sentAt = performance.now();
      report(entry.options, { phase: 'transfer', ms: entry.sentAt - transferStart, outcome: 'sent' });
    } catch {
      pending.delete(id);
      clearTimeout(entry.timeout);
      report(entry.options, { phase: 'transfer', ms: performance.now() - transferStart, outcome: 'error' });
      void fallback(entry, 'transfer-error');
    } finally {
      closeBitmap(bitmap);
    }
  });
}

function failRequest(target: PngWorker, reason = 'worker-timeout'): void {
  if (worker === target) worker = null;
  target.terminate();
  for (const [id, entry] of pending) {
    pending.delete(id);
    clearTimeout(entry.timeout);
    report(entry.options, { phase: 'worker', ms: performance.now() - entry.sentAt, outcome: reason === 'unsupported' ? 'unsupported' : reason === 'worker-timeout' ? 'timeout' : 'error', reason });
    void fallback(entry, reason);
  }
}
