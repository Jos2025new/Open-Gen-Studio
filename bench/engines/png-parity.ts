import { canvasToPngBlob, type CanvasPngDiagnostic } from '../../src/lib/canvasPngWorker';
import { canvasToBlob, createCanvas, ctx2d, setCpuCanvases } from '../../src/lib/media';

type Channels = { differentPixels: number; differentChannels: number; maxChannelDelta: number };

function paintProbe(canvas: HTMLCanvasElement): void {
  const ctx = ctx2d(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#16324f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 0.43;
  ctx.fillStyle = '#f28e2b';
  ctx.fillRect(13.25, 19.5, 420.75, 240.25);
  ctx.fillStyle = '#56b4e9';
  ctx.beginPath();
  ctx.arc(516.35, 350.7, 207.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,.72)';
  ctx.lineWidth = 2.35;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(7.4, 720.6);
  ctx.bezierCurveTo(180.1, 60.3, 740.9, 1020.2, 1015.6, 11.8);
  ctx.stroke();
}

function compare(a: Uint8ClampedArray, b: Uint8ClampedArray): Channels {
  let differentPixels = 0, differentChannels = 0, maxChannelDelta = 0;
  for (let i = 0; i < a.length; i += 4) {
    let changed = false;
    for (let ch = 0; ch < 4; ch++) {
      const delta = Math.abs(a[i + ch] - b[i + ch]);
      if (delta) { differentChannels++; changed = true; maxChannelDelta = Math.max(maxChannelDelta, delta); }
    }
    if (changed) differentPixels++;
  }
  return { differentPixels, differentChannels, maxChannelDelta };
}

async function readPixels(blob: Blob, width: number, height: number): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = createCanvas(width, height);
    ctx2d(canvas).drawImage(bitmap, 0, 0);
    return ctx2d(canvas).getImageData(0, 0, width, height).data;
  } finally {
    bitmap.close();
  }
}

/** One local PNG parity run; this is not included in the shipped app UI. */
export async function runPngParity(cpu = true): Promise<Record<string, unknown>> {
  setCpuCanvases(cpu);
  const canvas = createCanvas(1024, 768);
  paintProbe(canvas);
  const phases: CanvasPngDiagnostic[] = [];
  const longTasks: number[] = [];
  let observer: PerformanceObserver | undefined;
  try {
    observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((e) => e.duration)));
    observer.observe({ type: 'longtask', buffered: false });
  } catch { observer = undefined; }

  const workerStart = performance.now();
  const workerPromise = canvasToPngBlob(canvas, { onPhase: (event) => phases.push(event) });
  const canvasStart = performance.now();
  const canvasPromise = canvasToBlob(canvas, 'image/png');
  const [workerBlob, canvasBlob] = await Promise.all([workerPromise, canvasPromise]);
  const workerMs = performance.now() - workerStart;
  const canvasMs = performance.now() - canvasStart;
  observer?.disconnect();

  const [workerPixels, canvasPixels] = await Promise.all([
    readPixels(workerBlob, canvas.width, canvas.height), readPixels(canvasBlob, canvas.width, canvas.height),
  ]);
  const parity = compare(workerPixels, canvasPixels);
  return {
    mode: 'png-parity', cpuCanvas: cpu, width: canvas.width, height: canvas.height,
    workerMs, canvasToBlobMs: canvasMs, workerPngBytes: workerBlob.size, canvasToBlobBytes: canvasBlob.size,
    usedWorker: phases.some((p) => p.phase === 'worker' && p.outcome === 'encoded'),
    fellBack: phases.some((p) => p.phase === 'fallback'), phases,
    parity: { ...parity, exact: parity.differentChannels === 0 },
    longTasks: { count: longTasks.length, maxMs: Math.max(0, ...longTasks) },
  };
}
