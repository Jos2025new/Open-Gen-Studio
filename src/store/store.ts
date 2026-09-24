import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { uid } from '../lib/id';
import { stateDb } from '../lib/idb';
import { LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from '../engine/providers/demo';
import type { AgentTier, LlmModel } from '../engine/providers/llm';
import type { DesignTool } from '../engine/design/rules';
import { DEFAULT_TEXT_STYLE } from '../engine/design/doc';
import type {
  AgentStyle,
  Asset,
  ComposerMode,
  DesignDoc,
  FeedItem,
  GenSettings,
  Generation,
  Graph,
  LlmProviderId,
  MediaKind,
  ModelSchema,
  ModelSummary,
  ProviderId,
  RemoteProviderId,
  Session,
  TextStyle,
  Workspace,
} from '../engine/types';

// ---------------------------------------------------------------------------
// State shape

export interface Settings {
  keys: Record<RemoteProviderId, string>;
  agent: { provider: LlmProviderId | 'offline'; model: string; tier: AgentTier; effort: 'low' | 'medium' | 'high' };
  guidedRounds: number;
  budgetUsd: number;
  ops: { edit: string | null; upscale: string | null; removeBg: string | null; video: string | null; videoUpscale: string | null; videoEdit: string | null };
}

export interface ComposerState {
  mode: ComposerMode;
  agentStyle: AgentStyle;
  skillId: string | null;
  workflowId: string | null;
  text: string;
  image: { modelRef: string; settings: GenSettings };
  video: { modelRef: string; settings: GenSettings };
  attachments: string[];
  editing: { generationId: string } | null;
  designerTarget: 'new' | 'replace';
}

export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CatalogState {
  models: Record<string, ModelSummary>;
  schemas: Record<string, ModelSchema>;
  status: Record<ProviderId, CatalogStatus>;
  errors: Partial<Record<ProviderId, string>>;
  llm: Partial<Record<LlmProviderId, LlmModel[]>>;
  llmStatus: Partial<Record<LlmProviderId, CatalogStatus>>;
}

export interface Toast {
  id: string;
  text: string;
  level: 'info' | 'error' | 'success';
}

export interface UiState {
  workspace: Workspace;
  panel: 'gallery' | 'sessions' | null;
  panelExpanded: boolean;
  lightbox: { assetIds: string[]; index: number } | null;
  /** Sketch editor over a node's image; saving sets that node's painted-over copy. */
  sketch: { assetId: string; nodeId: string } | null;
  toasts: Toast[];
  tool: DesignTool;
  brush: { size: number; color: string; opacity: number };
  shape: { fill: string | null; stroke: string | null; strokeWidth: number; radius: number };
  text: TextStyle;
  threadOpen: boolean;
  settingsOpen: boolean;
  focusComposer: number;
}

export interface AppState {
  hydrated: boolean;
  settings: Settings;
  spentUsd: number;
  sessions: Record<string, Session>;
  activeSessionId: string;
  generations: Record<string, Generation>;
  assets: Record<string, Asset>;
  composer: ComposerState;
  catalog: CatalogState;
  ui: UiState;
}

// ---------------------------------------------------------------------------
// Defaults

export function emptyGraph(): Graph {
  return { nodes: [], edges: [] };
}

export function createSession(title = 'Untitled session'): Session {
  const now = Date.now();
  return {
    id: uid('ses'),
    title,
    titleLocked: false,
    createdAt: now,
    updatedAt: now,
    pinned: false,
    feed: [],
    graph: emptyGraph(),
    docs: [],
    activeDocId: null,
    agent: { history: [], questionRound: 0, notes: [], busy: false },
    usage: { inputTokens: 0, outputTokens: 0, llmUsd: 0 },
  };
}

const firstSession = createSession();

export const DEFAULT_SETTINGS: Settings = {
  keys: { openrouter: '', fal: '', nanogpt: '', atlas: '' },
  agent: { provider: 'offline', model: '', tier: 'normal', effort: 'medium' },
  guidedRounds: 2,
  budgetUsd: 25,
  ops: { edit: null, upscale: null, removeBg: null, video: null, videoUpscale: null, videoEdit: null },
};

const initial: AppState = {
  hydrated: false,
  settings: DEFAULT_SETTINGS,
  spentUsd: 0,
  sessions: { [firstSession.id]: firstSession },
  activeSessionId: firstSession.id,
  generations: {},
  assets: {},
  composer: {
    mode: 'agent',
    agentStyle: 'auto',
    skillId: null,
    workflowId: null,
    text: '',
    image: { modelRef: LOCAL_IMAGE_REF, settings: { aspect: '1:1', resolution: '1K', count: 1, advanced: {} } },
    video: { modelRef: LOCAL_VIDEO_REF, settings: { aspect: '16:9', resolution: '720p', duration: 5, count: 1, advanced: {} } },
    attachments: [],
    editing: null,
    designerTarget: 'new',
  },
  catalog: {
    models: {},
    schemas: {},
    status: { local: 'idle', openrouter: 'idle', fal: 'idle', nanogpt: 'idle', atlas: 'idle' },
    errors: {},
    llm: {},
    llmStatus: {},
  },
  ui: {
    workspace: 'chat',
    panel: null,
    panelExpanded: false,
    lightbox: null,
    sketch: null,
    toasts: [],
    tool: 'move',
    brush: { size: 24, color: '#ffffff', opacity: 1 },
    shape: { fill: '#d4f25a', stroke: null, strokeWidth: 4, radius: 0 },
    text: { ...DEFAULT_TEXT_STYLE },
    threadOpen: false,
    settingsOpen: false,
    focusComposer: 0,
  },
};

// ---------------------------------------------------------------------------
// Persistence (IndexedDB, debounced)

let writeTimer: number | undefined;
let pendingWrite: { name: string; value: string } | null = null;
let wiping = false;

function flushWrite(): void {
  if (!pendingWrite || wiping) return;
  const { name, value } = pendingWrite;
  pendingWrite = null;
  stateDb.set(name, value).catch((err) => console.error('Could not save state', err));
}

const idbStorage: StateStorage = {
  getItem: async (name) => (await stateDb.get(name)) ?? null,
  setItem: (name, value) => {
    if (wiping) return;
    pendingWrite = { name, value };
    window.clearTimeout(writeTimer);
    writeTimer = window.setTimeout(flushWrite, 350);
  },
  removeItem: (name) => stateDb.del(name),
};

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushWrite);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushWrite();
  });
}

