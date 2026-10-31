import { useState } from 'react';
import { setSettings, useStore } from '../../store/store';
import { DEFAULT_PEOPLE_LOOK } from '../../engine/peopleLook';
import { UserRound } from 'lucide-react';
import { SetRow } from './settings/SettingsRows';

/** Settings → Agent: the look of people the user does not describe (empty = the default, shown as placeholder). */
export function PeopleLookRow() {
  const saved = useStore((s) => s.settings.peopleLook ?? '');
  const [value, setValue] = useState(saved);
  const commit = () => {
    const next = value.trim();
    if (next !== saved) setSettings({ peopleLook: next || undefined });
  };
  return (
    <SetRow col icon={UserRound} label="Default look for people" tip="Used when you ask for a person without describing them. A reference image of the person always wins.">
      <input
        className="text-input"
        value={value}
        placeholder={DEFAULT_PEOPLE_LOOK}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        aria-label="Default look for people"
      />
    </SetRow>
  );
}
