import { useState } from 'react';
import { Button } from '../ui/primitives';
import { saveStatus } from '../../store/saveStatus';
import { useStore } from '../../store/store';
import { downloadCopy, keepThisVersion, revertToDisk } from '../../store/saveRecovery';

/**
 * Stays on screen (it is not a toast) while the disk is not taking this tab's saves. The browser copy keeps being
 * written meanwhile; these buttons are the ways out.
 */
export function SaveGuardBanner() {
  const reason = saveStatus((s) => s.reason);
  const rejected = saveStatus((s) => s.rejected);
  const title = useStore((s) => (rejected?.sessionId ? s.sessions[rejected.sessionId]?.title : undefined));
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  if (reason !== 'conflict' && reason !== 'possible-loss') return null;
  const loss = reason === 'possible-loss';
  const many = (rejected?.losses?.length ?? 0) > 1 || rejected?.total;
  const what = rejected?.sessionId && !many ? `"${title ?? rejected.sessionId}"` : 'your sessions';
  return (
    <div className="save-guard" role="alert">
      <p className="save-guard-text">
        {loss ? `Changes to ${what} are not being saved to disk` : 'Another tab saved more recent changes'}
        <span className="muted"> · {loss ? 'The server kept this version aside as a possible loss.' : 'This tab keeps its own copy in the browser and sends nothing to disk.'}</span>
      </p>
      {confirming ? (
        <div className="confirm save-guard-confirm">
          <p>Replace this tab's version with the one on disk? Your version is kept in the browser as a conflict copy.</p>
          {failed && <p className="spend-warn">The disk version could not be loaded.</p>}
          <div className="spend-actions">
            <Button variant="ghost" onClick={() => { setConfirming(false); setFailed(false); }}>Cancel</Button>
            <Button variant="danger" onClick={() => void revertToDisk().catch(() => setFailed(true))}>Revert to disk version</Button>
          </div>
        </div>
      ) : (
        <div className="save-guard-actions">
          <Button size="sm" onClick={downloadCopy}>Download copy</Button>
          {loss && rejected && <Button size="sm" onClick={() => void keepThisVersion()}>{rejected.total ? 'Keep this version (sessions removed)' : 'Keep this version'}</Button>}
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>Revert to disk version</Button>
        </div>
      )}
    </div>
  );
}
