/*
 * Leaf module (no imports) so the store can ask "does this session still ask before an over-limit run?" without
 * importing budget.ts, which imports the store. budget.ts registers its rule (overLimitAccepted) when it loads.
 */
let probe: ((sessionId?: string) => boolean) | undefined;

export function setNoAskProbe(fn: (sessionId?: string) => boolean): void {
  probe = fn;
}

/** Over-limit runs go ahead without asking in this session: the one answer for the warning, the panels and the runs. */
export function noAskActive(sessionId?: string): boolean {
  return probe?.(sessionId) ?? false;
}
