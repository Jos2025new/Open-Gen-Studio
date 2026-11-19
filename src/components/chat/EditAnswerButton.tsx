import { Pencil } from '../ui/icons';
import { laneOfItem } from '../../engine/agent/lanes';
import { useThread } from '../../engine/agent/useThread';
import { canReopenCard, reopenCard } from '../../engine/agent/runtime';

/**
 * "Edit" on an answered card, shown on hover like the edit of a message: the conversation goes back to that card
 * (what came after leaves the chat and the agent's context) and the card opens again with the earlier choices.
 */
export function EditAnswerButton({ sessionId, itemId }: { sessionId: string; itemId: string }) {
  // Re-render when the agent starts or stops, or the conversation changes.
  const owner = laneOfItem(sessionId, itemId); // the agent that raised the card
  useThread(sessionId, owner, (a) => a.busy, false);
  useThread(sessionId, owner, (a) => a.history.length, 0);
  if (!canReopenCard(sessionId, itemId)) return null;
  return (
    <button type="button" className="card-edit" data-tip="Edit — everything after this card is discarded" onClick={() => reopenCard(sessionId, itemId)}>
      <Pencil size={11} /> Edit
    </button>
  );
}
