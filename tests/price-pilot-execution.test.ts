import { describe, expect, it } from 'vitest';
import { environmentKey, estimatePilot, runPilot } from '../scripts/price-pilot.mjs';

const fixtures = () => Array.from({ length: 6 }, (_, i) => ({ id: `request-${i}`, case: 'fixture', arm: i % 2 ? 'notice' : 'control',
  body: { model: 'deepseek/deepseek-v4.1-flash', max_tokens: 500, messages: [{ role: 'user', content: 'synthetic fixture' }] } }));
const setup = (chargedMicroUsd = 0) => {
  const input = fixtures();
  const report = estimatePilot(input);
  const ledger = { approvalHash: report.approvalHash, chargedMicroUsd, stopped: false, calls: [] as any[] };
  const env = { NANOGPT_API_KEY: 'dummy-pilot-secret', PRICE_PILOT_APPROVAL: report.approvalHash };
  return { input, ledger, env };
};
const ok = () => new Response('data: {"choices":[{"delta":{"content":"synthetic"}}]}\n\n' +
  'data: {"usage":{"prompt_tokens":20,"completion_tokens":4,"cost":0.00001}}\n\ndata: [DONE]\n\n');

describe('pilot execution with a simulated provider only', () => {
  it('reads only NANOGPT_API_KEY and rejects missing/blank keys without saving or sending', async () => {
    const accessed: string[] = [];
    const env = new Proxy({}, { get: (_t, key) => { accessed.push(String(key)); return undefined; } });
    expect(() => environmentKey(env)).toThrow('NANOGPT_API_KEY is required');
    expect(accessed).toEqual(['NANOGPT_API_KEY']);
    expect(() => environmentKey({ NANOGPT_API_KEY: '   ' })).toThrow('required');
    const { input, ledger } = setup();
    let sends = 0; let saves = 0;
    const fakeFetch = (async () => { sends++; return ok(); }) as typeof fetch;
    await expect(runPilot(input, ledger, async () => { saves++; }, {}, fakeFetch)).rejects.toThrow('required');
    expect(sends).toBe(0); expect(saves).toBe(0);
  });

  it('sends six requests only to the fixed NanoGPT URL, prevents redirects, and never persists the key', async () => {
    const { input, ledger, env } = setup();
    const saved: string[] = [];
    let sends = 0;
    const save = async (state: unknown) => { saved.push(JSON.stringify(state)); };
    const fakeFetch = (async (url: string | URL | Request, options?: RequestInit) => {
      expect(url).toBe('https://nano-gpt.com/api/v1/chat/completions');
      expect(options).toMatchObject({ redirect: 'error', credentials: 'omit', method: 'POST' });
      expect(options?.headers).toEqual({ 'content-type': 'application/json', authorization: `Bearer ${env.NANOGPT_API_KEY}` });
      expect(String(options?.body)).not.toContain(env.NANOGPT_API_KEY);
      expect(JSON.parse(saved.at(-1)!).calls.at(-1).status).toBe('reserved');
      const body = JSON.parse(String(options?.body));
      expect(body).toMatchObject({ model: 'deepseek/deepseek-v4.1-flash', max_tokens: 500 });
      sends++; return ok();
    }) as typeof fetch;
    await runPilot(input, ledger, save, env, fakeFetch);
    expect(sends).toBe(6);
    expect(saved.join('\n')).not.toContain(env.NANOGPT_API_KEY);
    expect(ledger.chargedMicroUsd).toBe(60);
    expect(ledger.calls.every((c) => c.status === 'finished')).toBe(true);
    await expect(runPilot(input, ledger, save, env, fakeFetch)).rejects.toThrow('already attempted');
    expect(sends).toBe(6);
  });

  it('rejects the next POST before its reservation would exceed USD 0.05', async () => {
    const { input, ledger, env } = setup(49999);
    let sends = 0; let saves = 0;
    const fakeFetch = (async () => { sends++; return ok(); }) as typeof fetch;
    await expect(runPilot(input, ledger, async () => { saves++; }, env, fakeFetch)).rejects.toThrow('Insufficient');
    expect(sends).toBe(0); expect(saves).toBe(0); expect(ledger.chargedMicroUsd).toBe(49999);
  });

  it('stops after one reported cost over the reservation instead of sending the other five', async () => {
    const { input, ledger, env } = setup();
    let sends = 0;
    const fakeFetch = (async () => { sends++; return new Response('data: {"usage":{"cost":0.051}}\n\ndata: [DONE]\n\n'); }) as typeof fetch;
    await expect(runPilot(input, ledger, async () => undefined, env, fakeFetch)).rejects.toThrow('stopped');
    expect(sends).toBe(1); expect(ledger.stopped).toBe(true); expect(ledger.chargedMicroUsd).toBe(51000);
  });

  it('keeps the maximum reservation on failure, suppresses error secrets and never retries', async () => {
    const { input, ledger, env } = setup();
    const saved: string[] = [];
    let sends = 0;
    const fakeFetch = (async () => { sends++; throw new Error(env.NANOGPT_API_KEY); }) as typeof fetch;
    await expect(runPilot(input, ledger, async (s) => { saved.push(JSON.stringify(s)); }, env, fakeFetch)).rejects.toThrow('Pilot stopped; no automatic retry');
    expect(sends).toBe(1); expect(ledger.stopped).toBe(true);
    expect(ledger.calls[0]).toMatchObject({ status: 'uncertain', costSource: 'highest-estimate', reportedUsd: 'desconocido' });
    expect(saved.join('')).not.toContain(env.NANOGPT_API_KEY);
  });
});
