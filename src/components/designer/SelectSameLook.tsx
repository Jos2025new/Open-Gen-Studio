import { useState } from 'react';
import { MousePointerClick } from '../ui/icons';
import type { DesignDoc } from '../../engine/types';
import { toast } from '../../store/store';
import { objectPicks, setObjectPicks } from '../../engine/design/objectSelection';
import { setLayerPicks } from '../../engine/design/selection';
import { findShapesByLook, looksOfPicks, refsToPicks, type CapChoice, type JoinChoice, type LookQuery } from '../../engine/design/shapeSameLook';
import { IconButton } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { InlineChoice } from './InlineControls';
import { CapIcon, JoinIcon } from './ShapeLookFields';

const CAPS: Array<{ value: CapChoice; label: string; render: React.ReactNode }> = [
  { value: 'any', label: 'Any cap', render: 'Any' }, { value: 'butt', label: 'Butt cap', render: <CapIcon c="butt" /> },
  { value: 'round', label: 'Round cap', render: <CapIcon c="round" /> }, { value: 'square', label: 'Square cap', render: <CapIcon c="square" /> },
];
const JOINS: Array<{ value: JoinChoice; label: string; render: React.ReactNode }> = [
  { value: 'any', label: 'Any join', render: 'Any' }, { value: 'miter', label: 'Miter join', render: <JoinIcon j="miter" /> },
  { value: 'round', label: 'Round join', render: <JoinIcon j="round" /> }, { value: 'bevel', label: 'Bevel join', render: <JoinIcon j="bevel" /> },
];

/**
 * «Select same»: pick every stroked shape of the document (visible, unlocked vector layers) with the chosen stroke cap and
 * corner join. The choices start as the picked shapes' own; left alone, several picked shapes with different looks are
 * references of a union (Inkscape). Selecting saves nothing and records no undo step.
 */
export function SelectSameLook({ doc }: { doc: DesignDoc }) {
  const pop = usePopover();
  const [chosen, setChosen] = useState<LookQuery | null>(null);
  const refs = looksOfPicks(doc, objectPicks(doc.id));
  const same = <K extends 'cap' | 'join'>(key: K): LookQuery[K] => (refs.length && refs.every((r) => r[key] === refs[0][key]) ? refs[0][key] : 'any') as LookQuery[K];
  const shown: LookQuery = chosen ?? { cap: same('cap'), join: same('join') };
  const run = () => {
    const queries: LookQuery | LookQuery[] = chosen ?? (refs.length ? refs : { cap: 'any', join: 'any' });
    const found = findShapesByLook(doc, queries);
    pop.close();
    if (!found.length) return void toast('No shapes with that stroke cap and join.', 'info', 3000);
    const picks = refsToPicks(found);
    setLayerPicks(doc.id, []);
    setObjectPicks(doc.id, picks);
    toast(`${found.length} shape${found.length === 1 ? '' : 's'} in ${picks.length} layer${picks.length === 1 ? '' : 's'}`, 'info', 3000);
  };
  return <>
    <IconButton ref={pop.ref} icon={MousePointerClick} size="sm" label="Select same stroke cap and join" aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle} />
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={260} label="Select same">
      <div className="node-more">
        <InlineChoice label="Cap" value={shown.cap} options={CAPS} onChange={(cap) => setChosen({ ...shown, cap })} />
        <InlineChoice label="Join" value={shown.join} options={JOINS} onChange={(join) => setChosen({ ...shown, join })} />
        <button type="button" className="opt is-primary" onClick={run} data-tip="Selects the matching shapes of every visible, unlocked layer">Select</button>
      </div>
    </Popover>
  </>;
}
