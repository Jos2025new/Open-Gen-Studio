import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, X, ArrowUpDown, CircleAlert, LayoutGrid, MousePointerClick, RefreshCw, SlidersHorizontal, Star } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import type { AssetKind, Generation } from '../../engine/types';
import { generationTitle } from '../assets/GenerationInfo';
import { OP_ICONS, QUICK_LABEL } from '../assets/AssetActions';
import { OPS } from '../../engine/ops';
import type { OpId } from '../../engine/types';
import { AssetMedia } from '../ui/AssetMedia';
import { Popover, usePopover } from '../ui/Popover';
import { Chip, IconButton, Segmented } from '../ui/primitives';
import { KINDS, KIND_ICON, STATUS_LABEL, type Kind, type Sort } from '../shell/generationsView';
import { doneExpanded, splitBoard, suggestedOps, targetAsset } from './boardModel';
import { nounOf } from './actionRoute';
import { goWithAction } from './actionGo';

type Density = 'compact' | 'comfortable';

/** Generated Assets: finished results on top; running ones and the actions suggested for the chosen asset below. It cannot be closed. */
export function SpaceBoard({ kind: activeKind = 'image', empty = 'Nothing generated yet.', studio = false, onClose }: { kind?: AssetKind; empty?: string; /** Studio's board: Done and Ongoing only, Done folds while something runs, closable. */ studio?: boolean; onClose?: () => void }) {
  const generations = useStore((s) => s.generations);
  const assets = useStore((s) => s.assets);
  const sessionId = useStore((s) => s.activeSessionId);
  const [kind, setKind] = useState<Kind>('all');
  const [scope, setScope] = useState<'session' | 'all'>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [density, setDensity] = useState<Density>('comfortable');
  const [starred, setStarred] = useState(false);
  const [showFailed, setShowFailed] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const filter = usePopover();
  const order = usePopover();
  const view = usePopover();

  const rows = useMemo(() => splitBoard(generations, assets, { kind, status: 'all', q: '', sort, starred, showFailed, scope: scope === 'all' ? 'all' : { sessionId } }), [generations, assets, kind, sort, starred, showFailed, scope, sessionId]);
  const doneAssets = rows.done.flatMap((c) => (c.type === 'asset' ? [c.assetId] : []));
  const kind_ = activeKind;
  const target = targetAsset(rows, selected, assets, kind_);
  const ops = suggestedOps(target ? assets[target] : undefined);
  // Go needs an explicit selection of the active kind; a chosen action only lives while that holds.
  const picked = [...selected].reverse().find((id) => assets[id]?.kind === kind_);
  const [chosen, setChosen] = useState<OpId | null>(null);
  const [hint, setHint] = useState<OpId | null>(null);
  useEffect(() => { if (!picked) setChosen(null); else setHint(null); }, [picked]);
  useEffect(() => { setChosen(null); setHint(null); }, [kind_]);
  useEffect(() => { if (!hint) return; const t = window.setTimeout(() => setHint(null), 6000); return () => window.clearTimeout(t); }, [hint]);
  const choose = (id: OpId) => {
    if (!picked) { setHint(id); setChosen(null); return; }
    setChosen(chosen === id ? null : id);
  };
  const reset = () => { setKind('all'); setScope('all'); setSort('newest'); setDensity('comfortable'); setStarred(false); setShowFailed(false); setSelecting(false); setSelected([]); };
  const filtered = kind !== 'all' || scope !== 'all';
  const running = rows.ongoing.length > 0;
  const [userDone, setUserDone] = useState<boolean | null>(null);
  useEffect(() => { if (studio) setUserDone(null); }, [running, studio]);
  const doneOpen = doneExpanded({ running, override: userDone, auto: studio });

  return <section className={`space-board ${studio ? 'is-studio' : ''} ${doneOpen ? '' : 'is-done-folded'}`} aria-label="Generated assets">
    <header className="space-board-head">
      <div className="space-board-tools">
        <IconButton icon={RefreshCw} label="Reset view" size="sm" onClick={reset} />
        <h2 className="space-board-title">Generations</h2>
        <IconButton ref={filter.ref} icon={SlidersHorizontal} label="Filter" size="sm" active={filter.open || filtered} onClick={filter.toggle} />
        <IconButton ref={order.ref} icon={ArrowUpDown} label="Sort" size="sm" active={order.open || sort !== 'newest'} onClick={order.toggle} />
        <IconButton ref={view.ref} icon={LayoutGrid} label="View" size="sm" active={view.open || density !== 'comfortable'} onClick={view.toggle} />
      </div>
      <div className="space-board-tools">
        <IconButton icon={Star} label="Favorites only" size="sm" active={starred} aria-pressed={starred} onClick={() => setStarred(!starred)} />
        <IconButton icon={MousePointerClick} label="Select" size="sm" active={selecting} aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelected([]); }} />
        <IconButton icon={CircleAlert} label="Show failed" size="sm" active={showFailed} aria-pressed={showFailed} onClick={() => setShowFailed(!showFailed)} />
        {onClose ? <IconButton icon={X} label="Close board" size="sm" onClick={onClose} /> : null}
      </div>
    </header>
    <Popover open={filter.open} anchor={filter.ref} onClose={filter.close} width={300} label="Filter">
      <div className="sessions-view">
        <div className="sv-row"><span className="sv-label">Show</span>
          <Segmented size="sm" value={scope} onChange={setScope} options={[{ value: 'all', label: 'All sessions' }, { value: 'session', label: 'This session' }]} />
        </div>
        <div className="sv-row"><span className="sv-label">Type</span>
          <div className="sv-canvas">{KINDS.filter((k) => k.id !== 'text').map((k) => {
            const KIcon = k.id === 'all' ? null : KIND_ICON[k.id];
            return <button key={k.id} type="button" className={`canvas-tab ${kind === k.id ? 'is-on' : ''}`} onClick={() => setKind(k.id)}>{KIcon ? <KIcon size={12} /> : null}{k.label}</button>;
          })}</div>
        </div>
      </div>
    </Popover>
    <Popover open={order.open} anchor={order.ref} onClose={order.close} width={260} label="Sort">
      <div className="sessions-view"><div className="sv-row"><span className="sv-label">Sort</span>
        <Segmented size="sm" value={sort} onChange={setSort} options={[{ value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' }, { value: 'cost', label: 'Cost' }]} />
      </div></div>
    </Popover>
    <Popover open={view.open} anchor={view.ref} onClose={view.close} width={240} label="View">
      <div className="sessions-view"><div className="sv-row"><span className="sv-label">Tiles</span>
        <Segmented size="sm" value={density} onChange={setDensity} options={[{ value: 'comfortable', label: 'Large' }, { value: 'compact', label: 'Small' }]} />
      </div></div>
    </Popover>

    <div className={`space-done ${doneOpen ? '' : 'is-folded'}`} aria-label="Done">
      <button type="button" className="space-sub space-fold" aria-expanded={doneOpen} onClick={() => setUserDone(!doneOpen)}>
        <ChevronDown size={12} className={doneOpen ? '' : 'is-closed'} />Done <span className="num">{rows.done.length}</span>
      </button>
      {!doneOpen ? null : rows.done.length ? <div className={`space-grid is-${density}`}>
        {rows.done.map((c) => <button key={c.assetId} type="button" className={`space-tile t-${assets[c.assetId]?.kind ?? 'image'} ${selected.includes(c.assetId) ? 'is-selected' : ''}`} aria-label={assets[c.assetId]?.name || 'Open asset'} aria-pressed={selecting ? selected.includes(c.assetId) : undefined}
            onClick={() => selecting
              ? setSelected((s) => (s.includes(c.assetId) ? s.filter((x) => x !== c.assetId) : [...s, c.assetId]))
              : setUi({ lightbox: { assetIds: doneAssets, index: doneAssets.indexOf(c.assetId) } })}>
            <span className="space-tile-kind" aria-hidden>{(() => { const K = KIND_ICON[assets[c.assetId]?.kind ?? 'image']; return <K size={26} strokeWidth={1.5} />; })()}</span>
            <AssetMedia assetId={c.assetId} hoverPlay={false} autoPlay={false} draggable={false} />
            {assets[c.assetId]?.favorite ? <Star size={12} className="space-tile-star" aria-label="Favorite" /> : null}
          </button>)}
      </div> : <p className="space-empty">{starred ? 'No favorites yet.' : empty}</p>}
    </div>

    {showFailed ? <div className="space-failed" aria-label="Failed">
      <div className="space-sub">Failed</div>
      {rows.failed.length ? <div className="space-failed-row">{rows.failed.map((g) => <div key={g.id} className="space-fail" title={g.error}><CircleAlert size={14} /><span className="space-run-title">{generationTitle(g)}</span><span className="faint">{STATUS_LABEL[g.status]}</span></div>)}</div> : <p className="space-empty">Nothing failed.</p>}
    </div> : null}

    <div className="space-lower">
      <div className="space-ongoing" aria-label="Ongoing">
        <div className="space-sub">Ongoing</div>
        {rows.ongoing.length ? rows.ongoing.map((g) => <OngoingRow key={g.id} g={g} />) : <p className="space-empty">Nothing running.</p>}
      </div>
      {studio ? null : <div className="space-actions" aria-label="Actions suggested">
        <div className="space-sub">Actions suggested</div>
        {ops.length && target ? <div className="space-ops">
          {ops.map((id) => <Chip key={id} icon={OP_ICONS[id]} active={chosen === id} aria-pressed={chosen === id} data-tip={OPS[id].description} onClick={() => choose(id)}>{QUICK_LABEL[id] ?? OPS[id].label}</Chip>)}
          {picked && chosen ? <IconButton icon={ArrowRight} label="Go" size="sm" className="space-go" onClick={() => void goWithAction(chosen, picked)} /> : null}
        </div> : <p className="space-empty">No {kind_ === 'model3d' ? '3D model' : kind_} yet: generate one to see its actions.</p>}
        {hint ? <p className="space-empty space-hint-note" role="status">Pick {nounOf(kind_)} from your generations first (use Select), then press → to use it here.</p> : null}
      </div>}
    </div>
  </section>;
}

function OngoingRow({ g }: { g: Generation }) {
  const Icon = KIND_ICON[g.kind];
  const p = g.progress == null ? null : Math.min(1, Math.max(0, g.progress > 1 ? g.progress / 100 : g.progress));
  return <div className="space-run">
    <Icon size={14} aria-hidden />
    <div className="space-run-body">
      <div className="space-run-title" title={generationTitle(g)}>{generationTitle(g)}</div>
      <div className="space-run-meta faint">{g.statusText || STATUS_LABEL[g.status]}</div>
      <div className="space-run-bar" role="progressbar" aria-valuenow={p == null ? undefined : Math.round(p * 100)}><span style={{ width: p == null ? '30%' : `${p * 100}%` }} className={p == null ? 'is-indeterminate' : ''} /></div>
    </div>
  </div>;
}
