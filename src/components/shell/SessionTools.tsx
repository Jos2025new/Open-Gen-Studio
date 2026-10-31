import { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, ChartNoAxesColumn, CircleAlert, CircleCheck, Clock, Coins, Ellipsis, Eye, EyeOff, Images, Loader, Pencil, Pin, PinOff, Sparkles, Trash } from 'lucide-react';
import { setUi, togglePinSession, useStore } from '../../store/store';
import { deleteSession } from '../../engine/actions';
import { setUserHidden } from '../../store/userHidden';
import { setSessionsArchived } from '../../store/sessionArchive';
import { formatRelative, formatUsd } from '../../lib/format';
import { Popover, usePopover } from '../ui/Popover';
import { IconButton } from '../ui/primitives';
import { AssetMedia } from '../ui/AssetMedia';
import { MenuConfirm, MenuItem } from '../ui/PanelControls';
import { RunningNote } from './SessionRow';
import './SessionTools.css';
import type { GenerationStatus } from '../../engine/types';

/** The open session's ⋯ menu in the top bar: the same actions as a session card, grouped, Delete last with its confirmation. */
export function SessionMenu({ onRename }: { onRename: () => void }) {
  const session = useStore((s) => s.sessions[s.activeSessionId]);
  const pop = usePopover();
  const [confirming, setConfirming] = useState(false);
  if (!session) return null;
  const close = () => { pop.close(); setConfirming(false); };
  return <>
    <IconButton ref={pop.ref} icon={Ellipsis} label="Session actions" aria-haspopup="menu" aria-expanded={pop.open} active={pop.open} onClick={pop.toggle} />
    <Popover open={pop.open} anchor={pop.ref} onClose={close} width={236} className="pc-menu-pop" label="Session actions">
      <div className="pc-menu" role="menu">
        {confirming
          ? <MenuConfirm text={`Delete “${session.title}” with its conversation, nodes, designs and assets?`} extra={<RunningNote ids={[session.id]} />} action="Delete" onCancel={() => setConfirming(false)} onConfirm={() => { close(); deleteSession(session.id); }} />
          : <>
            <MenuItem icon={Pencil} onClick={() => { close(); onRename(); }}>Rename</MenuItem>
            <MenuItem icon={session.pinned ? PinOff : Pin} onClick={() => { close(); togglePinSession(session.id); }}>{session.pinned ? 'Unpin' : 'Pin'}</MenuItem>
            <hr className="pc-menu-sep" />
            <MenuItem icon={session.archived ? ArchiveRestore : Archive} onClick={() => { close(); setSessionsArchived([session.id], !session.archived); }}>{session.archived ? 'Restore session' : 'Archive session'}</MenuItem>
            <MenuItem icon={session.userHidden ? Eye : EyeOff} onClick={() => { close(); setUserHidden('session', [session.id], !session.userHidden); }}>{session.userHidden ? 'Unhide' : 'Hide'}</MenuItem>
            <hr className="pc-menu-sep" />
            <MenuItem icon={Trash} tone="danger" onClick={() => setConfirming(true)}>Delete</MenuItem>
          </>}
      </div>
    </Popover>
  </>;
}

const KIND: Record<string, string> = { image: 'Image', video: 'Video', audio: 'Audio', model3d: '3D', text: 'Text' };
const RUNNING: GenerationStatus[] = ['queued', 'running'];
const statusIcon = (s: GenerationStatus) => (RUNNING.includes(s) ? <Loader size={14} className="spin" aria-label="Running" /> : s === 'done' ? <CircleCheck size={14} className="si-ok" aria-label="Done" /> : <CircleAlert size={14} className="si-warn" aria-label={s === 'review' ? 'Needs review' : 'Did not finish'} />);

/** The open session at a glance (top bar): what it cost and holds, what is running or just ran, its latest results.
 *  "View all" goes where the full list already lives: Generations (scoped to this session) and Library. */
export function SessionInfo({ onGenerations }: { onGenerations: () => void }) {
  const session = useStore((s) => s.sessions[s.activeSessionId]);
  const generations = useStore((s) => s.generations);
  const assets = useStore((s) => s.assets);
  const spendLog = useStore((s) => s.spendLog);
  const pop = usePopover();
  const id = session?.id;
  const data = useMemo(() => {
    const gens = Object.values(generations).filter((g) => g.sessionId === id).sort((a, b) => b.createdAt - a.createdAt);
    const results = Object.values(assets).filter((a) => a.sessionId === id).sort((a, b) => b.createdAt - a.createdAt);
    const spent = spendLog.filter((e) => e.sessionId === id).reduce((t, e) => t + e.usd, 0);
    const running = gens.filter((g) => RUNNING.includes(g.status));
    return { gens, results, spent, recent: (running.length ? running : gens).slice(0, 3), running: running.length };
  }, [generations, assets, spendLog, id]);
  if (!session) return null;
  const go = (fn: () => void) => { pop.close(); fn(); };
  return <>
    <IconButton ref={pop.ref} icon={ChartNoAxesColumn} label="Session info" aria-expanded={pop.open} active={pop.open} onClick={pop.toggle} />
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={320} className="session-info-pop" label="Session info">
      <div className="si">
        <div className="si-title" title={session.title}>{session.title || 'Untitled'}</div>
        <section className="si-sec" aria-label="Usage">
          <h4>Usage</h4>
          <div className="si-row"><Coins size={15} /><span>Spent</span><b className="num">{formatUsd(data.spent)}</b></div>
          <div className="si-row"><Sparkles size={15} /><span>Generations</span><b className="num">{data.gens.length}</b></div>
          <div className="si-row"><Clock size={15} /><span>Started</span><b>{formatRelative(session.createdAt)}</b></div>
        </section>
        <section className="si-sec" aria-label={data.running ? 'Running' : 'Latest'}>
          <h4>{data.running ? 'Running' : 'Latest'} <span className="num">{data.running || data.gens.length}</span></h4>
          {data.recent.length ? data.recent.map((g) => (
            <div key={g.id} className="si-row si-gen" title={g.prompt}><span className="si-two"><span className="si-gen-text">{g.prompt || g.modelName}</span><small>{[g.modelName, g.settings.aspect, formatRelative(g.createdAt)].filter(Boolean).join(' · ')}</small></span>{statusIcon(g.status)}</div>
          )) : <p className="si-empty">Nothing generated in this session yet.</p>}
          {data.gens.length ? <button type="button" className="si-more" onClick={() => go(onGenerations)}>View all</button> : null}
        </section>
        <section className="si-sec" aria-label="Results">
          <h4>Results <span className="num">{data.results.length}</span></h4>
          {data.results.slice(0, 3).map((a) => (
            <div key={a.id} className="si-row si-file"><span className="si-thumb"><AssetMedia assetId={a.id} hoverPlay={false} /></span><span className="si-two"><span className="si-gen-text">{generations[a.generationId ?? '']?.prompt || a.kind}</span><small>{[KIND[a.kind] ?? a.kind, a.width > 0 && a.height > 0 ? `${a.width}×${a.height}` : '', generations[a.generationId ?? '']?.modelName].filter(Boolean).join(' · ')}</small></span><span className="faint">{formatRelative(a.createdAt)}</span></div>
          ))}
          {data.results.length ? <button type="button" className="si-more" onClick={() => go(() => setUi({ panel: 'gallery' }))}><Images size={14} />View all in Library</button> : <p className="si-empty">No results yet.</p>}
        </section>
      </div>
    </Popover>
  </>;
}
