import { useState } from 'react';
import { Check, Pencil, RotateCcw, Save, Trash2 } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { activePreset, applyBrushPreset, DAB_PRESETS, PENCIL_PRESETS, presetEdited, presetFromBrush, type BrushPreset } from '../../engine/design/brushPresets';
import { uid } from '../../lib/id';
import { MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';

const NO_PRESETS: BrushPreset[] = [];

/** Presets in the brush card's head: the button keeps naming the preset the brush started from, with a dot once a setting has changed. The menu applies (keeping the color), restores and saves them. */
export function BrushPresetMenu() {
  const brush = useStore((s) => s.ui.brush);
  const saved = useStore((s) => s.ui.brushPresets ?? NO_PRESETS);
  const menu = usePopover();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const now = activePreset(brush, saved);
  const edited = !!now && presetEdited(brush, now);
  const mine = now && saved.some((p) => p.id === now.id) ? now : undefined;
  const close = () => { setNaming(false); setName(''); setConfirmDelete(false); menu.close(); };
  const apply = (p: BrushPreset) => { setUi({ brush: applyBrushPreset(brush, p) }); close(); };
  const saveNew = () => {
    const label = name.trim();
    if (!label) return;
    const p = presetFromBrush(uid('brp'), label, brush);
    setUi({ brushPresets: [...saved, p], brush: { ...brush, presetId: p.id } });
    close();
  };
  return <>
    <button type="button" ref={menu.ref} className="tool-setting" aria-expanded={menu.open} onClick={menu.toggle} data-tip={edited ? 'Brush presets (settings changed)' : 'Brush presets'} aria-label={edited ? `Brush presets: ${now!.label}, edited` : 'Brush presets'}><Pencil size={14} /><span>{now?.label ?? 'Presets'}{edited ? ' •' : ''}</span></button>
    <Popover open={menu.open} anchor={menu.ref} onClose={close} placement="bottom-start" width={220} label="Brush presets">
      <div className="menu">
        {[...PENCIL_PRESETS, ...DAB_PRESETS, ...saved].map((p) => <MenuItem key={p.id} icon={Pencil} label={p.label} active={now?.id === p.id} onClick={() => apply(p)} />)}
        <div className="menu-sep" />
        {now && <MenuItem icon={RotateCcw} label={`Reset ${now.label}`} disabled={!edited} onClick={() => apply(now)} />}
        {mine && <MenuItem icon={Check} label={`Update ${mine.label}`} disabled={!edited} onClick={() => { setUi({ brushPresets: saved.map((p) => (p.id === mine.id ? presetFromBrush(mine.id, mine.label, brush) : p)) }); close(); }} />}
        {naming
          ? <form onSubmit={(e) => { e.preventDefault(); saveNew(); }}><input autoFocus aria-label="New preset name" placeholder="Preset name, Enter to save" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setNaming(false); }} className="text-input" style={{ width: '100%' }} /></form>
          : <MenuItem icon={Save} label="Save as new preset" onClick={() => setNaming(true)} />}
        {mine && <MenuItem icon={Trash2} danger label={confirmDelete ? `Confirm: delete ${mine.label}` : `Delete ${mine.label}`} onClick={() => {
          if (!confirmDelete) return setConfirmDelete(true);
          setUi({ brushPresets: saved.filter((p) => p.id !== mine.id), brush: { ...brush, presetId: undefined } });
          close();
        }} />}
      </div>
    </Popover>
  </>;
}
