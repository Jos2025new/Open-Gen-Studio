import { z } from 'zod';
import { defineCommand } from '../engine/commands/types';
import { useStore, newSession, selectSession, renameSession, togglePinSession, autoTitleSession } from './store';
import { setSessionsArchived } from './sessionArchive';
import { visibleSessions } from './spaceSession';

/* The sessions as commands (ADR 0030, step 5). Each wraps the store function the interface already calls. */

const none = z.object({}).strict();
const title = z.string().trim().min(1).max(120);
const there = (id: string | undefined) => Boolean(id && useStore.getState().sessions[id]);
const noSession = (id: string) => `No session "${id}".`;

export const commands = [
  defineCommand({
    id: 'sessions.list',
    title: 'List sessions',
    description: 'The sessions, with which one is on screen (active). Only the ones not archived, unless archived is true.',
    args: z.object({ archived: z.boolean().optional() }).strict(),
    effect: 'read',
    run: (_ctx, args) => {
      const st = useStore.getState();
      return visibleSessions(st.sessions)
        .filter((s) => (args.archived ? Boolean(s.archived) : !s.archived))
        .map((s) => ({ id: s.id, title: s.title, pinned: Boolean(s.pinned), archived: Boolean(s.archived), active: s.id === st.activeSessionId }));
    },
  }),
  defineCommand({
    id: 'sessions.new',
    title: 'New session',
    description: 'An empty session; it becomes the one on screen. Returns {session}.',
    args: z.object({ title: title.optional() }).strict(),
    effect: 'write',
    debt: 'Changes the session on screen (newSession sets activeSessionId).',
    run: (_ctx, args) => {
      const id = newSession();
      if (args.title) renameSession(id, args.title);
      return { session: id };
    },
  }),
  defineCommand({
    id: 'sessions.select',
    title: 'Show session',
    description: 'Puts this session on screen.',
    args: none,
    effect: 'write',
    needs: ['session'],
    available: (ctx) => (there(ctx.on.session) ? true : noSession(ctx.on.session!)),
    debt: 'Changes the session on screen (selectSession sets activeSessionId).',
    run: ({ on }) => selectSession(on.session!),
  }),
  defineCommand({
    id: 'sessions.rename',
    title: 'Rename session',
    description: 'Gives this session a new title, from 1 to 120 characters.',
    args: z.object({ title }).strict(),
    effect: 'write',
    needs: ['session'],
    available: (ctx) => (there(ctx.on.session) ? true : noSession(ctx.on.session!)),
    run: ({ on }, args) => renameSession(on.session!, args.title),
  }),
  defineCommand({
    id: 'sessions.pin',
    title: 'Pin session',
    description: 'Pins this session to the top of the list, or unpins it; it does nothing when it is already like that.',
    args: z.object({ pinned: z.boolean() }).strict(),
    effect: 'write',
    needs: ['session'],
    available: (ctx) => (there(ctx.on.session) ? true : noSession(ctx.on.session!)),
    run: ({ on }, args) => {
      const s = useStore.getState().sessions[on.session!];
      if (s && Boolean(s.pinned) !== args.pinned) togglePinSession(on.session!);
    },
  }),
  defineCommand({
    id: 'sessions.auto_title',
    title: 'Title session from text',
    description: 'Titles this session from the first request, unless the user renamed it. Returns {title}.',
    args: z.object({ text: z.string() }).strict(),
    effect: 'write',
    needs: ['session'],
    available: (ctx) => (there(ctx.on.session) ? true : noSession(ctx.on.session!)),
    run: ({ on }, args) => {
      autoTitleSession(on.session!, args.text);
      return { title: useStore.getState().sessions[on.session!]?.title ?? '' };
    },
  }),
  defineCommand({
    id: 'sessions.archive',
    title: 'Archive sessions',
    description: 'Archives these sessions (they leave the list) or brings them back, from 1 to 200 at a time.',
    args: z.object({ sessions: z.array(z.string().min(1)).min(1).max(200), archived: z.boolean() }).strict(),
    effect: 'write',
    available: (_ctx, args) => {
      const missing = args?.sessions?.find((id) => !there(id));
      return missing ? noSession(missing) : true;
    },
    run: (_ctx, args) => setSessionsArchived(args.sessions, args.archived),
  }),
];

/** Every exported action of the store modules: the command that runs it. A test keeps this list complete. */
export const SESSION_ACTIONS: Record<string, string> = {
  newSession: 'sessions.new',
  selectSession: 'sessions.select',
  renameSession: 'sessions.rename',
  togglePinSession: 'sessions.pin',
  autoTitleSession: 'sessions.auto_title',
  setSessionsArchived: 'sessions.archive',
  visibleSessions: 'sessions.list',
};
