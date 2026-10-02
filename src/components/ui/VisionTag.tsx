import { Eye, EyeOff } from 'lucide-react';

/**
 * Whether an agent model sees images, as its provider's catalog says. Without vision the agent cannot look at
 * attachments, the Designer page or results (find_assets); it still plans and edits by asset id.
 */
export function VisionTag({ vision, full }: { vision?: boolean; full?: boolean }) {
  if (vision === true)
    return (
      <span className="vision-tag is-on" data-tip="Sees images: attachments, the Designer page and results it looks at">
        <Eye size={11} />
        {full ? 'Vision' : null}
      </span>
    );
  if (vision === false)
    return (
      <span className="vision-tag is-off" data-tip="No vision: it cannot look at attachments, the Designer page or results; it still works by their ids">
        <EyeOff size={11} />
        {full ? 'No vision' : null}
      </span>
    );
  return (
    <span className="vision-tag" data-tip="The provider does not say whether it sees images">
      <Eye size={11} />
      {full ? 'Vision ?' : '?'}
    </span>
  );
}
