// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { cloneLayer } from '../src/engine/design/doc';
import { docToSvg, type SvgDeps } from '../src/engine/design/export';
import { writeFilesToFolder, type FolderHandle } from '../src/engine/design/exportFolder';
import type { DesignDoc, VectorLayer } from '../src/engine/types';

const deps: SvgDeps = { rasterHref: async () => null, layout: () => ({ lines: [], width: 0, lineHeightPx: 0 }), ascent: () => 0 };
const layer = { id: 'layer', name: 'Shapes', type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', objectGroups: [{ id: 'group', name: 'Group' }], shapes: [
  { id: 'a', groupId: 'group', type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '#000', stroke: null, strokeWidth: 0 },
  { id: 'b', groupId: 'group', type: 'rect', x: 20, y: 0, w: 10, h: 10, fill: '#000', stroke: null, strokeWidth: 0 },
] } as VectorLayer;

describe('export integrity under adverse conditions', () => {
  it('does not write a file after its existence check fails with a permission error', async () => {
    const write = vi.fn(async () => {});
    const getFileHandle = vi.fn(async (_name: string, options?: { create?: boolean }) => {
      if (!options?.create) throw new DOMException('Permission denied', 'NotAllowedError');
      return { createWritable: async () => ({ write, close: async () => {} }) };
    });
    const folder = { name: 'test', getFileHandle, getDirectoryHandle: async () => { throw new Error('not used'); } } as FolderHandle;
    await expect(writeFilesToFolder(folder, [{ name: 'image.png', mime: 'image/png', bytes: new Blob(['test']) }], false)).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(write).not.toHaveBeenCalled();
  });
  it('keeps SVG identifiers unique after duplicating a grouped layer', async () => {
    const doc = { id: 'd', name: 'Design', width: 100, height: 100, background: null, layers: [layer, cloneLayer(layer)], activeLayerId: 'layer', createdAt: 0, updatedAt: 0 } as DesignDoc;
    const svg = await docToSvg(doc, deps);
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const ids = Array.from(parsed.querySelectorAll('[id]'), (el) => el.getAttribute('id'));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
