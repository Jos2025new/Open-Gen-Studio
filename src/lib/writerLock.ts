/*
 * One active tab (plan: save protection, phase 1.4). Only the tab that holds the Web Lock 'ogs-writer' writes to
 * IndexedDB and the disk, hydrates the store, or starts work that costs money. Every write path asks
 * `holdsWriterLock()`: zustand calls setItem on every setState, hydrated or not, so not hydrating is not enough.
 * Handover between tabs travels on BroadcastChannel('ogs-writer'); a tab that does not answer in 5 s can be taken from
 * (`steal`). This module imports nothing from the store: the store and the handoff hooks register themselves here.
 */
export const LOCK_NAME = 'ogs-writer';
export const SILENCE_MS = 5000;
const POLL_MS = 500;

/** What runs in the holder: `transferable` generations have a provider job another tab can follow; the rest is lost on handover. */
export interface WorkReport { transferable: number; generations: number; agent: number }
export interface WriterHooks {
  report(): WorkReport;
  agentBusy(): boolean;
  /** Stops following the generations that have a remote job (abort reason WRITER_HANDOFF: they stay running). */
  abortTransferable(): void;
  /** Stops everything in flight (WRITER_HANDOFF for generations, Stop for the agent). */
  abortAll(): void;
  /** Writes everything pending (saveNow: state and deferred raster pixels). */
  flush(): Promise<void>;
}
const NONE: WorkReport = { transferable: 0, generations: 0, agent: 0 };
let hooks: WriterHooks = { report: () => NONE, agentBusy: () => false, abortTransferable() {}, abortAll() {}, flush: async () => undefined };
export function setWriterHooks(h: WriterHooks): void { hooks = h; }

export type WriterPhase = 'unsupported' | 'waiting' | 'held';
/** The requesting tab's progress: asking -> choose (work to lose) | waiting-them | silent (no answer in 5 s). */
export type Asking = 'idle' | 'asking' | 'choose' | 'waiting-them' | 'silent';
export interface WriterState {
  phase: WriterPhase;
  /** Holder: another tab asked for the lock, so no new work starts here. */
  requested: boolean;
  asking: Asking;
  /** The holder's work: live in the holder, the last answer received in the requester. */
  work: WorkReport | null;
}

