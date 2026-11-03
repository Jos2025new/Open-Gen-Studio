import { describe, expect, it } from 'vitest';
import { fitStepParams } from '../src/engine/agent/fit';
import { OPS } from '../src/engine/ops';

/*
 * Reported 2026-11-02: "extrae fotogramas en 0,1 y 0,4" (and later 1,7 / 3,4) gave the same front pose every time. The
 * agent sent `seconds` as a number; the plan kept only text, the second was dropped and the frame fell back to "last"
 * (a turnaround ends facing front, like it starts).
 */

const state = () => ({ direct: false, canAsk: true, answered: false, angles: new Map<string, string[]>() });
const fit = (params: Record<string, unknown>) =>
  fitStepParams({ id: 's1', where: 'step s1', op: 'extract_frame', input: 'asset:v', params, loose: {} }, OPS.extract_frame.fields, 'extrae fotogramas en 1,7 y 3,4', {}, state());

describe('extract_frame keeps the second the agent asked for', () => {
  it('a number of seconds stays, as text', () => {
    expect(fit({ which: 'time', seconds: 1.7 }).params).toMatchObject({ which: 'time', seconds: '1.7' });
  });

  it('a second without "which" means that second, not the last frame', () => {
    expect(fit({ seconds: 3.4 }).params).toMatchObject({ which: 'time', seconds: '3.4' });
    expect(fit({ seconds: '0,4' }).params).toMatchObject({ which: 'time', seconds: '0,4' });
  });

  it('"at second" without a second is refused, not turned into the last frame', () => {
    expect(fit({ which: 'time', seconds: '' }).errors[0]).toMatch(/needs params.seconds/);
  });

  it('first and last stay as they are', () => {
    expect(fit({ which: 'first' }).params.which).toBe('first');
    expect(fit({ which: 'last', seconds: '' }).params.which).toBe('last');
  });
});
