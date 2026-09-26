import { useMemo } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { formatUsd } from '../../lib/format';
import { CATEGORY_LABELS, periodStart, summarizeSpend, type SpendPeriod, type SpendRow } from '../../engine/spending';
import { PROVIDER_LABELS } from '../../engine/providers/types';
import { LLM_LABELS } from '../../engine/providers/llm';
import type { SpendCategory } from '../../engine/types';
import { setUi, useStore } from '../../store/store';
import { IconButton, Segmented } from '../ui/primitives';
import { usePref } from '../ui/hooks';

const PERIODS: Array<{ value: SpendPeriod; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All' },
];

/** Where the money goes: agent calls and paid generations, from the spend log. */
export function SpendingPanel() {
  const log = useStore((s) => s.spendLog);
  const spent = useStore((s) => s.spentUsd);
  const settings = useStore((s) => s.settings);
  const models = useStore((s) => s.catalog.models);
  const llm = useStore((s) => s.catalog.llm);
  const sessions = useStore((s) => s.sessions);
  const expanded = useStore((s) => s.ui.panelExpanded);
  const [period, setPeriod] = usePref<SpendPeriod>('ogs:spending-period', '7d');
  const sum = useMemo(() => summarizeSpend(log, periodStart(period)), [log, period]);

  const providerName = (p: string) => PROVIDER_LABELS[p as keyof typeof PROVIDER_LABELS] ?? LLM_LABELS[p as keyof typeof LLM_LABELS] ?? p;
  const modelName = (ref: string) => {
    const media = models[ref]?.name;
    if (media) return media;
    for (const list of Object.values(llm)) {
      const m = list?.find((x) => x.id === ref);
      if (m) return m.name;
    }
    return ref.includes('::') ? ref.split('::')[1] : ref;
  };
  const limitLeft = settings.budgetOn ? settings.budgetUsd - spent : null;
  const accepted = settings.budgetOn && settings.budgetAccepted === settings.budgetUsd;

  return (
    <div className="spending">
      <div className="panel-head">
        <div className="panel-title">Spending</div>
        <div className="panel-head-actions">
          <IconButton icon={expanded ? Minimize2 : Maximize2} label={expanded ? 'Collapse' : 'Expand'} size="sm" onClick={() => setUi({ panelExpanded: !expanded })} />
          <IconButton icon={X} label="Close" size="sm" onClick={() => setUi({ panel: null })} />
        </div>
      </div>
      <div className="spend-body">
        <section className="spend-limit">
          {limitLeft == null ? (
            <p>
              <span className="num">{formatUsd(spent)}</span> spent · no limit: spending is only shown.
            </p>
          ) : (
            <>
              <p>
                <span className="num">{formatUsd(spent)}</span> of <span className="num">{formatUsd(settings.budgetUsd)}</span>
                {limitLeft >= 0 ? <> · <span className="num">{formatUsd(limitLeft)}</span> left</> : <> · <span className="num over">{formatUsd(-limitLeft)}</span> over</>}
              </p>
              <div className="bar">
                <span className={limitLeft < 0 ? 'over' : ''} style={{ width: `${Math.min(100, (spent / Math.max(settings.budgetUsd, 1e-9)) * 100)}%` }} />
              </div>
              {accepted ? <p className="faint">You chose to continue past this limit; runs no longer ask.</p> : null}
            </>
          )}
          <button type="button" className="link-btn" onClick={() => setUi({ settingsOpen: true })}>
            Limit settings
          </button>
        </section>

        <Segmented value={period} options={PERIODS} onChange={setPeriod} size="sm" />

        <div className="spend-tiles">
          <Tile label="Total" usd={sum.total} note={`${sum.count} charge${sum.count === 1 ? '' : 's'}`} />
          <Tile label="Agent (LLM)" usd={sum.agent} />
          <Tile label="Media" usd={sum.media} />
        </div>

        {sum.count ? (
          <div className="spend-groups">
            <Group title="By type" rows={sum.byCategory} name={(k) => CATEGORY_LABELS[k as SpendCategory] ?? k} />
            <Group title="By model" rows={sum.byModel} name={modelName} limit={expanded ? 20 : 8} />
            <Group title="By provider" rows={sum.byProvider} name={providerName} />
            <Group title="By session" rows={sum.bySession} name={(id) => sessions[id]?.title ?? 'Deleted session'} limit={expanded ? 20 : 6} />
            <section className="spend-group spend-recent">
              <h4>Latest charges</h4>
              <ul>
                {sum.recent.map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    <span className="faint num">{new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="spend-what">
                      {CATEGORY_LABELS[e.category]} · {modelName(e.model)}
                    </span>
                    <span className="num">{formatUsd(e.usd, { approx: e.estimated })}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : (
          <p className="faint spend-empty">Nothing spent in this period.</p>
        )}
        <p className="faint spend-foot">≈ marks amounts estimated from published prices when the provider does not report the actual cost.</p>
        {spent > log.reduce((s, e) => s + e.usd, 0) + 0.005 ? <p className="faint spend-foot">Spending from before itemized tracking is counted in the total but not listed here.</p> : null}
      </div>
    </div>
  );
}

function Tile({ label, usd, note }: { label: string; usd: number; note?: string }) {
  return (
    <div className="spend-tile">
      <span className="faint">{label}</span>
      <span className="num">{formatUsd(usd)}</span>
      {note ? <span className="faint">{note}</span> : null}
    </div>
  );
}

function Group({ title, rows, name, limit = 8 }: { title: string; rows: SpendRow[]; name: (key: string) => string; limit?: number }) {
  const max = rows[0]?.usd || 1;
  return (
    <section className="spend-group">
      <h4>{title}</h4>
      <ul>
        {rows.slice(0, limit).map((r) => (
          <li key={r.key}>
            <span className="spend-what" title={r.key}>
              {name(r.key)} <span className="faint num">×{r.count}</span>
            </span>
            <span className="num">{formatUsd(r.usd, { approx: r.estimated })}</span>
            <div className="bar">
              <span style={{ width: `${(r.usd / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {rows.length > limit ? <p className="faint">+{rows.length - limit} more</p> : null}
    </section>
  );
}
