import { AbortedError } from '../../../lib/http';
import { createCanvas, ctx2d } from '../../../lib/media';

const MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && MIME_CANDIDATES.some((m) => MediaRecorder.isTypeSupported(m));
}

/**
 * Render an animation into a real video file by recording a canvas in real time.
 * `draw` receives t in [0, 1].
 */
export function recordCanvas(opts: {
  width: number;
  height: number;
  seconds: number;
  fps?: number;
  signal: AbortSignal;
  draw: (ctx: CanvasRenderingContext2D, t: number) => void;
  onProgress?: (p: number) => void;
}): Promise<Blob> {
  const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) return Promise.reject(new Error('This browser cannot record video (MediaRecorder unavailable).'));
  const fps = opts.fps ?? 30;
  const canvas = createCanvas(opts.width, opts.height);
  const ctx = ctx2d(canvas);
  opts.draw(ctx, 0);
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  return new Promise<Blob>((resolve, reject) => {
    let timer = 0;
    const total = opts.seconds * 1000;
    const start = performance.now();
    const stopAll = () => {
      window.clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
    };
    const onAbort = () => {
      if (recorder.state !== 'inactive') recorder.stop();
      stopAll();
      reject(new AbortedError());
    };
    opts.signal.addEventListener('abort', onAbort, { once: true });
    recorder.onstop = () => {
      opts.signal.removeEventListener('abort', onAbort);
      if (opts.signal.aborted) return;
      resolve(new Blob(chunks, { type: mime.split(';')[0] }));
    };
    recorder.onerror = () => {
      stopAll();
      reject(new Error('Video recording failed'));
    };
    recorder.start(250);
    timer = window.setInterval(() => {
      const elapsed = performance.now() - start;
      const t = Math.min(1, elapsed / total);
      opts.draw(ctx, t);
      opts.onProgress?.(t);
      if (elapsed >= total) {
        if (recorder.state !== 'inactive') recorder.stop();
        stopAll();
      }
    }, 1000 / fps);
  });
}