type Persisted = Pick<AppState, 'settings' | 'spentUsd' | 'sessions' | 'activeSessionId' | 'generations' | 'assets'> & {
  composer: Omit<ComposerState, 'editing'>;
  ui: Pick<UiState, 'workspace' | 'brush' | 'shape' | 'text' | 'tool'>;
};

export const useStore = create<AppState>()(
  persist(() => initial, {
    name: 'ogs-app',
    version: 1,
    storage: createJSONStorage(() => idbStorage),
    partialize: (s): Persisted => ({
      settings: s.settings,
      spentUsd: s.spentUsd,
      sessions: s.sessions,
      activeSessionId: s.activeSessionId,
      generations: s.generations,
      assets: s.assets,
      composer: { ...s.composer, editing: undefined } as Omit<ComposerState, 'editing'>,
      ui: { workspace: s.ui.workspace, brush: s.ui.brush, shape: s.ui.shape, text: s.ui.text, tool: s.ui.tool },
    }),
    merge: (persisted, current) => {
      const p = (persisted ?? {}) as Partial<Persisted>;
      const restored = p.sessions && Object.keys(p.sessions).length ? p.sessions : current.sessions;
      // A reload interrupts any agent call in flight.
      const sessions = Object.fromEntries(Object.entries(restored).map(([id, s]) => [id, { ...s, agent: { ...s.agent, busy: false } }]));
      const activeSessionId = p.activeSessionId && sessions[p.activeSessionId] ? p.activeSessionId : Object.keys(sessions)[0];
      return {
        ...current,
        settings: {
          ...DEFAULT_SETTINGS,
          ...p.settings,
          keys: { ...DEFAULT_SETTINGS.keys, ...p.settings?.keys },
          agent: { ...DEFAULT_SETTINGS.agent, ...p.settings?.agent },
          ops: { ...DEFAULT_SETTINGS.ops, ...p.settings?.ops },
        },
        spentUsd: p.spentUsd ?? 0,
        sessions,
        activeSessionId,
        generations: p.generations ?? {},
        assets: p.assets ?? {},
        composer: { ...current.composer, ...p.composer, editing: null },
        ui: { ...current.ui, ...p.ui },
      };
    },
    onRehydrateStorage: () => (_state, error) => {
      if (error) console.error('State restore failed', error);
      useStore.setState({ hydrated: true });
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutators

const set = useStore.setState;
const get = useStore.getState;

export function activeSession(): Session {
  const s = get();
  return s.sessions[s.activeSessionId];
}

export function patchSession(id: string, fn: (s: Session) => Session): void {
  set((st) => {
    const cur = st.sessions[id];
    if (!cur) return {};
    return { sessions: { ...st.sessions, [id]: { ...fn(cur), updatedAt: Date.now() } } };
  });
}

export function appendFeed(sessionId: string, item: FeedItem): void {
  patchSession(sessionId, (s) => ({ ...s, feed: [...s.feed, item] }));
}

export function updateFeedItem<T extends FeedItem>(sessionId: string, itemId: string, patch: Partial<T> | ((item: T) => T)): void {
  patchSession(sessionId, (s) => ({
    ...s,
    feed: s.feed.map((f) => (f.id === itemId ? (typeof patch === 'function' ? patch(f as T) : ({ ...f, ...patch } as FeedItem)) : f)),
  }));
}

export function removeFeedItem(sessionId: string, itemId: string): void {
  patchSession(sessionId, (s) => ({ ...s, feed: s.feed.filter((f) => f.id !== itemId) }));
}

export function upsertGeneration(g: Generation): void {
  set((st) => ({ generations: { ...st.generations, [g.id]: g } }));
}

export function patchGeneration(id: string, patch: Partial<Generation>): void {
  set((st) => {
    const cur = st.generations[id];
    if (!cur) return {};
    return { generations: { ...st.generations, [id]: { ...cur, ...patch } } };
  });
}

export function addAssets(assets: Asset[]): void {
  set((st) => {
    const next = { ...st.assets };
    for (const a of assets) next[a.id] = a;
    return { assets: next };
  });
}

export function patchAsset(id: string, patch: Partial<Asset>): void {
  set((st) => (st.assets[id] ? { assets: { ...st.assets, [id]: { ...st.assets[id], ...patch } } } : {}));
}

export function setGraph(sessionId: string, fn: (g: Graph) => Graph): void {
  patchSession(sessionId, (s) => ({ ...s, graph: fn(s.graph) }));
}

export function setDoc(sessionId: string, docId: string, fn: (d: DesignDoc) => DesignDoc): void {
  patchSession(sessionId, (s) => ({ ...s, docs: s.docs.map((d) => (d.id === docId ? fn(d) : d)) }));
}

export function setComposer(patch: Partial<ComposerState> | ((c: ComposerState) => Partial<ComposerState>)): void {
  set((st) => ({ composer: { ...st.composer, ...(typeof patch === 'function' ? patch(st.composer) : patch) } }));
}

export function setComposerMedia(kind: MediaKind, patch: Partial<ComposerState['image']>): void {
  set((st) => ({ composer: { ...st.composer, [kind]: { ...st.composer[kind], ...patch } } }));
}

export function setUi(patch: Partial<UiState> | ((u: UiState) => Partial<UiState>)): void {
  set((st) => ({ ui: { ...st.ui, ...(typeof patch === 'function' ? patch(st.ui) : patch) } }));
}

export function setSettings(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)): void {
  set((st) => ({ settings: { ...st.settings, ...(typeof patch === 'function' ? patch(st.settings) : patch) } }));
}

export function setCatalog(patch: Partial<CatalogState> | ((c: CatalogState) => Partial<CatalogState>)): void {
  set((st) => ({ catalog: { ...st.catalog, ...(typeof patch === 'function' ? patch(st.catalog) : patch) } }));
}

export function addSpend(usd: number): void {
  if (!Number.isFinite(usd) || usd <= 0) return;
  set((st) => ({ spentUsd: Math.round((st.spentUsd + usd) * 10000) / 10000 }));
}

export function toast(text: string, level: Toast['level'] = 'info'): void {
  const id = uid('tst');
  set((st) => ({ ui: { ...st.ui, toasts: [...st.ui.toasts.slice(-3), { id, text, level }] } }));
  window.setTimeout(() => dismissToast(id), level === 'error' ? 6500 : 3200);
}

export function dismissToast(id: string): void {
  set((st) => ({ ui: { ...st.ui, toasts: st.ui.toasts.filter((t) => t.id !== id) } }));
}

// ---------------------------------------------------------------------------
// Sessions

export function newSession(): string {
  const s = createSession();
  set((st) => ({ sessions: { ...st.sessions, [s.id]: s }, activeSessionId: s.id }));
  return s.id;
}

export function selectSession(id: string): void {
  if (get().sessions[id]) set({ activeSessionId: id });
}

export function renameSession(id: string, title: string): void {
  const t = title.trim();
  if (!t) return;
  patchSession(id, (s) => ({ ...s, title: t, titleLocked: true }));
}

export function togglePinSession(id: string): void {
  patchSession(id, (s) => ({ ...s, pinned: !s.pinned }));
}

/** Titles sessions from the first request, unless the user renamed them. */
export function autoTitleSession(id: string, text: string): void {
  const s = get().sessions[id];
  if (!s || s.titleLocked || s.feed.some((f) => f.type === 'user')) return;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return;
  const title = clean.length > 48 ? `${clean.slice(0, 47).replace(/\s\S*$/, '')}…` : clean;
  patchSession(id, (x) => ({ ...x, title: title.charAt(0).toUpperCase() + title.slice(1) }));
}

/** Delete every local database (state, media, caches) and reload. */
export async function wipeAllData(): Promise<void> {
  wiping = true;
  pendingWrite = null;
  window.clearTimeout(writeTimer);
  await stateDb.del('ogs-app').catch(() => undefined);
  for (const name of ['ogs-state', 'ogs-blobs', 'ogs-cache']) indexedDB.deleteDatabase(name);
  window.setTimeout(() => location.reload(), 150);
}
