import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { MiniMap, Panel, useReactFlow, useViewport } from '@xyflow/react';
import { Map, Minus, Plus, Redo2, Search, Undo2, X, Maximize } from 'lucide-react';
import { setGraph, toast, useStore } from '../../store/store';
import { graphEditProblem, lockedNodes } from '../../engine/flow/locks';
import { graphHistory, historyRevision, subscribeGraphHistory, travelGraph } from '../../engine/flow/history';
import { nodeOutputAsset } from '../../engine/flow/graph';
import { generationTitle } from '../assets/GenerationInfo';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { IconButton, MenuItem } from '../ui/primitives';

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

export function CanvasNavigation({ sessionId, onSelect }: { sessionId: string; onSelect: (id: string) => void }) {
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
      {mapOpen ? <MiniMap pannable zoomable position="bottom-left" className="canvas-map" maskColor="rgba(10,10,11,0.7)" nodeColor="var(--accent)" /> : null}
      <Panel position="bottom-left" className="canvas-navigation">
        <IconButton icon={Map} label="Map" active={mapOpen} onClick={() => setMapOpen(v => !v)} />
        <span className="canvas-nav-sep" />
        <IconButton ref={undoPop.ref} icon={Undo2} label="Undo · right-click for history" disabled={blocked || !past.length} onClick={() => travel('undo')} onContextMenu={e => showHistory(e, 'undo')} />
        <IconButton ref={redoPop.ref} icon={Redo2} label="Redo · right-click for history" disabled={blocked || !future.length} onClick={() => travel('redo')} onContextMenu={e => showHistory(e, 'redo')} />
        <span className="canvas-nav-sep" />
        <button ref={zoomPop.ref} type="button" className="canvas-zoom num" aria-label="Zoom" aria-expanded={zoomPop.open} onClick={zoomPop.toggle}>{Math.round(zoom * 100)}%</button>
        <span className="canvas-nav-sep" />
        <IconButton ref={searchPop.ref} icon={Search} label="Search canvas" active={searchPop.open} onClick={searchPop.toggle} />
      </Panel>
      <Popover open={history.open} anchor={direction === 'undo' ? undoPop.ref : redoPop.ref} onClose={history.close} width={300} label={`${direction} history`} className="canvas-nav-pop">
        <PopoverHeader title={direction === 'undo' ? 'Undo history' : 'Redo history'} />
        <div className="canvas-history-list">{(direction === 'undo' ? past : future).map((entry, i) => <MenuItem key={i} label={entry.label} detail={`${direction === 'undo' ? 'Undo' : 'Redo'} ${i + 1} action${i ? 's' : ''}`} disabled={blocked} onClick={() => travel(direction, i + 1)} />)}</div>
      </Popover>
      <Popover open={zoomPop.open} anchor={zoomPop.ref} onClose={zoomPop.close} width={200} label="Zoom canvas" className="canvas-nav-pop">
        <div className="canvas-zoom-controls">
          <IconButton icon={Minus} label="Zoom out" onClick={() => void rf.zoomOut({ duration: 150 })} />
          <span className="num">{Math.round(zoom * 100)}%</span>
          <IconButton icon={Plus} label="Zoom in" onClick={() => void rf.zoomIn({ duration: 150 })} />
          <IconButton icon={Maximize} label="Fit view" onClick={() => void rf.fitView({ padding: 0.2, duration: 150 })} />
        </div>
      </Popover>
      <Popover open={searchPop.open} anchor={searchPop.ref} onClose={searchPop.close} width={340} label="Search canvas" className="canvas-nav-pop">
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
