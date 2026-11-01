import { create } from 'zustand';
import { Ellipsis } from 'lucide-react';
import { OPS } from '../../engine/ops';
import { addConnected, newNodeData } from '../../engine/flow/actions';
import type { GraphNode, OpId, PortType } from '../../engine/types';
import { OP_ICONS } from '../assets/AssetActions';

/** Whether the Selection panel (the result's tools, at the right) is shown. Hidden until asked for; not persisted. */
export const useSelectionPanel = create<{ open: boolean }>(() => ({ open: false }));
export const toggleSelectionPanel = (open?: boolean) => useSelectionPanel.setState((s) => ({ open: open ?? !s.open }));

/** The three tools used most on each kind of result, first in the node bar. */
const KEY_TOOLS: Partial<Record<PortType, OpId[]>> = {
  image: ['angle', 'relight', 'animate'],
  video: ['extract_frame', 'continue', 'video_upscale'],
  audio: ['transcribe'],
};

/** Key tools as one group of icons; each adds a connected tool node, as the panel's do. */
export function KeyTools({ sessionId, node, out }: { sessionId: string; node: GraphNode; out: PortType }) {
  const ids = (KEY_TOOLS[out] ?? []).filter((id) => OPS[id].input === out);
  if (!ids.length) return null;
  return (
    <div className="nt-group" role="group" aria-label="Key tools">
      {ids.map((id) => {
        const Icon = OP_ICONS[id];
        return (
          <button key={id} type="button" className="nt-btn nt-icon nodrag" aria-label={OPS[id].label} data-tip={`${OPS[id].label} · ${OPS[id].description} (adds a connected node)`} onClick={() => addConnected(sessionId, node.id, newNodeData('tool', { op: id }))}>
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}

/** "…" at the end of the node bar: shows or hides the Selection panel with every tool for the result. */
export function PanelToggle() {
  const open = useSelectionPanel((s) => s.open);
  return (
    <button type="button" className={`nt-btn nt-icon nodrag ${open ? 'is-open' : ''}`} aria-label={open ? 'Hide all tools' : 'All tools'} aria-pressed={open} data-tip={open ? 'Hide all tools' : 'All tools'} onClick={() => toggleSelectionPanel()}>
      <Ellipsis size={14} />
    </button>
  );
}
