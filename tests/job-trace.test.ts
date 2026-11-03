import { describe, expect, it } from 'vitest';
import { diffTrace, recordTrace, traceOf } from '../src/engine/jobTrace';
import { describeRunning, generationStatus } from '../src/engine/agent/jobStatus';
import { useStore } from '../src/store/store';
import type { Generation } from '../src/engine/types';

/* The live trace of a generation (Details → Trace) and the agent's generation_status tool, which reads it on request. */

const gen = (over: Partial<Generation>): Generation => ({
  id: 'g1', sessionId: 's1', kind: 'video', prompt: 'turnaround', modelRef: 'nanogpt::seedance', modelName: 'Seedance 2.0 Fast', provider: 'nanogpt',
  settings: { count: 1, advanced: {} }, inputs: { refs: [] }, origin: 'agent', status: 'running', assetIds: [], estimate: { usd: 0.2 } as Generation['estimate'], createdAt: 1_000,
  ...over,
});

describe('job trace', () => {
  it('records each new status text and how the generation ended, never the same line twice', () => {
    const a = gen({ id: 't1', statusText: 'Queued · 5s' });
    diffTrace({}, { t1: a }, 10);
    diffTrace({ t1: a }, { t1: { ...a } }, 11);
    const b = { ...a, statusText: 'Rendering · 12s', progress: 0.4 };
    diffTrace({ t1: a }, { t1: b }, 20);
    const c = { ...b, statusText: undefined, status: 'error' as const, error: 'upstream timeout' };
    diffTrace({ t1: b }, { t1: c }, 30);
    expect(traceOf('t1')).toEqual([
      { at: 10, text: 'Queued · 5s' },
      { at: 20, text: 'Rendering · 12s', progress: 0.4 },
      { at: 30, text: 'Failed · upstream timeout' },
    ]);
  });

  it('keeps a bounded history per generation', () => {
    for (let i = 0; i < 100; i++) recordTrace('t2', `poll ${i}`, undefined, i);
    expect(traceOf('t2')).toHaveLength(60);
    expect(traceOf('t2').at(-1)?.text).toBe('poll 99');
  });
});

describe('generation_status', () => {
  it('describes a running job with its provider, job id, progress and recent checks', () => {
    recordTrace('t3', 'Rendering · 40s', undefined, 50_000);
    const text = describeRunning(gen({ id: 't3', statusText: 'Rendering · 40s', progress: 0.5, jobId: 'job-9', startedAt: 10_000 }), 60_000);
    expect(text).toContain('Seedance 2.0 Fast (NanoGPT)');
    expect(text).toContain('progress 50%');
    expect(text).toContain('job job-9');
    expect(text).toContain('running for 50s');
    expect(text).toContain('Rendering · 40s');
    expect(text).toContain('10s ago');
  });

  it('says so when nothing is running in the session', async () => {
    const sessionId = 'empty-session';
    useStore.setState({ generations: { d1: gen({ id: 'd1', sessionId, status: 'done', finishedAt: 5 }) } });
    const text = await generationStatus(sessionId, true, (w) => w);
    expect(text).toMatch(/Nothing is queued or running/);
    expect(text).toContain('generation:d1');
  });
});
