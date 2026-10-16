import { useStore } from '../../store/store';
import type { Workspace } from '../types';

/**
 * A failed turn only: in auto, the latest request asked to make something (not a question) and the agent ended
 * with text alone — no plan or questions card after that request.
 */
const MAKE_WORDS = /\b(crea|cre[aá]me|haz|hazle|hazme|genera|gen[eé]rala|gen[eé]ralo|dibuja|pinta|anima|edita|cambia|a[nñ]ade|agrega|quita|pon|ponle|convierte|mejora|rehaz|redise[nñ]a|render|create|make|generate|draw|paint|animate|edit|change|add|remove|turn|upscale|design)\w*/i;

export function endedWithoutPlan(sessionId: string, workspace: Workspace): boolean {
  if (useStore.getState().composer.agentStyle !== 'auto') return false;
  const feed = useStore.getState().sessions[sessionId].feed.filter((f) => f.workspace === workspace);
  const at = feed.map((f) => f.type).lastIndexOf('user');
  const request = feed[at];
  // Only a request to make or change something (not a question, a greeting or "let's move to the canvas").
  if (request?.type !== 'user' || /[?¿]/.test(request.text) || !MAKE_WORDS.test(request.text)) return false;
  return !feed.slice(at + 1).some((f) => f.type === 'plan' || f.type === 'questions');
}
