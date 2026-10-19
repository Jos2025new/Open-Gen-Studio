import { ReuseButton } from './ReuseButton';
import type { Generation } from '../../engine/types';
import { setUi } from '../../store/store';
import { Button } from '../ui/primitives';
import { generationTitle } from './GenerationInfo';
import { TextResult } from './TextResult';
import './text-result.css';

/** Text has no asset: no drag, selection, favorite or delete action. */
export function TextTile({ g }: { g: Generation }) {
  return <article className="space-card text-result-tile">
    <Button size="sm" variant="ghost" onClick={() => setUi({ textView: g.id })}>Open text · {generationTitle(g)}</Button>
    <TextResult g={g} compact /><ReuseButton g={g} />
  </article>;
}
