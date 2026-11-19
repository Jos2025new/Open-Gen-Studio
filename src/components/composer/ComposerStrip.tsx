import type { ReactNode } from 'react';
import { AgentControls } from './AgentControls';
import { AgentModelControls } from './AgentModelControls';
import { MediaControls, ModelChip } from './MediaControls';
import { ScrollRail } from './ScrollRail';
import { useStore } from '../../store/store';

/** The settings of the mode just above the prompt, without a background: the model at the far end, the rest in a row that scrolls with « » when it does not fit. */
export function ComposerStrip({ target, chatNodeId }: { /** What a generation lands on, when the workspace has a choice. */ target?: ReactNode; /** The chat this composer belongs to: its recipient is the agent whose model it shows. */ chatNodeId?: string }) {
  const mode = useStore((s) => s.composer.mode);
  const workspace = useStore((s) => s.ui.workspace);
  const agent = mode === 'agent', designer = workspace === 'designer';
  return <div className="composer-strip" aria-label="Mode settings" role="group">
    <ScrollRail backLabel="Previous settings" onLabel="More settings">
      {agent ? <AgentControls showMode={!designer} activeOnly={false} /> : <MediaControls kind={mode} showModel={false} />}
      {target}
    </ScrollRail>
    <div className="composer-strip-end">
      {agent ? (designer ? null : <AgentModelControls chatNodeId={chatNodeId} />) : <ModelChip kind={mode} />}
    </div>
  </div>;
}
