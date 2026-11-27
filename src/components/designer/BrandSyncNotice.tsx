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
          <IconButton icon={X} label="Cerrar aviso" size="sm" onClick={dismissBrandSyncNotice} />
        </div>
        <div className="brand-sync-notice-actions">
          {notice.canRevert && (
            <Button size="sm" variant="secondary" icon={Undo2} onClick={() => { if (revertBrandSyncNotice()) toast('Cambio de marca revertido.', 'info'); }}>
              Volver al anterior
            </Button>
          )}
          {mode === 'auto' && (
            <Button size="sm" variant="ghost" onClick={() => { setBrandSyncMode('manual'); toast('Sincronización de marca cambiada a bajo demanda.', 'info'); }}>
              Bajo demanda
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (mode === 'manual' && pending.total > 0) {
    const label = pending.kits.length ? `Cambios en ${pending.kits.slice(0, 2).join(', ')} (${pending.total})` : `Cambios de marca pendientes (${pending.total})`;
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
            Actualizar ahora
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setBrandSyncMode('auto')}>
            Automático
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
        if (res.total > 0) toast(`Vinculado a ${res.kitName}: ${formatBrandLinkSummary(res)}.`, 'success');
      } catch (e) { toast((e as Error).message, 'error'); }
    };
    const ambNote = linkPreview.ambiguous.length
      ? ` (${linkPreview.ambiguous.length} ambiguo${linkPreview.ambiguous.length === 1 ? '' : 's'} omitido${linkPreview.ambiguous.length === 1 ? '' : 's'}: ${linkPreview.ambiguous.slice(0, 2).join(', ')})`
      : '';
    return (
      <div className="brand-sync-notice is-suggest" role="status" aria-live="polite">
        <div className="brand-sync-notice-head">
          <span className="brand-sync-notice-text">{`Coincide con «${linkPreview.kitName}»: ${formatBrandLinkSummary(linkPreview)}.${ambNote}`}</span>
          <IconButton icon={X} label="Cerrar sugerencia" size="sm" onClick={() => setDismissedLinkKey(linkKey)} />
        </div>
        <div className="brand-sync-notice-actions">
          <Button size="sm" variant="primary" icon={Sparkles} onClick={linkAll}>
            Vincular todo
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
