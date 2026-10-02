import { useState } from 'react';
import { NodeToolbar, Position, ViewportPortal, useReactFlow } from '@xyflow/react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ChevronDown, ChevronRight, ClipboardCopy, Group, Scissors, Trash, Ungroup,
} from 'lucide-react';
import { alignNodes, copyNodes, cutNodes, groupNodes, moveGroup, renameGroup, ungroup, wholeGroup, type AlignMode, type AlignTo, type Sizes } from '../../engine/flow/arrange';
import { deleteNodes } from '../../engine/flow/actions';
import { NODE_WIDTH } from '../../engine/flow/graph';
import type { Graph } from '../../engine/types';
import { toast } from '../../store/store';
import { Popover, usePopover } from '../ui/Popover';
import { Chip, IconButton, MenuItem } from '../ui/primitives';

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
 * Several nodes selected: a small "Operations" button over them that opens only on click (the popover goes down or
 * up, where there is room): Group (or Ungroup), Align » (on hover, with what to align to), and copy · cut · delete.
 */
export function Operations({ sessionId, graph, ids, sizes, onSelect }: { sessionId: string; graph: Graph; ids: string[]; sizes: Sizes; onSelect: (ids: string[]) => void }) {
  const pop = usePopover();
  const [alignOpen, setAlignOpen] = useState(false);
  const [to, setTo] = useState<AlignTo>('selection');
  const group = wholeGroup(graph, ids);
  if (ids.length < 2) return null;
  const done = () => pop.close();
  return (
    <NodeToolbar nodeId={ids} isVisible position={Position.Top} offset={16}>
      <Chip ref={pop.ref} active={pop.open} onClick={pop.toggle} className="ops-chip">
        Operations · {ids.length}
        <ChevronDown size={12} />
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={() => { setAlignOpen(false); pop.close(); }} width={230} label="Operations">
        <div className="menu ops-menu">
          {group ? (
            <MenuItem icon={Ungroup} label={`Ungroup “${group.title}”`} onClick={() => { ungroup(sessionId, group.id); done(); }} />
          ) : (
            <MenuItem icon={Group} label="Group" detail="Ctrl+G" onClick={() => { groupNodes(sessionId, ids); done(); }} />
          )}
          <div className="ops-align" onMouseEnter={() => setAlignOpen(true)} onMouseLeave={() => setAlignOpen(false)}>
            <button type="button" className="menu-item ops-align-head" aria-expanded={alignOpen} onClick={() => setAlignOpen((v) => !v)}>
              <span>Align</span>
              <ChevronRight size={13} className="ops-more" />
            </button>
            {alignOpen ? (
              <div className="ops-sub">
                {ALIGN.map((a) => (
                  <MenuItem
                    key={a.id}
                    icon={a.icon}
                    label={a.label}
                    disabled={a.id.startsWith('distribute') && ids.length < 3}
                    onClick={() => alignNodes(sessionId, ids, a.id, to, sizes)}
                  />
                ))}
                <div className="ops-to">
                  <span className="faint">Relative to</span>
                  <div className="ops-to-opts">
                    {(['selection', 'first'] as const).map((t) => (
                      <button key={t} type="button" className={`ml-filter ${to === t ? 'is-active' : ''}`} aria-pressed={to === t} onClick={() => setTo(t)}>
                        {t === 'selection' ? 'Selection' : 'First selected'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <div className="ops-icons">
            <IconButton icon={ClipboardCopy} label="Copy (Ctrl+C)" size="sm" onClick={() => { toast(`Copied ${copyNodes(sessionId, ids)} nodes · Ctrl+V to paste`, 'success'); done(); }} />
            <IconButton icon={Scissors} label="Cut (Ctrl+X)" size="sm" onClick={() => { cutNodes(sessionId, ids); onSelect([]); done(); }} />
            <IconButton icon={Trash} label="Delete" size="sm" tone="danger" onClick={() => { deleteNodes(sessionId, ids); onSelect([]); done(); }} />
          </div>
        </div>
      </Popover>
    </NodeToolbar>
  );
}

/** Group frames behind their nodes: drag the title to move the group, click it to select its nodes, double-click to rename. */
export function GroupFrames({ sessionId, graph, sizes, onSelect }: { sessionId: string; graph: Graph; sizes: Sizes; onSelect: (ids: string[]) => void }) {
  const rf = useReactFlow();
  const [editing, setEditing] = useState<string | null>(null);
  if (!graph.groups?.length) return null;
  return (
    <ViewportPortal>
      {graph.groups.map((g) => {
        const members = graph.nodes.filter((n) => g.nodeIds.includes(n.id));
        if (!members.length) return null;
        const pad = 24;
        const l = Math.min(...members.map((n) => n.position.x)) - pad;
        const t = Math.min(...members.map((n) => n.position.y)) - pad;
        const r = Math.max(...members.map((n) => n.position.x + (sizes.get(n.id)?.width ?? NODE_WIDTH))) + pad;
        const b = Math.max(...members.map((n) => n.position.y + (sizes.get(n.id)?.height ?? 220))) + pad;
        return (
          <div key={g.id} className="group-frame" style={{ transform: `translate(${l}px, ${t}px)`, width: r - l, height: b - t }}>
            {editing === g.id ? (
              <input
                autoFocus
                className="group-title nodrag"
                defaultValue={g.title}
                onBlur={(e) => { renameGroup(sessionId, g.id, e.target.value); setEditing(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditing(null);
                  e.stopPropagation();
                }}
              />
            ) : (
              <div
                className="group-title"
                title="Drag to move · click to select · double-click to rename"
                onDoubleClick={() => setEditing(g.id)}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const start = { x: e.clientX, y: e.clientY };
                  let last = start;
                  let moved = false;
                  const move = (ev: PointerEvent) => {
                    const z = rf.getZoom();
                    const dx = (ev.clientX - last.x) / z, dy = (ev.clientY - last.y) / z;
                    if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 3) moved = true;
                    if (moved && (dx || dy)) moveGroup(sessionId, g.id, dx, dy);
                    last = { x: ev.clientX, y: ev.clientY };
                  };
                  const up = () => {
                    window.removeEventListener('pointermove', move);
                    window.removeEventListener('pointerup', up);
                    if (!moved) onSelect(g.nodeIds);
                  };
                  window.addEventListener('pointermove', move);
                  window.addEventListener('pointerup', up);
                }}
              >
                {g.title}
              </div>
            )}
          </div>
        );
      })}
    </ViewportPortal>
  );
}
