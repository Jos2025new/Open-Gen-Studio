import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

/*
 * Agent benchmark (R0 / R8 of PLAN_AGENT_ROUTE.md): fixed requests against the real LLM, only up to the plan.
 * It never generates media: the model catalog comes from the regression net (tests/fixtures/live) and every
 * request that is not the LLM's is blocked. Skipped unless BENCH_LLM_KEY is set; each run costs cents of tokens
 * and needs the user's permission.
 *
 *   BENCH_LLM_KEY=… [BENCH_LLM_PROVIDER=nanogpt|openrouter|atlas] [BENCH_LLM_MODEL=id] [BENCH_STYLE=guided|auto]
 *   [BENCH_IMAGE=bench/fixtures/character.jpg] npx vitest run tests/bench
 *
 * Results: bench/<date>-<commit>.json (per case: the agent metrics of each request, plans and questions shown).
 */

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
const IMAGE = process.env.BENCH_IMAGE ?? 'bench/fixtures/character.jpg';
vi.mock('../../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => new Blob([new Uint8Array(1)], { type: 'image/jpeg' }),
  putAssetBlob: async () => undefined,
}));
// No canvas in node: the attached image goes to the model as the file itself.
vi.mock('../../src/lib/media', async (orig) => {
  const { readFileSync: read } = await import('node:fs');
  const path = process.env.BENCH_IMAGE ?? 'bench/fixtures/character.jpg';
  const mime = path.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return {
    ...(await orig<typeof import('../../src/lib/media')>()),
    blobToCanvas: async () => ({ width: 768, height: 768 }),
    createCanvas: (w: number, h: number) => ({ width: w, height: h }),
    ctx2d: () => ({ drawImage: () => undefined }),
    canvasToBlob: async () => new Blob(['x'], { type: mime }),
    blobToDataUrl: async () => `data:${mime};base64,${read(path).toString('base64')}`,
  };
});

import { loadCatalogs, loadLlmCatalog } from '../../src/engine/catalog';
import { pickDefaultLlm } from '../../src/engine/providers/llm';
import { sendAgentMessage, submitAnswers } from '../../src/engine/agent/runtime';
import { useStore } from '../../src/store/store';
import type { LlmProviderId, QuestionsFeedItem, Workspace } from '../../src/engine/types';
import { serve } from '../fixtures/live/serve';

const KEY = process.env.BENCH_LLM_KEY;
const PROVIDER = (process.env.BENCH_LLM_PROVIDER ?? 'nanogpt') as LlmProviderId;
const STYLE = (process.env.BENCH_STYLE ?? 'guided') as 'guided' | 'auto';
const LLM_HOSTS = /(^|\.)(openrouter\.ai|nano-gpt\.com|atlascloud\.ai)$/;

interface Case {
  id: string;
  workspace?: Workspace;
  image?: boolean;
  /** First message, then follow-ups on the plan it produced. */
  turns: string[];
}

/** Fixed requests; the ids are the keys R8 compares. */
const CASES: Case[] = [
  { id: 'clear-image', turns: ['Una imagen de un gato astronauta flotando sobre la Tierra'] },
  { id: 'animate-vague', image: true, turns: ['Anima este personaje'] },
  { id: 'two-clips-named-model', image: true, turns: ['Haz dos clips de este personaje caminando por una ciudad de noche con Seedance 2.0 Fast'] },
  { id: 'change-model', image: true, turns: ['Haz dos clips de este personaje caminando por una ciudad de noche', 'Mejor usa MiniMax H3'] },
  { id: 'keep-first', image: true, turns: ['Haz dos clips de este personaje: uno saludando y otro saltando', 'Quédate solo con el primero'] },
  { id: 'product-portrait', turns: ['Retrato de producto de un perfume sobre mármol con luz suave'] },
  { id: 'designer-poster', workspace: 'designer', turns: ['Póster para un concierto de jazz, con título y fecha'] },
  { id: 'song', turns: ['Una canción corta de lo-fi para estudiar, instrumental'] },
  { id: 'model-3d-from-image', image: true, turns: ['Conviértelo en un modelo 3D'] },
];

/** Width and height from a PNG or JPEG header. */
function imageSize(buf: Uint8Array): { width: number; height: number } {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (v.getUint32(0) === 0x89504e47) return { width: v.getUint32(16), height: v.getUint32(20) };
  for (let i = 2; i + 9 < buf.length; ) {
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: v.getUint16(i + 5), width: v.getUint16(i + 7) };
    i += 2 + v.getUint16(i + 2);
  }
  return { width: 1024, height: 1024 };
}

const sid = () => useStore.getState().activeSessionId;
const feed = () => useStore.getState().sessions[sid()].feed;

