import { describe, expect, it } from 'vitest';
import { formatZodError, proposePlanSchema } from '../src/engine/agent/tools';

const step = { id: 's1', kind: 'image', prompt: 'a cat' };

describe('propose_plan steps sent as text (Qwen, MiMo)', () => {
  it('a valid JSON string is read as the array', () => {
    const r = proposePlanSchema.safeParse({ steps: JSON.stringify([step]) });
    expect(r.success).toBe(true);
  });
  it('a broken one gets an error that says how to send it, with an example', () => {
    const r = proposePlanSchema.safeParse({ steps: `[${JSON.stringify(step)}` });
    expect(r.success).toBe(false);
    expect(formatZodError(r.error!)).toMatch(/must be a JSON array of step objects, not a string.*Example/);
  });
  it('a real array still works', () => {
    expect(proposePlanSchema.safeParse({ steps: [step] }).success).toBe(true);
  });
});
