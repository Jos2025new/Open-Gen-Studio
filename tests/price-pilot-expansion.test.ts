import { describe, expect, it } from 'vitest';
import { estimatePilot, reserveCall, sampleRequest } from '../scripts/price-pilot.mjs';
import { buildExpansion, expansionResults, LIMIT_MICRO_USD, MODELS, newExpansionLedger, runExpansion } from '../scripts/price-pilot-expansion.mjs';

const ids = ['first-control', 'first-notice', 'continuation-continue-control', 'continuation-continue-notice',
  'continuation-cancel-control', 'continuation-cancel-notice'];
const setup = () => {
  const fixtures = ids.map((id) => ({ id, case: id.startsWith('first') ? 'first' : id.slice(0, id.lastIndexOf('-')),
    arm: id.endsWith('control') ? 'control' : 'notice', body: { model: 'deepseek/deepseek-v4.1-flash', max_tokens: 500,
      stream: true, messages: [{ role: 'system', content: 'fixed synthetic context' }, { role: 'user', content: id }] } }));
  const original = estimatePilot(fixtures);
  const previous = { approvalHash: original.approvalHash, chargedMicroUsd: 4020, stopped: false,
    calls: ids.map((id) => ({ id, status: 'finished', chargedMicroUsd: 670 })) };
  const { report } = buildExpansion(fixtures, previous);
  return { fixtures, previous, report, ledger: newExpansionLedger(report),
    env: { NANOGPT_API_KEY: 'dummy-expansion-secret', PRICE_PILOT_APPROVAL: report.approvalHash } };
};
const ok = () => new Response('data: {"choices":[{"delta":{"reasoning":"private reasoning"}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":"private answer"},"finish_reason":"length"}]}\n\n' +
  'data: {"usage":{"prompt_tokens":20,"completion_tokens":500,"prompt_tokens_details":{"cached_tokens":10},' +
  '"completion_tokens_details":{"reasoning_tokens":450},"cost":0.00001}}\n\ndata: [DONE]\n\n');

