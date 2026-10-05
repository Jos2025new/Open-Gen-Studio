import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { estimatePilot, requestFailure, sampleRequest } from '../scripts/price-pilot.mjs';
import { buildExpansion, expansionResults, newExpansionLedger, prepareOrRunExpansion2, runExpansion } from '../scripts/price-pilot-expansion.mjs';

const ids = ['first-control', 'first-notice', 'continuation-continue-control', 'continuation-continue-notice',
  'continuation-cancel-control', 'continuation-cancel-notice'];
const setup = () => {
  const fixtures = ids.map((id) => ({ id, case: id.startsWith('first') ? 'first' : id.slice(0, id.lastIndexOf('-')),
    arm: id.endsWith('control') ? 'control' : 'notice', body: { model: 'deepseek/deepseek-v4.1-flash', max_tokens: 500,
      stream: true, messages: [{ role: 'system', content: 'synthetic fixed prompt' }, { role: 'user', content: id }] } }));
  const original = estimatePilot(fixtures);
  const previous = { approvalHash: original.approvalHash, chargedMicroUsd: 4020, stopped: false,
    calls: ids.map((id) => ({ id, status: 'finished', chargedMicroUsd: 670 })) };
  const old = buildExpansion(fixtures, previous).report;
  const failed = { approvalHash: old.approvalHash, previousLedgerSha256: old.previousLedgerSha256, previousMicroUsd: 4020,
    chargedMicroUsd: 8864, stopped: true, calls: [{ id: old.rows[0].id, chargedMicroUsd: 4844, status: 'uncertain' }] };
  const { report } = buildExpansion(fixtures, previous, failed);
  return { fixtures, previous, failed, report, ledger: newExpansionLedger(report),
    env: { NANOGPT_API_KEY: 'dummy-expansion-2-secret', PRICE_PILOT_APPROVAL: report.approvalHash } };
};
const ok = () => new Response('data: {"choices":[{"delta":{"content":"private response"},"finish_reason":"stop"}]}\n\n' +
  'data: {"usage":{"prompt_tokens":20,"completion_tokens":4,"cost":0.00001}}\n\ndata: [DONE]\n\n');
const phases = [
  ['fetch', async () => { throw new Error('dummy-expansion-2-secret transport message'); }],
  ['http', async () => new Response(JSON.stringify({ error: { code: 'unsupported_reasoning_effort', type: 'invalid_request_error', message: 'dummy-expansion-2-secret' } }), { status: 400 })],
  ['parse', async () => new Response('data: invalid dummy-expansion-2-secret\n\n')],
  ['provider-error', async () => new Response('data: {"error":{"code":"unsupported_reasoning_effort","type":"invalid_request_error","message":"dummy-expansion-2-secret"}}\n\n')],
  ['timeout', async () => { throw new DOMException('dummy-expansion-2-secret timeout', 'TimeoutError'); }],
] as const;

