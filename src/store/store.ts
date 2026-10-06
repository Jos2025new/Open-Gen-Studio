import { historyDepth } from '../engine/design/history';
import { pendingRaster } from '../engine/design/raster';
import { useLayerSelection } from '../engine/design/selection';
import { objectPick } from '../engine/design/objectSelection';
import { recordGraph } from '../engine/flow/history';
import { graphEditProblem } from '../engine/flow/locks';
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { uid } from '../lib/id';
import { stateDb } from '../lib/idb';
import { disk } from '../lib/disk';
import { logEvent } from '../lib/log';
import { LOCAL_IMAGE_REF, LOCAL_VIDEO_REF } from '../engine/providers/demo';
import { formatUsd } from '../lib/format';
import type { AgentTier, LlmModel } from '../engine/providers/llm';
import type { DesignTool } from '../engine/design/rules';
import { DEFAULT_TEXT_STYLE } from '../engine/design/doc';
import { DEFAULT_STROKE_STYLE } from '../engine/design/strokes';
import type { StrokeStyle } from '../engine/types';
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
  TranscriberSummary,
  Session,
  Subject,
  SpendEntry,
  TextStyle,
  Workspace,
} from '../engine/types';

// ---------------------------------------------------------------------------
// State shape

export interface Settings {
  keys: Record<RemoteProviderId, string>;
  agent: { provider: LlmProviderId | 'offline'; model: string; /** True only when the user pinned this exact director model. */ modelPinned?: boolean; tier: AgentTier; effort: 'none' | 'low' | 'medium' | 'high'; /** Stream the model's reasoning into the activity block (default on). */ showThinking?: boolean };
  guidedRounds: number;
  budgetUsd: number;
  /** false: no spending limit, spending is only shown. */
  budgetOn: boolean;
  /** The limit the user chose to go past ("Continue anyway"); valid while budgetUsd stays the same. */
  budgetAccepted?: number | null;
  ops: { edit: string | null; upscale: string | null; removeBg: string | null; video: string | null; videoUpscale: string | null; videoEdit: string | null; videoExtend: string | null; transcribe: string | null; editRegion: string | null; removeObject: string | null };
}

export interface ComposerState {
  mode: ComposerMode;
  agentStyle: AgentStyle;
  skillId: string | null;
  workflowId: string | null;
  text: string;
  image: { modelRef: string; settings: GenSettings };
  video: { modelRef: string; settings: GenSettings };
  /** '' until an audio provider is connected (there is no local audio model). */
  audio: { modelRef: string; settings: GenSettings };
  /** 3D stays separate from image settings: resolutions/face counts are model-specific. */
  model3d: { modelRef: string; settings: GenSettings };
  attachments: string[];
  /** Kinds whose model the user picked by hand in the model selector (C2); unset: an app default. */
  userPicked?: Partial<Record<MediaKind, boolean>>;
  /** Agent-only video overrides by input shape; absent routes keep the existing global/default routing. */
  videoRoutes?: Partial<Record<'text' | 'image' | 'reference', string>>;
  /** Keyframe second per attached image (keyframe models); unset ones are spread evenly. */
  times?: Record<string, number>;
  /** Trim [start, end] per attached video (clip models). */
  trims?: Record<string, [number, number]>;
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
  /** Speech-to-text models (Transcribe operation). */
  transcribers?: Record<string, TranscriberSummary>;
}

export interface Toast {
  id: string;
  text: string;
  level: 'info' | 'error' | 'success';
}

