import { saveNow } from '../../store/store';
import { saveStatus } from '../../store/saveStatus';

export function SaveIndicator() {
  const phase = saveStatus((s) => s.phase);
  const browserOnly = saveStatus((s) => s.browserOnly);
  const conflict = saveStatus((s) => s.conflict);
  const error = saveStatus((s) => s.error);
  const text = conflict ? 'Another tab saved changes · reload'
    : phase === 'error' ? `Error saving · ${error}`
    : phase === 'saving' ? 'Saving…'
    : phase === 'unsaved' ? 'Unsaved changes'
    : browserOnly ? 'Saved in this browser' : 'Saved';
  return <button type="button" className={`topbar-menu save-indicator is-${phase}`} aria-label={text}
    title={conflict ? 'Reload to read the newer saved work' : phase === 'error' ? 'Retry saving' : 'Save now (Ctrl+S)'}
    onClick={() => { if (conflict) window.location.reload(); else void saveNow(); }}>
    <span className={`pool-dot ${phase === 'saved' ? 'is-on' : ''}`} aria-hidden="true" />
    <span role="status" aria-live="polite">{text}</span>
  </button>;
}
