import { useRef, useState } from 'react';
import { HardDrive, Images, Keyboard, Paperclip, Trash, TriangleAlert } from '../../ui/icons';
import { shortcutGroups } from '../../../engine/shortcuts';
import { setSettings, useStore, wipeAllData } from '../../../store/store';
import { Popover } from '../../ui/Popover';
import { Button, Toggle } from '../../ui/primitives';
import { DataSummary } from '../DataSummary';
import { SetGroup, SetRow } from './SettingsRows';

/** Settings → Data: what is saved and where, and clearing everything (with its own confirmation). The remembered Drawing choice is in the register of notices (Settings → Budget). */
export function DataTab() {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false), keep = useStore((s) => s.settings.keepAttachments !== false), autoBrand = useStore((s) => s.settings.brandSyncMode !== 'manual');
  return <>
    <SetGroup icon={Images} title="Library">
      <SetRow icon={Paperclip} label="Keep attachments" tip="What you attach to a message also stays in Library, even if its session is deleted.">
        <Toggle checked={keep} onChange={(v) => setSettings({ keepAttachments: v })} label="Keep attachments in Library" />
      </SetRow>
      <SetRow icon={Images} label="Auto-sync brand changes" tip="Automatically update open designs when a brand kit logo, component or token changes. Turn off to update on demand.">
        <Toggle checked={autoBrand} onChange={(v) => setSettings({ brandSyncMode: v ? 'auto' : 'manual' })} label="Auto-sync brand changes" />
      </SetRow>
    </SetGroup>
    <SetGroup icon={HardDrive} title="Storage"><DataSummary /></SetGroup>
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
