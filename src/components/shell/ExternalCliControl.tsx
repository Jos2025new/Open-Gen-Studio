import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { findExternalCommands, runExternalCommands } from '../../engine/externalCommands';
import type { ApprovalRequest } from '../../engine/commands';
import { priceFromEstimate } from '../../engine/money/ticket';
import { connectExternalCliTab } from '../../lib/externalCliTab';
import { holdsWriterLock, subscribeWriter } from '../../lib/writerLock';
import { Button } from '../ui/primitives';
import './external-cli.css';

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (approved: boolean) => void;
}

function spendMax({ steps }: ApprovalRequest) {
  let maximum = 0;
  for (const step of steps) {
    if (step.effect !== 'spend') continue;
    const { estimate, review } = step;
    const max = priceFromEstimate(estimate).maxVerifiableUsd;
    if (!review || max === null || estimate.unbounded || (estimate.approximate && !estimate.exact) ||
        Object.values(review.stepCaps ?? {}).some((cap) => cap === null)) return null;
    maximum += max;
  }
  return maximum;
}

export function ExternalCliControl() {
  const canLink = useSyncExternalStore(subscribeWriter, holdsWriterLock);
  const connection = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<'idle' | 'linking' | 'linked'>('idle');
  const [notice, setNotice] = useState('');
  const [approval, setApproval] = useState<PendingApproval | null>(null);

  useEffect(() => {
    const disconnect = () => connection.current?.abort();
    window.addEventListener('pagehide', disconnect);
    const unsubscribe = subscribeWriter(() => { if (!holdsWriterLock()) disconnect(); });
    return () => {
      disconnect();
      unsubscribe();
      window.removeEventListener('pagehide', disconnect);
    };
  }, []);

  function toggle() {
    if (connection.current) {
      connection.current.abort();
      return;
    }
    if (!holdsWriterLock()) return;
    const controller = new AbortController();
    connection.current = controller;
    setNotice('');
    setStatus('linking');

    void connectExternalCliTab({
      signal: controller.signal,
      onReady: () => setStatus('linked'),
      execute: (operation, input, signal, deadline) => {
        if (signal.aborted || Date.now() >= deadline || !holdsWriterLock()) {
          return { ok: false, error: { code: 'disconnected', message: 'The sandbox tab is no longer available.' } };
        }
        if (operation === 'find') return findExternalCommands(input);
        return runExternalCommands(input, (request) => new Promise<boolean>((done) => {
          if (signal.aborted) return done(false);
          const cancel = () => resolve(false);
          const resolve = (approved: boolean) => {
            signal.removeEventListener('abort', cancel);
            setApproval((current) => current?.resolve === resolve ? null : current);
            done(approved && !signal.aborted && Date.now() < deadline && holdsWriterLock());
          };
          signal.addEventListener('abort', cancel, { once: true });
          setApproval({ request, resolve });
        }), signal);
      },
    }).then(() => {
      if (!controller.signal.aborted) setNotice('CLI disconnected. Link this tab again to resume.');
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : 'Could not link the sandbox CLI.');
    }).finally(() => {
      connection.current = null;
      setStatus('idle');
    });
  }

  const maximum = approval ? spendMax(approval.request) : 0;
  return (
    <div className="external-cli">
      <Button size="sm" variant="ghost" data-testid="external-cli-link" disabled={!canLink || status === 'linking'}
        aria-pressed={status === 'linked'} onClick={toggle}>
        {status === 'linked' ? 'Unlink CLI from this tab' : status === 'linking' ? 'Linking CLI…' : 'Link CLI to this tab'}
      </Button>
      <span role="status" data-testid="external-cli-status">{notice || (status === 'linked' ? 'CLI linked' : '')}</span>
      {approval && (
        <section className="external-cli-approval" data-testid="external-cli-approval" aria-label="External CLI approval" role="region">
          <strong>External CLI requests approval</strong>
          <ol>
            {approval.request.steps.map((step) => (
              <li key={step.step} value={step.step}>
                <strong>{step.title}</strong> · {step.effect} · <code>{step.cmd}</code>
                <details>
                  <summary>Target and arguments</summary>
                  <pre>{JSON.stringify({ on: step.on, args: step.args }, null, 2)}</pre>
                  {step.review?.details.map((detail, i) => <p key={i}>{detail}</p>)}
                </details>
              </li>
            ))}
          </ol>
          {maximum === null ? <p>The maximum cost could not be verified.</p> :
            maximum > 0 ? <p>Maximum approved cost {maximum.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 })}</p> : null}
          <div className="external-cli-actions">
            <Button size="sm" variant="ghost" data-testid="external-cli-reject" onClick={() => approval.resolve(false)}>Reject</Button>
            <Button size="sm" variant="primary" data-testid="external-cli-approve" disabled={maximum === null}
              onClick={() => approval.resolve(maximum !== null)}>Approve</Button>
          </div>
        </section>
      )}
    </div>
  );
}
