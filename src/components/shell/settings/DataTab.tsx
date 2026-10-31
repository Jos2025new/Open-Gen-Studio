import { useRef, useState } from 'react';
import { Brush, HardDrive, Keyboard, Paintbrush, Trash, TriangleAlert } from 'lucide-react';
import { setDrawingPreference } from '../../../engine/design/drawingChoice';
import { shortcutGroups } from '../../../engine/shortcuts';
import { useStore, wipeAllData } from '../../../store/store';
import { Popover } from '../../ui/Popover';
import { Button } from '../../ui/primitives';
import { DataSummary } from '../DataSummary';
import { SetGroup, SetRow } from './SettingsRows';

/** Painting in Drawing on a layer with editable strokes: the saved choice, and the way back to asking (ADR 0016). */
function DrawingChoiceSetting() {
  const pref = useStore((s) => s.ui.drawingChoice ?? 'ask');
  const labels = { ask: 'Ask every time', flatten: 'Flatten and paint', design: 'Paint in Design', newLayer: 'New layer' } as const;
  return <SetRow icon={Paintbrush} label="Painting on layers with editable strokes" className="set-row-3">
    <span className="faint">{labels[pref]}</span>
    <Button size="sm" variant="ghost" disabled={pref === 'ask'} onClick={() => setDrawingPreference('ask')}>Ask every time</Button>
  </SetRow>;
}

/** Settings → Data: what is saved and where, the remembered Drawing choice, and clearing everything (with its own confirmation). */
export function DataTab() {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  return <>
    <SetGroup icon={HardDrive} title="Storage"><DataSummary /></SetGroup>
    <SetGroup icon={Brush} title="Drawing"><DrawingChoiceSetting /></SetGroup>
    <SetGroup icon={TriangleAlert} title="Reset">
      <SetRow icon={Trash} label="Local data">
        <Button ref={confirmRef} size="sm" variant="danger" icon={Trash} onClick={() => setConfirmOpen(true)}>
          Clear everything
        </Button>
        <Popover open={confirmOpen} anchor={confirmRef} onClose={() => setConfirmOpen(false)} width={300} label="Confirm clear">
          <div className="confirm">
            <p>Delete all sessions, generations, designs and keys? Export anything you want to keep first.</p>
            <div className="spend-actions">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void wipeAllData()}>
                Delete all
              </Button>
            </div>
          </div>
        </Popover>
      </SetRow>
    </SetGroup>
  </>;
}

/** Settings → Shortcuts: one group per area. */
export function ShortcutsTab() {
  return <>
    {shortcutGroups().map((g) => (
      <SetGroup key={g.title} icon={Keyboard} title={g.title}>
        <dl className="set-keys">
          {g.items.map((it) => (
            <div key={it.keys + it.action} className="set-key-row">
              <dt><kbd className="kbd">{it.keys}</kbd></dt>
              <dd>{it.action}</dd>
            </div>
          ))}
        </dl>
      </SetGroup>
    ))}
    <p className="set-note">Mod is Ctrl, or ⌘ on a Mac. Save (Mod+S) also works while typing; other shortcuts pause in fields.</p>
  </>;
}
