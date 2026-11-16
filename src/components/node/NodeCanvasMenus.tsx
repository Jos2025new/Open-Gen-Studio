import { Copy, Trash } from '../ui/icons';
import { MenuItem } from '../ui/primitives';

/** Right-click menu of a node on the canvas. */
export function NodeContextMenu({ onDuplicate, onDelete }: { onDuplicate: () => void; onDelete: () => void }) {
  return (
    <div className="menu">
      <MenuItem icon={Copy} label="Duplicate" onClick={onDuplicate} />
      <MenuItem icon={Trash} label="Delete" detail="Del" danger onClick={onDelete} />
    </div>
  );
}

/** The rubber-band rectangle drawn while box-selecting (screen coordinates). */
export function BoxSelectRect({ box }: { box: { x0: number; y0: number; x1: number; y1: number } }) {
  return <div className="node-box-select" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />;
}
