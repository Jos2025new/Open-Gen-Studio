// @ts-nocheck -- Node fs in a test; the project has no @types/node (see tests/bench/node.d.ts).
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/*
 * The automatic twin of the reference runs (e2e/BROWSER_TESTS.md, e2e/REFERENCE_RUNS.md): the same scenarios and the
 * same answers to every card, with the app's real engine and the real agent LLM (DeepSeek V4.1 Flash on NanoGPT),
 * but no browser and no media: generations finish at once with placeholder results. Costs cents of agent tokens.
 * What differs from a browser run is what this simulation does not see (provider errors, reloads, tabs, the UI).
 *
 *   TWIN=1 [TWIN_ONLY=S1,S4] [E2E_OUT=e2e-runs/<date>-twin] npx vitest run tests/e2e/twin.test.ts
 *
 * Writes <out>/state.json (sessions and generations, no settings or keys), then the usual report reads it:
 *   E2E_REPORT=1 E2E_STATE=<out>/state.json E2E_OUT=<out> npx vitest run tests/e2e/browser-report.test.ts
 * and tests/e2e/compare.test.ts puts it beside a browser run.
 */

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
const IMAGE = 'bench/fixtures/character.png';
vi.mock('../../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined, adoptDisk: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => new Blob([new Uint8Array(1)], { type: 'image/png' }),
  putAssetBlob: async () => undefined,
}));
vi.mock('../../src/lib/media', async (orig) => {
  const { readFileSync: read } = await import('node:fs');
  return {
    ...(await orig<typeof import('../../src/lib/media')>()),
    blobToCanvas: async () => ({ width: 768, height: 768 }),
    createCanvas: (w: number, h: number) => ({ width: w, height: h }),
    ctx2d: () => ({ drawImage: () => undefined }),
    canvasToBlob: async () => new Blob(['x'], { type: 'image/png' }),
    blobToDataUrl: async () => `data:image/png;base64,${read('bench/fixtures/character.png').toString('base64')}`,
  };
});
// Media is never generated: each generation finishes after a short wait with placeholder results of the asked shape.
vi.mock('../../src/engine/jobs', async (orig) => {
  const real = await orig<typeof import('../../src/engine/jobs')>();
  const { useStore } = await import('../../src/store/store');
  const run = async (id: string): Promise<string[]> => {
    const g = useStore.getState().generations[id];
    useStore.setState((st) => ({ generations: { ...st.generations, [id]: { ...g, status: 'running', startedAt: Date.now() } } }));
    await new Promise((r) => setTimeout(r, 50));
    const n = g.variants?.length || g.settings.count || 1;
    const [w, h] = /9:16/.test(String(g.settings.aspect)) ? [576, 1024] : /16:9/.test(String(g.settings.aspect)) ? [1024, 576] : [1024, 1024];
    const ids = Array.from({ length: n }, (_, i) => `ast_twin_${id}_${i}`);
    useStore.setState((st) => ({
      assets: { ...st.assets, ...Object.fromEntries(ids.map((a) => [a, { id: a, kind: g.kind === 'video' ? 'video' : 'image', mime: g.kind === 'video' ? 'video/mp4' : 'image/png', width: w, height: h, duration: g.kind === 'video' ? g.settings.duration : undefined, sessionId: g.sessionId, origin: 'generated', stored: true, favorite: false, createdAt: Date.now() }])) },
      generations: { ...st.generations, [id]: { ...st.generations[id], status: 'done', assetIds: ids, finishedAt: Date.now(), actualUsd: g.estimate?.usd } },
    }));
    return ids;
  };
  return { ...real, runGeneration: run, retryGeneration: run, recheckGeneration: run };
});

import { loadCatalogs, loadLlmCatalog, ensureSchema } from '../../src/engine/catalog';
import { approvePlan, confirmSettings, sendAgentMessage, submitAnswers } from '../../src/engine/agent/runtime';
import { choiceEstimate, defaultChoice, sectionsOf } from '../../src/engine/agent/settingsCard';
import { settingsOptions } from '../../src/engine/agent/settingsCard';
import { useStore } from '../../src/store/store';
import type { PlanFeedItem, QuestionsFeedItem, SettingsChoice, SettingsFeedItem, SettingsSection } from '../../src/engine/types';
import { serve } from '../fixtures/live/serve';

