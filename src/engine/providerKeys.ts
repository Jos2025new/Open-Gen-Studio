import { isKeyMarker, KEY_MARKER } from '../lib/providerFetch';
import { LOCAL_WRITE } from '../lib/disk';
import { setSettings, useStore } from '../store/store';
import type { RemoteProviderId } from './types';
import { useSyncExternalStore } from 'react';

/**
 * API keys live outside the page (server/keys.js: system keyring, or data/keys.json with a warning). The store keeps a
 * marker (`ogs:****1234`) per provider: enough to know a key exists and show its last 4 characters.
 */
const PROVIDERS: RemoteProviderId[] = ['openrouter', 'fal', 'nanogpt', 'atlas'];
let warning = '';
const listeners = new Set<() => void>();
const setWarning = (w: string) => { if (w !== warning) { warning = w; listeners.forEach((l) => l()); } };
/** The notice to show in Settings (empty when the keys are in the system keyring). */
export function useKeyWarning(): string {
  return useSyncExternalStore((l) => { listeners.add(l); return () => void listeners.delete(l); }, () => warning);
}

const setKey = (p: RemoteProviderId, v: string) => setSettings((s) => ({ keys: { ...s.keys, [p]: v } }));

/** Saves (or, empty, removes) a key. Without the local server the key stays in the page as before, with a warning. */
export async function saveKey(p: RemoteProviderId, value: string): Promise<void> {
  const v = value.trim();
  try {
    if (!v) {
      const r = await fetch(`/x/store/keys/${p}`, { method: 'DELETE', headers: LOCAL_WRITE });
      if (!r.ok) throw new Error('delete');
      return setKey(p, '');
    }
    const r = await fetch(`/x/store/keys/${p}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...LOCAL_WRITE }, body: JSON.stringify({ key: v }) });
    if (!r.ok) throw new Error('put');
    const j = (await r.json()) as { mask: string; warning?: string };
    setKey(p, j.mask);
    setWarning(j.warning ?? '');
  } catch {
    setKey(p, v);
    if (v) setWarning('The local server did not take the key: it stays in this browser (not in the system keyring).');
  }
}

/** At start: real keys still in the page go to the server, and the page shows the server's truth (marker or nothing). */
export async function syncKeys(): Promise<void> {
  let server: { providers: Record<string, { set: boolean; last4?: string }>; warning?: string };
  try {
    const r = await fetch('/x/store/keys', { cache: 'no-store' });
    if (!r.ok) return;
    server = await r.json();
  } catch { return; }
  setWarning(server.warning ?? '');
  const next = { ...useStore.getState().settings.keys };
  for (const p of PROVIDERS) {
    const v = next[p];
    if (v && !isKeyMarker(v)) {
      const r = await fetch(`/x/store/keys/${p}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...LOCAL_WRITE }, body: JSON.stringify({ key: v }) }).catch(() => null);
      if (r?.ok) next[p] = ((await r.json()) as { mask: string }).mask;
    } else if (server.providers[p]?.set) next[p] = `${KEY_MARKER}****${server.providers[p].last4 ?? ''}`;
    else if (isKeyMarker(v)) next[p] = '';
  }
  const cur = useStore.getState().settings.keys;
  if (PROVIDERS.some((p) => next[p] !== cur[p])) setSettings((s) => ({ keys: { ...s.keys, ...Object.fromEntries(PROVIDERS.filter((p) => next[p] !== cur[p]).map((p) => [p, next[p]])) } }));
}

let started = false;
/** Runs the sync once the saved state is loaded (the store flag `hydrated`). */
export function startKeySync(): void {
  if (started) return;
  started = true;
  if (useStore.getState().hydrated) return void syncKeys();
  const off = useStore.subscribe((s) => { if (s.hydrated) { off(); void syncKeys(); } });
}
