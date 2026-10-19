import { Copy, Music } from 'lucide-react';
import type { Generation } from '../../engine/types';
import { setComposer, setUi, toast, useStore } from '../../store/store';
import { applyLyrics, copyText } from '../../engine/actions';
import { Button } from '../ui/primitives';

/** Shared text result: chat keeps its original composer actions. */
export function TextResult({ g, compact = false }: { g: Generation; compact?: boolean }) {
  const lyrics = useStore((s) => Boolean(s.catalog.models[g.modelRef]?.textOutput));
  return <div className={`gen-text ${compact ? 'is-compact' : ''}`}>
    <p>{g.text || <span className="faint">{lyrics ? 'No lyrics came back.' : 'No speech was found.'}</span>}</p>
    <div className="gen-text-actions">
      <Button size="sm" variant="ghost" icon={Copy} disabled={!g.text} onClick={() => void copyText(g.text ?? '')}>Copy</Button>
      <Button size="sm" variant="secondary" disabled={!g.text} onClick={() => {
        setComposer({ text: g.text ?? '' });
        setUi((u) => ({ focusComposer: u.focusComposer + 1, textView: null }));
        toast(`${lyrics ? 'Lyrics' : 'Transcription'} placed in the composer.`, 'info');
      }}>Use as prompt</Button>
      {lyrics || g.op?.id === 'transcribe' ? <Button size="sm" variant={lyrics ? 'primary' : 'secondary'} icon={Music} disabled={!g.text} data-tip="Put this text in the lyrics of a music model" onClick={() => void applyLyrics(g.text ?? '')}>Use as lyrics</Button> : null}
    </div>
  </div>;
}
