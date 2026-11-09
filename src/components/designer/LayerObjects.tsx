import { useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronRight, Circle, Folder, Minus, PenTool, Spline, Square } from '../ui/icons';
import type { DesignDoc, Layer, ObjectGroup, VectorLayer } from '../../engine/types';
import { setActiveLayer } from '../../engine/design/actions';
import { setLayerPicks } from '../../engine/design/selection';
import { objectPicks, setObjectPicks, useObjectSelection } from '../../engine/design/objectSelection';
import { groupChain, inGroup } from '../../engine/design/objectGroupTree';
import { renameObjectGroup } from '../../engine/design/objectGroups';

/*
 * A layer's objects under its row, as Inkscape's Layers and Objects: groups (nesting, collapsible, double-click to
 * rename) and shapes / strokes in paint order, topmost first. A click picks that item; Ctrl/Shift-click adds or removes.
 */

const KIND: Record<string, string> = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', path: 'Path' };
const ICON = { rect: Square, ellipse: Circle, line: Minus, path: Spline, stroke: PenTool } as const;
type Node = { kind: 'group'; group: ObjectGroup; children: Node[] } | { kind: 'item'; id: string; label: string; icon: keyof typeof ICON };

// Which layers show their objects: shared by the chevron in the layer row and the list under it.
let shown = new Set<string>();
const subs = new Set<() => void>();
const useShown = (id: string) => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => shown.has(id));
const toggleShown = (id: string) => { shown = new Set(shown); if (!shown.delete(id)) shown.add(id); subs.forEach((f) => f()); };

/** The chevron at the start of a layer row: opens its objects (an empty slot keeps rows aligned). */
export function LayerObjectsToggle({ layer }: { layer: Layer }) {
  const open = useShown(layer.id);
  if (!tree(layer).length) return <span className="layer-objects-chevron" aria-hidden />;
  return <button className="layer-objects-chevron" aria-expanded={open} aria-label={open ? 'Hide objects' : 'Show objects'} onClick={() => toggleShown(layer.id)}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>;
}

function tree(layer: Layer): Node[] {
  if (layer.type === 'raster') return (layer.paintStrokes ?? []).filter((s) => !s.erase).map((s, i) => ({ kind: 'item' as const, id: s.id, label: `Stroke ${i + 1}`, icon: 'stroke' as const })).reverse();
  if (layer.type !== 'vector') return [];
  const root: Node[] = [];
  const open = new Map<string, Node & { kind: 'group' }>();
  layer.shapes.forEach((s, i) => {
    let into = root;
    for (const g of groupChain(layer, s.groupId).reverse()) {
      let n = open.get(g.id);
      if (!n) { n = { kind: 'group', group: g, children: [] }; open.set(g.id, n); into.push(n); }
      into = n.children;
    }
    into.push({ kind: 'item', id: s.id, label: `${KIND[s.type] ?? 'Shape'} ${i + 1}`, icon: s.type in ICON ? s.type : 'path' });
  });
  (layer.strokes ?? []).forEach((s, i) => root.push({ kind: 'item', id: s.id, label: `Lineart ${i + 1}`, icon: 'stroke' }));
  const rev = (ns: Node[]): Node[] => ns.reverse().map((n) => (n.kind === 'group' ? { ...n, children: rev(n.children) } : n));
  return rev(root);
}

export function LayerObjects({ sessionId, doc, layer }: { sessionId: string; doc: DesignDoc; layer: Layer }) {
  const open = useShown(layer.id);
  const [editing, setEditing] = useState<string | null>(null);
  const picks = useObjectSelection((st) => st.byDoc[doc.id]);
  const nodes = tree(layer);
  if (!nodes.length || !open) return null;
  const picked = new Set(picks?.find((p) => p.layerId === layer.id)?.ids ?? []);
  const pick = (ids: string[], add: boolean) => {
    const cur = objectPicks(doc.id).find((p) => p.layerId === layer.id)?.ids ?? [];
    const all = add ? (ids.every((x) => cur.includes(x)) ? cur.filter((x) => !ids.includes(x)) : [...cur, ...ids.filter((x) => !cur.includes(x))]) : ids;
    setLayerPicks(doc.id, []);
    setObjectPicks(doc.id, all.length ? [{ layerId: layer.id, ids: all }] : null);
    if (doc.activeLayerId !== layer.id) setActiveLayer(sessionId, doc.id, layer.id);
  };
  const members = (g: ObjectGroup) => (layer as VectorLayer).shapes.filter((s) => inGroup(layer as VectorLayer, s, g.id)).map((s) => s.id);
  const row = (n: Node, depth: number): React.ReactNode => {
    const pad = { paddingLeft: `${0.5 + depth * 1}rem` };
    if (n.kind === 'item') return <button key={n.id} className={`layer-object${picked.has(n.id) ? ' is-picked' : ''}`} style={pad} onClick={(e) => pick([n.id], e.ctrlKey || e.metaKey || e.shiftKey)}>{(() => { const I = ICON[n.icon]; return <I size={14} />; })()}{n.label}</button>;
    const ids = members(n.group), on = ids.length > 0 && ids.every((x) => picked.has(x)), shut = n.group.collapsed;
    return <div key={n.group.id} className="layer-object-group">
      <div className={`layer-object${on ? ' is-picked' : ''}`} style={pad}>
        <button className="layer-object-toggle" aria-label={shut ? 'Expand group' : 'Collapse group'} onClick={() => renameObjectGroup(sessionId, doc.id, layer.id, n.group.id, { collapsed: !shut })}>{shut ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
        {editing === n.group.id
          ? <input className="layer-name-inline" aria-label="Group name" autoFocus defaultValue={n.group.name} onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== n.group.name) renameObjectGroup(sessionId, doc.id, layer.id, n.group.id, { name }); setEditing(null); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null); e.stopPropagation(); }} />
          : <button className="layer-object-name" onClick={(e) => pick(ids, e.ctrlKey || e.metaKey || e.shiftKey)} onDoubleClick={() => setEditing(n.group.id)}><Folder size={14} /> {n.group.name}</button>}
      </div>
      {!shut && n.children.map((c) => row(c, depth + 1))}
    </div>;
  };
  return <div className="layer-objects">{nodes.map((n) => row(n, 0))}</div>;
}
