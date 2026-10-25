import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT } from '../src/engine/agent/context';
import { TOOLS } from '../src/engine/agent/tools';
import { LAYER_DOC } from '../src/engine/agent/layerDoc';

// The agent learns what it can do from the system prompt; the schema validates it. Both must say the same.
describe('layer steps are described once', () => {
  it('the capability map names freehand strokes and path shapes', () => {
    expect(SYSTEM_PROMPT).toContain(LAYER_DOC.strokes);
    expect(SYSTEM_PROMPT).toContain(LAYER_DOC.shapes);
    expect(SYSTEM_PROMPT).toContain('type: "path"');
  });

  it('the propose_plan schema uses the same descriptions', () => {
    const plan = TOOLS.find((t) => t.function.name === 'propose_plan');
    const step = JSON.stringify(plan?.function.parameters);
    for (const text of [LAYER_DOC.strokes, LAYER_DOC.shapes, LAYER_DOC.box]) expect(step).toContain(JSON.stringify(text).slice(1, -1));
  });
});