export interface UiState {
  workspace: Workspace;
  panel: 'gallery' | 'sessions' | 'spending' | null;
  panelExpanded: boolean;
  /** `back`: the view to return to on close (a reference opened from inside the viewer). */
  lightbox: { assetIds: string[]; index: number; back?: { assetIds: string[]; index: number } } | null;
  /** Sketch editor over a node's image; saving sets that node's painted-over copy. */
  /** Sketch editor: paint over a node's image (saved to the node), or draw a mask for Edit region / Remove object. */
  sketch: { assetId: string; nodeId?: string; mode?: 'paint' | 'mask' } | null;
  toasts: Toast[];
  tool: DesignTool;
  brush: { size: number; color: string; opacity: number; smoothing?: number; stabilization?: number; fillThreshold?: number; fillExpand?: number; fillSmooth?: number };
  /** Designer colors: the last ones used (newest first) and the ones the user saved. */
  swatches?: { recent: string[]; saved: string[] };
  /** Pixel selection tool: rectangle (default) or lasso. */
  selectShape?: 'rect' | 'lasso' | 'wand';
  /** Magic wand, like the bucket: color tolerance, grow, soft edge; how it combines; what it samples. */
  wand?: { threshold: number; expand: number; smooth: number; mode: 'replace' | 'add' | 'subtract'; sample: 'layer' | 'all' };
  /** Designer rulers (and the guides dragged from them) shown. */
  rulers?: boolean;
  /** Designer bottom bar: the toolbox (default) or the prompt box. */
  designerDock?: 'tools' | 'prompt';
  /** Gradient tool (the main color is the brush color). */
  gradient?: { shape: 'linear' | 'radial'; mode: 'two' | 'fade'; color2: string; reverse?: boolean; opacity: number };
  /** Style of new Lineart strokes (editable afterwards per layer). */
  lineart: StrokeStyle;
  lineartMode?: 'draw' | 'edit';
  lineartInfluence?: number;
  /** Edit tool snapping (page and other layers); on by default. */
  snap?: { on: boolean; page: boolean; layers: boolean };
  /** Edit tool: Ctrl-click picks more objects of the active layer (default) or more layers. */
  selectMode?: 'objects' | 'layers';
  shape: { fill: string | null; stroke: string | null; strokeWidth: number; radius: number; sides?: number; bend?: number };
  text: TextStyle;
  threadOpen: boolean;
  settingsOpen: boolean;
  focusComposer: number;
}

export interface AppState {
  hydrated: boolean;
  settings: Settings;
  spentUsd: number;
  /** Itemized spending, newest last (capped at MAX_SPEND_LOG). */
  spendLog: SpendEntry[];
  /** Exact Atlas prices by request (engine/quotes.ts); null = no quote. Not persisted: prices change. */
  quotes: Record<string, number | null>;
  sessions: Record<string, Session>;
  activeSessionId: string;
  generations: Record<string, Generation>;
  assets: Record<string, Asset>;
  /** Saved characters, objects, products and styles, shared by every session (@Name). */
  library: Subject[];
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
  budgetOn: true,
  budgetAccepted: null,
  ops: { edit: null, upscale: null, removeBg: null, video: null, videoUpscale: null, videoEdit: null, videoExtend: null, transcribe: null, editRegion: null, removeObject: null },
};

const initial: AppState = {
  hydrated: false,
  settings: DEFAULT_SETTINGS,
  spentUsd: 0,
  spendLog: [],
  quotes: {},
  sessions: { [firstSession.id]: firstSession },
  activeSessionId: firstSession.id,
  generations: {},
  assets: {},
  library: [],
  composer: {
    mode: 'agent',
    agentStyle: 'auto',
    skillId: null,
    workflowId: null,
    text: '',
    image: { modelRef: LOCAL_IMAGE_REF, settings: { aspect: '1:1', resolution: '1K', count: 1, advanced: {} } },
    video: { modelRef: LOCAL_VIDEO_REF, settings: { aspect: '16:9', resolution: '720p', duration: 5, count: 1, advanced: {} } },
    audio: { modelRef: '', settings: { count: 1, advanced: {} } },
    model3d: { modelRef: '', settings: { count: 1, advanced: {} } },
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
    lineart: { ...DEFAULT_STROKE_STYLE },
    shape: { fill: '#d4f25a', stroke: null, strokeWidth: 4, radius: 0 },
    text: { ...DEFAULT_TEXT_STYLE },
    threadOpen: false,
    settingsOpen: false,
    focusComposer: 0,
  },
};

// ---------------------------------------------------------------------------
// Persistence (IndexedDB, debounced)

