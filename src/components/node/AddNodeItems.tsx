import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Box, ChevronRight, FileImage, Film, Image as ImageIcon, Music, Search, Type, Upload, Wand, type LucideIcon } from 'lucide-react';
import { OPS, OP_IDS } from '../../engine/ops';
import { newNodeData } from '../../engine/flow/actions';
import { inputPorts, portFits } from '../../engine/flow/graph';
import type { GraphNodeData, OpId, PortType } from '../../engine/types';
import { OP_ICONS } from '../assets/AssetActions';
import { MenuItem } from '../ui/primitives';

const MENU_TIP_DELAY = 2500;

type Kind = 'image' | 'video' | 'audio' | 'model3d' | 'text';
interface Entry { id: string; section: 'media' | 'nodes' | 'tools'; kind?: Kind; icon: LucideIcon; label: string; sub: string; keywords: string; run: () => void }
const KIND_LABEL: Record<Kind, string> = { image: 'Image', video: 'Video', audio: 'Audio', model3d: '3D', text: 'Text' };
const SECTION_LABEL = { media: 'Media', nodes: 'Nodes', tools: 'Tools' } as const;

/** The same node kinds and tools as AddNodeItems, as one flat list for the library panel. */
function libraryEntries({ onPick, onAsset, onImport }: { onPick: (data: GraphNodeData) => void; onAsset?: () => void; onImport?: () => void }): Entry[] {
  const node = (kind: Exclude<Kind, 'text'> | 'text', icon: LucideIcon, label: string, sub: string, keywords: string): Entry => ({ id: kind, section: 'nodes', kind, icon, label, sub, keywords, run: () => onPick(newNodeData(kind)) });
  return [
    ...(onImport ? [{ id: 'import', section: 'media' as const, icon: Upload, label: 'Import images', sub: 'From your computer', keywords: 'upload import images files', run: onImport }] : []),
    ...(onAsset ? [{ id: 'asset', section: 'media' as const, icon: FileImage, label: 'Asset', sub: 'Drag one from the Library', keywords: 'asset gallery library', run: onAsset }] : []),
    node('text', Type, 'Text', 'Prompt or copy that feeds other nodes', 'text prompt copy'),
    node('image', ImageIcon, 'Image', 'Generate images', 'image generation reference'),
    node('video', Film, 'Video', 'Generate video', 'video generation first frame motion'),
    node('audio', Music, 'Audio', 'Generate music or song lyrics', 'audio music song lyrics voice'),
    node('model3d', Box, '3D model', 'Generate a GLB model from text or image', '3d model glb'),
    ...OP_IDS.filter((id) => !OPS[id].multiInput).map((id): Entry => ({ id, section: 'tools', kind: OPS[id].input as Kind, icon: OP_ICONS[id], label: OPS[id].label, sub: `${OPS[id].input} → ${OPS[id].output}`, keywords: `${OPS[id].label} ${OPS[id].description} tool`, run: () => onPick(newNodeData('tool', { op: id as OpId })) })),
  ];
}

/** Add node from the canvas toolbox (2026-10-31): a library panel. A search field, kind chips, Media / Nodes / Tools
 *  sections with each entry's kind tinted on its icon and a line under its name, and the keyboard: type to filter,
 *  ↑↓ to move, Enter to add. Same entries as AddNodeItems (one list of node kinds). */