describe('expansion-2 safe diagnostics and model skipping with mocks only', () => {
  it('writes only expansion-2, preserves both old locks and ledgers byte-for-byte, and blocks a second process', async () => {
    const { fixtures, previous, failed } = setup();
    const root = mkdtempSync(join(tmpdir(), 'price-expansion2-test-'));
    const dir = join(root, '.sandbox/pilot');
    let sends = 0;
    try {
      mkdirSync(join(dir, 'expansion'), { recursive: true });
      const inputs = [
        ['requests.json', JSON.stringify(fixtures)], ['ledger.json', JSON.stringify(previous)],
        ['execution.lock', 'original lock'], ['expansion/ledger.json', JSON.stringify(failed)],
        ['expansion/execution.lock', 'failed expansion lock'], ['expansion/results.json', JSON.stringify({
          status: 'stopped', approvalHash: failed.approvalHash, globalAccountedUsd: 0.008864 })],
      ];
      for (const [name, content] of inputs) writeFileSync(join(dir, name), content);
      const report = await prepareOrRunExpansion2(root);
      const env = { NANOGPT_API_KEY: 'dummy-expansion-2-secret', PRICE_PILOT_APPROVAL: report.approvalHash };
      const fetcher = (async () => {
        const saved = JSON.parse(readFileSync(join(dir, 'expansion-2/results.json'), 'utf8'));
        expect(saved.status).toBe('running');
        expect(saved.calls.at(-1).status).toBe('reserved');
        sends++; return ok();
      }) as typeof fetch;
      const result = await prepareOrRunExpansion2(root, true, env, fetcher);
      expect(result).toMatchObject({ status: 'finished', previousAccountedUsd: 0.008864, globalAccountedUsd: 0.009144 });
      expect(sends).toBe(28);
      for (const [name, content] of inputs) expect(readFileSync(join(dir, name), 'utf8')).toBe(content);
      expect(readFileSync(join(dir, 'expansion-2/results.json'), 'utf8')).not.toContain(env.NANOGPT_API_KEY);
      await expect(prepareOrRunExpansion2(root, true, env, fetcher)).rejects.toThrow();
      expect(sends).toBe(28);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('carries USD 0.008864 exactly once, binds both ledgers and retains 28 calls under the dollar', () => {
    const { fixtures, previous, failed, report } = setup();
    expect(report).toMatchObject({ executionDirectory: 'expansion-2', skipFailedModels: true, calls: 28,
      warmupCalls: 4, measuredCalls: 24, previousMicroUsd: 8864, previousUsd: 0.008864, hardLimitUsd: 1 });
    expect(report.globalMaximumUsd).toBeLessThanOrEqual(1);
    const changed = structuredClone(failed); changed.chargedMicroUsd++;
    expect(() => buildExpansion(fixtures, previous, changed)).toThrow('Invalid stopped');
    changed.calls[0].chargedMicroUsd++;
    expect(buildExpansion(fixtures, previous, changed).report.approvalHash).not.toBe(report.approvalHash);
    changed.stopped = false;
    expect(() => buildExpansion(fixtures, previous, changed)).toThrow('Valid stopped');
  });

  it.each(phases)('records %s, skips that model after its warmup and continues others without exposing content', async (phase, failure) => {
    const { fixtures, previous, failed, ledger, env } = setup();
    const evidenceBefore = JSON.stringify({ previous, failed });
    const bodies: any[] = []; const saved: string[] = [];
    const fetcher = (async (_url: unknown, opts?: RequestInit) => {
      const body = JSON.parse(String(opts?.body)); bodies.push(body);
      return body.model === 'xiaomi/mimo-v2.6-flash' ? failure() : ok();
    }) as typeof fetch;
    await runExpansion(fixtures, previous, ledger, async (state) => { saved.push(JSON.stringify(state)); }, env, fetcher, failed);
    expect(bodies.filter((b) => b.model === 'xiaomi/mimo-v2.6-flash')).toHaveLength(1);
    expect(bodies).toHaveLength(22);
    expect(bodies.every((b) => b.max_tokens === 2000 && b.reasoning_effort === 'medium')).toBe(true);
    expect(ledger.calls[0]).toMatchObject({ failurePhase: phase, status: 'uncertain', measured: false, firstTextMs: 'no medido' });
    if (phase === 'http' || phase === 'provider-error') expect(ledger.calls[0]).toMatchObject({
      providerErrorCode: 'unsupported_reasoning_effort', providerErrorType: 'invalid_request_error', httpStatus: phase === 'http' ? 400 : 200 });
    expect(expansionResults(ledger)).toMatchObject({ status: 'finished_with_skips', skippedModels: ['xiaomi/mimo-v2.6-flash'],
      previousAccountedUsd: 0.008864, measuredCalls: 18, warmupCalls: 4 });
    expect(ledger.skippedRequests).toHaveLength(6);
    expect(ledger.chargedMicroUsd).toBe(8864 + ledger.calls[0].reservedMicroUsd + 21 * 10);
    expect(saved.join('')).not.toMatch(/dummy-expansion-2-secret|private response|transport message/);
    expect(JSON.stringify({ previous, failed })).toBe(evidenceBefore);
    const calls = bodies.length;
    await expect(runExpansion(fixtures, previous, ledger, async () => undefined, env, fetcher, failed)).rejects.toThrow('Already attempted');
    expect(bodies).toHaveLength(calls);
  });

  it.each([401, 402])('stops the entire run on HTTP %s without attempting other models', async (status) => {
    const { fixtures, previous, failed, ledger, env } = setup();
    let sends = 0;
    const fetcher = (async () => { sends++; return new Response(JSON.stringify({ error: { code: 'invalid_api_key', type: 'authentication_error', message: env.NANOGPT_API_KEY } }), { status }); }) as typeof fetch;
    await expect(runExpansion(fixtures, previous, ledger, async () => undefined, env, fetcher, failed)).rejects.toThrow('stopped');
    expect(sends).toBe(1); expect(ledger.stopped).toBe(true);
    expect(ledger.calls[0]).toMatchObject({ failurePhase: 'http', httpStatus: status, providerErrorCode: 'invalid_api_key' });
    expect(JSON.stringify(ledger)).not.toContain(env.NANOGPT_API_KEY);
  });

  it('continues after a measured failure, skipping remaining requests for that model', async () => {
    const { fixtures, previous, failed, ledger, env } = setup();
    let mimoCalls = 0; let sends = 0;
    const fetcher = (async (_url: unknown, opts?: RequestInit) => {
      sends++;
      const body = JSON.parse(String(opts?.body));
      if (body.model === 'xiaomi/mimo-v2.6-flash' && ++mimoCalls === 2) return new Response('failure', { status: 500 });
      return ok();
    }) as typeof fetch;
    await runExpansion(fixtures, previous, ledger, async () => undefined, env, fetcher, failed);
    expect(mimoCalls).toBe(2); expect(sends).toBe(23); expect(ledger.skippedRequests).toHaveLength(5);
    expect(expansionResults(ledger).status).toBe('finished_with_skips');
  });

  it.each(['success', 'provider-error'])('stops on a cost above reservation in %s, even below the global dollar', async (mode) => {
    const { fixtures, previous, failed, ledger, env } = setup();
    let sends = 0;
    const fetcher = (async () => {
      sends++;
      const payload = mode === 'provider-error' ? { error: { code: 'server_error', type: 'api_error', message: env.NANOGPT_API_KEY }, usage: { cost: 0.1 } } : { usage: { cost: 0.1 } };
      return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`);
    }) as typeof fetch;
    await expect(runExpansion(fixtures, previous, ledger, async () => undefined, env, fetcher, failed)).rejects.toThrow('stopped');
    expect(sends).toBe(1); expect(ledger.stopped).toBe(true); expect(ledger.chargedMicroUsd).toBe(108864);
    expect(ledger.calls[0]).toMatchObject({ reportedUsd: 0.1, costSource: 'provider' });
  });

  it('drops arbitrary code/type strings or a key disguised as a known code, retaining numeric technical codes', async () => {
    for (const [key, code, type, expected] of [
      ['dummy-secret', 'dummy-secret', 'private-response', 'desconocido'],
      ['invalid_api_key', 'invalid_api_key', 'invalid_api_key', 'desconocido'],
      ['dummy-secret', 400, 'invalid_request_error', 400],
    ] as const) {
      const fetcher = (async () => new Response(JSON.stringify({ error: { code, type, message: key } }), { status: 400 })) as typeof fetch;
      try { await sampleRequest({}, key, fetcher); throw new Error('expected failure'); }
      catch (error) {
        const diagnostic = requestFailure(error);
        expect(diagnostic.providerErrorCode).toBe(expected);
        expect(diagnostic.failurePhase).toBe('http');
        expect(JSON.stringify(diagnostic)).not.toContain(key);
      }
    }
  });
});