const MODEL = process.env.TWIN_MODEL ?? 'deepseek/deepseek-v4.1-flash';
const LLM_HOSTS = /(^|\.)nano-gpt\.com$/;

/** The answers e2e/BROWSER_TESTS.md gives. A question without a rule takes the recommended option. */
interface Step {
  say: string;
  attach?: boolean;
  /** Option picked per question when its text matches. */
  answers?: Array<[RegExp, RegExp]>;
  images?: number;
  /** Written while the plan waits, before Run (the plan must keep waiting). */
  comment?: string;
}
const SCENARIOS: Record<string, Step[]> = {
  S1: [
    { say: 'Crea una chica para vender una corneta bluetooth', answers: [[/corneta|producto|altavoz/i, /invent/i], [/empez|etapa|arranc|cómo/i, /ficha|hoja|opciones.*prueba|prueba/i]], images: 2 },
    { say: 'La 1 de la chica y la 1 de la corneta. Haz la prueba corta del vídeo.' },
    { say: 'Ahora haz a la chica en un sofá', images: 1, comment: '¿Por qué usas ese modelo?' },
  ],
  S2: [{ say: 'Haz una hoja de personaje de ella con 2 opciones para elegir', attach: true, images: 2 }],
  S3: [{ say: 'Anima a este personaje caminando hacia la cámara', attach: true }],
  S4: [{ say: 'Un retrato de producto de un perfume sobre mármol con luz suave', images: 1 }],
};

const sid = () => useStore.getState().activeSessionId;
const feed = () => useStore.getState().sessions[sid()].feed;
const name = (ref: string) => useStore.getState().catalog.models[ref]?.name ?? ref;

/** The settings-card rule of the guide: cheapest Nano Banana at the lowest resolution; video the cheapest Seedance 2.0 Mini or H3 Developer at 480p, 5 s. */
async function pick(x: SettingsSection, images?: number): Promise<SettingsChoice> {
  const refs = [x.recommended.modelRef, ...x.alternatives];
  for (const r of refs) await ensureSchema(r);
  const schemas = useStore.getState().catalog.schemas;
  const want = x.kind === 'image' ? /nano banana/i : /seedance 2\.0 mini|h3[- ]developer/i;
  const req = { kind: x.kind, startImage: x.recommended.needsImage, duration: 5, aspect: x.recommended.aspect };
  const choices = refs.filter((r) => want.test(name(r))).map((r) => {
    const c = { ...defaultChoice(r, schemas[r], req, x.recommended), needsImage: x.recommended.needsImage };
    const o = settingsOptions(schemas[r], x.kind);
    const low = x.kind === 'video' ? o.resolutions.find((v) => /480/.test(v)) : o.resolutions.find((v) => /^1k$/i.test(v)) ?? o.resolutions[0];
    return { ...c, resolution: low ?? c.resolution, ...(x.kind === 'video' ? { duration: 5 } : { count: images ?? c.count }) };
  });
  if (!choices.length) return { ...x.recommended, ...(x.kind === 'image' && images ? { count: images } : {}) };
  return choices.sort((a, b) => (choiceEstimate(a, x.kind, 1).usd ?? 1e9) - (choiceEstimate(b, x.kind, 1).usd ?? 1e9))[0];
}

/** Answer whatever card is open until a plan waits (or nothing is left), like the tester does. */
async function drive(step: Step): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const q = feed().find((f): f is QuestionsFeedItem => f.type === 'questions' && f.status === 'pending');
    if (q) {
      const answers = Object.fromEntries(q.questions.map((x) => {
        const rule = step.answers?.find(([qq]) => qq.test(x.question));
        const opt = rule ? x.options.find((o) => rule[1].test(o)) : undefined;
        return [x.id, opt ?? x.default ?? x.options[0] ?? 'default'];
      }));
      await submitAnswers(sid(), q.id, answers);
      continue;
    }
    const s = feed().find((f): f is SettingsFeedItem => f.type === 'settings' && f.status === 'pending');
    if (s) {
      const chosen = [];
      for (const x of sectionsOf(s)) chosen.push(await pick(x, step.images));
      await confirmSettings(sid(), s.id, chosen);
      continue;
    }
    const p = feed().find((f): f is PlanFeedItem => f.type === 'plan' && f.status === 'awaiting');
    if (p) {
      if (step.comment) {
        await sendAgentMessage(step.comment);
        step = { ...step, comment: undefined };
        continue;
      }
      // The guide's brakes: a plan above $0.60 is canceled (here nothing is charged, but the run stays comparable).
      if ((p.estimate.usd ?? 0) > 0.6) return;
      await approvePlan(sid(), p.id);
      // The closing message runs after the plan; wait for the agent to be free.
      await vi.waitFor(() => expect(useStore.getState().sessions[sid()].agent.busy).toBe(false), { timeout: 180_000, interval: 250 });
      return;
    }
    return;
  }
}

