import { CommandError } from './types';

/*
 * One command, or one sequence, is one undo step in each history it touches (a Designer document, a node graph). The
 * core does not know how an area records undo: the area registers an adapter, and the core opens one transaction per
 * history and closes it when the call ends. There is no global history.
 */

export interface HistoryTx {
  /** Keeps what changed as one undo step (or none if nothing changed). */
  commit(): void;
  /** Puts the history's subject back as it was at `begin` and records nothing. */
  rollback(): void;
}

export interface HistoryAdapter {
  /** Opens a transaction on one subject (`id` is the part of the key after `kind:`). */
  begin(id: string): HistoryTx;
}

const adapters = new Map<string, HistoryAdapter>();
/** Open transactions by key. A command that calls another on the same history joins the open one. */
const open = new Map<string, { tx: HistoryTx; depth: number; failed: boolean; waited: boolean }>();

/** Registers the adapter of one kind of history ("designer", "nodes"). Returns how to remove it. */
export function registerHistory(kind: string, adapter: HistoryAdapter): () => void {
  adapters.set(kind, adapter);
  return () => {
    if (adapters.get(kind) === adapter) adapters.delete(kind);
  };
}

/** The transactions of one call or sequence. `touch` opens each history the first time a step names it. */
export class Transactions {
  private keys: string[] = [];

  touch(key: string): void {
    if (this.keys.includes(key)) return;
    const held = open.get(key);
    if (held) {
      held.depth++;
    } else {
      const cut = key.indexOf(':');
      const adapter = adapters.get(cut < 0 ? key : key.slice(0, cut));
      if (!adapter) throw new CommandError('history', `No undo history is registered for "${key}".`);
      open.set(key, { tx: adapter.begin(cut < 0 ? '' : key.slice(cut + 1)), depth: 1, failed: false, waited: false });
    }
    this.keys.push(key);
  }

  /**
   * A step did not finish in the task it started in: while it waited, the user may have changed the same subjects.
   * From here on these histories are never put back, because that would erase the user's change with the command's.
   */
  waited(): void {
    for (const key of this.keys) {
      const held = open.get(key);
      if (held) held.waited = true;
    }
  }

  /**
   * Closes every history: one undo step each, or, when `ok` is false, everything back as it was. Returns the
   * histories that failed and were kept all the same because the call had waited (one undo step takes them back).
   */
  end(ok: boolean): string[] {
    const keys = this.keys;
    const kept: string[] = [];
    this.keys = [];
    for (const key of keys.reverse()) {
      const held = open.get(key);
      if (!held) continue;
      if (!ok) held.failed = true;
      if (--held.depth > 0) continue;
      open.delete(key);
      if (held.failed && !held.waited) held.tx.rollback();
      else {
        held.tx.commit();
        if (held.failed) kept.push(key);
      }
    }
    return kept;
  }

  get size(): number {
    return this.keys.length;
  }
}

/** Removes adapters and forgets open transactions (tests). */
export function resetHistories(): void {
  adapters.clear();
  open.clear();
}
