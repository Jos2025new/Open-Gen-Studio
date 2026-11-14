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
const open = new Map<string, { tx: HistoryTx; depth: number; failed: boolean }>();

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
      open.set(key, { tx: adapter.begin(cut < 0 ? '' : key.slice(cut + 1)), depth: 1, failed: false });
    }
    this.keys.push(key);
  }

  /** Closes every history: one undo step each, or everything back as it was when `ok` is false. */
  end(ok: boolean): void {
    const keys = this.keys;
    this.keys = [];
    for (const key of keys.reverse()) {
      const held = open.get(key);
      if (!held) continue;
      if (!ok) held.failed = true;
      if (--held.depth > 0) continue;
      open.delete(key);
      if (held.failed) held.tx.rollback();
      else held.tx.commit();
    }
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
