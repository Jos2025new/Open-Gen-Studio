import { Box, Film, Image as ImageIcon, MessageSquare, PenTool, Workflow, AudioLines, Wand2, Eraser, ZoomIn, Sun, Crop, Copy, Rotate3d, ImagePlus, Clapperboard, FastForward, Frame, Mic, Grid2x2, type LucideIcon } from 'lucide-react';
import type { AssetKind, ComposerMode, OpId, Workspace } from '../../engine/types';
import { OPS, opsFor } from '../../engine/ops';
import { setComposer, setUi } from '../../store/store';

/** The one description of the app's destinations; the sidebar and the Home view both draw from it. */

export interface SpaceItem { id: 'studio' | 'canvas' | 'designer'; label: string; hint: string; icon: LucideIcon; workspace: Workspace }
export const SPACES: SpaceItem[] = [
  { id: 'studio', label: 'Studio', hint: 'Describe what you want; the agent plans and runs it', icon: MessageSquare, workspace: 'chat' },
  { id: 'canvas', label: 'Canvas', hint: 'Connected flows of cards', icon: Workflow, workspace: 'node' },
  { id: 'designer', label: 'Designer', hint: 'Layers: raster, vector and text', icon: PenTool, workspace: 'designer' },
];

export interface CreateItem { id: 'image' | 'video' | 'audio' | 'model3d'; label: string; hint: string; icon: LucideIcon; kind: AssetKind; mode: ComposerMode; soon?: boolean }
export const CREATE: CreateItem[] = [
  { id: 'image', label: 'Image', hint: 'Generate pictures from a prompt', icon: ImageIcon, kind: 'image', mode: 'image' },
  { id: 'video', label: 'Video', hint: 'Animate a scene or a still', icon: Film, kind: 'video', mode: 'video' },
  { id: 'audio', label: 'Audio', hint: 'Voice, music and effects', icon: AudioLines, kind: 'audio', mode: 'audio' },
  { id: 'model3d', label: '3D', hint: 'Models from text or images', icon: Box, kind: 'model3d', mode: 'model3d' },
];

/** The operations shown first, per input kind; the rest sit behind "More". */
const MAIN_IMAGE: OpId[] = ['edit', 'remove_bg', 'upscale', 'relight', 'reframe', 'variations', 'replace_background', 'angle'];
const MAIN_VIDEO: OpId[] = ['video_edit', 'video_upscale', 'video_extend', 'extract_frame'];

export interface ToolItem { id: OpId; label: string; kind: AssetKind; icon: LucideIcon }
const ICONS: Partial<Record<OpId, LucideIcon>> = {
  edit: Wand2, remove_bg: Eraser, upscale: ZoomIn, relight: Sun, reframe: Crop, variations: Copy, replace_background: ImagePlus, angle: Rotate3d,
  video_edit: Clapperboard, video_upscale: ZoomIn, video_extend: FastForward, extract_frame: Frame, transcribe: Mic, contact_sheet: Grid2x2, grid_split: Grid2x2,
};
const tool = (kind: AssetKind) => (id: OpId): ToolItem => ({ id, label: OPS[id].label, kind, icon: ICONS[id] ?? Wand2 });
const restOf = (kind: AssetKind, main: OpId[]) => opsFor(kind).map((o) => o.id).filter((id) => !main.includes(id)).map(tool(kind));

export const TOOLS_MAIN: ToolItem[] = [...MAIN_IMAGE.map(tool('image')), ...MAIN_VIDEO.map(tool('video'))].filter((t) => OPS[t.id]);
export const TOOLS_MORE: ToolItem[] = [...restOf('image', MAIN_IMAGE), ...restOf('video', MAIN_VIDEO), ...restOf('audio', [])];

/** Every action leaves the Home view or the open Space and applies on the next render. */
export function openHome(): void { setUi({ home: true, space: undefined, panel: null, homeTab: 'home' }); }
/** The Library as a full page: Home with its Library tab active. */
export function openLibrary(): void { setUi({ home: true, space: undefined, panel: null, homeTab: 'gallery' }); }
export function openSpace(item: SpaceItem): void {
  if (item.id === 'studio') setComposer({ mode: 'agent' });
  setUi({ workspace: item.workspace, home: false, space: undefined });
}
export function openCreate(item: CreateItem): void {
  if (item.soon) return;
  // Generating here is the plain chat-workspace path (not Designer layers), so the workspace is the chat one.
  setComposer({ mode: item.mode });
  setUi({ workspace: 'chat', home: false, space: 'create' });
}
export const ALL_TOOLS: ToolItem[] = [...TOOLS_MAIN, ...TOOLS_MORE];
/** An operation opens the Tools space with it selected; the input asset is chosen there. */
export function openTool(item: ToolItem): void {
  setUi({ workspace: 'chat', home: false, space: 'tools', toolOp: item.id, toolAsset: undefined, panel: null });
}

/** What the Library lists: sketches, masks and 3D view captures are working copies. */
export const isListed = (a: { origin: string }): boolean => a.origin !== 'sketch' && a.origin !== 'mask' && a.origin !== 'view3d';