async function runCase(c: Case) {
  const st = useStore.getState();
  const attachments: string[] = [];
  if (c.image) {
    const { width, height } = imageSize(readFileSync(IMAGE));
    const asset = { id: 'bench_img', kind: 'image' as const, mime: IMAGE.endsWith('.png') ? 'image/png' : 'image/jpeg', width, height, sessionId: sid(), origin: 'upload' as const, stored: true, favorite: false, createdAt: Date.now() };
    useStore.setState({ assets: { ...st.assets, bench_img: asset } });
    attachments.push('bench_img');
  }
  useStore.setState((s) => ({
    ui: { ...s.ui, workspace: c.workspace ?? 'chat' },
    sessions: { ...s.sessions, [sid()]: { ...s.sessions[sid()], feed: [], docs: [], activeDocId: null, agentMetrics: [], agent: { history: [], questionRound: 0, notes: [], busy: false } } },
  }));
  for (const [i, text] of c.turns.entries()) {
    useStore.setState((s) => ({ composer: { ...s.composer, agentStyle: STYLE, attachments: i === 0 ? attachments : [] } }));
    await sendAgentMessage(text);
    // Questions: take the first option of each (the user accepting what is offered), as many rounds as the app allows.
    for (let round = 0; round < 4; round++) {
      const q = feed().find((f): f is QuestionsFeedItem => f.type === 'questions' && f.status === 'pending');
      if (!q) break;
      await submitAnswers(sid(), q.id, Object.fromEntries(q.questions.map((x) => [x.id, x.options[0] ?? 'default'])));
    }
  }
  const s = useStore.getState().sessions[sid()];
  return {
    id: c.id,
    turns: c.turns,
    image: Boolean(c.image),
    metrics: s.agentMetrics ?? [],
    plans: s.feed.flatMap((f) => (f.type === 'plan' ? [{ title: f.plan.title, status: f.status, revised: Boolean(f.revised), estimateUsd: f.estimate.usd, steps: f.plan.steps.map((x) => ({ id: x.id, kind: x.kind, model: 'modelRef' in x ? x.modelRef : undefined, prompt: 'prompt' in x ? x.prompt : undefined })) }] : [])),
    questions: s.feed.flatMap((f) => (f.type === 'questions' ? f.questions.map((q) => q.question) : [])),
    replies: s.feed.flatMap((f) => (f.type === 'assistant' ? [f.text] : f.type === 'notice' ? [`[notice] ${f.text}`] : [])),
  };
}

describe.skipIf(!KEY)('agent bench (real LLM, plans only)', () => {
  it('runs the fixed requests and saves the metrics', async () => {
    vi.stubGlobal('location', { href: 'http://localhost/' });
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      let recorded: unknown;
      try {
        recorded = serve(url);
      } catch {
        recorded = undefined;
      }
      if (recorded !== undefined) return new Response(JSON.stringify(recorded));
      const { hostname, pathname } = new URL(url);
      if (LLM_HOSTS.test(hostname) && /\/(chat\/completions|models)$/.test(pathname)) return realFetch(url, init);
      throw new Error(`bench: blocked request to ${url} (no media is ever generated)`);
    });
    const st = useStore.getState();
    useStore.setState({ settings: { ...st.settings, keys: { ...st.settings.keys, atlas: 'bench', fal: 'bench', nanogpt: 'bench', [PROVIDER]: KEY! } } });
    await loadCatalogs();
    expect(Object.keys(useStore.getState().catalog.models).length, 'recorded catalog did not load').toBeGreaterThan(50);
    await loadLlmCatalog(PROVIDER);
    const model = process.env.BENCH_LLM_MODEL ?? pickDefaultLlm(useStore.getState().catalog.llm[PROVIDER] ?? []);
    expect(model, 'no agent model: set BENCH_LLM_MODEL').toBeTruthy();
    useStore.setState((s) => ({ settings: { ...s.settings, agent: { ...s.settings.agent, provider: PROVIDER, model: model! } } }));

    const hasImage = existsSync(IMAGE);
    const results = [];
    for (const c of CASES) {
      if (c.image && !hasImage) {
        results.push({ id: c.id, skipped: `no image at ${IMAGE}` });
        continue;
      }
      results.push(await runCase(c));
    }

    const commit = (() => {
      try {
        return execSync('git rev-parse --short HEAD').toString().trim();
      } catch {
        return 'unknown';
      }
    })();
    const date = new Date().toISOString().slice(0, 10);
    mkdirSync('bench', { recursive: true });
    const file = `bench/${date}-${commit}.json`;
    writeFileSync(file, JSON.stringify({ date, commit, provider: PROVIDER, model, style: STYLE, cases: results }, null, 2));
    console.table(
      results.map((r) => {
        if (!('metrics' in r)) return { case: r.id, skipped: r.skipped };
        const m = r.metrics;
        const sum = (k: 'llmCalls' | 'inputTokens' | 'outputTokens' | 'questionRounds' | 'revisions' | 'rejectedPlans' | 'findModels') => m.reduce((a, x) => a + x[k], 0);
        return {
          case: r.id,
          calls: sum('llmCalls'),
          tokensIn: sum('inputTokens'),
          tokensOut: sum('outputTokens'),
          sToPlan: m[0]?.msToPlan != null ? +(m[0].msToPlan / 1000).toFixed(1) : null,
          questions: sum('questionRounds'),
          revisions: sum('revisions'),
          rejected: sum('rejectedPlans'),
          findModels: sum('findModels'),
          models: [...new Set(m.flatMap((x) => x.models))].join(' '),
          usd: m.at(-1)?.lastEstimatedUsd ?? null,
        };
      }),
    );
    console.log(`Saved ${file}`);
  }, 20 * 60_000);
});
