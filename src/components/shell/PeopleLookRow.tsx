import { useState } from 'react';
import { setSettings, useStore } from '../../store/store';
import { DEFAULT_PEOPLE_LOOK } from '../../engine/peopleLook';

/** Settings → Agent: the look of people the user does not describe (empty = the default, shown as placeholder). */
export function PeopleLookRow() {
  const saved = useStore((s) => s.settings.peopleLook ?? '');
  const [value, setValue] = useState(saved);
  const commit = () => {
    const next = value.trim();
    if (next !== saved) setSettings({ peopleLook: next || undefined });
  };
  return (
    <div className="set-row col">
      <span className="set-label" data-tip="Used when you ask for a person without describing them. A reference image of the person always wins.">
        Default look for people
      </span>
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
    </div>
  );
}
