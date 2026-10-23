import { Layers as LayersIcon } from 'lucide-react';
import type { DesignDoc } from '../../engine/types';
import type { DesignTool } from '../../engine/design/rules';
import { IconButton } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { ToolDock } from '../designer/ToolDock';
import { EmbeddedLayers } from './EmbeddedLayers';

/** The tools Studio's board offers: pick and move, pan, line art, eraser, shapes and text. The rest stay in the full Designer. */
export const EMBEDDED_TOOLS: ReadonlySet<DesignTool> = new Set<DesignTool>(['move', 'hand', 'lineart', 'eraser', 'text', 'rect', 'ellipse', 'line', 'curve', 'arrow', 'polygon', 'star', 'sector', 'arc', 'chord']);

/** The bottom bar of the board: the same ToolDock as the full Designer (limited to EMBEDDED_TOOLS) plus the layers list. */
export function EmbeddedDesignerBar({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const layersPop = usePopover();
  return <div className="designer-palette is-docked studio-palette">
    <div className="studio-dock-row">
      <ToolDock sessionId={sessionId} doc={doc} tools={EMBEDDED_TOOLS} />
      <IconButton ref={layersPop.ref} icon={LayersIcon} label="Layers" size="md" active={layersPop.open} aria-haspopup="dialog" aria-expanded={layersPop.open} onClick={layersPop.toggle} />
      <Popover open={layersPop.open} anchor={layersPop.ref} onClose={layersPop.close} width={260} label="Layers">
        <EmbeddedLayers sessionId={sessionId} doc={doc} />
      </Popover>
    </div>
  </div>;
}
