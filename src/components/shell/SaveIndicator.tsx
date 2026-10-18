import { saveNow } from '../../store/store';
import { saveStatus } from '../../store/saveStatus';

export function SaveIndicator() {
  const phase = saveStatus((s) => s.phase);
  const browserOnly = saveStatus((s) => s.browserOnly);
  const conflict = saveStatus((s) => s.conflict);
  const error = saveStatus((s) => s.error);
  const reason = saveStatus((s) => s.reason);
  const text = conflict ? 'Another tab saved changes'
    : reason === 'possible-loss' ? 'Not saved to disk · see the notice'
    : phase === 'error' ? `Error saving · ${error}`
    : phase === 'saving' ? 'Saving…'
    : phase === 'unsaved' ? 'Unsaved changes'
    : browserOnly ? 'Saved in this browser' : 'Saved';
  return <button type="button" className={`topbar-menu save-indicator is-${phase}`} aria-label={text}
    title={phase === 'error' ? 'Retry saving' : 'Save now (Ctrl+S)'}
    onClick={() => void saveNow()}>
    <span className={`pool-dot ${phase === 'saved' ? 'is-on' : ''}`} aria-hidden="true" />
    <span role="status" aria-live="polite">{text}</span>
  </button>;
}
