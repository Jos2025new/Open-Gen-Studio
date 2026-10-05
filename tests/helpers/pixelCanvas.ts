/** Small alpha-only Canvas double. Real browser pixels are checked separately in the sandbox. */
export function pixelCanvas(width: number, height: number) {
  const pixels = new Float64Array(width * height);
  const canvas = { width, height, pixels, getContext: () => ctx };
  let matrix = [1, 0, 0, 1, 0, 0], path: number[][] = [], line: number[][] = [];
  const saved: Array<{ matrix: number[]; op: string; alpha: number }> = [];
  const put = (x: number, y: number, alpha: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x, a = alpha * ctx.globalAlpha, old = pixels[i];
    pixels[i] = ctx.globalCompositeOperation === 'destination-over' ? old + a * (1 - old)
      : ctx.globalCompositeOperation === 'destination-out' ? old * (1 - a)
      : ctx.globalCompositeOperation === 'destination-in' ? old * a : a + old * (1 - a);
  };
  const mapped = (x: number, y: number) => [x * matrix[0] + matrix[4], y * matrix[3] + matrix[5]];
  const inside = (x: number, y: number) => {
    let on = false;
    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
      const a = path[i], b = path[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) on = !on;
    }
    return on;
  };
  const ctx = {
    globalCompositeOperation: 'source-over', globalAlpha: 1, lineWidth: 1, fillStyle: '', strokeStyle: '',
    save() { saved.push({ matrix: [...matrix], op: ctx.globalCompositeOperation, alpha: ctx.globalAlpha }); },
    restore() { const s = saved.pop()!; matrix = s.matrix; ctx.globalCompositeOperation = s.op; ctx.globalAlpha = s.alpha; },
    setTransform(...m: number[]) { matrix = m; },
    transform(...m: number[]) {
      const a = matrix;
      matrix = [a[0]*m[0]+a[2]*m[1], a[1]*m[0]+a[3]*m[1], a[0]*m[2]+a[2]*m[3], a[1]*m[2]+a[3]*m[3], a[0]*m[4]+a[2]*m[5]+a[4], a[1]*m[4]+a[3]*m[5]+a[5]];
    },
    drawImage(src: ReturnType<typeof pixelCanvas>, ...args: number[]) {
      const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 8 ? args : [0, 0, src.width, src.height, args[0], args[1], args[2] ?? src.width, args[3] ?? src.height];
      const [x0, y0] = mapped(dx, dy), [x1, y1] = mapped(dx + dw, dy + dh);
      for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) {
        const u = Math.floor(sx + (x + .5 - x0) / (x1 - x0) * sw), v = Math.floor(sy + (y + .5 - y0) / (y1 - y0) * sh);
        put(x, y, src.pixels[v * src.width + u] ?? 0);
      }
    },
    clearRect(x: number, y: number, w: number, h: number) {
      for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx++) pixels[yy * width + xx] = 0;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      const [x0, y0] = mapped(x, y), [x1, y1] = mapped(x + w, y + h);
      for (let yy = Math.max(0, Math.floor(y0)); yy < Math.min(height, Math.ceil(y1)); yy++) for (let xx = Math.max(0, Math.floor(x0)); xx < Math.min(width, Math.ceil(x1)); xx++) put(xx, yy, 1);
    },
    beginPath() { path = []; line = []; },
    moveTo(x: number, y: number) { path.push(mapped(x, y)); line.push(mapped(x, y)); },
    lineTo(x: number, y: number) { path.push(mapped(x, y)); line.push(mapped(x, y)); },
    closePath() {},
    fill() { for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (inside(x + .5, y + .5)) put(x, y, 1); },
    stroke() {
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        for (let i = 1; i < line.length; i++) {
          const [a, b] = [line[i - 1], line[i]], dx = b[0] - a[0], dy = b[1] - a[1];
          const t = Math.max(0, Math.min(1, ((x + .5 - a[0]) * dx + (y + .5 - a[1]) * dy) / (dx * dx + dy * dy || 1)));
          if (Math.hypot(x + .5 - a[0] - t * dx, y + .5 - a[1] - t * dy) <= ctx.lineWidth / 2) { put(x, y, 1); break; }
        }
      }
    },
    getImageData(x: number, y: number, w: number, h: number) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[(j * w + i) * 4 + 3] = Math.round((pixels[(y + j) * width + x + i] ?? 0) * 255);
      return { data, width: w, height: h };
    },
  };
  return canvas;
}
export const alphaAt = (canvas: HTMLCanvasElement, x: number, y: number) => canvas.getContext('2d')!.getImageData(x, y, 1, 1).data[3];
