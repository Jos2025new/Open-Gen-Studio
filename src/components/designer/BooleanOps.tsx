import { ChevronDown, Scissors, SquaresExclude, SquaresIntersect, SquaresSubtract, SquaresUnite, type LucideIcon } from 'lucide-react';
import type { DesignDoc } from '../../engine/types';
import { setUi } from '../../store/store';
import { useObjectSelection } from '../../engine/design/objectSelection';
import { BOOL_OPS, isFillable, type BoolOp } from '../../engine/design/shapeBoolean';
import { applyBoolean, pickedShapes } from '../../engine/design/shapeBuilder';
import { IconButton } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import '../../styles/shape-builder.css';

const ICONS: Partial<Record<BoolOp, LucideIcon>> = { union: SquaresUnite, subtract: SquaresSubtract, intersect: SquaresIntersect, exclude: SquaresExclude, divide: Scissors };

/**
 * Combine the picked shapes: Union, Subtract, Intersect and Exclude are always in view (Figma's order), Divide and
 * the Shape Builder sit behind the chevron. Shown only while two or more shapes of one unlocked vector layer are picked.
 */
export function BooleanOps({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const pick = useObjectSelection((st) => st.byDoc[doc.id] ?? null);
  const pop = usePopover();
  const got = pickedShapes(doc, pick);
  if (!got) return null;
  const ready = got.shapes.filter(isFillable).length >= 2;
  const why = ready ? '' : ' — needs two shapes with a fill';
  const run = (op: BoolOp) => { applyBoolean(sessionId, doc.id, op); pop.close(); };
  const tipOf = (b: (typeof BOOL_OPS)[number]) => `${b.label}  ${b.key ? `Ctrl+Alt+${b.key}` : ''} · ${b.tip}${why}`.replace('  ·', ' ·');
  return <div className="boolean-ops" role="group" aria-label="Combine shapes">
    {BOOL_OPS.filter((b) => b.op !== 'divide').map((b) => <IconButton key={b.op} icon={ICONS[b.op]!} size="sm" label={tipOf(b)} disabled={!ready} onClick={() => run(b.op)} />)}
    <button type="button" ref={pop.ref} className="opt boolean-more" aria-haspopup="menu" aria-expanded={pop.open} aria-label="More ways to combine" data-tip="More: Divide, Shape Builder" onClick={pop.toggle}><ChevronDown size={14} /></button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="top-start" width={240} label="Combine shapes">
      <div className="node-more">
        <button type="button" className="opt" disabled={!ready} data-tip={tipOf(BOOL_OPS[4])} onClick={() => run('divide')}>Divide</button>
        <button type="button" className="opt" data-tip="Drag across the regions you want to merge · Shift+M" onClick={() => { setUi({ tool: 'shapeBuilder' }); pop.close(); }}>Shape Builder</button>
      </div>
    </Popover>
  </div>;
}