describe.skipIf(!process.env.TWIN)('twin of the reference runs (real agent LLM, no media)', () => {
  it('runs the scenarios and saves sessions for the report', async () => {
    // The user's NanoGPT key, read from the app's saved state and never printed.
    const key = (JSON.parse(readFileSync('data/state.json').toString('utf8')).state?.settings?.keys?.nanogpt as string | undefined)?.trim();
    expect(key, 'no NanoGPT key in data/state.json').toBeTruthy();
    vi.stubGlobal('location', { href: 'http://localhost/' });
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      let recorded: unknown;
      try { recorded = serve(url); } catch { recorded = undefined; }
      if (recorded !== undefined) return new Response(JSON.stringify(recorded));
      const { hostname, pathname } = new URL(url, 'http://localhost/');
      if (LLM_HOSTS.test(hostname) && /\/(chat\/completions|models)$/.test(pathname)) return realFetch(url, init);
      // Atlas quotes and anything else: refused (the estimate stays the catalog's).
      return new Response('{}', { status: 503 });
    });
    const st = useStore.getState();
    useStore.setState({ settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'twin', fal: 'twin', nanogpt: key! } } });
    await loadCatalogs({ preferRemote: true });
    expect(Object.keys(useStore.getState().catalog.models).length).toBeGreaterThan(50);
    await loadLlmCatalog('nanogpt');
    useStore.setState((s) => ({ settings: { ...s.settings, agent: { ...s.settings.agent, provider: 'nanogpt', model: MODEL, tier: 'normal' } } }));

    const only = process.env.TWIN_ONLY?.split(',');
    const sessionIds: string[] = [];
    const t0 = Date.now();
    for (const [id, steps] of Object.entries(SCENARIOS)) {
      if (only && !only.includes(id)) continue;
      // A new session per scenario, chat canvas, Agent + Auto (the guide's preparation).
      const sesId = `ses_twin_${id.toLowerCase()}_${t0}`;
      useStore.setState((s) => ({
        activeSessionId: sesId,
        ui: { ...s.ui, workspace: 'chat' },
        sessions: { ...s.sessions, [sesId]: { ...s.sessions[s.activeSessionId], id: sesId, title: steps[0].say, createdAt: Date.now(), feed: [], docs: [], activeDocId: null, agentMetrics: [], subjects: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
      }));
      sessionIds.push(sesId);
      for (const step of steps) {
        const attachments: string[] = [];
        if (step.attach) {
          const buf = readFileSync(IMAGE);
          const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
          const asset = { id: `twin_img_${id}`, kind: 'image' as const, mime: 'image/png', width: dv.getUint32(16), height: dv.getUint32(20), sessionId: sesId, origin: 'upload' as const, stored: true, favorite: false, createdAt: Date.now() };
          useStore.setState((s) => ({ assets: { ...s.assets, [asset.id]: asset } }));
          attachments.push(asset.id);
        }
        useStore.setState((s) => ({ composer: { ...s.composer, agentStyle: 'auto', attachments } }));
        await sendAgentMessage(step.say);
        await drive(step);
      }
    }

    const out = process.env.E2E_OUT ?? join('e2e-runs', `${new Date().toISOString().slice(0, 16).replace(':', '')}-twin`);
    mkdirSync(out, { recursive: true });
    const s = useStore.getState();
    const sessions = Object.fromEntries(sessionIds.map((x) => [x, s.sessions[x]]));
    const generations = Object.fromEntries(Object.entries(s.generations).filter(([, g]) => sessionIds.includes(g.sessionId)));
    const commit = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'unknown'; } })();
    writeFileSync(join(out, 'state.json'), JSON.stringify({ state: { sessions, generations }, twin: { model: MODEL, commit, at: new Date(t0).toISOString() } }));
    console.log(`Twin: ${sessionIds.length} sessions in ${Math.round((Date.now() - t0) / 1000)} s → ${out}/state.json`);
  }, 40 * 60_000);
});
