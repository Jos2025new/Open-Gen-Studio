import { useEffect } from 'react';
import { Paperclip, Plus } from 'lucide-react';
import { AgentOptions } from './AgentControls';
import { Popover, usePopover } from '../ui/Popover';

export function ComposerOptions({ label, disabled, agent, onAdd }: { label: string; disabled: boolean; agent: boolean; onAdd: () => void }) {
  const pop = usePopover();
  useEffect(() => {
    if (!pop.open) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('.composer-options button:not(:disabled)')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [pop.open]);
  return <>
    <button ref={pop.ref} type="button" className={`composer-options-trigger ${pop.open ? 'is-open' : ''}`} aria-label="Add files or agent options" aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}>
      <Plus size={19} />
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={260} label="Files and agent options" className="composer-options">
      <button type="button" className="composer-options-file" disabled={disabled} onClick={() => { pop.close(); onAdd(); }}>
        <Paperclip size={17} /><span>{label}</span>
      </button>
      {agent ? <><div className="composer-options-separator" /><AgentOptions onPicked={pop.close} /></> : null}
    </Popover>
  </>;
}
