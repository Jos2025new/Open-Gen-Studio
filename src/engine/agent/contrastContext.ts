import { contrastLine } from '../contrast';
import type { Session } from '../types';

/** The context line when the session's latest user message asks for a contrast level. */
export function contrastLines(session: Session): string[] {
  const last = [...session.feed].reverse().find((f) => f.type === 'user');
  const line = last?.type === 'user' ? contrastLine(last.text) : undefined;
  return line ? [line] : [];
}
