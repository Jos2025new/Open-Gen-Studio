import { describe, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import expectedTxt from '../fixtures/live/expected.txt?raw';

/*
 * Audit (run on demand: AUDIT_OUT=<file> npx vitest run tests/audit): over the regression catalog, for every model
 * line of our families, (1) the same model + route on two providers must share one row (variantKey), and (2) the
 * routes the panel fills when the text variant is picked (lineRoutes). Writes a report; never fails the suite.
 */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { inIndex } from '../../src/engine/agent/modelIndex';
import { lineKey, variantKey, variantRoute } from '../../src/engine/variants';
import { lineRoutes } from '../../src/engine/catalog';
import { useStore } from '../../src/store/store';
import type { MediaKind, ModelSummary } from '../../src/engine/types';

function models(): ModelSummary[] {
  const out: ModelSummary[] = [];
  const missing = new Set<string>();
  let last = '';
  for (const line of expectedTxt.split('\n')) {
    const m = /^(\w+)::(\S+) \[(\w+)\] (.*)$/.exec(line);
    if (m) {
      const [, provider, id, kind, inputs] = m;
      last = provider + '::' + id;
      out.push({ ref: last, provider: provider as ModelSummary['provider'], id, name: id, kind: kind as MediaKind, acceptsText: /\btext\b/.test(inputs), acceptsImage: /\bimage\b/.test(inputs), acceptsVideo: /video-in/.test(inputs), needsVideo: /NEEDS-VIDEO/.test(inputs), tags: [] });
    } else if (/^\s+MISSING:/.test(line)) missing.add(last);
  }
  return out.filter((x) => inIndex(x, missing.has(x.ref) ? { ref: x.ref, params: [], slots: {}, missing: ['x'], source: 'catalog' } : undefined));
}

describe.skipIf(!process.env.AUDIT_OUT)('variant audit', () => {
  it('reports split rows and route coverage', () => {
    const all = models().filter((m) => m.kind === 'image' || m.kind === 'video');
    useStore.setState({ catalog: { ...useStore.getState().catalog, models: Object.fromEntries(all.map((m) => [m.ref, m])) } });
    const lines = new Map<string, ModelSummary[]>();
    for (const m of all) lines.set(lineKey(m), [...(lines.get(lineKey(m)) ?? []), m]);
    const split: string[] = [];
    const coverage: string[] = [];
    for (const [key, ms] of [...lines.entries()].sort()) {
      const providers = new Set(ms.map((m) => m.provider));
      // (1) same route on 2+ providers: one variantKey expected.
      const byRoute = new Map<string, ModelSummary[]>();
      for (const m of ms) byRoute.set(variantRoute(m), [...(byRoute.get(variantRoute(m)) ?? []), m]);
      for (const [route, rs] of byRoute) {
        const provs = new Set(rs.map((m) => m.provider));
        if (provs.size < 2) continue;
        const keys = new Map<string, string[]>();
        for (const m of rs) keys.set(variantKey(m), [...(keys.get(variantKey(m)) ?? []), m.ref]);
        // Several keys can be legit (Pro vs Fast inside one key is not, tiers differ in lineKey already); report when a provider's key is alone.
        if (keys.size > 1) {
          const perProv = [...keys.values()].map((refs) => new Set(refs.map((r) => r.split('::')[0])).size);
          if (perProv.some((n) => n === 1) && [...keys.values()].every((refs) => new Set(refs.map((r) => r.split('::')[0])).size < provs.size)) split.push(key + ' [' + route + ']\n    ' + [...keys.entries()].map(([k, refs]) => k + ' ← ' + refs.join(', ')).join('\n    '));
        }
      }
      // (2) routes filled from each provider's text variant (video lines only; image: edit twin).
      for (const p of providers) {
        const text = ms.find((m) => m.provider === p && variantRoute(m) === 'text');
        if (!text) continue;
        const r = lineRoutes(text.ref);
        const want = text.kind === 'video' ? ['text', 'image', 'reference'] : ['text', 'edit'];
        const has = ms.filter((m) => m.provider === p).map((m) => variantRoute(m)).concat(text.kind === 'video' && text.acceptsImage ? ['image'] : []);
        const missingFill = want.filter((w) => has.includes(w as never) && !(r as Record<string, string>)[w]);
        coverage.push((missingFill.length ? 'MISSING FILL ' : 'ok ') + text.ref + ' → ' + JSON.stringify(r) + (missingFill.length ? '  (exists but not filled: ' + missingFill.join(', ') + ')' : ''));
      }
    }
    const report = ['# Variant audit (' + all.length + ' image/video models, ' + lines.size + ' lines)', '', '## Same model+route split across providers: ' + split.length, ...split, '', '## Route fill from the text variant (per provider): ' + coverage.filter((c) => c.startsWith('MISSING')).length + ' missing', ...coverage.filter((c) => c.startsWith('MISSING')), '', '## All fills', ...coverage].join('\n');
    writeFileSync(process.env.AUDIT_OUT!, report);
  });
});
