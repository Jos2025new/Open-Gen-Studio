import { describe, expect, it } from 'vitest';
import {
  MAX_BYTES,
  WARN_BYTES,
  ratchetBaseline,
  sizeViolations,
  sizeWarnings,
  staleBaselines,
} from '../scripts/check-sizes.mjs';

describe('check-sizes discipline rules', () => {
  it('warns without failing when a file exceeds 90% (27 000 B) up to 30 000 B', () => {
    const files = [
      { path: 'src/ok.ts', bytes: WARN_BYTES },
      { path: 'src/near.ts', bytes: WARN_BYTES + 1 },
      { path: 'src/atLimit.ts', bytes: MAX_BYTES },
      { path: 'src/over.ts', bytes: MAX_BYTES + 1 },
      { path: 'package-lock.json', bytes: 29_000 },
    ];
    const warnings = sizeWarnings(files);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^src\/near\.ts:1: warning: 27001 bytes/);
    expect(warnings[1]).toMatch(/^src\/atLimit\.ts:1: warning: 30000 bytes/);
    expect(sizeViolations([{ path: 'src/near.ts', bytes: WARN_BYTES + 1 }], {})).toEqual([]);
  });

  it('fails when a baseline file grows past its baseline', () => {
    const baseline = { 'src/big.ts': 35_000 };
    const errors = sizeViolations([{ path: 'src/big.ts', bytes: 35_001 }], baseline);
    expect(errors).toEqual([expect.stringMatching(/^src\/big\.ts:1: 35001 bytes, grew from 35000/)]);
  });

  it('flags stale baseline entries that shrank, dropped under 30 KB, or were deleted', () => {
    const baseline = {
      'src/held.ts': 35_000,
      'src/shrank.ts': 35_000,
      'src/fixed.ts': 32_000,
      'src/deleted.ts': 31_000,
    };
    const files = [
      { path: 'src/held.ts', bytes: 35_000 },
      { path: 'src/shrank.ts', bytes: 34_000 },
      { path: 'src/fixed.ts', bytes: 28_000 },
    ];
    const stale = staleBaselines(files, baseline);
    expect(stale).toHaveLength(3);
    expect(stale.some((e) => e.includes('src/shrank.ts shrank from 35000 to 34000') && e.includes('npm run sizes:baseline'))).toBe(true);
    expect(stale.some((e) => e.includes('src/fixed.ts is now 28000') && e.includes('npm run sizes:baseline'))).toBe(true);
    expect(stale.some((e) => e.includes('src/deleted.ts no longer exists') && e.includes('npm run sizes:baseline'))).toBe(true);
  });

  it('ratchetBaseline only lowers or removes entries and never raises or adds files', () => {
    const baseline = {
      'src/shrank.ts': 35_000,
      'src/grew.ts': 35_000,
      'src/fixed.ts': 32_000,
      'src/deleted.ts': 31_000,
    };
    const files = [
      { path: 'src/shrank.ts', bytes: 34_200 },
      { path: 'src/grew.ts', bytes: 36_000 },
      { path: 'src/fixed.ts', bytes: 29_500 },
      { path: 'src/newBig.ts', bytes: 40_000 },
    ];
    expect(ratchetBaseline(files, baseline)).toEqual({
      'src/grew.ts': 35_000,
      'src/shrank.ts': 34_200,
    });
  });
});
