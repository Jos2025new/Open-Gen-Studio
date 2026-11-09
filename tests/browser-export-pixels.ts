/* Standalone browser pixel probe. Bundle with rolldown into a temporary directory and open a local HTML that loads it.
 * Run: bundle this file as an IIFE with rolldown, load it from a local HTML file, then read the page text.
 * Example: rolldown tests/browser-export-pixels.ts -p browser -f iife -o /tmp/ogs-pixels/test.js --inlineDynamicImports
 * Use an isolated browser and an HTML file in that directory containing <script src="test.js"></script>.
 * Uses in-memory canvases and never starts the app or accesses its data. `pass` requires matching opaque and edge pixels.
 */
import { drawRasterStroke } from '../src/engine/design/rasterDraw';
import { setBuffer } from '../src/engine/design/raster';
import { exportGeometry, exportPlan } from '../src/engine/design/exportJob';
import { drawDoc } from '../src/engine/design/render';
import { DEFAULT_EXPORT } from '../src/engine/design/exportSettings';

const strokeA = { id: 'red', x: 0, y: 0, color: '#ff8080', opacity: 1, erase: false, segments: [[10, 30, 80, 30, 14]] };
const strokeB = { id: 'blue', x: 0, y: 0, color: '#8080ff', opacity: 1, erase: false, segments: [[50, 10, 50, 50, 14]], tip: { hardness: 1, blend: 'multiply' } };
const layer = { id: 'pixel-proof', name: 'test', type: 'raster', visible: true, locked: false, opacity: 1, blend: 'normal', x: 0, y: 0, width: 100, height: 100, pxWidth: 100, pxHeight: 100, rev: 0, paintStrokes: [strokeA, strokeB] };
const doc = { id: 'proof', name: 'proof', width: 100, height: 100, background: null, layers: [layer], activeLayerId: layer.id, createdAt: 0, updatedAt: 0 };
const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100;
const ctx = canvas.getContext('2d')!; drawRasterStroke(ctx, strokeA as any); drawRasterStroke(ctx, strokeB as any); setBuffer(layer.id, canvas, false);
const settings = { ...DEFAULT_EXPORT, area: 'objects' as const, format: 'png' as const };
const target = { objects: [{ layerId: layer.id, ids: ['blue'] }] };
const deps = { rasterHref: async () => null, layout: () => ({ lines: [], width: 0, lineHeightPx: 0 }), ascent: () => 0 };
async function run() {
  const geometry = exportGeometry(doc as any, settings, target); const [file] = await exportPlan(doc as any, settings, target, deps);
  const img = await createImageBitmap(file.bytes); const out = document.createElement('canvas'); out.width = img.width; out.height = img.height;
  const ox = out.getContext('2d')!; ox.drawImage(img, 0, 0);
  const screen = document.createElement('canvas'); screen.width = 100; screen.height = 100; const screenCtx = screen.getContext('2d')!; drawDoc(screenCtx, doc as any);
  const inspect = (x: number, y: number) => ({ at: [x,y], screen: [...screenCtx.getImageData(x,y,1,1).data], output: [...ox.getImageData(x-geometry.box.x,y-geometry.box.y,1,1).data] });
  const points = [inspect(50, 30), inspect(50, 15), inspect(43, 15)];
  let solid = 0, solidDifferences = 0, transparent = 0, partial = 0, maxDiff = 0; const edgeDifferences: unknown[] = [];
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) { const a = ox.getImageData(x,y,1,1).data; const b = screenCtx.getImageData(x + geometry.box.x,y + geometry.box.y,1,1).data; if (a[3] === 255) { solid++; const d = Math.max(...a.map((v,i) => Math.abs(v-b[i]))); if (d) solidDifferences++; maxDiff = Math.max(maxDiff,d); } else if (a[3] === 0) transparent++; else { partial++; if (b[3] > 0 && b[3] < 255 && a[3] !== b[3] && edgeDifferences.length < 4) edgeDifferences.push({ at: [x + geometry.box.x, y + geometry.box.y], screen: [...b], output: [...a] }); } }
  document.body.textContent = JSON.stringify({ pass: solidDifferences === 0 && edgeDifferences.length === 0, box: geometry.box, mime: file.mime, bytes: file.bytes.size, points, solid, solidDifferences, maxDiff, transparent, partial, edgeDifferences });
}
run().catch((error) => { document.body.textContent = JSON.stringify({error: String(error), stack: error?.stack}); });
