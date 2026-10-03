import { Pencil } from 'lucide-react';
import { canReopenCard, reopenCard } from '../../engine/agent/runtime';
import { useStore } from '../../store/store';

/**
 * "Edit" on an answered card, shown on hover like the edit of a message: the conversation goes back to that card
 * (what came after leaves the chat and the agent's context) and the card opens again with the earlier choices.
 */
export function EditAnswerButton({ sessionId, itemId }: { sessionId: string; itemId: string }) {
  // Re-render when the agent starts or stops, or the conversation changes.
  useStore((s) => s.sessions[sessionId]?.agent.busy);
  useStore((s) => s.sessions[sessionId]?.agent.history.length);
  if (!canReopenCard(sessionId, itemId)) return null;
  return (
    <button type="button" className="card-edit" data-tip="Edit — everything after this card is discarded" onClick={() => reopenCard(sessionId, itemId)}>
      <Pencil size={11} /> Edit
    </button>
  );
}