export function NodeLibrary({ onPick, onAsset, onImport }: { onPick: (data: GraphNodeData) => void; onAsset?: () => void; onImport?: () => void }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [at, setAt] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // The popover places itself after mounting, so the field takes the focus on the next frame (autoFocus is lost).
  useEffect(() => { const t = window.setTimeout(() => field.current?.focus(), 0); return () => window.clearTimeout(t); }, []);
  const entries = useMemo(() => libraryEntries({ onPick, onAsset, onImport }), [onPick, onAsset, onImport]);
  const q = query.trim().toLowerCase();
  const shown = entries.filter((e) => (kind === 'all' || e.kind === kind) && (!q || `${e.label} ${e.keywords}`.toLowerCase().includes(q)));
  useEffect(() => setAt(0), [query, kind]);
  useEffect(() => { list.current?.querySelector('[data-at="true"]')?.scrollIntoView?.({ block: 'nearest' }); }, [at]);
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => (shown.length ? (i + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length : 0)); }
    if (e.key === 'Enter' && shown[at]) { e.preventDefault(); shown[at].run(); }
  };
  const chips: Array<Kind | 'all'> = ['all', 'image', 'video', 'audio', 'model3d', 'text'];
  return <div className="node-lib" onKeyDown={keys}>
    <label className="node-lib-search"><Search size={16} aria-hidden /><input ref={field} type="search" aria-label="Search nodes and tools" placeholder="Search nodes and tools" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
    <div className="node-lib-chips" role="group" aria-label="Kind">
      {chips.map((c) => <button key={c} type="button" className={`node-lib-chip${kind === c ? ' is-on' : ''}`} aria-pressed={kind === c} onClick={() => setKind(c)}>{c === 'all' ? 'All' : KIND_LABEL[c]}</button>)}
    </div>
    <div ref={list} className="node-lib-list" role="listbox" aria-label="Nodes and tools">
      {(['media', 'nodes', 'tools'] as const).map((section) => {
        const items = shown.filter((e) => e.section === section);
        return items.length ? <div key={section} className="node-lib-sec" role="group" aria-label={SECTION_LABEL[section]}>
          <div className="node-lib-head">{SECTION_LABEL[section]}<span className="num">{items.length}</span></div>
          {items.map((e) => { const i = shown.indexOf(e); return (
            <button key={e.id} type="button" role="option" aria-selected={i === at} data-at={i === at} className={`node-lib-item${i === at ? ' is-at' : ''}${e.kind ? ` k-${e.kind}` : ''}`} onMouseEnter={() => setAt(i)} onClick={e.run}>
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
  const takes = (kind: 'image' | 'video' | 'audio' | 'model3d') => !accepts || inputPorts(newNodeData(kind)).some((p) => portFits(accepts, p.type));
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
      {searchable ? <label className="node-add-search"><Search size={14} aria-hidden /><input autoFocus type="search" aria-label="Search compatible nodes" placeholder="Search nodes and tools…" value={query} onChange={(e) => setQuery(e.target.value)} /></label> : null}
      {onImport ? <MenuItem icon={Upload} label="Import images" onClick={onImport} /> : null}
      {!accepts && matches('Text prompt copy') ? <MenuItem icon={Type} label="Text" tip="Prompt or copy that feeds other nodes" tipDelay={MENU_TIP_DELAY} onClick={() => onPick(newNodeData('text'))} /> : null}
      {takes('image') && matches('Image generation reference') ? <MenuItem icon={ImageIcon} label="Image" tip={accepts === 'image' ? 'Use it as a reference' : 'Generate images'} tipDelay={MENU_TIP_DELAY} onClick={() => onPick(newNodeData('image'))} /> : null}
      {takes('video') && matches('Video generation first frame motion') ? <MenuItem icon={Film} label="Video" tip={accepts === 'image' ? 'Use it as the first frame' : accepts === 'audio' ? 'Use it as speech or soundtrack' : 'Generate video'} tipDelay={MENU_TIP_DELAY} onClick={() => onPick(newNodeData('video'))} /> : null}
      {takes('audio') && matches('Audio music song lyrics') ? <MenuItem icon={Music} label="Audio" tip={accepts === 'text' ? 'Use it as the prompt of a song' : 'Generate music or song lyrics'} tipDelay={MENU_TIP_DELAY} onClick={() => onPick(newNodeData('audio'))} /> : null}
      {takes('model3d') && matches('3D model GLB') ? <MenuItem icon={Box} label="3D model" tip="Generate a GLB model from text or image" tipDelay={MENU_TIP_DELAY} onClick={() => onPick(newNodeData('model3d'))} /> : null}
      {!query.trim() && toolIds.length ? <MenuItem icon={Wand} label="Tool" tip="Relight, angle, upscale, animate…" tipDelay={MENU_TIP_DELAY} right={<ChevronRight size={14} />} onClick={() => setTools(true)} /> : null}
      {query.trim() ? toolIds.filter((id) => matches(`${OPS[id].label} ${OPS[id].description}`)).map((id) => <MenuItem key={id} icon={OP_ICONS[id]} label={OPS[id].label} tip={`${OPS[id].input} → ${OPS[id].output}`} tipDelay={MENU_TIP_DELAY} onClick={() => onPick(newNodeData('tool', { op: id as OpId }))} />) : null}
      {onAsset && !accepts && matches('Asset gallery') ? <MenuItem icon={FileImage} label="Asset" tip="Drag one from the gallery onto the canvas" tipDelay={MENU_TIP_DELAY} onClick={onAsset} /> : null}
    </div>
  );
}
