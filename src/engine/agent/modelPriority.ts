/** Resolve intent once; a comparison chooses models for this request, never a new session default. */
export function modelPriority(p: { picked?: string; session?: string; composer?: string; proposed?: string; userRequested?: boolean; comparison?: boolean }): { modelRef: string | undefined; reason: string } {
  if (p.picked) return { modelRef: p.picked, reason: 'card' };
  if (p.proposed && p.comparison) return { modelRef: p.proposed, reason: 'comparison' };
  if (p.proposed && p.userRequested) return { modelRef: p.proposed, reason: 'user request' };
  if (p.session) return { modelRef: p.session, reason: 'session' };
  return { modelRef: p.composer, reason: 'composer' };
}
