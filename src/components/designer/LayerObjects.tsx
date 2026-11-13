import { useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronRight, Circle, Eye, EyeOff, Folder, Lock, Minus, PenTool, Spline, Square, Unlock } from '../ui/icons';
import { IconButton } from '../ui/primitives';
import type { DesignDoc, Layer, ObjectGroup, VectorLayer } from '../../engine/types';
import { setActiveLayer } from '../../engine/design/actions';
import { setLayerPicks } from '../../engine/design/selection';
import { objectPicks, setObjectPicks, useObjectSelection } from '../../engine/design/objectSelection';
import { groupChain, groupLook, groupMembers, pickable } from '../../engine/design/objectGroupTree';
import { renameObjectGroup, setObjectMeta } from '../../engine/design/objectGroups';
import type { ObjectMeta } from '../../engine/objectMeta';

/*
 * A layer's objects under its row, as Inkscape's Layers and Objects: groups (nesting, collapsible, double-click to
 * rename) and shapes / strokes in paint order, topmost first. A click picks that item; Ctrl/Shift-click adds or removes.
 */

const KIND: Record<string, string> = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', path: 'Path' };
const ICON = { rect: Square, ellipse: Circle, line: Minus, path: Spline, stroke: PenTool } as const;
type Node = { kind: 'group'; group: ObjectGroup; children: Node[] } | { kind: 'item'; id: string; label: string; icon: keyof typeof ICON; /** A vector shape: it can be renamed, hidden and locked. */ meta?: ObjectMeta };

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
  if (layer.type === 'text') return [{ kind: 'item', id: layer.id, label: layer.name, icon: 'path' }];
  if (layer.type === 'raster') {
    // An image painted over: the image first, its strokes below (top stroke first).
    const whole: Node = { kind: 'item', id: layer.id, label: layer.name, icon: 'stroke' };
    if (!layer.paintStrokes?.length) return [whole];
    const strokes = layer.paintStrokes.filter((s) => !s.erase).map((s, i) => ({ kind: 'item' as const, id: s.id, label: `Stroke ${i + 1}`, icon: 'stroke' as const })).reverse();
    return layer.sourceAssetId ? [whole, ...strokes] : strokes;
  }
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
    into.push({ kind: 'item', id: s.id, label: s.name || `${KIND[s.type] ?? 'Shape'} ${i + 1}`, icon: s.type in ICON ? s.type : 'path', meta: s });
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
  const vector = layer as VectorLayer;
  // A group is picked whole, its hidden and locked members with it; it can be picked while one member can.
  const members = (g: ObjectGroup) => { const all = groupMembers(vector, g.id); return all.some((s) => pickable(vector, s)) ? all.map((s) => s.id) : []; };
  const additive = (e: React.MouseEvent) => e.ctrlKey || e.metaKey || e.shiftKey;
  // Eye and lock of a shape or group, as on a layer row: shown on hover, and always while set.
  const toggles = (id: string, m: ObjectMeta, name: string) => <>
    <IconButton className={`layer-toggle ${m.hidden ? 'is-on' : ''}`} icon={m.hidden ? EyeOff : Eye} label={`${m.hidden ? 'Show' : 'Hide'} ${name}`} size="sm" onClick={() => setObjectMeta(sessionId, doc.id, layer.id, id, { hidden: !m.hidden })} />
    <IconButton className={`layer-toggle ${m.locked ? 'is-on' : ''}`} icon={m.locked ? Lock : Unlock} label={`${m.locked ? 'Unlock' : 'Lock'} ${name}`} size="sm" onClick={() => setObjectMeta(sessionId, doc.id, layer.id, id, { locked: !m.locked })} />
  </>;
  const nameField = (label: string, value: string, save: (name: string) => void) => <input className="layer-name-inline" aria-label={label} autoFocus defaultValue={value} onBlur={(e) => { const name = e.target.value.trim(); if (name !== value) save(name); setEditing(null); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = value; setEditing(null); } e.stopPropagation(); }} />;
  const row = (n: Node, depth: number): React.ReactNode => {
    const pad = { paddingLeft: `${0.5 + depth * 1}rem` };
    if (n.kind === 'item') {
      const I = ICON[n.icon];
      if (!n.meta) return <button key={n.id} className={`layer-object${picked.has(n.id) ? ' is-picked' : ''}`} style={pad} onClick={(e) => pick([n.id], additive(e))}><I size={14} />{n.label}</button>;
      const off = !pickable(vector, n.meta as VectorLayer['shapes'][number]);
      return <div key={n.id} className={`layer-object${picked.has(n.id) ? ' is-picked' : ''}${off ? ' is-off' : ''}`} style={pad}>
        {editing === n.id
          ? nameField('Object name', n.meta.name ?? '', (name) => setObjectMeta(sessionId, doc.id, layer.id, n.id, { name }))
          : <button className="layer-object-name" onClick={(e) => { if (!off) pick([n.id], additive(e)); }} onDoubleClick={() => setEditing(n.id)}><I size={14} />{n.label}</button>}
        {toggles(n.id, n.meta, n.label)}
      </div>;
    }
    const ids = members(n.group), on = ids.length > 0 && ids.every((x) => picked.has(x)), shut = n.group.collapsed;
    return <div key={n.group.id} className="layer-object-group">
      <div className={`layer-object${on ? ' is-picked' : ''}${ids.length ? '' : ' is-off'}`} style={pad}>
        <button className="layer-object-toggle" aria-label={shut ? 'Expand group' : 'Collapse group'} onClick={() => renameObjectGroup(sessionId, doc.id, layer.id, n.group.id, { collapsed: !shut })}>{shut ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
        {editing === n.group.id
          ? nameField('Group name', n.group.name, (name) => { if (name) renameObjectGroup(sessionId, doc.id, layer.id, n.group.id, { name }); })
          : <button className="layer-object-name" onClick={(e) => { if (ids.length) pick(ids, additive(e)); }} onDoubleClick={() => setEditing(n.group.id)} data-tip={groupLook(n.group) ? `This group has its own look: ${Math.round((n.group.opacity ?? 1) * 100)}% opacity, ${n.group.blend ?? 'normal'} blend` : undefined}><Folder size={14} /> {n.group.name}</button>}
        {toggles(n.group.id, n.group, n.group.name)}
      </div>
      {!shut && n.children.map((c) => row(c, depth + 1))}
    </div>;
  };
  return <div className="layer-objects">{nodes.map((n) => row(n, 0))}</div>;
}
