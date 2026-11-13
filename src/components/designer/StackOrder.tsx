import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, type LucideIcon } from '../ui/icons';
import type { DesignDoc } from '../../engine/types';
import { useStore } from '../../store/store';
import { useObjectSelection } from '../../engine/design/objectSelection';
import { useLayerSelection } from '../../engine/design/selection';
import { STACK_OPS, type StackOp } from '../../engine/design/stackOrder';
import { restackSelection, stackTarget } from '../../engine/design/stackOrderActions';
import { IconButton } from '../ui/primitives';
import '../../styles/shape-builder.css';

const ICONS: Record<StackOp, LucideIcon> = { front: ArrowUpToLine, forward: ArrowUp, backward: ArrowDown, back: ArrowDownToLine };
const KEYS: Record<string, string> = { Home: 'Home', PageUp: 'Page Up', PageDown: 'Page Down', End: 'End' };

/** Stacking order of the selection: to front, forward, backward, to back. Shown only with something selected. */
export function StackOrder({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  useStore((s) => s.ui.selectMode);
  useObjectSelection((st) => st.byDoc[doc.id]);
  useLayerSelection((st) => st.byDoc[doc.id]);
  const target = stackTarget(doc.id, doc.activeLayerId, doc.layers.map((l) => l.id));
  if (!target) return null;
  const what = target.mode === 'layers' ? 'among the layers' : 'inside its layer';
  return <div className="stack-order" role="group" aria-label="Stacking order">
    {STACK_OPS.map((s) => <IconButton key={s.op} icon={ICONS[s.op]} size="sm" label={`${s.label} · ${KEYS[s.key]} · ${what}`} onClick={() => restackSelection(sessionId, doc.id, s.op)} />)}
  </div>;
}
