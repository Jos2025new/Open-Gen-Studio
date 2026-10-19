import { SpaceFrame } from './SpaceFrame';
import { SpaceBoard } from './SpaceBoard';
import { ToolsPanel, useToolOp } from './ToolsPanel';
import { OPS } from '../../engine/ops';

/** Tools: one operation at a time. Same Space Panel / Space Board frame as Create Media. */
export function ToolsSpace() {
  const op = useToolOp();
  const kind = OPS[op].input;
  return <SpaceFrame label="Tools" panel={<ToolsPanel />} board={<SpaceBoard place="space-tools" kind={kind} empty="Nothing generated yet. Pick a tool and run it on an asset." />} />;
}
