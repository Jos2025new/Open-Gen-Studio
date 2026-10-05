import { describe, expect, it } from 'vitest';
import { estimatePilot, reserveCall, settleCall, sampleRequest } from '../scripts/price-pilot.mjs';

const row = { id: 'sample', maximumMicroUsd: 4000 };
const ledger = (chargedMicroUsd = 0) => ({ chargedMicroUsd, calls: [] as any[], stopped: false });

describe('pilot budget without network or provider spend', () => {
  it('reserves before sending and rejects exceeding USD 0.05', () => {
    const state = ledger(47000);
    expect(() => reserveCall(state, row)).toThrow('Insufficient');
    expect(state).toEqual(ledger(47000));
    reserveCall(state, { ...row, maximumMicroUsd: 3000 });
    expect(state.chargedMicroUsd).toBe(50000);
    expect(() => reserveCall(state, { id: 'next', maximumMicroUsd: 1 })).toThrow('Insufficient');
  });
  it('uses reported cost when present and highest reserved estimate when absent', () => {
    const state = ledger();
    reserveCall(state, row); settleCall(state, row, 0.001);
    expect(state.chargedMicroUsd).toBe(1000);
    const second = { id: 'second', maximumMicroUsd: 5000 };
    reserveCall(state, second); settleCall(state, second, 'desconocido');
    expect(state.chargedMicroUsd).toBe(6000);
    expect(state.calls[1].costSource).toBe('highest-estimate');
    expect(() => reserveCall(state, row)).toThrow('already attempted');
  });
  it('stops if a reported cost exceeds the reserved estimate', () => {
    const state = ledger();
    reserveCall(state, row); settleCall(state, row, 0.005);
    expect(state.stopped).toBe(true);
    expect(state.chargedMicroUsd).toBe(5000);
    expect(() => reserveCall(state, { id: 'next', maximumMicroUsd: 1 })).toThrow('Stopped');
  });
  it('estimates characters / 3 with 50% margin and blocks GPT Luna', () => {
    const fixtures = Array.from({ length: 6 }, (_, i) => ({ id: `${i}`, case: 'first', arm: 'control',
      body: { model: 'deepseek/deepseek-v4.1-flash', max_tokens: 500, messages: [{ role: 'user', content: 'á😀' }] } }));
    const result = estimatePilot(fixtures);
    const chars = [...JSON.stringify(fixtures[0].body)].length;
    expect(result.rows[0].inputTokensEstimate).toBe(Math.ceil(chars / 3 * 1.5));
    expect(result.rows[0].maximumMicroUsd).toBe(Math.ceil(Math.ceil(chars / 3 * 1.5) * 0.13 + 500 * 0.52));
    fixtures[0].body.model = 'openai/gpt-6-luna';
    expect(() => estimatePilot(fixtures)).toThrow('Unapproved model');
  });
  it('measures first text separately, preserves unknown cache and never returns conversation text', async () => {
    const body = 'data: {"choices":[{"delta":{"reasoning":"hidden"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n' +
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":5,"cost":0.0001}}\n\ndata: [DONE]\n\n';
    let calls = 0;
    const fakeFetch = (async () => { calls++; return new Response(body); }) as typeof fetch;
    const result = await sampleRequest({}, 'test-only', fakeFetch);
    expect(calls).toBe(1);
    expect(result).toMatchObject({ firstTextMs: expect.any(Number), totalMs: expect.any(Number), inputTokens: 10,
      outputTokens: 5, cachedTokens: 'desconocido', reportedUsd: 0.0001 });
    expect(JSON.stringify(result)).not.toMatch(/answer|hidden|test-only/);
  });
  it('does not retry an HTTP 400 that refuses reasoning', async () => {
    let calls = 0;
    const fakeFetch = (async () => { calls++; return new Response('reasoning rejected', { status: 400 }); }) as typeof fetch;
    await expect(sampleRequest({}, 'test-only', fakeFetch)).rejects.toThrow('no retry');
    expect(calls).toBe(1);
  });
});
