import { describe, expect, it } from 'vitest';
import { extractBaseline, readSandboxBaseline, statistics } from '../scripts/agent-baseline.mjs';

describe('read-only baseline', () => {
  it('computes median, nearest-rank p90 and >30s using only known samples', () => {
    expect(statistics([10_000, 20_000, 30_000, 40_000, undefined], true)).toEqual({
      conocidas: 4, desconocidas: 1, mediana: 25_000, p90: 40_000, porcentajeMayor30s: 25,
    });
    expect(statistics([], true).mediana).toBe('desconocido');
  });
  it('exports only numeric telemetry and preserves unknowns instead of guessing session type', () => {
    const result = extractBaseline({ state: { settings: { apiKey: 'private-value' }, sessions: {
      secretId: { feed: [{ text: 'private-text' }], agentMetrics: [{
        request: 'private-request', engine: 'deepseek-v3 · NanoGPT', llmCalls: 2,
        callTimings: [{ cachedTokens: 100 }], msToFirstOutput: 123,
      }] },
    } } });
    expect(result.peticiones[0]).toMatchObject({ modelo: 'DeepSeek', tipo: 'desconocido', cachedTokens: 'desconocido',
      primeraSalidaMs: 123, primerTextoVisibleMs: 'desconocido', respuestaTerminadaMs: 'desconocido', costeLlmUsd: 'desconocido' });
    expect(JSON.stringify(result)).not.toMatch(/private-|secretId/);
  });
  it('sums cache only when all calls have a sample and a known value', () => {
    const result = extractBaseline({ sessions: { s: { agentMetrics: [{ engine: 'gpt-6-luna · NanoGPT',
      llmCalls: 2, callTimings: [{ cachedTokens: 0 }, { cachedTokens: 200 }] }] } } });
    expect(result.peticiones[0]).toMatchObject({ modelo: 'GPT Luna', cachedTokens: 200 });
  });
  it('rejects real data before any file access', async () => {
    await expect(readSandboxBaseline('/nonexistent-worktree', 'data/state.json')).rejects.toThrow('Solo se permite');
    await expect(readSandboxBaseline('/nonexistent-worktree', '.sandbox/data/backups/state.json')).rejects.toThrow('Solo se permite');
  });
});
