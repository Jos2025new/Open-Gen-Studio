import { useStore } from '../../store/store';
import { AGENT_ATTACHABLE, toggleAgentAttachment } from '../../engine/actions';

/**
 * A small checkbox over a result (image, video, audio or 3D; chat, node or reference thumbnail): it adds that asset to the
 * agent's attachment list, or removes it, in the order the boxes were ticked. Only existing assets:
 * nothing is imported, copied or sent — the checkbox just names an asset the agent may reuse from the chat.
 */
export function AgentAttachToggle({ assetId, className }: { assetId: string; className?: string }) {
  const attachable = useStore((s) => AGENT_ATTACHABLE.includes(s.assets[assetId]?.kind ?? ''));
  const order = useStore((s) => s.composer.attachments.indexOf(assetId));
  if (!attachable) return null;
  const on = order >= 0;
  return (
    <button
      type="button"
      className={`attach-toggle ${on ? 'is-on' : ''} ${className ?? ''}`}
      role="checkbox"
      aria-checked={on}
      aria-label={on ? 'Remove from the agent context' : 'Add to the agent context'}
      data-tip={on ? `In the agent context · position ${order + 1}` : 'Add to the agent context'}
      onClick={(e) => {
        // Over an image that itself reacts to clicks (opens the viewer, selects an output): only the box acts.
        e.stopPropagation();
        e.preventDefault();
        toggleAgentAttachment(assetId);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="attach-toggle-box">{on ? order + 1 : null}</span>
    </button>
  );
}
