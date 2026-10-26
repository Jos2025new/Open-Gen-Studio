import { logEvent } from '../../lib/log';
import { uid } from '../../lib/id';

export type TurnRoute = 'new' | 'plan-comment' | 'answers' | 'skip' | 'settings-reply' | 'settings-confirm' | 'retry' | 'wrap-up';
export type TurnOutcome = 'plan' | 'questions' | 'settings' | 'text' | 'empty' | 'error' | 'canceled' | 'cut';

/** One line when an agent turn starts and one when it ends, with the same id: who answered and how it ended. Never content. */
export function startTurnLog(session: string, engine: 'llm' | 'offline', route: TurnRoute): (outcome: TurnOutcome) => void {
  const turn = uid('turn');
  const at = Date.now();
  logEvent('agent', { event: 'turn-start', turn, session, engine, route });
  return (outcome) => logEvent('agent', { event: 'turn-end', turn, session, outcome, ms: Date.now() - at });
}
