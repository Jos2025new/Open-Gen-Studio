import type { AgentState, Session } from '../../src/engine/types';
import { MAIN_THREAD, freshAgent, shownKey, threadOf } from '../../src/engine/agent/threads';

/** The thread the UI shows (what a test that does not name an agent means): the one a message would go to. */
export const viewed = (s: Session): AgentState => threadOf(s, undefined) ?? freshAgent();

/** The `agents` of a session with `patch` applied to the shown thread (for `{ ...session, agents: agentsWith(session, { busy: true }) }`). */
export const agentsWith = (s: Session, patch: Partial<AgentState>): Session['agents'] => ({ ...s.agents, [shownKey(s)]: { ...viewed(s), ...patch } });

/** A session's `agents` with one thread: the session's main one. */
export const mainThread = (a: Partial<AgentState> = {}): Session['agents'] => ({ [MAIN_THREAD]: { ...freshAgent(), ...a } });
