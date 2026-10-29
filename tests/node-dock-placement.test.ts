import { describe, expect, it } from 'vitest';
import { dockLift } from '../src/components/node/dockPlacement';

const rect = (left: number, right: number, top: number, bottom: number) => ({ left, right, top, bottom }) as DOMRect;

describe('node toolbar and composer', () => {
  it('clears the prompt, footer and conversation when they are stacked', () => {
    const panel = rect(80, 510, 578, 624);
    const footer = rect(274, 1074, 582, 615);
    const prompt = rect(274, 1074, 528, 582);
    const conversation = rect(274, 464, 474, 520);
    expect(dockLift(panel, [conversation, footer, prompt])).toBe(158);
    expect(dockLift(panel, [rect(600, 800, 500, 620)])).toBe(0);
  });
});
