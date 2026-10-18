/** The Home drafts of sessions that still exist, without empty ones: a deleted session's draft goes with it. */
export function keptDrafts(drafts: Record<string, string> | undefined, sessions: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(drafts ?? {}).filter(([id, text]) => text && id in sessions));
}
