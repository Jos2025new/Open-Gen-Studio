import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw, Settings2, Wallet } from 'lucide-react';
import { ADAPTERS, REMOTE_PROVIDERS } from '../../engine/providers/registry';
import { PROVIDER_LABELS } from '../../engine/providers/types';
import type { RemoteProviderId } from '../../engine/types';
import { formatUsd } from '../../lib/format';
import { setUi, useStore } from '../../store/store';
import { Popover } from '../ui/Popover';
import { usePref } from '../ui/hooks';

type Balance = number | 'none' | 'error' | 'loading';

/** Balances of the connected providers, refreshed on demand (open, expand, refresh button). */
function useBalances() {
  const keys = useStore((s) => s.settings.keys);
  const connected = REMOTE_PROVIDERS.filter((p) => keys[p]?.trim());
  const [balances, setBalances] = useState<Partial<Record<RemoteProviderId, Balance>>>({});
  const signature = connected.map((p) => `${p}:${keys[p].length}`).join();

  const refresh = useCallback(() => {
    for (const p of connected) {
      const fetchBalance = ADAPTERS[p].balance;
      if (!fetchBalance) {
        setBalances((b) => ({ ...b, [p]: 'none' }));
        continue;
      }
      setBalances((b) => ({ ...b, [p]: 'loading' }));
      fetchBalance(keys[p].trim())
        .then((v) => setBalances((b) => ({ ...b, [p]: v ?? 'none' })))
        .catch(() => setBalances((b) => ({ ...b, [p]: 'error' })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(refresh, [refresh]);
  const total = connected.reduce((sum, p) => sum + (typeof balances[p] === 'number' ? (balances[p] as number) : 0), 0);
  const known = connected.some((p) => typeof balances[p] === 'number');
  return { connected, balances, total, known, refresh };
}

function PoolDetails({ pool }: { pool: ReturnType<typeof useBalances> }) {
  return (
    <div className="pool-details">
      {pool.connected.map((p) => {
        const b = pool.balances[p];
        return (
          <div key={p} className="pool-row">
            <span>{PROVIDER_LABELS[p]}</span>
            <span className={`num ${typeof b === 'number' ? 'pool-usd' : 'faint'}`} data-tip={b === 'none' ? 'This provider does not expose the balance to API keys' : undefined}>
              {typeof b === 'number' ? formatUsd(b) : b === 'loading' ? '…' : b === 'error' ? 'error' : 'no balance API'}
            </span>
          </div>
        );
      })}
      {!pool.connected.length ? <div className="pool-row faint">No providers connected</div> : null}
      <div className="pool-actions">
        <button type="button" onClick={() => setUi({ settingsOpen: true })}>
          <Settings2 size={13} /> Provider details
        </button>
        <button type="button" aria-label="Refresh balances" data-tip="Refresh balances" onClick={pool.refresh}>
          <RefreshCw size={13} />
        </button>
      </div>
    </div>
  );
}

/** Unified wallet: a collapsible block in the wide sidebar, a button with a popover in the narrow one. */
export function ProviderPool({ wide }: { wide: boolean }) {
  const pool = useBalances();
  const [open, setOpen] = usePref('ogs:pool-open', false);
  const [pop, setPop] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const total = pool.known ? formatUsd(pool.total) : '—';

  if (!wide) {
    return (
      <>
        <button
          ref={ref}
          type="button"
          className={`side-btn ${pop ? 'is-open' : ''}`}
          data-tip={`Provider pool · ${total}`}
          data-tip-side="right"
          aria-label="Provider pool"
          onClick={() => {
            if (!pop) pool.refresh();
            setPop(!pop);
          }}
        >
          <Wallet size={18} strokeWidth={1.7} />
          <span className="side-budget num">{total}</span>
        </button>
        <Popover open={pop} anchor={ref} onClose={() => setPop(false)} placement="right-end" width={260} label="Provider pool">
          <div className="pool-head">
            <span className="pool-title">Provider pool</span>
            <span className="num pool-total">{total}</span>
          </div>
          <PoolDetails pool={pool} />
        </Popover>
      </>
    );
  }

  return (
    <div className={`pool ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="pool-head"
        aria-expanded={open}
        onClick={() => {
          if (!open) pool.refresh();
          setOpen(!open);
        }}
      >
        <span className="pool-title">
          <span className={`pool-dot ${pool.connected.length ? 'is-on' : ''}`} />
          Provider pool
        </span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        <span className="num pool-total">{total}</span>
        <span className="faint pool-count">Connected · {pool.connected.length}</span>
      </button>
      {open ? <PoolDetails pool={pool} /> : null}
    </div>
  );
}
