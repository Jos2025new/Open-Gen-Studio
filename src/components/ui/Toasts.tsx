import { CircleAlert, CircleCheck, Info, X } from './icons';
import { dismissToast, useStore } from '../../store/store';

export function Toasts() {
  const toasts = useStore((s) => s.ui.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.level === 'error' ? CircleAlert : t.level === 'success' ? CircleCheck : Info;
        return (
          <div key={t.id} className={`toast toast-${t.level}`}>
            <Icon size={15} strokeWidth={1.9} />
            <span>{t.text}</span>
            {t.action && <button type="button" className="toast-action" onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>}
            <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
