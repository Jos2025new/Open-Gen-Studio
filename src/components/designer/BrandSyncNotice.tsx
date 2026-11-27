import { useMemo, useState, useSyncExternalStore } from 'react';
import { autoLinkDocToBrand, formatBrandLinkSummary, previewBrandLink } from '../../engine/brandAutoLink';
import {
  dismissBrandSyncNotice,
  getBrandSyncNotice,
  pendingBrandUpdates,
  revertBrandSyncNotice,
  setBrandSyncMode,
  subscribeBrandSyncNotice,
  syncBrandInSession,
} from '../../engine/brandSync';
import { toast, useStore } from '../../store/store';
import { RefreshCw, Sparkles, Undo2, X } from '../ui/icons';
import { Button, IconButton } from '../ui/primitives';
import './BrandSyncNotice.css';

/** Non-blocking corner notice for brand kit propagations: shows what changed, Revert, and Auto/On-demand switch. */
export function BrandSyncNotice({ sessionId }: { sessionId: string }) {
  const notice = useSyncExternalStore(subscribeBrandSyncNotice, getBrandSyncNotice);
  const mode = useStore((s) => s.settings.brandSyncMode ?? 'auto');
  const library = useStore((s) => s.library);
  const kitId = useStore((s) => s.composer.kitId);
  const session = useStore((s) => s.sessions[sessionId]);
  const docs = session?.docs;
  const activeDoc = docs?.find((d) => d.id === session?.activeDocId);
  const [busy, setBusy] = useState(false);
  const [dismissedLinkKey, setDismissedLinkKey] = useState<string | null>(null);

  const pending = useMemo(
    () => (mode === 'manual' ? pendingBrandUpdates(sessionId) : { tokens: 0, logos: 0, components: 0, total: 0, kits: [] }),
    [mode, sessionId, library, docs],
  );

  const linkPreview = useMemo(
    () => (activeDoc && kitId ? previewBrandLink(activeDoc, kitId) : null),
    [activeDoc, kitId, library],
  );

  if (notice && notice.sessionId === sessionId) {
    return (
      <div className="brand-sync-notice" role="status" aria-live="polite">
        <div className="brand-sync-notice-head">
          <span className="brand-sync-notice-text">{notice.summary}</span>
          <IconButton icon={X} label="Dismiss notice" size="sm" onClick={dismissBrandSyncNotice} />
        </div>
        <div className="brand-sync-notice-actions">
          {notice.canRevert && (
            <Button size="sm" variant="secondary" icon={Undo2} onClick={() => { if (revertBrandSyncNotice()) toast('Brand update reverted.', 'info'); }}>
              Revert
            </Button>
          )}
          {mode === 'auto' && (
            <Button size="sm" variant="ghost" onClick={() => { setBrandSyncMode('manual'); toast('Brand sync switched to on-demand.', 'info'); }}>
              On demand
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'manual' && pending.total > 0) {
    const label = pending.kits.length ? `Updates in ${pending.kits.slice(0, 2).join(', ')} (${pending.total})` : `Pending brand updates (${pending.total})`;
    const apply = async () => {
      if (busy) return;
      setBusy(true);
      try { await syncBrandInSession(sessionId, { includeTokens: true, recordNotice: true }); }
      catch (e) { toast((e as Error).message, 'error'); }
      finally { setBusy(false); }
    };
    return (
      <div className="brand-sync-notice is-pending" role="status" aria-live="polite">
        <div className="brand-sync-notice-head">
          <span className="brand-sync-notice-text">{label}</span>
        </div>
        <div className="brand-sync-notice-actions">
          <Button size="sm" variant="primary" icon={RefreshCw} disabled={busy} onClick={() => void apply()}>
            Update now
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setBrandSyncMode('auto')}>
            Auto
          </Button>
        </div>
      </div>
    );
  }

  const linkKey = activeDoc && linkPreview && linkPreview.total > 0 ? `${activeDoc.id}:${linkPreview.kitId}:${linkPreview.total}` : null;
  if (activeDoc && linkPreview && linkPreview.total > 0 && linkKey !== dismissedLinkKey) {
    const linkAll = () => {
      try {
        const res = autoLinkDocToBrand(sessionId, activeDoc.id, linkPreview.kitId);
        if (res.total > 0) toast(`Linked to ${res.kitName}: ${formatBrandLinkSummary(res)}.`, 'success');
      } catch (e) { toast((e as Error).message, 'error'); }
    };
    const ambNote = linkPreview.ambiguous.length
      ? ` (${linkPreview.ambiguous.length} ambiguous skipped: ${linkPreview.ambiguous.slice(0, 2).join(', ')})`
      : '';
    return (
      <div className="brand-sync-notice is-suggest" role="status" aria-live="polite">
        <div className="brand-sync-notice-head">
          <span className="brand-sync-notice-text">{`Matches "${linkPreview.kitName}": ${formatBrandLinkSummary(linkPreview)}.${ambNote}`}</span>
          <IconButton icon={X} label="Dismiss suggestion" size="sm" onClick={() => setDismissedLinkKey(linkKey)} />
        </div>
        <div className="brand-sync-notice-actions">
          <Button size="sm" variant="primary" icon={Sparkles} onClick={linkAll}>
            Link all
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
