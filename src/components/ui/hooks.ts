import { useEffect, useState } from 'react';
import { loadAssetUrl, peekAssetUrl } from '../../lib/idb';
import { useStore } from '../../store/store';
import type { Session } from '../../engine/types';

/** Object URL (or remote URL) for an asset's media, loaded lazily from IndexedDB. */
export function useAssetUrl(assetId: string | null | undefined): string | null {
  const remote = useStore((s) => (assetId ? s.assets[assetId]?.remoteUrl : undefined));
  const stored = useStore((s) => (assetId ? s.assets[assetId]?.stored : undefined));
  const [url, setUrl] = useState<string | null>(() => (assetId ? peekAssetUrl(assetId) ?? null : null));
  useEffect(() => {
    let alive = true;
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
      if (alive) setUrl(u ?? remote ?? null);
    });
    return () => {
      alive = false;
    };
  }, [assetId, remote, stored]);
  return url;
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
