// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { it, expect, vi } from 'vitest';
const probe = vi.hoisted(() => ({ clips: [] as string[][] }));
vi.mock('../src/engine/design/exportRaster', () => ({ PREVIEW_MAX_SIDE: 512, checkRasterExport: () => {}, exportDoc: async () => new Blob(), drawExport: (_doc: unknown, _type: unknown, opts: { clip?: (ctx: CanvasRenderingContext2D) => void }) => {
  const calls: string[] = [];
  const ctx = new Proxy({}, { get: (_obj, key) => () => calls.push(String(key)) }) as CanvasRenderingContext2D;
  opts.clip?.(ctx); probe.clips.push(calls); return { canvas: {} };
} }));
import { exportPreview } from '../src/engine/design/exportJob';
import { BUILTIN_EXPORTS } from '../src/engine/design/exportSettings';
import type { DesignDoc } from '../src/engine/types';
const doc = { id: 'd', name: 'd', width: 100, height: 100, background: null, layers: [], activeLayerId: null, createdAt: 0, updatedAt: 0 } as DesignDoc;
const selection = { points: [[10, 10], [80, 10], [10, 80]] as [number, number][] };
it('preserves polygon clipping in the print-shop preview', async () => {
  const settings = { ...BUILTIN_EXPORTS.find((p) => p.id === 'print-shop')!.settings, area: 'selection' as const };
  exportPreview(doc, settings, { selection });
  expect(probe.clips[0]).toContain('lineTo');
});
