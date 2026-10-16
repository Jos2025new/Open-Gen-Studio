import { Panel, useReactFlow } from '@xyflow/react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { IconButton } from '../ui/primitives';

/** The embedded node canvas's only controls: zoom and fit. */
export function EmbeddedControls() {
  const rf = useReactFlow();
  return <Panel position="bottom-left" className="canvas-navigation">
    <IconButton icon={Minus} label="Zoom out" size="sm" onClick={() => void rf.zoomOut({ duration: 150 })} />
    <IconButton icon={Plus} label="Zoom in" size="sm" onClick={() => void rf.zoomIn({ duration: 150 })} />
    <IconButton icon={Maximize} label="Fit view" size="sm" onClick={() => void rf.fitView({ padding: 0.2, duration: 150 })} />
  </Panel>;
}
