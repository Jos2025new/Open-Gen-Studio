// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { railTools } from '../src/components/designer/ToolRail';
import { DESIGN_TOOL_KEYS, TOOL_NAMES } from '../src/engine/shortcuts';
import { TOOL_HELP } from '../src/components/designer/ToolHelp';

/*
 * The Designer's inventory (docs/plan-designer-ux.md, step 0): every tool has a place in the rail. The rail is drawn
 * from the same list, so a tool missing here would be missing on screen. Reorganising the rail must keep this green.
 */
describe('designer inventory', () => {
  it('every tool has a place in the rail, exactly once', () => {
    const all = Object.keys(TOOL_NAMES);
    const placed = railTools();
    expect(new Set(placed).size).toBe(placed.length);
    for (const t of all) expect(placed, `tool "${t}" has no place in the rail`).toContain(t);
  });
  it('every tool key leads to a tool that is in the rail', () => {
    for (const [key, t] of Object.entries(DESIGN_TOOL_KEYS)) expect(railTools(), `key ${key}`).toContain(t);
  });
  it('every tool has a help line', () => {
    for (const t of Object.keys(TOOL_NAMES)) expect((TOOL_HELP as Record<string, string>)[t], `tool "${t}" has no help`).toBeTruthy();
  });
});
