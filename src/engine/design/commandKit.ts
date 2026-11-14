import { z } from 'zod';
import { registerHistory } from '../commands/history';
import { defineCommand, type Availability, type CommandContext, type CommandSpec, type Target } from '../commands/types';
import { setDoc, useStore } from '../../store/store';
import type { DesignDoc, Layer } from '../types';
import { getDoc, prunePicks } from './actions';
import { openHistoryGroup } from './history';

/*
 * What the Designer's command files share (ADR 0030): the target of a document command, its undo history, and the
 * checks that turn an action's silent "nothing happened" into a reason the caller can read.
 */

export type DocTarget = { session: string; doc: string };
export const layerRef = z.string().min(1).max(80);
const NO_DOC = 'That document is not in this session.';

/** The document a command acts on; throws the reason when it is gone. */
export function docOf(on: Target): DesignDoc {
  const doc = getDoc(on.session ?? '', on.doc ?? '');
  if (!doc) throw new Error(NO_DOC);
  return doc;
}

export function layerOf(on: Target, id: string): Layer {
  const layer = docOf(on).layers.find((l) => l.id === id);
  if (!layer) throw new Error(`No layer "${id}" in this document.`);
  return layer;
}

/** The document exists and, when the call names layers (`layer`, `layers`), so do they. */
export function hasTarget(ctx: CommandContext, args?: { layer?: unknown; layers?: unknown }): Availability {
  const doc = getDoc(ctx.on.session ?? '', ctx.on.doc ?? '');
  if (!doc) return NO_DOC;
  const named = [args?.layer, ...(Array.isArray(args?.layers) ? args.layers : [])].filter((id): id is string => typeof id === 'string');
  const missing = named.find((id) => !doc.layers.some((l) => l.id === id));
  return missing ? `No layer "${missing}" in this document.` : true;
}

type DocSpec<A, R> = Omit<CommandSpec<A, R>, 'needs' | 'history' | 'run'> & {
  /** `false` for what the Designer does not record in undo (picking a layer, renaming the document). */
  undo?: false;
  run: (on: DocTarget, args: A, ctx: CommandContext) => R;
};

/** A command on one document: it needs `on.session` and `on.doc`, and is one undo step in that document. */
export function docCommand<A, R>(spec: DocSpec<A, R>): CommandSpec<A, R> {
  const { undo, run, ...rest } = spec;
  return defineCommand<A, R>({
    available: hasTarget as CommandSpec<A, R>['available'],
    ...rest,
    needs: ['session', 'doc'],
    ...(undo === false ? {} : { history: (on: Target) => `designer:${on.doc}` }),
    run: (ctx, args) => run(ctx.on as DocTarget, args, ctx),
  });
}

function sessionOf(docId: string): string | undefined {
  return Object.values(useStore.getState().sessions).find((s) => s.docs.some((d) => d.id === docId))?.id;
}

/** The Designer's undo behind `designer:<doc>`: every `record` of a call or sequence is one step; a failure puts the document back. */
registerHistory('designer', {
  begin(docId) {
    const sessionId = sessionOf(docId);
    const before = sessionId ? getDoc(sessionId, docId) : undefined;
    const group = openHistoryGroup(docId);
    return {
      commit: () => group.close(),
      rollback: () => {
        const back = group.revert() ?? before;
        const now = sessionId ? getDoc(sessionId, docId) : undefined;
        if (!sessionId || !back || !now || now === back) return;
        setDoc(sessionId, docId, () => ({ ...back, lastExport: now.lastExport }));
        prunePicks(back);
      },
    };
  },
});
