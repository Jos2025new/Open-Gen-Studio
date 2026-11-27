import { useMemo, useState, useSyncExternalStore } from 'react';
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
import { RefreshCw, Undo2, X } from '../ui/icons';
import { Button, IconButton } from '../ui/primitives';
import './BrandSyncNotice.css';

/** Non-blocking corner notice for brand kit propagations: shows what changed, Revert, and Auto/On-demand switch. */
export function BrandSyncNotice({ sessionId }: { sessionId: string }) {
  const notice = useSyncExternalStore(subscribeBrandSyncNotice, getBrandSyncNotice);
  const mode = useStore((s) => s.settings.brandSyncMode ?? 'auto');
  const library = useStore((s) => s.library);
  const docs = useStore((s) => s.sessions[sessionId]?.docs);
  const [busy, setBusy] = useState(false);

  const pending = useMemo(
    () => (mode === 'manual' ? pendingBrandUpdates(sessionId) : { tokens: 0, logos: 0, components: 0, total: 0, kits: [] }),
    [mode, sessionId, library, docs],
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
          <Button size="sm" variant="ghost" onClick={() => { setBrandSyncMode('auto'); void apply(); }}>
            Automático
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
