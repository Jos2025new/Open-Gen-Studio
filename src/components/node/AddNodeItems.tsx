import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronRight, FileImage, MessageSquare, PenTool, Search, Upload, Wand, Workflow, type LucideIcon } from '../ui/icons';
import { OPS, OP_IDS } from '../../engine/ops';
import { newNodeData } from '../../engine/flow/actions';
import { inputPorts, portFits } from '../../engine/flow/graph';
import { MEDIA_KINDS, type GraphNodeData, type MediaKind, type OpId, type PortType, type SystemNodeType } from '../../engine/types';
import { OMNI_SPACES, OMNI_SPACE_TITLES, type OmniSpace } from '../../engine/nodes/omniSpaces';
import { SYSTEM_NODE_TYPES } from '../../engine/nodes/spec';
import { OP_ICONS } from '../assets/AssetActions';
import { MenuItem } from '../ui/primitives';
import { NODE_UIS, type NodeUi } from './nodeUi';
import { SYSTEM_MENU_ORDER, SYSTEM_UIS } from './systemUi';

const MENU_TIP_DELAY = 2500;

type Kind = MediaKind | 'text';
interface Entry { id: string; section: 'spaces' | 'system' | 'media' | 'nodes' | 'tools'; kind?: Kind; icon: LucideIcon; label: string; sub: string; keywords: string; run: () => void }
const KIND_LABEL: Record<Kind, string> = { image: 'Image', video: 'Video', audio: 'Audio', model3d: '3D', text: 'Text' };
const SECTION_LABEL = { spaces: 'Spaces', system: 'System', media: 'Media', nodes: 'Nodes', tools: 'Tools' } as const;

/** The omnicanvas also takes the session's own parts as nodes (a library where everything is a node). `has`: that Space already has its one node. */
export interface OmniEntries { /** False on the ordinary Nodes canvas: system parts only, no Space nodes. */ spaces?: boolean; has: (space: OmniSpace) => boolean; onSpace: (space: OmniSpace) => void; onSystem: (type: SystemNodeType) => void }
const SPACE_ICON: Record<OmniSpace, LucideIcon> = { studio: MessageSquare, nodes: Workflow, designer: PenTool };
const SPACE_SUB: Record<OmniSpace, string> = { studio: 'Chat and results', nodes: 'Connected flows of cards', designer: 'Layers: raster, vector and text' };
/** The same node kinds and tools as AddNodeItems, as one flat list for the library panel. */
function libraryEntries({ onPick, onAsset, onImport, omni }: { onPick: (data: GraphNodeData) => void; onAsset?: () => void; onImport?: () => void; omni?: OmniEntries }): Entry[] {
  const node = (ui: NodeUi): Entry => ({ id: ui.kind, section: 'nodes', kind: ui.chip, icon: ui.icon, label: ui.label, sub: ui.sub, keywords: ui.keywords, run: () => onPick(newNodeData(ui.kind)) });
  return [
    ...(onImport ? [{ id: 'import', section: 'media' as const, icon: Upload, label: 'Import images', sub: 'From your computer', keywords: 'upload import images files', run: onImport }] : []),
    ...(onAsset ? [{ id: 'asset', section: 'media' as const, icon: FileImage, label: 'Asset', sub: 'Drag one from the Library', keywords: 'asset gallery library', run: onAsset }] : []),
    ...NODE_UIS.map(node),
    ...(omni && omni.spaces !== false ? OMNI_SPACES.map((space): Entry => ({ id: `space-${space}`, section: 'spaces', icon: SPACE_ICON[space], label: OMNI_SPACE_TITLES[space], sub: omni.has(space) ? 'Already here: selects it (one per session)' : SPACE_SUB[space], keywords: `space ${space} thumbnail`, run: () => omni.onSpace(space) })) : []),
    ...(omni && omni.spaces !== false ? SYSTEM_MENU_ORDER.map((type): Entry => { const ui = SYSTEM_UIS[type]!; return { id: `sys-${type}`, section: 'system', icon: ui.icon, label: SYSTEM_NODE_TYPES[type].title, sub: ui.sub, keywords: `system ${ui.keywords}`, run: () => omni.onSystem(type) }; }) : []),
    ...OP_IDS.filter((id) => !OPS[id].multiInput).map((id): Entry => ({ id, section: 'tools', kind: OPS[id].input as Kind, icon: OP_ICONS[id], label: OPS[id].label, sub: `${OPS[id].input} → ${OPS[id].output}`, keywords: `${OPS[id].label} ${OPS[id].description} tool`, run: () => onPick(newNodeData('tool', { op: id as OpId })) })),
  ];
}

/** Add node from the canvas toolbox (2026-10-31): a library panel. A search field, kind chips, Media / Nodes / Tools
 *  sections with each entry's kind tinted on its icon and a line under its name, and the keyboard: type to filter,
 *  ↑↓ to move, Enter to add. Same entries as AddNodeItems (one list of node kinds). */