let writeTimer: ReturnType<typeof setTimeout> | undefined;
// The debounce restarts with every change; this one does not: a long stream of changes (an agent turn, a job's
// progress) still starts a save every MAX_WRITE_WAIT_MS instead of waiting for a quiet moment that may not come.
let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
const MAX_WRITE_WAIT_MS = 2000;
// The latest state to save. Held as the (immutable) object and turned into JSON only when the debounced write runs:
// stringifying the whole state on every change cost a full serialization per store update, which grows with the
// history and piled up where many updates come together (the end of an agent turn, when its card appears).
let pendingWrite: { name: string; value: StorageValue<Persisted> } | null = null;
let wiping = false;

function flushWrite(): void {
  clearTimeout(writeTimer);
  clearTimeout(maxWaitTimer);
  writeTimer = maxWaitTimer = undefined;
  if (!pendingWrite || wiping) return;
  const { name, value } = pendingWrite;
  pendingWrite = null;
  stateDb.set(name, JSON.stringify(value)).catch((err) => console.error('Could not save state', err));
}

const idbStorage: PersistStorage<Persisted> = {
  getItem: async (name) => {
    const raw = await stateDb.get(name);
    return raw ? (JSON.parse(raw) as StorageValue<Persisted>) : null;
  },
  setItem: (name, value) => {
    if (wiping) return;
    pendingWrite = { name, value };
    // The global timers, not window's: tests (Node) write state too.
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushWrite, 350);
    maxWaitTimer ??= setTimeout(flushWrite, MAX_WRITE_WAIT_MS);
  },
  removeItem: (name) => stateDb.del(name),
};

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushWrite);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushWrite();
  });
}

type Persisted = Pick<AppState, 'settings' | 'spentUsd' | 'spendLog' | 'sessions' | 'activeSessionId' | 'generations' | 'assets' | 'library'> & {
  composer: Omit<ComposerState, 'editing'>;
  ui: Pick<UiState, 'workspace' | 'brush' | 'lineart' | 'shape' | 'text' | 'tool' | 'swatches' | 'gradient' | 'rulers' | 'selectShape' | 'wand'>;
};

