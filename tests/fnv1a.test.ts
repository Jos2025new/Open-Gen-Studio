import { describe, expect, it } from 'vitest';
import { fnv1a32 } from '../bench/engines/fnv1a';
import digests from '../bench/engines/parity-digests.json';

describe('FNV-1a parity digest', () => {
  it('matches the published 32-bit FNV-1a vectors', () => {
    expect(fnv1a32([])).toBe('811c9dc5');
    expect(fnv1a32([...'a'].map((c) => c.charCodeAt(0)))).toBe('e40c292c');
    expect(fnv1a32([...'foobar'].map((c) => c.charCodeAt(0)))).toBe('bf9cf968');
  });
  it('is sensitive to a single changed channel byte', () => {
    const a = new Uint8ClampedArray([10, 20, 30, 255]), b = new Uint8ClampedArray([10, 20, 31, 255]);
    expect(fnv1a32(a)).not.toBe(fnv1a32(b));
  });
  it('the stored reference has the expected shape', () => {
    expect(digests.format).toBe(1);
    expect(digests.seed).toBe(20260412);
    for (const hex of Object.values(digests.digests)) expect(hex).toMatch(/^[0-9a-f]{8}$/);
  });
});
