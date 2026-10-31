import { ChevronDown, MessageSquare, PenTool, Workflow, type LucideIcon } from 'lucide-react';
import type { Workspace } from '../../engine/types';
import { setUi } from '../../store/store';
import { MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { useStore } from '../../store/store';

export const WORKSPACES: Array<{ id: Workspace; label: string; icon: LucideIcon; hint: string }> = [
  { id: 'chat', label: 'Chat', icon: MessageSquare, hint: 'Conversation, questions and results' },
  { id: 'node', label: 'Node', icon: Workflow, hint: 'Connected flows of cards' },
  { id: 'designer', label: 'Designer', icon: PenTool, hint: 'Layers: raster, vector and text' },
];

export function WorkspaceMenuItems({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  return WORKSPACES.map((w) => <MenuItem key={w.id} icon={w.icon} label={w.label} detail={w.hint} active={w.id === workspace} onClick={() => { setUi({ workspace: w.id, home: false, space: undefined }); onClose(); }} />);
}

export function ComposerWorkspaceMenu() {
  const workspace = useStore((s) => s.ui.workspace);
  const pop = usePopover();
  return <>
    <button type="button" ref={pop.ref} className="ws-tag title-btn" aria-label="Switch workspace" aria-haspopup="menu" aria-expanded={pop.open} onClick={pop.toggle}>
      {WORKSPACES.find((w) => w.id === workspace)?.label}<ChevronDown size={12} />
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={240} align="start" boundarySelector=".composer-dock" label="Canvases">
      <div className="menu" role="menu"><WorkspaceMenuItems workspace={workspace} onClose={pop.close} /></div>
    </Popover>
  </>;
}
