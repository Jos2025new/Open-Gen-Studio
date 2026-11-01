import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { MiniMap, Panel, useReactFlow, useViewport } from '@xyflow/react';
import { Hand, LayoutDashboard, Scissors, Map, Minus, MousePointer2, Plus, Redo2, Search, Trash, Undo2, X, Maximize } from 'lucide-react';
import { setGraph, toast, useStore } from '../../store/store';
import { graphEditProblem, lockedNodes } from '../../engine/flow/locks';
import { graphHistory, historyRevision, subscribeGraphHistory, travelGraph } from '../../engine/flow/history';
import { nodeOutputAsset } from '../../engine/flow/graph';
import { generationTitle } from '../assets/GenerationInfo';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { IconButton, MenuItem } from '../ui/primitives';
import { InlineSlider } from '../designer/InlineControls';
import { MAX_ZOOM } from '../../engine/design/viewCoordinates';

export type NodeTool = 'select' | 'pan' | 'cut';

/** Nodes zooms as far as the Designer: 5% to its MAX_ZOOM (3200%). */
export const NODE_MIN_ZOOM = 0.05;
export const NODE_MAX_ZOOM = MAX_ZOOM;
/** The zoom popover: −, the app's slider on a log scale (drag, scroll or type the percent), +. */
export function ZoomControls({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const step = (by: number) => onZoom(Math.min(NODE_MAX_ZOOM, Math.max(NODE_MIN_ZOOM, zoom * by)));
  return <div className="canvas-zoom-controls">
    <IconButton icon={Minus} label="Zoom out" onClick={() => step(1 / Math.SQRT2)} />
    <InlineSlider label="Zoom" value={zoom} min={NODE_MIN_ZOOM} max={NODE_MAX_ZOOM} scale={100} unit="%" log onChange={onZoom} />
    <IconButton icon={Plus} label="Zoom in" onClick={() => step(Math.SQRT2)} />
  </div>;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const parts = [];
  let from = 0;
  const lower = text.toLowerCase(), needle = query.toLowerCase();
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    parts.push(text.slice(from, at), <mark key={at}>{text.slice(at, at + query.length)}</mark>);
    from = at + query.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

/** The canvas toolbox (2026-10-31): one vertical bar on the left, in the Designer's toolbar style, with every canvas
 *  tool: Add node (`add`), Select, Pan, Cut and Auto layout, Fit view and Map, Undo, Redo and Delete, zoom, Search. Its
 *  popovers open to the right. `tool`: Select drags a selection box (middle/right drag pans); Pan drags the canvas. */
export function CanvasNavigation({ sessionId, add, onAutoLayout, onSelect, tool, onTool, selectedCount, onDelete }: { sessionId: string; add?: ReactNode; onAutoLayout?: () => void; onSelect: (id: string) => void; tool: NodeTool; onTool: (t: NodeTool) => void; selectedCount: number; onDelete: () => void }) {
  const graph = useStore(s => s.sessions[sessionId].graph);
  const generations = useStore(s => s.generations);
  const assets = useStore(s => s.assets);
  useSyncExternalStore(subscribeGraphHistory, historyRevision);
  const rf = useReactFlow();
  const { zoom } = useViewport();
  const [mapOpen, setMapOpen] = useState(false);
  const [direction, setDirection] = useState<'undo' | 'redo'>('undo');
  const history = usePopover();
  const undoPop = usePopover();
  const redoPop = usePopover();
  const zoomPop = usePopover();
  const searchPop = usePopover();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const past = graphHistory(sessionId, 'undo');
  const future = graphHistory(sessionId, 'redo');
  const blocked = lockedNodes(sessionId).size > 0 || graph.nodes.some(n => 'generationId' in n.data && n.data.generationId && ['running', 'queued'].includes(generations[n.data.generationId]?.status));
  const travel = (dir: 'undo' | 'redo', count = 1) => {
    if (blocked) return;
    travelGraph(sessionId, graph, dir, count, next => {
      const problem = graphEditProblem(sessionId, graph, next);
      if (problem) { toast(problem, 'error'); return false; }
      setGraph(sessionId, () => next);
      return true;
    });
    history.close();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      if (!(e.ctrlKey || e.metaKey) || !['z', 'y'].includes(e.key.toLowerCase())) return;
      e.preventDefault();
      travel(e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo');
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const results = useMemo(() => {
    if (!submitted) return [];
    return graph.nodes.flatMap(n => {
      const d = n.data;
      const asset = nodeOutputAsset(n, generations);
      const g = asset && assets[asset]?.generationId ? generations[assets[asset].generationId!] : undefined;
      const fields = [...new Set([d.title, d.kind === 'text' ? d.text : 'prompt' in d ? d.prompt : '', g ? generationTitle(g) : '', ...(d.kind === 'tool' ? Object.entries(d.params).filter(([k, v]) => /prompt|instruction|text/i.test(k) && typeof v === 'string').map(([, v]) => String(v)) : [])])];
      return fields.filter(text => text.toLowerCase().includes(submitted.toLowerCase())).map(text => ({ id: n.id, title: d.title, text }));
    });
  }, [graph, generations, assets, submitted]);
  const showHistory = (e: React.MouseEvent, dir: 'undo' | 'redo') => { e.preventDefault(); e.stopPropagation(); setDirection(dir); history.setOpen(true); };
  return (
    <>
      {mapOpen ? <MiniMap pannable zoomable position="top-left" className="canvas-map" maskColor="var(--overlay)" nodeColor="var(--text-4)" /> : null}
      <Panel position="top-left" className="canvas-navigation" role="toolbar" aria-label="Canvas tools" aria-orientation="vertical">
        {add ? <>{add}<span className="canvas-nav-sep" /></> : null}
        <IconButton icon={MousePointer2} label="Select: drag a box; middle or right drag pans" active={tool === 'select'} onClick={() => onTool('select')} />
        <IconButton icon={Hand} label="Pan (default): drag moves the canvas, scroll pans, double-click and hold to box-select" active={tool === 'pan'} onClick={() => onTool('pan')} />
        <IconButton icon={Scissors} label="Cut connections (X): drag across links to cut them" active={tool === 'cut'} disabled={!graph.edges.length && tool !== 'cut'} onClick={() => onTool('cut')} />
        {onAutoLayout ? <IconButton icon={LayoutDashboard} label="Auto layout" disabled={!graph.nodes.length} onClick={onAutoLayout} /> : null}
        <span className="canvas-nav-sep" />
        <IconButton icon={Maximize} label="Fit view" disabled={!graph.nodes.length} onClick={() => void rf.fitView({ padding: 0.2, duration: 300 })} />
        <IconButton icon={Map} label="Map" active={mapOpen} onClick={() => setMapOpen(v => !v)} />
        <span className="canvas-nav-sep" />
        <IconButton ref={undoPop.ref} icon={Undo2} label="Undo · right-click for history" disabled={blocked || !past.length} onClick={() => travel('undo')} onContextMenu={e => showHistory(e, 'undo')} />
        <IconButton ref={redoPop.ref} icon={Redo2} label="Redo · right-click for history" disabled={blocked || !future.length} onClick={() => travel('redo')} onContextMenu={e => showHistory(e, 'redo')} />
        <IconButton icon={Trash} label={selectedCount ? `Delete ${selectedCount} selected (Del)` : 'Delete selected (Del)'} tone="danger" disabled={!selectedCount} onClick={onDelete} />
        <span className="canvas-nav-sep" />
        <IconButton icon={Plus} label="Zoom in" onClick={() => void rf.zoomIn({ duration: 150 })} />
        <button ref={zoomPop.ref} type="button" className="canvas-zoom num" aria-label="Zoom" aria-expanded={zoomPop.open} onClick={zoomPop.toggle}>{Math.round(zoom * 100)}%</button>
        <IconButton icon={Minus} label="Zoom out" onClick={() => void rf.zoomOut({ duration: 150 })} />
        <span className="canvas-nav-sep" />
        <IconButton ref={searchPop.ref} icon={Search} label="Search canvas" active={searchPop.open} onClick={searchPop.toggle} />
      </Panel>
      <Popover open={history.open} anchor={direction === 'undo' ? undoPop.ref : redoPop.ref} onClose={history.close} placement="right-start" width={300} label={`${direction} history`} className="canvas-nav-pop">
        <PopoverHeader title={direction === 'undo' ? 'Undo history' : 'Redo history'} />
        <div className="canvas-history-list">{(direction === 'undo' ? past : future).map((entry, i) => <MenuItem key={i} label={entry.label} detail={`${direction === 'undo' ? 'Undo' : 'Redo'} ${i + 1} action${i ? 's' : ''}`} disabled={blocked} onClick={() => travel(direction, i + 1)} />)}</div>
      </Popover>
      <Popover open={zoomPop.open} anchor={zoomPop.ref} onClose={zoomPop.close} placement="right-start" width={220} label="Zoom canvas" className="canvas-nav-pop">
        <ZoomControls zoom={zoom} onZoom={z => void rf.zoomTo(z, { duration: 0 })} />
      </Popover>
      <Popover open={searchPop.open} anchor={searchPop.ref} onClose={searchPop.close} placement="right-start" width={340} label="Search canvas" className="canvas-nav-pop">
        <PopoverHeader title="Search canvas" right={<IconButton icon={X} label="Close search" size="sm" onClick={searchPop.close} />} />
        <form className="search-input" onSubmit={e => { e.preventDefault(); setSubmitted(query.trim()); }}>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search prompts and names" aria-label="Search canvas text" />
          <IconButton icon={Search} label="Find matches" size="sm" type="submit" />
        </form>
        <div className="canvas-search-results">
          {results.map((r, i) => <button key={`${r.id}-${i}`} className="canvas-search-result" type="button" onClick={() => { onSelect(r.id); void rf.fitView({ nodes: [{ id: r.id }], padding: 0.4, maxZoom: 1, duration: 200 }); }}><span className="faint">{r.title}</span><span><Highlight text={r.text} query={submitted} /></span></button>)}
          {submitted && !results.length ? <div className="empty-block">No matches in this canvas.</div> : null}
        </div>
      </Popover>
    </>
  );
}
