import { useEffect, useState } from 'react';
import { BellOff, CircleDollarSign, Coins, Percent, Receipt, Wallet } from 'lucide-react';
import { formatUsd } from '../../../lib/format';
import { askAgain } from '../../../engine/budget';
import { priceMargin } from '../../../engine/priceAuthorization';
import { setSettings, setUi, useStore } from '../../../store/store';
import { Button, Segmented } from '../../ui/primitives';
import { SetGroup, SetRow } from './SettingsRows';

/** Settings → Budget: the spending limit and when it asks, then the price margin and what was spent. */
export function BudgetTab() {
  const settings = useStore((s) => s.settings);
  const sessionNoAsk = useStore((s) => Boolean(s.sessions[s.activeSessionId]?.noAskOverLimit));
  const spent = useStore((s) => s.spentUsd);
  const [budget, setBudget] = useState(String(settings.budgetUsd));
  useEffect(() => setBudget(String(settings.budgetUsd)), [settings.budgetUsd]);
  return <>
    <SetGroup icon={Wallet} title="Limit">
      <SetRow icon={Wallet} label="Spending limit" tip="Compares each run with the prices known before it runs. A run over the limit, or with no published price, asks first. Nothing running is ever stopped, and the real cost can be higher than the estimate.">
        <Segmented value={settings.budgetOn ? 'on' : 'off'} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} onChange={(v) => setSettings({ budgetOn: v === 'on' })} size="sm" />
      </SetRow>
      {settings.budgetOn ? (
        <SetRow icon={CircleDollarSign} label="Limit (USD)">
          <input
            className="num-input num"
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            onBlur={() => {
              const v = Number.parseFloat(budget);
              if (Number.isFinite(v) && v >= 0) setSettings({ budgetUsd: Math.round(v * 100) / 100 });
              else setBudget(String(settings.budgetUsd));
            }}
            aria-label="Budget limit in USD"
          />
        </SetRow>
      ) : null}
      {settings.budgetOn ? (
        <SetRow icon={BellOff} label="Don’t ask in any session" tip="Over-limit runs go ahead without asking, in every session.">
          <Segmented
            value={settings.budgetNoAsk || settings.budgetAccepted === settings.budgetUsd ? 'on' : 'off'}
            options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]}
            onChange={(v) => setSettings({ budgetNoAsk: v === 'on', budgetAccepted: null })}
            size="sm"
          />
        </SetRow>
      ) : null}
      {settings.budgetOn && !settings.budgetNoAsk && sessionNoAsk ? (
        <SetRow label="This session" className="set-row-3">
          <span>not asking</span>
          <Button size="sm" variant="ghost" onClick={() => askAgain()}>Ask again</Button>
        </SetRow>
      ) : null}
    </SetGroup>
    <SetGroup icon={Receipt} title="Prices">
      <SetRow icon={Percent} label="Price margin" tip="If a step would cost more than its approved price by more than this (at least 1¢), it waits for you. Off: it runs and the card shows the difference.">
        <Segmented
          value={String(priceMargin())}
          options={[{ value: '5', label: '5%' }, { value: '25', label: '25%' }, { value: '50', label: '50%' }, { value: 'off', label: 'Off' }]}
          onChange={(v) => setSettings({ priceMargin: v === 'off' ? 'off' : Number(v) })}
          size="sm"
        />
      </SetRow>
      <SetRow icon={Coins} label="Spent" className="set-row-3">
        <span className="num">{formatUsd(spent)}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            useStore.setState({ spentUsd: 0 });
            setSettings({ budgetAccepted: null });
            askAgain();
          }}
          data-tip="Start counting against the limit again. The Spending panel keeps the history."
        >
          Reset
        </Button>
      </SetRow>
    </SetGroup>
    <p className="set-note">
      Every paid run shows its estimated cost first. {settings.budgetOn ? 'A run over the limit asks before it starts.' : 'Without a limit, spending is only shown.'} Agent (LLM) calls count too. Details:{' '}
      <button type="button" className="link-btn" onClick={() => setUi({ panel: 'spending', settingsOpen: false })}>
        Spending
      </button>
      .
    </p>
  </>;
}
