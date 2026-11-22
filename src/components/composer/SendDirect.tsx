import { useMemo } from 'react';
import { ArrowUp, Zap } from '../ui/icons';
import { sendSessionId, ensureSendSession } from '../../store/spaceSession';
import { toast, useStore } from '../../store/store';
import { checkDirect, generateDirect } from '../../engine/actions';
import type { BudgetPass } from '../../engine/budget';
import type { MediaKind } from '../../engine/types';
import { Popover, usePopover } from '../ui/Popover';
import { costLabel } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';

export function SendDirect({ kind, onLaunch, compact = false }: { kind: MediaKind; onLaunch?: (text: string) => void; compact?: boolean }) {
  const composer = useStore((s) => s.composer);
  // All schemas: the check may use the family's edit variant (directModelRef), whose schema loads later.
  const schema = useStore((s) => s.catalog.schemas);
  const assets = useStore((s) => s.assets);
  const spent = useStore((s) => s.spentUsd);
  const sid = useStore(sendSessionId);
  const budget = useStore((s) => s.settings);
  const noAsk = useStore((s) => s.sessions[sid]?.noAskOverLimit);
  const workspace = useStore((s) => s.ui.workspace);
  const models = useStore((s) => s.catalog.models);
  const quotes = useStore((s) => s.quotes);
  // Recompute whenever any input of the check changes (an Atlas quote arriving included).
  const check = useMemo(() => checkDirect(kind), [kind, composer, schema, assets, spent, budget, sid, noAsk, workspace, models, quotes]);
  const pop = usePopover();
  const unknown = check.estimate.usd == null;
  const launch = (pass?: BudgetPass) => { onLaunch?.(useStore.getState().composer.text); return pass ? generateDirect(kind, pass) : generateDirect(kind); };
  const onClick = () => {
    if (!check.ok) {
      toast(check.reason ?? 'Not ready', 'error');
      return;
    }
    // Unknown price or over the spending limit: confirm in the cost popover first.
    if (unknown || check.overLimit) pop.toggle();
    else launch();
  };
  return (
    <>
      {compact ? <span className="send-cost num" aria-hidden="true">{costLabel(check.estimate, { short: true })}</span> : null}
      <button
        ref={pop.ref}
        type="button"
        className={`send-btn is-generate ${check.ok ? '' : 'is-blocked'}`}
        aria-label={`Generate · ${costLabel(check.estimate, { short: true })}`}
        onClick={onClick}
        aria-disabled={!check.ok}
        data-tip={check.ok ? (unknown ? 'Price not published: you will confirm first' : check.overLimit ? 'Over your spending limit: you will confirm first' : 'Generate (Enter)') : check.reason}
      >
        {compact ? <ArrowUp size={16} strokeWidth={2.2} /> : <><Zap size={14} strokeWidth={2} /><span>Generate</span><span className="send-cost num">{costLabel(check.estimate, { short: true })}</span></>}
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={300} label="Confirm cost">
        <SpendConfirm
          sessionId={sid}
          resolveSessionId={ensureSendSession}
          title="Generate"
          estimate={check.estimate}
          confirmLabel="Generate"
          onConfirm={(pass) => {
            pop.close();
            return launch(pass);
          }}
          onCancel={pop.close}
        />
      </Popover>
    </>
  );
}