let state: WriterState = { phase: 'waiting', requested: false, asking: 'idle', work: null };
const listeners = new Set<() => void>();
const granted = new Set<() => void>();
const lostCbs = new Set<() => void>();
export const getWriterState = (): WriterState => state;
export function subscribeWriter(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
function setState(patch: Partial<WriterState>): void { state = { ...state, ...patch }; listeners.forEach((l) => l()); }

export const holdsWriterLock = (): boolean => state.phase === 'held';
/** New work (a generation, an agent turn) may start: the lock is held and nobody is waiting for it, except an agent turn already running. */
export const mayStartWork = (): boolean => state.phase === 'held' && (!state.requested || hooks.agentBusy());
/** Runs `fn` each time this tab takes the lock (at once if it already holds it). */
export function onWriterLockGranted(fn: () => void): void { granted.add(fn); if (state.phase === 'held') fn(); }
/** Runs `fn` each time this tab stops holding the lock (handed over, stolen). */
export function onWriterLockLost(fn: () => void): void { lostCbs.add(fn); }

const blocking = (w: WorkReport | null): number => (w ? w.generations + w.agent : 0);
const tabId = Math.random().toString(36).slice(2);
let channel: { postMessage(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null } | null = null;
let releaseHeld: (() => void) | null = null;
let queued: AbortController | null = null;
let silenceTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let handing = false;
const send = (m: Record<string, unknown>) => channel?.postMessage({ ...m, from: tabId });

function armSilence(): void {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => { if (state.phase === 'waiting' && state.asking !== 'idle') setState({ asking: 'silent' }); }, SILENCE_MS);
}

function becomeHolder(): void {
  clearTimeout(silenceTimer);
  clearInterval(pollTimer);
  handing = false;
  setState({ phase: 'held', requested: false, asking: 'idle', work: null });
  granted.forEach((fn) => fn());
}

function stoppedHolding(): void {
  clearInterval(pollTimer);
  setState({ phase: 'waiting', requested: false, asking: 'idle', work: null });
  lostCbs.forEach((fn) => fn());
  request(false); // back in the queue: this tab takes the lock again if the other one ends
}

/** The lock request. A normal one waits its turn (and is aborted before a steal); a steal takes the lock from a frozen holder. */
function request(steal: boolean): void {
  queued?.abort();
  const ac = steal ? null : new AbortController();
  queued = ac;
  const options = steal ? { steal: true } : { signal: ac!.signal };
  void navigator.locks.request(LOCK_NAME, options, () => new Promise<void>((resolve) => {
    if (queued === ac) queued = null;
    releaseHeld = resolve;
    becomeHolder();
  })).then(() => undefined, (err: { name?: string }) => {
    // Rejected with AbortError while held: another tab stole the lock. (A queued request this tab aborted itself is not a loss.)
    if (err?.name === 'AbortError' && !ac?.signal.aborted) { hooks.abortAll(); releaseHeld = null; stoppedHolding(); }
  });
}

/** Holder: cut the provider polling, write everything, release. `force` also gives up what cannot be handed over. */
async function handOver(force: boolean): Promise<void> {
  if (state.phase !== 'held' || handing) return;
  handing = true;
  clearInterval(pollTimer);
  hooks.abortTransferable();
  if (force) hooks.abortAll();
  try { await hooks.flush(); } catch (err) { console.error('Could not save before handing over', err); }
  const release = releaseHeld;
  releaseHeld = null;
  stoppedHolding();
  release?.();
}

function answer(to: string): void {
  const work = hooks.report();
  setState({ work });
  send({ type: 'work', to, work });
}

function onMessage(m: { type: string; from: string; to?: string; work?: WorkReport }): void {
  if (m.from === tabId) return;
  if (state.phase === 'held') {
    if (m.type === 'ask') {
      setState({ requested: true });
      answer(m.from);
      if (blocking(state.work) === 0) void handOver(false);
    } else if (m.type === 'wait') {
      clearInterval(pollTimer);
      pollTimer = setInterval(() => { answer(m.from); if (blocking(state.work) === 0) void handOver(false); }, POLL_MS);
    } else if (m.type === 'now') void handOver(true);
  } else if (m.to === tabId && m.type === 'work') {
    setState({ work: m.work ?? NONE, asking: state.asking === 'waiting-them' ? 'waiting-them' : blocking(m.work ?? null) ? 'choose' : 'asking' });
    if (state.asking !== 'choose') armSilence();
  } else if (m.type === 'kept' && state.asking !== 'idle') {
    clearTimeout(silenceTimer);
    setState({ asking: 'idle', work: null });
  }
}

/** Requester: "Use here". Asks the holder, which answers with its work and hands over at once when none would be lost. */
export function useHere(): void {
  if (state.phase !== 'waiting') return;
  setState({ asking: 'asking', work: null });
  if (!channel) { setState({ asking: 'silent' }); return; }
  send({ type: 'ask' });
  armSilence();
}
/** Requester: wait until what cannot be handed over finishes (recommended). */
export function waitForThem(): void {
  if (state.phase !== 'waiting') return;
  setState({ asking: 'waiting-them' });
  send({ type: 'wait' });
  armSilence();
}
/** Requester: the holder gives up its work now and hands over. */
export function takeNow(): void {
  if (state.phase !== 'waiting') return;
  send({ type: 'now' });
  setState({ asking: 'asking' });
  armSilence();
}
/** Requester: no answer in 5 s. Steals the lock; the old tab stops writing and following jobs. */
export function takeOver(): void {
  if (state.phase === 'waiting') request(true);
}
/** Holder: "Keep using here" after a request. */
export function keepHere(): void {
  clearInterval(pollTimer);
  setState({ requested: false });
  send({ type: 'kept' });
}
/** Holder: hand over now from the waiting panel (work that cannot be handed over is lost). */
export function handOverNow(): void { void handOver(true); }

export function startWriterLock(): void {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) { state = { ...state, phase: 'unsupported' }; return; }
  if (typeof BroadcastChannel !== 'undefined') {
    const ch = new BroadcastChannel(LOCK_NAME) as unknown as NonNullable<typeof channel> & { unref?: () => void };
    ch.onmessage = (e) => onMessage(e.data as Parameters<typeof onMessage>[0]);
    ch.unref?.();
    channel = ch;
  }
  request(false);
}
startWriterLock();
