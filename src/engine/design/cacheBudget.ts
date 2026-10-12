/*
 * One byte budget for the editor's caches (Paso 4): the layer FX results, the 'below' FX results and the brush
 * stroke masks share it. Only caches register here: the user's drawing is never an entry, so it is never evicted.
 * When a new entry would exceed the budget, the least recently used entries go first (their owners recompute them on
 * the next frame). The entry being stored is always kept, even if it alone is larger than the budget.
 */

interface Entry { bytes: number; drop: () => void }

export class CacheBudget {
  private entries = new Map<string, Entry>();
  private total = 0;
  constructor(public limitBytes: number) {}

  get usedBytes(): number { return this.total; }
  get count(): number { return this.entries.size; }

  /** Marks an entry as used now (moves it to the most recently used end). */
  touch(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    this.entries.delete(key);
    this.entries.set(key, e);
  }

  /** Stores (or replaces) an entry of `bytes`; `drop` releases its owner's copy when it is evicted. */
  put(key: string, bytes: number, drop: () => void): void {
    this.remove(key);
    this.entries.set(key, { bytes, drop });
    this.total += bytes;
    for (const [k, e] of this.entries) {
      if (this.total <= this.limitBytes || this.entries.size <= 1) break;
      if (k === key) continue;
      this.entries.delete(k);
      this.total -= e.bytes;
      e.drop();
    }
  }

  remove(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    this.entries.delete(key);
    this.total -= e.bytes;
  }

  /** Sets a new limit and evicts down to it. */
  setLimit(limitBytes: number): void {
    this.limitBytes = Math.max(0, limitBytes);
    for (const [k, e] of this.entries) {
      if (this.total <= this.limitBytes || this.entries.size <= 1) break;
      this.entries.delete(k);
      this.total -= e.bytes;
      e.drop();
    }
  }
}

/** The editor's shared cache budget. 256 MB by default; the app may raise or lower it. */
export const editorCacheBudget = new CacheBudget(256 * 1024 * 1024);
