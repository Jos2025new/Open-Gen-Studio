/*
 * Leaf module (no imports, pure functions): the lasting "do not ask before an over-limit run" rules. The store (store.ts) and
 * budget.ts both read them from here, so no answer depends on which module loaded first. A one-off or sequence pass is not
 * lasting: it lives in budget.ts, and the next run still asks.
 */
export interface NoAskState {
  settings: { budgetOn: boolean; budgetUsd: number; budgetAccepted?: number | null; budgetNoAsk?: boolean };
  activeSessionId: string;
  sessions: Record<string, { noAskOverLimit?: boolean } | undefined>;
}

/** "Until next session": the chat the user was in and the limit they accepted it for. */
export interface UntilNextGrant {
  chat: string;
  budgetOn: boolean;
  budgetUsd: number;
}

let grant: UntilNextGrant | null = null;

export function untilNextGrant(): UntilNextGrant | null {
  return grant;
}

export function setUntilNextGrant(next: UntilNextGrant | null): void {
  grant = next;
}

/** Does the grant still hold: same chat open, same limit. */
export function untilNextHolds(state: Pick<NoAskState, 'settings' | 'activeSessionId'>, g: UntilNextGrant | null = grant): boolean {
  return g !== null && state.activeSessionId === g.chat && state.settings.budgetOn === g.budgetOn && state.settings.budgetUsd === g.budgetUsd;
}

/** "Don't ask in any session" (or a limit accepted by an older version). */
export function noAskEverywhere(s: { budgetUsd: number; budgetAccepted?: number | null; budgetNoAsk?: boolean }): boolean {
  return Boolean(s.budgetNoAsk) || s.budgetAccepted === s.budgetUsd;
}

/** The lasting rules: everywhere, until next session, or this session's "Don't ask again". Passes are not included. */
export function noAskDurable(state: NoAskState, sessionId?: string): boolean {
  return noAskEverywhere(state.settings) || untilNextHolds(state) || Boolean(state.sessions[sessionId ?? state.activeSessionId]?.noAskOverLimit);
}
