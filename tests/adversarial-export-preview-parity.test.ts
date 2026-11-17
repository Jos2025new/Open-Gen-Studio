// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
const capture = vi.hoisted(() => ({ options: [] as Array<Record<string, unknown>> }));
vi.mock('../src/engine/design/exportRaster', () => ({
  PREVIEW_MAX_SIDE: 512,
  checkRasterExport: () => undefined,
  exportDoc: async () => new Blob(),
  drawExport: (_doc: unknown, _mime: unknown, options: Record<string, unknown>) => {
    capture.options.push(options);
    return { canvas: { width: options.width, height: options.height } };
  },
}));
import { exportPreview } from '../src/engine/design/exportJob';
import { DEFAULT_EXPORT } from '../src/engine/design/exportSettings';
import type { DesignDoc } from '../src/engine/types';

const doc = (width: number, height: number, background: string | null = null) => ({ id: 'd', name: 'd', width, height, background, layers: [], activeLayerId: null, createdAt: 0, updatedAt: 0 } as DesignDoc);

describe('adversarial export preview parity', () => {
  beforeEach(() => { capture.options.length = 0; });

  it('bounds an enormous empty transparent canvas while preserving aspect ratio and transparency', () => {
    const frame = exportPreview(doc(20000, 10000), { ...DEFAULT_EXPORT, background: null }, {});
    expect([frame.width, frame.height]).toEqual([512, 256]);
    expect(capture.options[0]).toMatchObject({ preview: true, background: undefined, whiteBase: false, width: 512, height: 256 });
  });

  it('retains selection crop geometry in the drawn preview options', () => {
    exportPreview(doc(100, 100), { ...DEFAULT_EXPORT, area: 'selection', size: 3 }, { selection: { points: [[10, 20], [70, 20], [70, 80], [10, 80]] } });
    expect(capture.options[0]).toMatchObject({ width: 180, height: 180, box: { x: 10, y: 20, w: 60, h: 60 }, preview: true });
    expect(capture.options[0].clip).toEqual(expect.any(Function));
  });
});
