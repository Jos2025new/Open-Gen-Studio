import { Pencil } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { activePreset, applyBrushPreset, PENCIL_PRESETS } from '../../engine/design/brushPresets';
import { MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';

/** Pencil presets in the brush card's head: one small button, a menu of eight; applying keeps the color. */
export function BrushPresetMenu() {
  const brush = useStore((s) => s.ui.brush);
  const menu = usePopover();
  const now = activePreset(brush);
  return <>
    <button type="button" ref={menu.ref} className="tool-setting" aria-expanded={menu.open} onClick={menu.toggle} data-tip="Brush presets" aria-label="Brush presets"><Pencil size={14} /><span>{now?.label ?? 'Presets'}</span></button>
    <Popover open={menu.open} anchor={menu.ref} onClose={menu.close} placement="bottom-start" width={220} label="Brush presets">
      <div className="menu">
        {PENCIL_PRESETS.map((p) => <MenuItem key={p.id} icon={Pencil} label={p.label} active={now?.id === p.id} onClick={() => { setUi({ brush: applyBrushPreset(brush, p) }); menu.close(); }} />)}
      </div>
    </Popover>
  </>;
}
