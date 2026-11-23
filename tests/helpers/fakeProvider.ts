/*
 * Simulated provider & reload harness for the D+ money matrix (docs/diagnostico-dinero.md).
 * Counts paid POSTs by key, separates auxiliary non-billing POSTs/GETs, supports cutting
 * the connection AFTER provider acceptance and BEFORE response/jobId delivery, and simulates
 * full browser reloads from the last persisted state snapshot.
 */
import { vi } from 'vitest';
import { useStore } from '../../src/store/store';
import { clearSessionPasses } from '../../src/engine/budget';
import { setUntilNextGrant } from '../../src/engine/noAsk';
import { useAlerts } from '../../src/engine/alerts';
import { forgetBalances } from '../../src/engine/credit';
import { resetActions } from '../../src/engine/nodecore/action';
import { controllers, running } from '../../src/engine/jobState';

export const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export function pngBlob(): Blob {
  const ctor = (globalThis as unknown as { window?: { Blob?: typeof Blob } }).window?.Blob ?? Blob;
  return new ctor([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function imageResponse(opts: { cost?: number; count?: number } = {}): Response {
  const count = Math.max(1, opts.count ?? 1);
  const data = Array.from({ length: count }, () => ({ b64_json: PNG_B64 }));
  return jsonResponse({ data, ...(opts.cost !== undefined ? { cost: opts.cost } : {}) }, 200);
}

export function sseResponse(chunks: unknown[]): Response {
  const body = `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

export interface FakeIdbStore {
  lastRaw: string | undefined;
  onStateSet: ((raw: string) => void) | null;
  reset(): void;
  lastPersistedState(): unknown;
  mockModule(): Record<string, unknown>;
}

/** In-memory IndexedDB double capturing every `stateDb.set` write for reload simulation. */
export function createFakeIdb(): FakeIdbStore {
  const store: FakeIdbStore = {
    lastRaw: undefined,
    onStateSet: null,
    reset() {
      store.lastRaw = undefined;
      store.onStateSet = null;
    },
    lastPersistedState() {
      if (!store.lastRaw) return undefined;
      const parsed = JSON.parse(store.lastRaw) as { state?: unknown };
      return parsed.state ?? parsed;
    },
    mockModule() {
      return {
        stateDb: {
          get: async () => store.lastRaw,
          set: async (_name: string, val: string | { text?: () => string }) => {
            const raw = typeof val === 'string' ? val : val?.text?.();
            store.lastRaw = raw;
            if (raw) store.onStateSet?.(raw);
            return { ok: true };
          },
          del: async () => undefined,
        },
        cacheDb: { get: async () => undefined, set: async () => undefined },
        blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
        getAssetBlob: async () => pngBlob(),
        putAssetBlob: async () => undefined,
        deleteAssetBlobs: async () => undefined,
      };
    },
  };
  return store;
}

/** Captures the Zustand persisted slice synchronously (same shape written to IndexedDB). */
export function snapshotStore(): unknown {
  const { partialize } = useStore.persist.getOptions();
  return JSON.parse(JSON.stringify(partialize!(useStore.getState())));
}

export interface ReloadOptions {
  /** Session id whose in-memory budget passes are cleared on reload. */
  sessionId?: string;
  /** Explicit persisted state snapshot; defaults to `idb.lastPersistedState()` or `snapshotStore()`. */
  state?: unknown;
  /** Clear non-persisted model schemas (mergePersistedState.ts:7-10). */
  clearSchemas?: boolean;
  /** Clear non-persisted provider quotes (mergePersistedState.ts:7-10). */
  clearQuotes?: boolean;
  /** Clear non-persisted LLM catalog (mergePersistedState.ts:7-10). */
  clearLlmCatalog?: boolean;
}

/** Simulates a full browser reload from the last persisted snapshot, clearing all RAM-only state. */
export function simulateReload(idb: FakeIdbStore | null, opts: ReloadOptions = {}): void {
  const saved = opts.state ?? idb?.lastPersistedState() ?? snapshotStore();
  const sid = opts.sessionId ?? useStore.getState().activeSessionId;
  const { merge } = useStore.persist.getOptions();
  running.clear();
  controllers.clear();
  resetActions();
  clearSessionPasses(sid);
  setUntilNextGrant(null);
  forgetBalances();
  useAlerts.setState({ alerts: [] });
  const merged = merge!(saved as never, useStore.getState()) as ReturnType<typeof useStore.getState>;
  if (opts.clearSchemas) merged.catalog = { ...merged.catalog, schemas: {} };
  if (opts.clearLlmCatalog) merged.catalog = { ...merged.catalog, llm: {}, llmStatus: { openrouter: 'idle', nanogpt: 'idle', atlas: 'idle' } };
  if (opts.clearQuotes) merged.quotes = {};
  useStore.setState(merged as never, true);
}

export type PaidCallOutcome = 'accepted' | 'cut-after-accept' | 'rejected-402' | 'rejected-400' | 'rejected-retryable';

export interface FakeRequest {
  url: string;
  method: string;
  body: string;
  json: Record<string, unknown> | null;
  key: string;
  signal?: AbortSignal | null;
}

export interface PaidCallRecord {
  key: string;
  url: string;
  method: string;
  body: string;
  outcome: PaidCallOutcome;
  acceptedAt: number;
}

export type ScriptedAction =
  | 'cut-after-accept'
  | 'http-402'
  | 'http-400-reasoning'
  | 'atlas-upstream-denied'
  | ((req: FakeRequest) => Response | Promise<Response>);

export type RequestMatcher = string | RegExp | ((req: FakeRequest) => boolean);

export interface HeldPaidCall {
  arrived: Promise<PaidCallRecord>;
  resolve(res?: Response): void;
  cutAfterAccept(): void;
}

const AUX_POST_RE = /\/api\/(check-balance|transcribe\/status)|\/api\/v1\/model\/(uploadMedia|calculate)/i;
const PAID_POST_RE = /\/v1\/images|\/api\/generate-(video|audio)|\/api\/v1\/model\/generate(Image|Video|Audio)|\/chat\/completions/i;

function serializeBody(body: BodyInit | null | undefined): string {
  if (typeof body === 'string') return body;
  if (body instanceof FormData) {
    return [...body.entries()].map(([k, v]) => `${k}=${typeof v === 'string' ? v : '[file]'}`).join('&');
  }
  return '';
}

function tryJson(body: string): Record<string, unknown> | null {
  if (!body.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function defaultKeyOf(url: string, body: string, json: Record<string, unknown> | null): string {
  if (url.includes('/chat/completions')) {
    const model = typeof json?.model === 'string' ? json.model : 'llm';
    return `llm:${model}`;
  }
  if (typeof json?.prompt === 'string' && json.prompt.trim()) return `prompt:${json.prompt.trim()}`;
  const m = /(?:^|&)prompt=([^&]+)/.exec(body);
  if (m) return `prompt:${m[1]}`;
  if (typeof json?.model === 'string') return `model:${json.model}`;
  return url;
}

function matches(matcher: RequestMatcher, req: FakeRequest): boolean {
  if (typeof matcher === 'string') return req.url.includes(matcher) || req.body.includes(matcher) || req.key.includes(matcher);
  if (matcher instanceof RegExp) return matcher.test(req.url) || matcher.test(req.body) || matcher.test(req.key);
  return matcher(req);
}

export interface FakeProviderOptions {
  defaultImageCost?: number;
  defaultLlmCost?: number;
  balances?: Partial<Record<'nanogpt' | 'atlas' | 'openrouter', number>>;
  keyOf?: (req: { url: string; body: string; json: Record<string, unknown> | null }) => string;
}

export interface FakeProvider {
  readonly paidCalls: PaidCallRecord[];
  readonly auxCalls: Array<{ url: string; method: string }>;
  balances: Record<'nanogpt' | 'atlas' | 'openrouter', number>;
  install(): void;
  reset(): void;
  /** Paid POSTs accepted by the provider (includes `cut-after-accept`, excludes 402/400/retryable refusals). */
  acceptedCount(match?: RequestMatcher): number;
  /** Paid POSTs accepted under an exact key (e.g. `prompt:alpha mug`, `llm:paid-llm`). */
  countByKey(key: string): number;
  /** Map of key -> accepted paid POST count. */
  countsByKey(): Record<string, number>;
  /** All paid POST attempts (including 402 / 400 / Atlas upstream-denied refusals). */
  attemptCount(match?: RequestMatcher): number;
  /** Queue a one-shot scripted response or fault for the next matching paid POST. */
  onNext(match: RequestMatcher, action: ScriptedAction): void;
  /** Pause the next matching paid POST AFTER acceptance and BEFORE returning any response or remote jobId. */
  holdNext(match: RequestMatcher): HeldPaidCall;
  /** Optional observer called right as a paid POST hits the provider. */
  onPaidRequest: ((req: FakeRequest) => void) | null;
}

export function createFakeProvider(opts: FakeProviderOptions = {}): FakeProvider {
  const defaultImageCost = opts.defaultImageCost ?? 0.1;
  const defaultLlmCost = opts.defaultLlmCost ?? 0.01;
  const paidCalls: PaidCallRecord[] = [];
  const auxCalls: Array<{ url: string; method: string }> = [];
  const rules: Array<{ match: RequestMatcher; action: ScriptedAction }> = [];
  const holds: Array<{
    match: RequestMatcher;
    onArrive: (rec: PaidCallRecord, finish: (r: Response) => void, cut: () => void) => void;
  }> = [];
  const balances: Record<'nanogpt' | 'atlas' | 'openrouter', number> = {
    nanogpt: opts.balances?.nanogpt ?? 10,
    atlas: opts.balances?.atlas ?? 10,
    openrouter: opts.balances?.openrouter ?? 10,
  };
  let atlasJobSeq = 0;

  function defaultPaidResponse(req: FakeRequest): Response {
    if (req.url.includes('/api/v1/model/generate')) {
      const id = `atlas_job_${++atlasJobSeq}`;
      return jsonResponse({ data: { id, urls: { get: `https://api.atlascloud.ai/api/v1/model/prediction/${id}` } } });
    }
    if (req.url.includes('/chat/completions')) {
      return sseResponse([
        { choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 100, completion_tokens: 50, cost: defaultLlmCost } },
      ]);
    }
    const count = typeof req.json?.n === 'number' ? req.json.n : typeof req.json?.count === 'number' ? req.json.count : 1;
    return imageResponse({ cost: Math.round(defaultImageCost * count * 10000) / 10000, count });
  }

  function handleAux(url: string, method: string): Response {
    auxCalls.push({ url, method });
    if (url.includes('/public/v1/balance')) return jsonResponse({ available: { value: String(balances.atlas) } });
    if (url.includes('/api/check-balance')) return jsonResponse({ balance: String(balances.nanogpt) });
    if (url.includes('/api/v1/model/prediction/')) {
      return jsonResponse({ data: { status: 'completed', outputs: ['https://cdn.atlas.test/out.png'] } });
    }
    if (url.includes('cdn.atlas.test/')) {
      return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }
    if (url.includes('/api/v1/model/calculate')) return jsonResponse({ data: { price: defaultImageCost } });
    if (url.includes('/api/v1/model/uploadMedia')) return jsonResponse({ url: 'https://cdn.atlas.test/upload.png' });
    return jsonResponse({ data: [] });
  }

  const provider: FakeProvider = {
    paidCalls,
    auxCalls,
    balances,
    onPaidRequest: null,

    install() {
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        const body = serializeBody(init?.body);
        const isPaid = method === 'POST' && PAID_POST_RE.test(url) && !AUX_POST_RE.test(url);
        if (!isPaid) return handleAux(url, method);

        const json = tryJson(body);
        const key = opts.keyOf ? opts.keyOf({ url, body, json }) : defaultKeyOf(url, body, json);
        const req: FakeRequest = { url, method, body, json, key, signal: init?.signal };
        provider.onPaidRequest?.(req);

        const ruleIdx = rules.findIndex((r) => matches(r.match, req));
        if (ruleIdx >= 0) {
          const { action } = rules.splice(ruleIdx, 1)[0];
          if (action === 'cut-after-accept') {
            paidCalls.push({ key, url, method, body, outcome: 'cut-after-accept', acceptedAt: Date.now() });
            throw new TypeError('Failed to fetch');
          }
          if (action === 'http-402') {
            paidCalls.push({ key, url, method, body, outcome: 'rejected-402', acceptedAt: Date.now() });
            return jsonResponse({ error: { message: 'Insufficient credits' } }, 402);
          }
          if (action === 'http-400-reasoning') {
            paidCalls.push({ key, url, method, body, outcome: 'rejected-400', acceptedAt: Date.now() });
            return jsonResponse({ error: { message: 'Unsupported reasoning_effort parameter' } }, 400);
          }
          if (action === 'atlas-upstream-denied') {
            paidCalls.push({ key, url, method, body, outcome: 'rejected-retryable', acceptedAt: Date.now() });
            return jsonResponse({ error: 'Upstream access denied' }, 500);
          }
          paidCalls.push({ key, url, method, body, outcome: 'accepted', acceptedAt: Date.now() });
          return await action(req);
        }

        const holdIdx = holds.findIndex((h) => matches(h.match, req));
        if (holdIdx >= 0) {
          const { onArrive } = holds.splice(holdIdx, 1)[0];
          const rec: PaidCallRecord = { key, url, method, body, outcome: 'accepted', acceptedAt: Date.now() };
          paidCalls.push(rec);
          return new Promise<Response>((resolve, reject) => {
            const onAbort = () => {
              rec.outcome = 'cut-after-accept';
              reject(new DOMException('Aborted', 'AbortError'));
            };
            req.signal?.addEventListener('abort', onAbort, { once: true });
            onArrive(
              rec,
              (res) => {
                req.signal?.removeEventListener('abort', onAbort);
                resolve(res);
              },
              () => {
                req.signal?.removeEventListener('abort', onAbort);
                rec.outcome = 'cut-after-accept';
                reject(new TypeError('Failed to fetch'));
              },
            );
          });
        }

        paidCalls.push({ key, url, method, body, outcome: 'accepted', acceptedAt: Date.now() });
        return defaultPaidResponse(req);
      }));
    },

    reset() {
      paidCalls.length = 0;
      auxCalls.length = 0;
      rules.length = 0;
      holds.length = 0;
      atlasJobSeq = 0;
      provider.onPaidRequest = null;
      balances.nanogpt = opts.balances?.nanogpt ?? 10;
      balances.atlas = opts.balances?.atlas ?? 10;
      balances.openrouter = opts.balances?.openrouter ?? 10;
    },

    acceptedCount(match) {
      return paidCalls.filter((c) => {
        if (c.outcome !== 'accepted' && c.outcome !== 'cut-after-accept') return false;
        if (!match) return true;
        return matches(match, { url: c.url, method: c.method, body: c.body, json: tryJson(c.body), key: c.key });
      }).length;
    },

    countByKey(key) {
      return paidCalls.filter((c) => (c.outcome === 'accepted' || c.outcome === 'cut-after-accept') && c.key === key).length;
    },

    countsByKey() {
      const out: Record<string, number> = {};
      for (const c of paidCalls) {
        if (c.outcome !== 'accepted' && c.outcome !== 'cut-after-accept') continue;
        out[c.key] = (out[c.key] ?? 0) + 1;
      }
      return out;
    },

    attemptCount(match) {
      if (!match) return paidCalls.length;
      return paidCalls.filter((c) => matches(match, { url: c.url, method: c.method, body: c.body, json: tryJson(c.body), key: c.key })).length;
    },

    onNext(match, action) {
      rules.push({ match, action });
    },

    holdNext(match) {
      let resolveArrival!: (rec: PaidCallRecord) => void;
      let finishReq: ((r?: Response) => void) | null = null;
      let cutReq: (() => void) | null = null;
      let pendingRes: Response | undefined;
      let pendingCut = false;
      const arrived = new Promise<PaidCallRecord>((r) => { resolveArrival = r; });

      holds.push({
        match,
        onArrive(rec, finish, cut) {
          finishReq = (r) => finish(r ?? defaultPaidResponse({ url: rec.url, method: rec.method, body: rec.body, json: tryJson(rec.body), key: rec.key }));
          cutReq = cut;
          resolveArrival(rec);
          if (pendingCut) cut();
          else if (pendingRes) finish(pendingRes);
        },
      });

      return {
        arrived,
        resolve(res) {
          if (finishReq) finishReq(res);
          else pendingRes = res ?? imageResponse({ cost: defaultImageCost });
        },
        cutAfterAccept() {
          if (cutReq) cutReq();
          else pendingCut = true;
        },
      };
    },
  };

  return provider;
}
