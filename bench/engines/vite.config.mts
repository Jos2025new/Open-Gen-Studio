import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/* The engine comparison: one build per engine (BENCH_ENGINE=canvas2d|webgl2|canvaskit), never shipped with the app. */
const engine = process.env.BENCH_ENGINE ?? 'canvas2d';
const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  define: { __ENGINE__: JSON.stringify(engine) },
  build: { outDir: fileURLToPath(new URL(`../../.bench-dist/${engine}`, import.meta.url)), emptyOutDir: true, target: 'es2022', sourcemap: false },
  server: { host: '127.0.0.1', port: 5190, strictPort: true },
  preview: { host: '127.0.0.1', port: 5190, strictPort: true },
});
