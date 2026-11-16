import { describe, expect, it } from 'vitest';
import { ensureOmniNodes, OMNI_SPACES } from '../src/engine/nodes/omni';
import { nodeRect, rectsOverlap } from '../src/engine/flow/graph';
import { OMNI_OPEN_MIN_ZOOM } from '../src/components/omni/useOmniFraming';
import { newSession, useStore } from '../src/store/store';

describe('omnicanvas opening layout', () => {
  it('puts Studio, Nodes and Designer right above the chat, without overlaps, so they frame together at a readable zoom', () => {
    const sid = newSession();
    ensureOmniNodes(sid);
    const nodes = useStore.getState().sessions[sid].graph.nodes;
    const spaces = nodes.filter((n) => n.data.kind === 'ref' && n.data.type === 'space' && OMNI_SPACES.includes(n.data.ref as never));
    const chat = nodes.find((n) => n.data.kind === 'ref' && n.data.type === 'chat')!;
    expect(spaces).toHaveLength(3);
    const rects = [...spaces, chat].map((n) => nodeRect(n));
    rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => expect(rectsOverlap(a, b)).toBe(false)));
    // The group's bounds fit a 1220x672 pane with 10 % padding at the zoom the framing allows (>= minimum).
    const x0 = Math.min(...rects.map((r) => r.x)); const x1 = Math.max(...rects.map((r) => r.x + r.width));
    const y0 = Math.min(...rects.map((r) => r.y)); const y1 = Math.max(...rects.map((r) => r.y + r.height));
    const zoom = Math.min(1220 / ((x1 - x0) * 1.1), 672 / ((y1 - y0) * 1.1), 1);
    expect(zoom).toBeGreaterThanOrEqual(0.5);
    expect(zoom).toBeGreaterThanOrEqual(OMNI_OPEN_MIN_ZOOM);
    expect(OMNI_OPEN_MIN_ZOOM).toBe(0.35);
  });
});
