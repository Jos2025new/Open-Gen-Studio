// Spike fixtures shaped like the real state (src/engine/types.ts: Session, Generation, SpendEntry, Asset;
// src/store/store.ts: partialize -> settings, spentUsd, spendLog, sessions, generations, assets, library, composer, ui).
// Deterministic: the same options always give the same bytes. Nothing here touches data/ or .sandbox/.

export const NS = 50; // sessions in the realistic fixture
const T0 = 1_700_000_000_000;

/** mulberry32: small seeded PRNG. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = 'luz sombra trazo capa color textura escena personaje fondo boceto render modelo prompt referencia escala tono contraste viento mar ciudad bosque noche lienzo mascara pincel'.split(' ');
const pick = (r, a) => a[Math.floor(r() * a.length)];
const words = (r, n) => Array.from({ length: n }, () => pick(r, WORDS)).join(' ');

export const sessionId = (j) => `ses_${j.toString(36).padStart(4, '0')}`;

/** One session (Session in types.ts). `v` is its version: content grows with it, never shrinks. */
export function makeSession(j, v, { items = 120 } = {}) {
  const r = rng(j * 1000003 + v * 7919 + 1);
  const feed = Array.from({ length: items + v }, (_, i) => ({
    id: `f_${i}`, kind: i % 2 ? 'assistant' : 'user', text: words(r, 40), at: T0 + i * 1000,
  }));
  return {
    id: sessionId(j), title: `Sesion ${j}`, titleLocked: false, createdAt: T0 + j, updatedAt: T0 + v * 1000,
    pinned: j % 7 === 0, feed,
    graph: { nodes: Array.from({ length: 3 + (v % 5) }, (_, i) => ({ id: `n_${i}`, type: 'image', params: { prompt: words(r, 8) } })), edges: [] },
    docs: [{ id: `doc_${j}`, name: 'Lienzo', layers: [{ id: `l_${j}`, name: 'Capa 1', visible: true, opacity: 1 }] }],
    activeDocId: `doc_${j}`,
    agent: { busy: false, messages: Array.from({ length: 4 }, () => ({ role: 'user', content: words(r, 30) })) },
    usage: { inputTokens: v * 1200, outputTokens: v * 300, llmUsd: v * 0.01 },
  };
}

/** Generation (types.ts Generation), trimmed to the fields that matter for size. */
export function makeGeneration(i, r, nSessions = NS) {
  return {
    id: `gen_${i}`, sessionId: sessionId(i % nSessions), kind: 'image', prompt: words(r, 12),
    modelRef: 'fal:flux-pro', modelName: 'FLUX Pro', provider: 'fal', settings: { aspect: '1:1', count: 1, seed: i },
    inputs: { refs: [`ast_${i}`] }, status: 'done', createdAt: T0 + i * 1000, finishedAt: T0 + i * 1000 + 4000, usd: 0.04,
  };
}

/** SpendEntry (types.ts). */
export const makeSpend = (i) => ({
  at: T0 + i * 1000, usd: 0.04, estimated: i % 9 === 0, category: 'image', provider: 'fal', model: 'fal:flux-pro', sessionId: sessionId(i % NS),
});

/** Asset (types.ts Asset). */
export function makeAsset(i, r) {
  return {
    id: `ast_${i}`, name: words(r, 2), kind: 'image', mime: 'image/png', width: 1024, height: 1024, sessionId: sessionId(i % NS),
    generationId: `gen_${i}`, origin: 'generated', mode: 'image', place: { x: i % 900, y: (i * 7) % 900, w: 512, h: 512 },
  };
}

/** Globals object of the state (everything except sessions). */
function globalsObject(parts) {
  const { generations, spendLog, assets, activeSessionId, tick = 0 } = parts;
  return {
    settings: { theme: 'dark', tick, keysMigrated: true, language: 'es' },
    spentUsd: spendLog.reduce((a, e) => a + e.usd, 0),
    spendLog, generations, assets, library: [],
    composer: { text: 'escena nocturna', refs: [] },
    ui: { panel: 'sessions', zoom: 1 },
    activeSessionId,
  };
}

/**
 * Big realistic state for the benchmark: NS sessions, `generations` generation rows, `spend` spend rows and
 * `assets` assets (their total is what matters for size). Returns the same parts a commit body carries.
 */
export function buildFixture({ sessions = NS, items = 120, generations = 40000, spend = 40000, assets = 20000, seed = 7, savedAt = T0 + 1000 } = {}) {
  const r = rng(seed);
  const gens = {};
  for (let i = 1; i <= generations; i++) gens[`gen_${i}`] = makeGeneration(i, r, sessions);
  const spendLog = Array.from({ length: spend }, (_, i) => makeSpend(i + 1));
  const assetMap = {};
  for (let i = 1; i <= assets; i++) assetMap[`ast_${i}`] = makeAsset(i, r);
  const globals = JSON.stringify(globalsObject({ generations: gens, spendLog, assets: assetMap, activeSessionId: sessionId(0) }));
  const order = [], texts = {};
  for (let j = 0; j < sessions; j++) {
    order.push(sessionId(j));
    texts[sessionId(j)] = JSON.stringify(makeSession(j, 1, { items }));
  }
  return { savedAt, baseAt: 0, version: 1, globals, order, sessions: texts };
}

// ---- Deterministic small state for the crash test: state(k) is a pure function of the step k. ----

export const S = (k) => T0 + k * 1000; // savedAt of step k
const SPEND_CAP = 300;
const GEN_CAP = 300;

/** Version of session j at step k: step 1 sends every session; step s > 1 changes session s % NS. */
export function lastChange(j, k) {
  for (let s = k; s >= 2; s--) if (s % NS === j) return s;
  return 1;
}

/** Expected state at step k as objects: { globals, sessions: { id: object } }. */
export function expectedState(k, { items = 16 } = {}) {
  const generations = {};
  for (let i = Math.max(1, k - GEN_CAP + 1); i <= k; i++) {
    generations[`gen_${i}`] = { ...makeGeneration(i, rng(i), NS), status: i < k ? 'done' : 'running' };
  }
  const spendLog = [];
  for (let i = Math.max(1, k - SPEND_CAP + 1); i <= k; i++) spendLog.push(makeSpend(i));
  const globals = globalsObject({ generations, spendLog, assets: {}, activeSessionId: sessionId(0), tick: k });
  const sessions = {};
  for (let j = 0; j < NS; j++) sessions[sessionId(j)] = makeSession(j, lastChange(j, k), { items });
  return { globals, sessions };
}

/** Commit body for step k (same shape as the app sends): all sessions at step 1, only the changed one after. */
export function stepBody(k, baseAt, { items = 16 } = {}) {
  const st = expectedState(k, { items });
  const order = Object.keys(st.sessions);
  const changed = k === 1 ? order : [sessionId(k % NS)];
  const sessions = Object.fromEntries(changed.map((id) => [id, JSON.stringify(st.sessions[id])]));
  return { savedAt: S(k), baseAt, version: 1, globals: JSON.stringify(st.globals), order, sessions };
}