export function NodeLibrary({ onPick, onAsset, onImport, omni }: { onPick: (data: GraphNodeData) => void; onAsset?: () => void; onImport?: () => void; omni?: OmniEntries }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [at, setAt] = useState(0);
  const navByKey = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // The popover places itself after mounting, so the field takes the focus on the next frame (autoFocus is lost).
  useEffect(() => { const t = window.setTimeout(() => field.current?.focus(), 0); return () => window.clearTimeout(t); }, []);
  const entries = useMemo(() => libraryEntries({ onPick, onAsset, onImport, omni }), [onPick, onAsset, onImport, omni]);
  const q = query.trim().toLowerCase();
  const shown = entries.filter((e) => (kind === 'all' || e.kind === kind) && (!q || `${e.label} ${e.keywords}`.toLowerCase().includes(q)));
  useEffect(() => { navByKey.current = false; setAt(0); }, [query, kind]);
  useEffect(() => {
    if (!navByKey.current) return;
    navByKey.current = false;
    list.current?.querySelector('[data-at="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [at]);
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); navByKey.current = true; setAt((i) => (shown.length ? (i + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length : 0)); }
    if (e.key === 'Enter' && shown[at]) { e.preventDefault(); shown[at].run(); }
  };
  const chips: Array<Kind | 'all'> = ['all', ...MEDIA_KINDS, 'text'];
  return <div className="node-lib" onKeyDown={keys}>
    <label className="search-input node-lib-search"><Search size={14} aria-hidden /><input ref={field} type="search" aria-label="Search nodes and tools" placeholder="Search nodes and tools" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
    <div className="node-lib-chips" role="group" aria-label="Kind">
      {chips.map((c) => <button key={c} type="button" className={`node-lib-chip${kind === c ? ' is-on' : ''}`} aria-pressed={kind === c} onClick={() => setKind(c)}>{c === 'all' ? 'All' : KIND_LABEL[c]}</button>)}
    </div>
    <div ref={list} className="node-lib-list" role="listbox" aria-label="Nodes and tools">
      {(['media', 'nodes', 'spaces', 'system', 'tools'] as const).map((section) => {
        const items = shown.filter((e) => e.section === section);
        return items.length ? <div key={section} className="node-lib-sec" role="group" aria-label={SECTION_LABEL[section]}>
          <div className="node-lib-head">{SECTION_LABEL[section]}<span className="num">{items.length}</span></div>
          {items.map((e) => { const i = shown.indexOf(e); return (
            <button key={e.id} type="button" role="option" aria-selected={i === at} data-at={i === at} className={`node-lib-item${i === at ? ' is-at' : ''}${e.kind ? ` k-${e.kind}` : ''}`} onMouseEnter={() => { navByKey.current = false; setAt(i); }} onClick={e.run}>
              <span className="node-lib-icon"><e.icon size={16} strokeWidth={1.8} aria-hidden /></span>
              <span className="node-lib-text"><span>{e.label}</span><small>{e.sub}</small></span>
            </button>
          ); })}
        </div> : null;
      })}
      {shown.length ? null : <p className="node-lib-empty">No nodes or tools match.</p>}
    </div>
    <div className="node-lib-keys" aria-hidden><span><kbd>↑</kbd><kbd>↓</kbd> Move</span><span><kbd>↵</kbd> Add</span></div>
  </div>;
}

/** Node kinds (and tools) to add; with `accepts`, only those that take that port type as input. */
export function AddNodeItems({ accepts, onPick, onAsset, onImport, searchable = false }: { accepts?: PortType | null; onPick: (data: GraphNodeData) => void; onAsset?: () => void; onImport?: () => void; searchable?: boolean }) {
  const [tools, setTools] = useState(false);
  const [query, setQuery] = useState('');
  const matches = (text: string) => text.toLowerCase().includes(query.trim().toLowerCase());
  const takes = (kind: GraphNodeData['kind']) => !accepts || inputPorts(newNodeData(kind)).some((p) => portFits(accepts, p.type));
  const toolIds = OP_IDS.filter((id) => !OPS[id].multiInput && (!accepts || portFits(accepts, OPS[id].input)));
  if (tools && !query.trim()) {
    return (
      <div className="menu">
        <button type="button" className="menu-back" onClick={() => setTools(false)}>
          ‹ Tools
        </button>
        {toolIds.map((id) => (
          <MenuItem key={id} icon={OP_ICONS[id]} label={OPS[id].label} tip={`${OPS[id].input} → ${OPS[id].output}`} tipDelay={MENU_TIP_DELAY} onClick={() => onPick(newNodeData('tool', { op: id as OpId }))} />
        ))}
      </div>
    );
  }
  return (
    <div className="menu">
      {searchable ? <label className="search-input node-add-search"><Search size={14} aria-hidden /><input autoFocus type="search" aria-label="Search compatible nodes" placeholder="Search nodes and tools…" value={query} onChange={(e) => setQuery(e.target.value)} /></label> : null}
      {onImport ? <MenuItem icon={Upload} label="Import images" onClick={onImport} /> : null}
      {NODE_UIS.filter((ui) => takes(ui.kind) && matches(ui.menuKeywords)).map((ui) => (
        <MenuItem key={ui.kind} icon={ui.icon} label={ui.label} tip={ui.tip(accepts)} tipDelay={MENU_TIP_DELAY} onClick={() => onPick(newNodeData(ui.kind))} />
      ))}
      {!query.trim() && toolIds.length ? <MenuItem icon={Wand} label="Tool" tip="Relight, angle, upscale, animate…" tipDelay={MENU_TIP_DELAY} right={<ChevronRight size={14} />} onClick={() => setTools(true)} /> : null}
      {query.trim() ? toolIds.filter((id) => matches(`${OPS[id].label} ${OPS[id].description}`)).map((id) => <MenuItem key={id} icon={OP_ICONS[id]} label={OPS[id].label} tip={`${OPS[id].input} → ${OPS[id].output}`} tipDelay={MENU_TIP_DELAY} onClick={() => onPick(newNodeData('tool', { op: id as OpId }))} />) : null}
      {onAsset && !accepts && matches('Asset gallery') ? <MenuItem icon={FileImage} label="Asset" tip="Drag one from the Library onto the canvas" tipDelay={MENU_TIP_DELAY} onClick={onAsset} /> : null}
    </div>
  );
}
