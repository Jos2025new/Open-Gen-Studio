import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { dismissAlert, useAlerts } from '../../engine/alerts';

/** Warnings right above the prompt box (no credit, a switched model, agent errors), until closed. */
export function ComposerAlerts() {
  const alerts = useAlerts((s) => s.alerts);
  if (!alerts.length) return null;
  return (
    <div className="composer-alerts" role="status">
      {alerts.map((a) => {
        const Icon = a.level === 'error' ? CircleAlert : a.level === 'warn' ? TriangleAlert : Info;
        return (
          <div key={a.id} className={`composer-alert is-${a.level}`}>
            <Icon size={14} />
            <span className="composer-alert-text">{a.text}</span>
            {a.actions?.map((x) => (
              <button key={x.label} type="button" className="notice-retry" onClick={x.run}>
                {x.label}
              </button>
            ))}
            <button type="button" className="composer-alert-close" aria-label="Close" onClick={() => dismissAlert(a.id)}>
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
