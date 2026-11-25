import { useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, FolderInput, FolderOutput, Group, Trash } from '../ui/icons';
import { createEmptyGroup, duplicateGroup, groupFrameBounds, groupSubtree, reparentGroup } from '../../engine/flow/arrange';
import type { Graph, GraphGroup } from '../../engine/types';
import { MenuItem } from '../ui/primitives';

/** Right-click menu of a node on the canvas. */
export function NodeContextMenu({ onDuplicate, onDelete }: { onDuplicate: () => void; onDelete: () => void }) {
  return (
    <div className="menu">
      <MenuItem icon={Copy} label="Duplicate" onClick={onDuplicate} />
      <MenuItem icon={Trash} label="Delete" detail="Del" danger onClick={onDelete} />
    </div>
  );
}

/** Right-click menu of a group frame: duplicate subtree, add subgroup, nest/unnest, delete. */
export function GroupContextMenu({ sessionId, graph, group, onDone, onDelete }: {
  sessionId: string; graph: Graph; group: GraphGroup; onDone: (select?: string[]) => void; onDelete: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const sub = groupSubtree(graph.groups, group.id).groupIds;
  const parent = group.parentId ? graph.groups?.find((g) => g.id === group.parentId) : undefined;
  const targets = (graph.groups ?? []).filter((g) => !sub.has(g.id) && g.id !== group.parentId && !('detachedOutputs' in g));
  if (picking) {
    return (
      <div className="menu">
        <MenuItem icon={ChevronLeft} label="Back" onClick={() => setPicking(false)} />
        {targets.map((t) => <MenuItem key={t.id} icon={Group} label={t.title} onClick={() => { reparentGroup(sessionId, group.id, t.id); onDone(); }} />)}
      </div>
    );
  }
  const addSub = () => {
    const b = groupFrameBounds(graph, group.id, new Map());
    const id = createEmptyGroup(sessionId, b ? { x: b.x + 28, y: b.y + 46 } : undefined, undefined, group.id);
    onDone(id ? [id] : undefined);
  };
  return (
    <div className="menu">
      {!('detachedOutputs' in group) ? <MenuItem icon={Copy} label="Duplicate" onClick={() => { const id = duplicateGroup(sessionId, group.id); onDone(id ? [id] : undefined); }} /> : null}
      {!('detachedOutputs' in group) ? <MenuItem icon={Group} label="Add subgroup" onClick={addSub} /> : null}
      {!('detachedOutputs' in group) && targets.length ? <MenuItem icon={FolderInput} label="Move into" right={<ChevronRight size={14} />} onClick={() => setPicking(true)} /> : null}
      {parent ? <MenuItem icon={FolderOutput} label="Move out" onClick={() => { reparentGroup(sessionId, group.id, parent.parentId); onDone(); }} /> : null}
      <MenuItem icon={Trash} label="Delete" detail="Del" danger onClick={onDelete} />
    </div>
  );
}

/** The rubber-band rectangle drawn while box-selecting (screen coordinates). */
export function BoxSelectRect({ box }: { box: { x0: number; y0: number; x1: number; y1: number } }) {
  return <div className="node-box-select" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />;
}
