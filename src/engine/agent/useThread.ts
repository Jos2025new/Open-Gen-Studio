import { useStore } from '../../store/store';
import type { AgentState } from '../types';
import { recipientOf } from './recipient';
import { allThreads, threadOf } from './lanes';

/** A value of one agent's thread (the agent that owns the row, card or message), never of whichever is on screen. */
export function useThread<T>(sessionId: string, owner: string | undefined, pick: (a: AgentState) => T, none: T): T {
  return useStore((s) => { const a = threadOf(s.sessions[sessionId], owner); return a ? pick(a) : none; });
}

/** A value of the thread that would take a message from the composer now (its recipient), for what depends on who is spoken to. */
export function useRecipientThread<T>(sessionId: string, pick: (a: AgentState) => T, none: T): T {
  return useStore((s) => { const a = threadOf(s.sessions[sessionId], recipientOf(sessionId).id); return a ? pick(a) : none; });
}

/** Whether any of the session's agents satisfies `test` (is working, has a card waiting): for what concerns the whole session. */
export function useAnyThread(sessionId: string, test: (a: AgentState) => boolean): boolean {
  return useStore((s) => allThreads(s.sessions[sessionId]).some(test));
}

/** The phase of an agent that is working, if any. */
export function useWorkingPhase(sessionId: string): NonNullable<AgentState['phase']> | null {
  return useStore((s) => allThreads(s.sessions[sessionId]).find((a) => a.busy)?.phase ?? (allThreads(s.sessions[sessionId]).some((a) => a.busy) ? 'working' : null));
}
