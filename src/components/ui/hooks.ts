import { useEffect, useState } from 'react';
import { loadAssetUrl, peekAssetUrl } from '../../lib/idb';
import { useStore } from '../../store/store';
import type { Session } from '../../engine/types';

/** Object URL (or remote URL) for an asset's media, loaded lazily from IndexedDB. */
export function useAssetUrl(assetId: string | null | undefined): string | null {
  return useAssetSource(assetId).url;
}

/** The asset's URL, and `lost` once its stored bytes turned out to be gone (nothing more is coming). */
export function useAssetSource(assetId: string | null | undefined): { url: string | null; lost: boolean } {
  const remote = useStore((s) => (assetId ? s.assets[assetId]?.remoteUrl : undefined));
  const stored = useStore((s) => (assetId ? s.assets[assetId]?.stored : undefined));
  const [url, setUrl] = useState<string | null>(() => (assetId ? peekAssetUrl(assetId) ?? null : null));
  const [lost, setLost] = useState(false);
  useEffect(() => {
    let alive = true;
    setLost(false);
    if (!assetId) {
      setUrl(null);
      return;
    }
    const hit = peekAssetUrl(assetId);
    if (hit) {
      setUrl(hit);
      return;
    }
    if (!stored) {
      setUrl(remote ?? null);
      return;
    }
    void loadAssetUrl(assetId).then((u) => {
      if (!alive) return;
      setUrl(u ?? remote ?? null);
      setLost(!u && !remote);
    });
    return () => {
      alive = false;
    };
  }, [assetId, remote, stored]);
  return { url, lost };
}

export function useActiveSession(): Session {
  return useStore((s) => s.sessions[s.activeSessionId]);
}

export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs, active]);
  return now;
}

/** Panel layout preference kept per browser (width, collapsed panel, collapsed sections). */
export function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw == null ? initial : (JSON.parse(raw) as T); } catch { return initial; }
  });
  const set = (v: T) => { setValue(v); try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } };
  return [value, set];
}
