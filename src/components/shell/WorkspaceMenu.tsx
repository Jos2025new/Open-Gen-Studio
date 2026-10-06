import { MessageSquare, PenTool, Workflow, type LucideIcon } from 'lucide-react';
import type { Workspace } from '../../engine/types';
import { setUi } from '../../store/store';
import { MenuItem } from '../ui/primitives';

export const WORKSPACES: Array<{ id: Workspace; label: string; icon: LucideIcon; hint: string }> = [
  { id: 'chat', label: 'Chat', icon: MessageSquare, hint: 'Conversation, questions and results' },
  { id: 'node', label: 'Node', icon: Workflow, hint: 'Connected flows of cards' },
  { id: 'designer', label: 'Designer', icon: PenTool, hint: 'Layers: raster, vector and text' },
];

export function WorkspaceMenuItems({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  return WORKSPACES.map((w) => <MenuItem key={w.id} icon={w.icon} label={w.label} detail={w.hint} active={w.id === workspace} onClick={() => { setUi({ workspace: w.id }); onClose(); }} />);
}
