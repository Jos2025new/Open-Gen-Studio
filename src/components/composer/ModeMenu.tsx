import { Bot, Box, Check, ChevronDown, Film, Image, Music } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ComposerMode } from '../../engine/types';
import { setComposer, useStore } from '../../store/store';
import { Popover, usePopover } from '../ui/Popover';

export const MODES: Array<{ id: ComposerMode; label: string; icon: LucideIcon; desc: string }> = [
  { id: 'agent', label: 'Agent', icon: Bot, desc: 'Plans and runs multi-step work, with skills and workflows' },
  { id: 'image', label: 'Image', icon: Image, desc: 'Generate images directly with a chosen model' },
  { id: 'video', label: 'Video', icon: Film, desc: 'Generate video directly with a chosen model' },
  { id: 'audio', label: 'Audio', icon: Music, desc: 'Music and song lyrics with a chosen model' },
  { id: 'model3d', label: '3D', icon: Box, desc: 'Generate GLB models from text or reference images' },
];

export function ModeMenu() {
  const mode = useStore((s) => s.composer.mode);
  const workspace = useStore((s) => s.ui.workspace);
  const pop = usePopover();
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  return (
    <>
      <button ref={pop.ref} type="button" className={`mode-btn ${pop.open ? 'is-open' : ''}`} onClick={pop.toggle} aria-haspopup="menu" aria-expanded={pop.open}>
        <current.icon size={14} strokeWidth={1.9} />
        <span>{current.label}</span>
        <ChevronDown size={12} />
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={270} label="Mode">
        <div className="menu" role="menu">
          {MODES.map((m) => {
            const disabled = workspace === 'designer' && (m.id === 'video' || m.id === 'audio' || m.id === 'model3d');
            return (
              <button
                key={m.id}
                type="button"
                role="menuitemradio"
                aria-checked={m.id === mode}
                className={`menu-item ${m.id === mode ? 'is-active' : ''}`}
                disabled={disabled}
                data-tip={disabled ? `Designer layers hold images, text and shapes, not ${m.id}` : undefined}
                onClick={() => {
                  setComposer({ mode: m.id });
                  pop.close();
                }}
              >
                <m.icon size={15} strokeWidth={1.8} className="menu-icon" />
                <span className="menu-text">
                  <span className="menu-label">{m.label}</span>
                  <span className="menu-detail">{disabled ? 'Not available in Designer' : m.desc}</span>
                </span>
                {m.id === mode ? <Check size={14} className="menu-right" /> : null}
              </button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}
