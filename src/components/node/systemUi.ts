import { Bot, Cpu, Database, FileText, MessageSquare, Sparkles, Wand, type LucideIcon } from '../ui/icons';
import type { SystemNodeType } from '../../engine/types';

/**
 * The menu side of a system node type (like `NODE_UIS` for the creative ones): its entry in the omnicanvas «Add node»
 * library. `null`: it has no entry (Spaces have their own; prompt and mediaSettings are made elsewhere).
 * The initial values are `SYSTEM_DEFAULTS` (engine/nodes/systemDefaults.ts), the title and ports `SYSTEM_NODE_TYPES`.
 */
export interface SystemUi { icon: LucideIcon; /** The line under the name. */ sub: string; /** What the search matches besides the label. */ keywords: string }

/** One entry per system type: `tsc` asks for the entry of a new type. */
export const SYSTEM_UIS: Record<SystemNodeType, SystemUi | null> = {
  chat: { icon: MessageSquare, sub: 'The chat of this session', keywords: 'chat conversation messages' },
  agent: { icon: Bot, sub: 'The agent that answers in the chat', keywords: 'agent assistant director' },
  model: { icon: Sparkles, sub: 'A model to attach to the agent or chat', keywords: 'model provider llm' },
  provider: { icon: Cpu, sub: 'A provider and its catalog', keywords: 'provider catalog openrouter' },
  'designer.doc': { icon: FileText, sub: 'A Designer document', keywords: 'designer doc canvas layers' },
  library: { icon: Database, sub: 'Characters, objects and styles', keywords: 'library subjects characters' },
  toolset: { icon: Wand, sub: 'The operations catalog', keywords: 'tools operations catalog' },
  session: { icon: MessageSquare, sub: 'This session', keywords: 'session' },
  space: null,
  prompt: null,
  mediaSettings: null,
};

/** The order of the menu: the order of the entries here (not the order of the types). */
export const SYSTEM_MENU_ORDER = ['chat', 'agent', 'model', 'provider', 'designer.doc', 'library', 'toolset', 'session'] as const satisfies readonly SystemNodeType[];
