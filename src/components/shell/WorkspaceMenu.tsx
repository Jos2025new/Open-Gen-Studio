import { MessageSquare, PenTool, Workflow, type LucideIcon } from '../ui/icons';
import type { Workspace } from '../../engine/types';

export const WORKSPACES: Array<{ id: Workspace; label: string; icon: LucideIcon; hint: string }> = [
  { id: 'chat', label: 'Chat', icon: MessageSquare, hint: 'Conversation, questions and results' },
  { id: 'node', label: 'Node', icon: Workflow, hint: 'Connected flows of cards' },
  { id: 'designer', label: 'Designer', icon: PenTool, hint: 'Layers: raster, vector and text' },
];
