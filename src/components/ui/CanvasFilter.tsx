import { MessageSquare, PenTool, Workflow } from 'lucide-react';
import type { Workspace } from '../../engine/types';

export type CanvasFilterValue = 'all' | Workspace;
export const CANVAS_LABEL: Record<Workspace, string> = { chat: 'Chat', node: 'Nodes', designer: 'Designer' };
const ICON = { chat: MessageSquare, node: Workflow, designer: PenTool } as const;

/** All · Chat · Nodes · Designer with counts, the same tabs the Sessions panel uses (empty ones are disabled). */
export function CanvasFilter({ value, counts, onChange }: { value: CanvasFilterValue; counts: Record<CanvasFilterValue, number>; onChange: (v: CanvasFilterValue) => void }) {
  return (
    <div className="sv-canvas">
      {(['all', 'chat', 'node', 'designer'] as const).map((w) => {
        const Icon = w === 'all' ? null : ICON[w];
        return (
          <button key={w} type="button" className={`canvas-tab ${value === w ? 'is-on' : ''}`} onClick={() => onChange(w)} disabled={w !== 'all' && !counts[w]}>
            {Icon ? <Icon size={12} /> : null}
            {w === 'all' ? 'All' : CANVAS_LABEL[w]}
            <span className="num faint">{counts[w]}</span>
          </button>
        );
      })}
    </div>
  );
}
