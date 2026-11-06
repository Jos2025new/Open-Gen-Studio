import { NEW_DOC_BACKGROUND_PREF } from '../../engine/design/doc';
import { usePref } from '../ui/hooks';
import { InlineColor } from './InlineControls';

/** The transparent choice of a page background: the checkerboard itself, marked while it is the one in force. */
export function TransparentSwatch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <button type="button" className={`doc-bg-transparent ${on ? 'is-on' : ''}`} aria-label="Transparent background" aria-pressed={on} data-tip="Transparent" onClick={onClick} />;
}

/** Where a document is created: its background, transparent unless another was chosen; the choice stays for the next one. */
export function DocBackgroundChoice() {
  const [background, setBackground] = usePref<string | null>(NEW_DOC_BACKGROUND_PREF, null);
  return <div className="doc-bg-choice" role="group" aria-label="New document background">
    <span>Background</span>
    <TransparentSwatch on={!background} onClick={() => setBackground(null)} />
    <InlineColor label="Background color" iconOnly value={background ?? '#ffffff'} onChange={setBackground} />
  </div>;
}
