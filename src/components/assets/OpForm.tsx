import { ChevronLeft } from 'lucide-react';
import { OPS } from '../../engine/ops';
import type { OpId } from '../../engine/types';
import { SpendConfirm } from '../ui/SpendConfirm';
import { OpFields, ViaPick, useOpRun, type OpTarget } from './opRun';

export type { OpTarget } from './opRun';

/** Parameters + cost check for one operation. Lives inside a popover. */
export function OpForm({ op, target: targetProp, onClose, onBack }: { op: OpId; target: OpTarget; onClose: () => void; onBack?: () => void }) {
  const def = OPS[op];
  const state = useOpRun(op, targetProp);
  const { estimate, via, blocked } = state;

  return (
    <div className="op-form">
      <div className="op-head">
        {onBack ? (
          <button type="button" className="back-btn" onClick={onBack} aria-label="Back">
            <ChevronLeft size={15} />
          </button>
        ) : null}
        <div>
          <div className="pop-title">{def.label}</div>
          <div className="pop-sub">{def.description}</div>
        </div>
      </div>
      <OpFields op={op} state={state} />
      <SpendConfirm
        title={state.pickable && via ? <ViaPick op={op} state={state} /> : via ? `via ${via}` : 'Cost'}
        estimate={estimate}
        confirmLabel={def.engine === 'local' ? 'Run (free)' : 'Apply'}
        onConfirm={() => { onClose(); state.run(); }}
        onCancel={onClose}
        blocked={blocked}
      />
    </div>
  );
}
