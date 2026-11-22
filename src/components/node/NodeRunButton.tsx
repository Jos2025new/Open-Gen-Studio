import { useRef } from 'react';
import { Play } from '../ui/icons';
import { runApproved } from '../../engine/nodecore/action';
import { uid } from '../../lib/id';
import { prepareNodeRun, previewRun } from '../../engine/flow/actions';
import type { GraphNode } from '../../engine/types';
import { useStore } from '../../store/store';
import { usePreviewDeps } from './usePreviewDeps';
import { Popover, usePopover } from '../ui/Popover';
import { costLabel } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';

/** Run with spend confirmation. `primary` is the panel's big button and shows the estimated cost. */
export function RunButton({ node, primary }: { node: GraphNode; primary?: boolean }) {
  const sessionId = useStore(s => s.activeSessionId);
  const pop = usePopover();
  const confirmId = useRef('');
  usePreviewDeps(sessionId, pop.open || !!primary); // Keeps the reviewed request and price current.
  const preview = pop.open || primary ? previewRun(sessionId, [node.id]) : null;
  return (
    <>
      <button ref={pop.ref} type="button" className={`${primary ? 'nt-go' : 'nt-btn nt-run'} nodrag ${pop.open ? 'is-open' : ''}`} aria-label="Run node" onClick={() => { confirmId.current = uid('run'); void prepareNodeRun(sessionId, [node.id]).then(pop.toggle); }}>
        <Play size={12} fill="currentColor" /> {primary && preview ? costLabel(preview.estimate, { short: true }) : 'Run'}
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={300} label="Run node">
        {pop.open && preview ? (
          <SpendConfirm
            title={preview.count > 1 ? `Run ${preview.count} nodes` : `Run “${node.data.title}”`}
            lines={preview.runIds.map(id => `${id} · ${useStore.getState().sessions[sessionId].graph.nodes.find(n => n.id === id)?.data.title}`)}
            estimate={preview.estimate}
            blocked={preview.errors[0] ?? null}
            sessionId={sessionId}
            onCancel={pop.close}
            onConfirm={(pass) => {
              if (previewRun(sessionId, [node.id]).signature !== preview.signature) return;
              return (pass ? runApproved(sessionId, [node.id], true, preview, confirmId.current, undefined, pass) : runApproved(sessionId, [node.id], true, preview, confirmId.current)).then(() => pop.close());
            }}
          />
        ) : null}
      </Popover>
    </>
  );
}

