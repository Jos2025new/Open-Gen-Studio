import { useEffect } from 'react';
import { Bot, Check, ChevronRight, Paperclip, PencilRuler, Plus, Sparkles } from 'lucide-react';
import { AgentOptions } from './AgentControls';
import { MODES } from './ModeMenu';
import { Popover, usePopover } from '../ui/Popover';
import { setComposer, setUi, useStore } from '../../store/store';

/** The "+" menu: Upload (to the prompt, or to the canvas of the open workspace), Agent, Create (a media kind) and Design. */
export function ComposerOptions({ label, disabled, agent, onAdd }: { label: string; disabled: boolean; agent: boolean; onAdd: () => void }) {
  const pop = usePopover();
  const create = usePopover();
  const mode = useStore((s) => s.composer.mode);
  const workspace = useStore((s) => s.ui.workspace);
  const dockPref = useStore((s) => s.ui.designerDock) ?? 'tools';
  useEffect(() => {
    if (!pop.open) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('.composer-options button:not(:disabled)')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [pop.open]);
  const promptDock = () => { if (workspace === 'designer') setUi({ designerDock: 'prompt' }); };
  const pick = (fn: () => void) => () => { pop.close(); fn(); };
  const canvasName = workspace === 'designer' ? 'the design' : workspace === 'node' ? 'the node canvas' : '';
  return <>
    <button ref={pop.ref} type="button" className={`composer-options-trigger ${pop.open ? 'is-open' : ''}`} aria-label="Add files, switch mode or open Design" aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}>
      <Plus size={19} />
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={270} label="Add and mode" className="composer-options">
      <button type="button" className="composer-options-file" disabled={disabled} onClick={pick(onAdd)}>
        <Paperclip size={17} /><span>{label}</span>
      </button>
      {canvasName ? <button type="button" className="composer-options-file" onClick={pick(() => window.dispatchEvent(new Event('ogs:upload')))}>
        <Plus size={17} /><span>Upload image to {canvasName}</span>
      </button> : null}
      <div className="composer-options-separator" />
      <button type="button" className={`composer-options-file ${mode === 'agent' ? 'is-active' : ''}`} onClick={pick(() => { setComposer({ mode: 'agent' }); promptDock(); })}>
        <Bot size={17} /><span>Agent</span>{mode === 'agent' ? <Check size={14} className="menu-right" /> : null}
      </button>
      <button ref={create.ref} type="button" className={`composer-options-file ${create.open ? 'is-open' : ''}`} aria-haspopup="menu" aria-expanded={create.open} onClick={create.toggle}>
        <Sparkles size={17} /><span>Create</span><ChevronRight size={14} className="menu-right" />
      </button>
      <Popover open={create.open} anchor={create.ref} onClose={create.close} placement="right-start" width={180} label="Create" className="composer-options">
        {MODES.filter((m) => m.id !== 'agent').map((m) => {
          const off = workspace === 'designer' && (m.id === 'video' || m.id === 'audio' || m.id === 'model3d');
          return <button key={m.id} type="button" className={`composer-options-file ${m.id === mode ? 'is-active' : ''}`} disabled={off} data-tip={off ? 'Designer layers hold images, text and shapes' : m.desc} onClick={() => { create.close(); pop.close(); setComposer({ mode: m.id }); promptDock(); }}>
            <m.icon size={17} /><span>Create {m.label}</span>{m.id === mode ? <Check size={14} className="menu-right" /> : null}
          </button>;
        })}
      </Popover>
      <div className="composer-options-separator" />
      <button type="button" className={`composer-options-file ${workspace === 'designer' && dockPref === 'tools' ? 'is-active' : ''}`} onClick={pick(() => setUi({ workspace: 'designer', designerDock: 'tools' }))}>
        <PencilRuler size={17} /><span>Design</span>{workspace === 'designer' && dockPref === 'tools' ? <Check size={14} className="menu-right" /> : null}
      </button>
      {agent ? <><div className="composer-options-separator" /><AgentOptions onPicked={pop.close} /></> : null}
    </Popover>
  </>;
}
