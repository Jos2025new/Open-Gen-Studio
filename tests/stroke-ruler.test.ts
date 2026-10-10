import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { beginRulerStroke, endRulerStroke, rulerPoint, setRuler } from '../src/engine/design/strokeRuler';

/* Stroke rulers (SAI 2): while on, the brush follows the guide; off or on another page, strokes are free. */
describe('stroke ruler', () => {
  it('straight: strokes run parallel to the guide from where they start', () => {
    setRuler({ docId: 'd', kind: 'line', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, on: true });
    expect(beginRulerStroke('d', { x: 10, y: 50 })).toEqual({ x: 10, y: 50 });
    expect(rulerPoint('d', { x: 80, y: 90 })).toEqual({ x: 80, y: 50 });
    expect(rulerPoint('other', { x: 80, y: 90 })).toEqual({ x: 80, y: 90 });
    endRulerStroke();
  });
  it('ellipse: strokes follow the concentric ellipse through their start', () => {
    setRuler({ docId: 'd', kind: 'ellipse', a: { x: -100, y: -50 }, b: { x: 100, y: 50 }, on: true });
    const s = beginRulerStroke('d', { x: 50, y: 0 });
    expect(s.x).toBeCloseTo(50); expect(s.y).toBeCloseTo(0);
    const p = rulerPoint('d', { x: 0, y: 300 });
    expect(p.x).toBeCloseTo(0); expect(p.y).toBeCloseTo(25);
    endRulerStroke();
  });
  it('turned off, the brush is free', () => {
    setRuler({ docId: 'd', kind: 'line', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, on: false });
    beginRulerStroke('d', { x: 10, y: 50 });
    expect(rulerPoint('d', { x: 80, y: 90 })).toEqual({ x: 80, y: 90 });
  });
});
