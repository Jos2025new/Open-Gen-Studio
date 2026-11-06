import { useEffect, useState, type ReactNode } from 'react';
import { Bot, Check, ChevronRight, FolderOpen, Paperclip, Plus } from 'lucide-react';
import { MODES } from './ModeMenu';
import { AssetMedia } from '../ui/AssetMedia';
import { ALL_TOOLS, isListed, openLibrary, openTool } from '../shell/navModel';
import { Popover, usePopover } from '../ui/Popover';
import { newSession, selectSession, setComposer, setUi, useStore } from '../../store/store';
import type { Workspace } from '../../engine/types';

type Section = 'attach' | 'sessions' | 'library' | 'tools' | 'create';
const SECTIONS: Array<{ id: Section; label: string }> = [{ id: 'attach', label: 'Attach' }, { id: 'sessions', label: 'Sessions' }, { id: 'library', label: 'Library' }, { id: 'tools', label: 'Tools' }, { id: 'create', label: 'Create' }];
const SPACES: Array<{ id: Workspace; label: string }> = [{ id: 'chat', label: 'Studio' }, { id: 'node', label: 'Nodes' }, { id: 'designer', label: 'Designer' }];

function Row({ icon, label, right, active, disabled, tip, onClick }: { icon?: ReactNode; label: ReactNode; right?: ReactNode; active?: boolean; disabled?: boolean; tip?: string; onClick: () => void }) {
  return <button type="button" className={`composer-options-file ${active ? 'is-active' : ''}`} disabled={disabled} data-tip={tip} onClick={onClick}>
    {icon}<span className="truncate">{label}</span>{right}
  </button>;
}

/** The "+": a control center one hover away. Sections on the left, their content beside them, the three spaces below. */
export function ComposerOptions({ label, disabled, onAdd, onAsset }: { label: string; disabled: boolean; onAdd: () => void; onAsset: (id: string) => void }) {
  const pop = usePopover();
  const [section, setSection] = useState<Section>('attach');
  const mode = useStore((s) => s.composer.mode);
  const workspace = useStore((s) => s.ui.workspace);
  const dockPref = useStore((s) => s.ui.designerDock) ?? 'tools';
  const sessions = useStore((s) => s.sessions), activeId = useStore((s) => s.activeSessionId);
  const assets = useStore((s) => s.assets);
  useEffect(() => {
    if (!pop.open) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('.control-center button:not(:disabled)')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [pop.open]);
  const promptDock = () => { if (workspace === 'designer') setUi({ designerDock: 'prompt' }); };
  const pick = (fn: () => void) => () => { pop.close(); fn(); };
  const canvasName = workspace === 'designer' ? 'the design' : workspace === 'node' ? 'the node canvas' : '';
  const toolsShown = workspace === 'designer' && dockPref === 'tools';
  const pane = () => {
    if (section === 'attach') return <>
      <Row icon={<Paperclip size={17} />} label={label} disabled={disabled} onClick={pick(onAdd)} />
      {canvasName ? <Row icon={<Plus size={17} />} label={<>Upload image to {canvasName}</>} onClick={pick(() => window.dispatchEvent(new Event('ogs:upload')))} /> : null}
    </>;
    if (section === 'sessions') return <>
      <Row icon={<Plus size={17} />} label="New session" onClick={pick(() => newSession())} />
      {Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6).map((s) => <Row key={s.id} label={s.title} active={s.id === activeId} onClick={pick(() => selectSession(s.id))} />)}
      <Row icon={<FolderOpen size={17} />} label="All sessions" onClick={pick(() => setUi({ panel: 'sessions' }))} />
    </>;
    if (section === 'library') return <>
      <div className="control-center-thumbs">{Object.values(assets).filter(isListed).sort((a, b) => b.createdAt - a.createdAt).slice(0, 6).map((a) => <button key={a.id} type="button" aria-label={`Attach ${a.kind}`} data-tip="Attach to the prompt" onClick={pick(() => onAsset(a.id))}><AssetMedia assetId={a.id} hoverPlay={false} autoPlay={false} draggable={false} /></button>)}</div>
      <Row icon={<FolderOpen size={17} />} label="Open Library" onClick={pick(openLibrary)} />
    </>;
    if (section === 'tools') return ALL_TOOLS.map((t) => <Row key={t.id} icon={<t.icon size={17} />} label={t.label} onClick={pick(() => openTool(t))} />);
    return MODES.filter((m) => m.id !== 'agent').map((m) => {
      const off = workspace === 'designer' && (m.id === 'video' || m.id === 'audio' || m.id === 'model3d');
      return <Row key={m.id} icon={<m.icon size={17} />} label={m.label} active={m.id === mode} disabled={off} tip={off ? 'Designer layers hold images, text and shapes' : undefined} right={m.id === mode ? <Check size={14} className="menu-right" /> : null} onClick={pick(() => { setComposer({ mode: m.id }); promptDock(); })} />;
    });
  };
  return <>
    <button ref={pop.ref} type="button" className={`composer-options-trigger ${pop.open ? 'is-open' : ''}`} aria-label="Control center" aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}>
      <Plus size={19} />
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={420} align="start" clearOf=".composer" label="Control center" className="composer-options control-center">
      <div className="control-center-top">
        <nav className="control-center-nav" aria-label="Sections">
          {SECTIONS.map((s) => <button key={s.id} type="button" className={s.id === section ? 'is-current' : ''} aria-current={s.id === section ? 'true' : undefined} onMouseEnter={() => setSection(s.id)} onFocus={() => setSection(s.id)} onClick={() => setSection(s.id)}>
            <span>{s.label}</span>{s.id === section ? <ChevronRight size={14} /> : null}
          </button>)}
          <button type="button" className={`control-center-agent ${mode === 'agent' ? 'is-on' : ''}`} aria-pressed={mode === 'agent'} onClick={pick(() => { setComposer({ mode: 'agent' }); promptDock(); })}>
            <Bot size={15} /><span>Agent</span>{mode === 'agent' ? <Check size={14} /> : null}
          </button>
        </nav>
        <div className="control-center-pane">{pane()}</div>
      </div>
      <div className="control-center-spaces" role="group" aria-label="Spaces">
        {SPACES.map((s) => {
          const on = s.id === workspace && (s.id !== 'designer' || toolsShown);
          return <button key={s.id} type="button" className={on ? 'is-on' : ''} aria-pressed={on} onClick={pick(() => setUi({ workspace: s.id, home: false, space: undefined, ...(s.id === 'designer' ? { designerDock: 'tools' as const } : {}) }))}>{s.label}</button>;
        })}
      </div>
    </Popover>
  </>;
}