describe('expanded pilot with simulated providers; never uses a live credential', () => {
  it('builds exactly three pairs for each requested model, preserving the captured history and configuration', () => {
    const { fixtures, previous } = setup();
    const { requests, report } = buildExpansion(fixtures, previous);
    expect(requests).toHaveLength(28);
    expect(new Set(requests.map((r) => r.id)).size).toBe(28);
    expect(requests.filter((r) => !r.measured)).toHaveLength(4);
    for (const model of MODELS) {
      const samples = requests.filter((r) => r.body.model === model.id && r.measured);
      expect(samples.map((s) => s.arm)).toEqual(['control', 'notice', 'notice', 'control', 'control', 'notice']);
      for (const r of samples) {
        const source = fixtures.find((f) => r.id === `${model.id}/${f.id}`)!;
        expect(r.body).toEqual({ ...source.body, model: model.id, reasoning_effort: 'medium', max_tokens: 2000 });
        expect(JSON.stringify(r.body.messages)).toBe(JSON.stringify(source.body.messages));
      }
      const warmup = requests.find((r) => r.body.model === model.id && !r.measured)!;
      expect(warmup.body).toEqual(samples[0].body);
      expect(requests.indexOf(warmup) + 1).toBe(requests.indexOf(samples[0]));
    }
    expect(report.previousMicroUsd).toBe(4020);
    expect(report.rows.filter((r: any) => r.model === 'x-ai/grok-4.7').every((r: any) =>
      r.rejectionFeeMicroUsd === 55000 && r.maximumMicroUsd === r.tokenMicroUsd + 55000)).toBe(true);
    expect(report.rows.filter((r: any) => !r.mediumAdvertised).map((r: any) => r.model)).toHaveLength(14);
    expect(report).toMatchObject({ calls: 28, measuredCalls: 24, warmupCalls: 4, maxOutputTokens: 2000, grokContingencyIncluded: true });
    expect(report.globalMaximumUsd).toBeCloseTo(report.previousUsd + report.additionalMaximumUsd, 8);
  });

  it('ties approval to the exact request and completed prior accounting; rejects unfinished or altered input', () => {
    const { fixtures, previous, report } = setup();
    const changed = structuredClone(fixtures);
    changed[0].body.messages[1].content += ' changed';
    expect(() => buildExpansion(changed, previous)).toThrow('Completed original');
    const unfinished = structuredClone(previous); unfinished.calls[0].status = 'uncertain';
    expect(() => buildExpansion(fixtures, unfinished)).toThrow('Completed original');
    const corrupt = structuredClone(previous); corrupt.chargedMicroUsd--;
    expect(() => buildExpansion(fixtures, corrupt)).toThrow('Invalid original');
    const other = structuredClone(previous); other.calls[0].chargedMicroUsd++; other.chargedMicroUsd++;
    expect(buildExpansion(fixtures, other).report.approvalHash).not.toBe(report.approvalHash);
  });

  it('rejects an expansion over the approved global dollar before any network use', () => {
    const { fixtures } = setup();
    fixtures[0].body.messages[0].content = 'a'.repeat(700000);
    const original = estimatePilot(fixtures);
    const previous = { approvalHash: original.approvalHash, chargedMicroUsd: 0, stopped: false,
      calls: ids.map((id) => ({ id, status: 'finished', chargedMicroUsd: 0 })) };
    expect(() => buildExpansion(fixtures, previous)).toThrow('exceeds approved global');
  });

  it('removes Grok contingency before dropping any warmup or measured pair if the full reservation exceeds a dollar', () => {
    const { fixtures } = setup();
    fixtures.forEach((f) => { f.body.messages[0].content = 'a'.repeat(120000); });
    const original = estimatePilot(fixtures);
    const previous = { approvalHash: original.approvalHash, chargedMicroUsd: 0, stopped: false,
      calls: ids.map((id) => ({ id, status: 'finished', chargedMicroUsd: 0 })) };
    const { report, requests } = buildExpansion(fixtures, previous);
    expect(report.globalMaximumWithContingencyUsd).toBeGreaterThan(1);
    expect(report.grokContingencyIncluded).toBe(false);
    expect(report.globalMaximumUsd).toBeLessThanOrEqual(1);
    expect(report.rows.every((r: any) => r.rejectionFeeMicroUsd === 0 && r.maximumMicroUsd === r.tokenMicroUsd)).toBe(true);
    expect(requests.filter((r) => r.measured)).toHaveLength(24);
    expect(requests.filter((r) => !r.measured)).toHaveLength(4);
  });

  it('retains the original five-cent default and blocks a next reservation beyond the expanded dollar', () => {
    const ledger = { chargedMicroUsd: 999999, stopped: false, calls: [] };
    expect(() => reserveCall(ledger, { id: 'next', maximumMicroUsd: 2 }, LIMIT_MICRO_USD)).toThrow('Insufficient');
    expect(ledger.calls).toHaveLength(0);
    expect(() => reserveCall({ chargedMicroUsd: 50000, stopped: false, calls: [] }, { id: 'next', maximumMicroUsd: 1 })).toThrow('Insufficient');
    expect(() => reserveCall(ledger, { id: 'next', maximumMicroUsd: 1 }, 1000001)).toThrow('Invalid budget limit');
  });

  it('sends four unmeasured warmups and 24 medium samples, saving reservations and accounting all costs without secrets/content', async () => {
    const { fixtures, previous, ledger, env } = setup();
    const original = JSON.stringify(previous);
    const saved: string[] = [];
    let sends = 0;
    const fakeFetch = (async (url: string | URL | Request, options?: RequestInit) => {
      expect(url).toBe('https://nano-gpt.com/api/v1/chat/completions');
      expect(options).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit' });
      expect(options?.headers).toEqual({ 'content-type': 'application/json', authorization: `Bearer ${env.NANOGPT_API_KEY}` });
      expect(JSON.parse(String(options?.body))).toMatchObject({ reasoning_effort: 'medium', max_tokens: 2000 });
      expect(String(options?.body)).not.toContain(env.NANOGPT_API_KEY);
      expect(JSON.parse(saved.at(-1)!).calls.at(-1).status).toBe('reserved');
      sends++; return ok();
    }) as typeof fetch;
    await runExpansion(fixtures, previous, ledger, async (s) => { saved.push(JSON.stringify(s)); }, env, fakeFetch);
    expect(sends).toBe(28);
    expect(ledger.chargedMicroUsd).toBe(4020 + 28 * 10);
    expect(expansionResults(ledger)).toMatchObject({ status: 'finished', limitUsd: 1, previousAccountedUsd: 0.00402,
      globalAccountedUsd: 0.00430, additionalAccountedUsd: 0.00028, measuredCalls: 24, warmupCalls: 4 });
    expect(ledger.calls.filter((c: any) => !c.measured).every((c: any) => c.firstTextMs === 'no medido' && c.totalMs === 'no medido')).toBe(true);
    expect(ledger.calls.filter((c: any) => c.measured).every((c: any) => typeof c.firstTextMs === 'number')).toBe(true);
    expect(JSON.stringify(previous)).toBe(original);
    expect(saved.join('')).not.toMatch(/dummy-expansion-secret|private answer|private reasoning/);
    expect(ledger.calls.every((c: any) => c.requestedReasoningEffort === 'medium' && c.effectiveReasoningEffort === 'desconocido' &&
      c.reasoningTokens === 450 && c.finishReason === 'length' && c.cachedTokens === 10)).toBe(true);
    await expect(runExpansion(fixtures, previous, ledger, async () => undefined, env, fakeFetch)).rejects.toThrow('Already attempted');
    expect(sends).toBe(28);
  });

  it('aborts missing credentials or wrong approval before saving or sending', async () => {
    const { fixtures, previous, ledger, env } = setup();
    let sends = 0; let saves = 0;
    const fetcher = (async () => { sends++; return ok(); }) as typeof fetch;
    const save = async () => { saves++; };
    await expect(runExpansion(fixtures, previous, ledger, save, {}, fetcher)).rejects.toThrow('NANOGPT_API_KEY');
    await expect(runExpansion(fixtures, previous, ledger, save, { ...env, PRICE_PILOT_APPROVAL: 'wrong' }, fetcher)).rejects.toThrow('Approval');
    expect(sends).toBe(0); expect(saves).toBe(0);
  });

  it('retains the highest reservation without reported cost and records no visible text after reasoning-only output', async () => {
    const { fixtures, previous, report, ledger, env } = setup();
    const fetcher = (async () => new Response('data: {"choices":[{"delta":{"reasoning":"private"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n')) as typeof fetch;
    await runExpansion(fixtures, previous, ledger, async () => undefined, env, fetcher);
    expect(ledger.chargedMicroUsd).toBe(Math.round(report.globalMaximumUsd * 1e6));
    expect(ledger.calls.every((c: any) => c.costSource === 'highest-estimate' && c.firstTextMs === (c.measured ? 'desconocido' : 'no medido') &&
      c.finishReason === 'length' && c.reportedUsd === 'desconocido')).toBe(true);
  });

  it('stops on a reported overspend and sends no further requests', async () => {
    const { fixtures, previous, ledger, env } = setup();
    let sends = 0;
    const fetcher = (async () => { sends++; return new Response('data: {"usage":{"cost":1.001}}\n\ndata: [DONE]\n\n'); }) as typeof fetch;
    await expect(runExpansion(fixtures, previous, ledger, async () => undefined, env, fetcher)).rejects.toThrow('stopped');
    expect(sends).toBe(1); expect(ledger.stopped).toBe(true); expect(ledger.chargedMicroUsd).toBeGreaterThan(1000000);
  });

  it('does not retry rejected medium or leak provider error messages', async () => {
    const { fixtures, previous, ledger, env } = setup();
    let sends = 0;
    const fetcher = (async () => { sends++; return new Response(env.NANOGPT_API_KEY, { status: 400 }); }) as typeof fetch;
    await expect(runExpansion(fixtures, previous, ledger, async () => undefined, env, fetcher)).rejects.toThrow('no automatic retry');
    expect(sends).toBe(1); expect(ledger.calls[0]).toMatchObject({ status: 'uncertain', costSource: 'highest-estimate' });
    expect(JSON.stringify(ledger)).not.toContain(env.NANOGPT_API_KEY);
  });

  it('persists only known finish reason values, not arbitrary provider strings', async () => {
    const fetcher = (async () => new Response('data: {"choices":[{"finish_reason":"private-provider-string"}]}\n\ndata: [DONE]\n\n')) as typeof fetch;
    expect(await sampleRequest({}, 'dummy', fetcher)).toMatchObject({ finishReason: 'desconocido', reasoningTokens: 'desconocido' });
  });
});