export const useStore = create<AppState>()(
  persist(() => initial, {
    name: 'ogs-app',
    version: 1,
    storage: idbStorage,
    partialize: (s): Persisted => ({
      settings: s.settings,
      spentUsd: s.spentUsd,
      spendLog: s.spendLog,
      sessions: s.sessions,
      activeSessionId: s.activeSessionId,
      generations: s.generations,
      assets: s.assets,
      library: s.library,
      composer: { ...s.composer, editing: undefined } as Omit<ComposerState, 'editing'>,
      ui: { workspace: s.ui.workspace, brush: s.ui.brush, lineart: s.ui.lineart, shape: s.ui.shape, text: s.ui.text, tool: s.ui.tool, swatches: s.ui.swatches, gradient: s.ui.gradient, rulers: s.ui.rulers, selectShape: s.ui.selectShape, wand: s.ui.wand },
    }),
    merge: (persisted, current) => {
      const p = (persisted ?? {}) as Partial<Persisted>;
      const restored = p.sessions && Object.keys(p.sessions).length ? p.sessions : current.sessions;
      // A reload interrupts any agent call in flight.
      const sessions = Object.fromEntries(Object.entries(restored).map(([id, s]) => [id, { ...s, agent: { ...s.agent, busy: false, phase: undefined, revising: undefined } }]));
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
        spendLog: p.spendLog ?? [],
        sessions,
        activeSessionId,
        generations: p.generations ?? {},
        assets: p.assets ?? {},
        library: p.library ?? legacySubjects(restored),
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

/** Before the global library, subjects lived in each session: copied once (first name wins); sessions keep theirs. */
export function legacySubjects(sessions: Record<string, Session>): Subject[] {
  const out: Subject[] = [];
  for (const s of Object.values(sessions)) {
    for (const x of s.subjects ?? []) if (!out.some((y) => y.name.toLowerCase() === x.name.toLowerCase())) out.push(x);
  }
  return out;
}

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
  patchSession(sessionId, (s) => {
    const graph = fn(s.graph);
    const problem = graphEditProblem(sessionId, s.graph, graph);
    if (problem) { queueMicrotask(() => toast(problem, 'error')); return s; }
    recordGraph(sessionId, s.graph, graph);
    return { ...s, graph };
  });
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

export const MAX_SPEND_LOG = 5000;

/**
 * Count money spent (never blocks: what is running keeps running). With `entry` it is itemized for the Spending
 * panel. Crossing an active, not accepted limit shows one notice; the next paid run asks before going on.
 */
export function addSpend(usd: number, entry?: Omit<SpendEntry, 'at' | 'usd'>): void {
  if (!Number.isFinite(usd) || usd <= 0) return;
  const before = get().spentUsd;
  set((st) => ({
    spentUsd: Math.round((st.spentUsd + usd) * 10000) / 10000,
    spendLog: entry ? [...st.spendLog, { ...entry, at: Date.now(), usd }].slice(-MAX_SPEND_LOG) : st.spendLog,
  }));
  const { budgetOn, budgetUsd, budgetAccepted } = get().settings;
  if (budgetOn && budgetAccepted !== budgetUsd && before <= budgetUsd && get().spentUsd > budgetUsd) {
    toast(`You passed your spending limit (${formatUsd(budgetUsd)}). What is running continues; new paid runs will ask first.`, 'error');
  }
}

export function toast(text: string, level: Toast['level'] = 'info', ms?: number): void {
  if (get().ui.toasts.some((t) => t.text === text)) return; // the same notice is already on screen
  const id = uid('tst');
  set((st) => ({ ui: { ...st.ui, toasts: [...st.ui.toasts.slice(-3), { id, text, level }] } }));
  window.setTimeout(() => dismissToast(id), ms ?? (level === 'error' ? 6500 : 3200));
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
  clearTimeout(writeTimer);
  clearTimeout(maxWaitTimer);
  await stateDb.del('ogs-app').catch(() => undefined);
  // The disk copy moves to data.bak-<date>: otherwise the next load would restore it, and nothing is lost for good.
  await disk.wipe();
  for (const name of ['ogs-state', 'ogs-blobs', 'ogs-cache']) indexedDB.deleteDatabase(name);
  window.setTimeout(() => location.reload(), 150);
}

// Another tab (or window) saved newer work after this one loaded: this tab stops saving, its browser copy becomes the
// disk's again, and it says so. Its browser copy is kept, never replaced.
disk.onStateConflict(() => {
  // A tab that saves an older state over a newer one loses work (seen 2026-10-03): the trail says when it happened (T5).
  logEvent('save-conflict', { at: new Date().toISOString(), sessions: Object.keys(get().sessions).length });
  // This tab keeps its own browser copy (closing it loses nothing); the disk keeps the other work.
  toast('Another tab saved newer work. This tab is out of date and no longer saves: reload it to continue.', 'error', 24 * 3600_000);
});


/** Detached Designer state, exposed only on the sandbox port; no actions or credentials. */
if (typeof window !== 'undefined' && window.location?.port === '5183') {
  Object.assign(window, { __OGS_TEST__: () => {
    const state = useStore.getState(), session = state.sessions[state.activeSessionId];
    const doc = session?.docs.find((d) => d.id === session.activeDocId) ?? session?.docs[0];
    return JSON.parse(JSON.stringify({
      hydrated: state.hydrated,
      sessionId: session?.id,
      document: doc ? { id: doc.id, width: doc.width, height: doc.height, background: doc.background,
        layers: doc.layers, groups: doc.groups ?? [], activeLayerId: doc.activeLayerId } : null,
      selection: { layers: doc ? useLayerSelection.getState().byDoc[doc.id] ?? [] : [], objects: doc ? objectPick(doc.id) : null },
      history: doc ? historyDepth(doc.id) : { undo: 0, redo: 0 },
      saving: { state: Boolean(pendingWrite), raster: pendingRaster() },
    }));
  } });
}
