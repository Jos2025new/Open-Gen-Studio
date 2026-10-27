// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { toolboxTools, TOOLBOXES } from '../src/components/designer/toolboxModel';
import { DESIGN_TOOL_KEYS, TOOL_NAMES } from '../src/engine/shortcuts';
import { TOOL_HELP } from '../src/components/designer/ToolHelp';

/*
 * Every implemented tool must appear in a mode toolbox so a reorganisation cannot hide it from the interface.
 */
describe('designer inventory', () => {
  it('every tool has a place in the toolbox model', () => {
    const all = Object.keys(TOOL_NAMES);
    const placed = toolboxTools();
    for (const t of all) expect(placed, `tool "${t}" has no place in a toolbox`).toContain(t);
  });
  it('every tool key leads to a tool in a mode toolbox', () => {
    for (const [key, t] of Object.entries(DESIGN_TOOL_KEYS)) expect(toolboxTools(), `key ${key}`).toContain(t);
  });
  it('defines a toolbox for both drawing and design', () => {
    expect(TOOLBOXES.drawing.length).toBeGreaterThan(0);
    expect(TOOLBOXES.design.length).toBeGreaterThan(0);
  });
  it('every tool has a help line', () => {
    for (const t of Object.keys(TOOL_NAMES)) expect((TOOL_HELP as Record<string, string>)[t], `tool "${t}" has no help`).toBeTruthy();
  });
});
