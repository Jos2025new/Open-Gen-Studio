import { AbortedError, isAbort } from './http';

export interface MediaInfo {
  width: number;
  height: number;
  duration?: number;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read file'));
    r.readAsDataURL(blob);
  });
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const clean = b64.includes(',') && b64.startsWith('data:') ? b64.slice(b64.indexOf(',') + 1) : b64;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+)?(;base64)?,/.exec(dataUrl);
  const mime = m?.[1] ?? 'application/octet-stream';
  if (m?.[2]) return base64ToBlob(dataUrl, mime);
  return new Blob([decodeURIComponent(dataUrl.slice(dataUrl.indexOf(',') + 1))], { type: mime });
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), type, quality);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = src;
  });
}

export async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    await img.decode().catch(() => undefined);
    return img;
  } finally {
    // Safe to revoke once decoded; the element keeps its pixels.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('2D canvas is not available');
  return ctx;
}

export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const img = await blobToImage(blob);
  const c = createCanvas(img.naturalWidth, img.naturalHeight);
  ctx2d(c).drawImage(img, 0, 0);
  return c;
}

export async function fetchBlob(url: string, init?: RequestInit): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (isAbort(err)) throw new AbortedError();
    throw new Error('Could not download the result (network or CORS).');
  }
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return res.blob();
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    v.crossOrigin = 'anonymous';
    v.onloadedmetadata = () => resolve(v);
    v.onerror = () => reject(new Error('Video failed to load'));
    v.src = src;
  });
}

/** Resolve real dimensions (and duration for video) of a media blob. */
export async function probeMedia(blob: Blob): Promise<MediaInfo> {
  const url = URL.createObjectURL(blob);
  try {
    if (blob.type.startsWith('video/')) {
      const v = await loadVideo(url);
      let duration = v.duration;
      if (!Number.isFinite(duration)) {
        // MediaRecorder webm files report Infinity until seeked to the end.
        duration = await new Promise<number>((resolve) => {
          v.ontimeupdate = () => {
            v.ontimeupdate = null;
            resolve(Number.isFinite(v.duration) ? v.duration : 0);
          };
          v.currentTime = 1e9;
        });
      }
      return { width: v.videoWidth, height: v.videoHeight, duration };
    }
    const img = await loadImage(url);
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Grab the first or last frame of a video as a PNG blob. */
export async function extractVideoFrame(src: string, which: 'first' | 'last'): Promise<{ blob: Blob; width: number; height: number }> {
  const v = await loadVideo(src);
  v.preload = 'auto';
  let duration = v.duration;
  if (!Number.isFinite(duration)) {
    await seek(v, 1e9);
    duration = Number.isFinite(v.duration) ? v.duration : v.currentTime;
  }
  const t = which === 'first' ? 0.001 : Math.max(0, duration - 0.05);
  await seek(v, t);
  const c = createCanvas(v.videoWidth, v.videoHeight);
  ctx2d(c).drawImage(v, 0, 0, c.width, c.height);
  const blob = await canvasToBlob(c, 'image/png');
  return { blob, width: c.width, height: c.height };
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      v.removeEventListener('seeked', done);
      resolve();
    };
    v.addEventListener('seeked', done);
    v.onerror = () => reject(new Error('Video seek failed'));
    v.currentTime = t;
  });
}

/** Re-encode images whose long edge exceeds `maxSide` before sending them to a provider. */
export async function prepareImageForUpload(blob: Blob, maxSide = 2048): Promise<Blob> {
  const img = await blobToImage(blob);
  const long = Math.max(img.naturalWidth, img.naturalHeight);
  const supported = /^image\/(png|jpeg|webp)$/.test(blob.type);
  if (long <= maxSide && supported) return blob;
  const scale = Math.min(1, maxSide / long);
  const c = createCanvas(img.naturalWidth * scale, img.naturalHeight * scale);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return canvasToBlob(c, 'image/png');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function extensionForMime(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('svg')) return 'svg';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('quicktime')) return 'mov';
  return 'bin';
}

export function guessMimeFromUrl(url: string, kind: 'image' | 'video'): string {
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.webm')) return 'video/webm';
  if (path.endsWith('.mov')) return 'video/quicktime';
  if (path.endsWith('.mp4')) return 'video/mp4';
  return kind === 'image' ? 'image/png' : 'video/mp4';
}
