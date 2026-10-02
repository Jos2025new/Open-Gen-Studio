import { memo, useState } from 'react';
import { NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ChevronDown, ChevronRight, ClipboardCopy, Group, Scissors, Trash, Ungroup, X,
} from 'lucide-react';
import { alignNodes, copyNodes, cutNodes, groupNodes, renameGroup, setGroupColor, ungroup, wholeGroup, type AlignMode, type AlignTo, type Sizes } from '../../engine/flow/arrange';
import { deleteNodes } from '../../engine/flow/actions';
import type { Graph, GraphGroup } from '../../engine/types';
import { toast } from '../../store/store';

const ALIGN: Array<{ id: AlignMode; label: string; icon: typeof AlignStartVertical }> = [
  { id: 'left', label: 'Left edges', icon: AlignStartVertical },
  { id: 'center', label: 'Centers', icon: AlignCenterVertical },
  { id: 'right', label: 'Right edges', icon: AlignEndVertical },
  { id: 'top', label: 'Top edges', icon: AlignStartHorizontal },
  { id: 'middle', label: 'Middles', icon: AlignCenterHorizontal },
  { id: 'bottom', label: 'Bottom edges', icon: AlignEndHorizontal },
  { id: 'distribute-h', label: 'Distribute horizontally', icon: AlignHorizontalDistributeCenter },
  { id: 'distribute-v', label: 'Distribute vertically', icon: AlignVerticalDistributeCenter },
];

/**
 * Several nodes selected: "Operations ▾" over them, in the same bar as a node's tools; it opens only on click into
 * Group (or Ungroup) · Align › (its options show on hover, with what to align to) · copy · cut · delete.
 */
export function Operations({ sessionId, graph, ids, sizes, onSelect }: { sessionId: string; graph: Graph; ids: string[]; sizes: Sizes; onSelect: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState(false);
  const [to, setTo] = useState<AlignTo>('selection');
  if (ids.length < 2) return null;
  const group = wholeGroup(graph, ids);
  return (
    <NodeToolbar nodeId={ids} isVisible position={Position.Top} offset={14}>
      <div className="nt-bar ops-bar nodrag">
        {!open ? (
          <button type="button" className="nt-btn" onClick={() => setOpen(true)}>
            Operations · {ids.length} <ChevronDown size={13} />
          </button>
        ) : (
          <>
            {group ? (
              <button type="button" className="nt-btn" data-tip="Ctrl+Shift+G" onClick={() => ungroup(sessionId, group.id)}>
                <Ungroup size={13} /> Ungroup
              </button>
            ) : (
              <button type="button" className="nt-btn" data-tip="Ctrl+G" onClick={() => groupNodes(sessionId, ids)}>
                <Group size={13} /> Group
              </button>
            )}
            <div className="ops-align" onMouseEnter={() => setAlign(true)} onMouseLeave={() => setAlign(false)}>
              <button type="button" className={`nt-btn ${align ? 'is-open' : ''}`} onClick={() => setAlign((v) => !v)}>
                <AlignStartVertical size={13} /> Align <ChevronRight size={12} />
              </button>
              {align ? (
                <div className="ops-sub nt-bar">
                  {ALIGN.map((a) => (
                    <button key={a.id} type="button" className="nt-btn ops-row" disabled={a.id.startsWith('distribute') && ids.length < 3} onClick={() => alignNodes(sessionId, ids, a.id, to, sizes)}>
                      <a.icon size={13} /> {a.label}
                    </button>
                  ))}
                  <div className="ops-to">
                    <span>Relative to</span>
                    {(['selection', 'first'] as const).map((t) => (
                      <button key={t} type="button" className={`nt-btn ${to === t ? 'is-open' : ''}`} aria-pressed={to === t} onClick={() => setTo(t)}>
                        {t === 'selection' ? 'Selection' : 'First selected'}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <span className="nt-sep" />
            <button type="button" className="nt-btn nt-icon" aria-label="Copy" data-tip="Copy (Ctrl+C)" onClick={() => toast(`Copied ${copyNodes(sessionId, ids)} nodes · Ctrl+V to paste`, 'success')}>
              <ClipboardCopy size={14} />
            </button>
            <button type="button" className="nt-btn nt-icon" aria-label="Cut" data-tip="Cut (Ctrl+X)" onClick={() => { cutNodes(sessionId, ids); onSelect([]); }}>
              <Scissors size={14} />
            </button>
            <button type="button" className="nt-btn nt-icon nt-danger" aria-label="Delete" data-tip="Delete" onClick={() => { deleteNodes(sessionId, ids); onSelect([]); }}>
              <Trash size={14} />
            </button>
            <span className="nt-sep" />
            <button type="button" className="nt-btn nt-icon" aria-label="Close" data-tip="Close" onClick={() => { setOpen(false); setAlign(false); }}>
              <X size={13} />
            </button>
          </>
        )}
      </div>
    </NodeToolbar>
  );
}

const COLORS = [undefined, '#d8ff3a', '#5ec8ff', '#b892ff', '#ff7ab6', '#ffc25e', '#86e3a5'];

export type GroupFlowNode = Node<{ group: GraphGroup; sessionId: string }, 'group'>;

/**
 * A group as a container on the canvas: a frame behind its nodes, sized from them (it follows them as they move).
 * Dragging it — also in hand mode — moves everything inside. Title: double-click to rename; the dot sets an
 * optional background color (none by default).
 */
export const GroupNode = memo(function GroupNode({ data, selected }: NodeProps<GroupFlowNode>) {
  const { group, sessionId } = data;
  const [editing, setEditing] = useState(false);
  const [palette, setPalette] = useState(false);
  return (
    <div className={`group-frame ${selected ? 'is-selected' : ''}`} style={group.color ? { background: `color-mix(in srgb, ${group.color} 10%, transparent)`, borderColor: `color-mix(in srgb, ${group.color} 55%, transparent)` } : undefined}>
      <div className="group-head">
        {editing ? (
          <input
            autoFocus
            className="group-title nodrag"
            defaultValue={group.title}
            onBlur={(e) => { renameGroup(sessionId, group.id, e.target.value); setEditing(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
              e.stopPropagation();
            }}
          />
        ) : (
          <span className="group-title" title="Drag the group to move everything in it · double-click to rename" onDoubleClick={() => setEditing(true)}>
            {group.title}
          </span>
        )}
        <button type="button" className="group-dot nodrag" aria-label="Background color" data-tip="Background color" style={group.color ? { background: group.color } : undefined} onClick={() => setPalette((v) => !v)} />
        {palette ? (
          <span className="group-palette nodrag">
            {COLORS.map((c) => (
              <button key={c ?? 'none'} type="button" className={`group-swatch ${c === group.color ? 'is-on' : ''} ${c ? '' : 'is-none'}`} aria-label={c ?? 'No color'} style={c ? { background: c } : undefined} onClick={() => { setGroupColor(sessionId, group.id, c); setPalette(false); }} />
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
});
