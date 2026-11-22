import { Box, FileImage, Film, Image as ImageIcon, Layers, Music, Type, Wand, type LucideIcon } from '../ui/icons';
import type { GraphNodeData, MediaKind, PortType } from '../../engine/types';

/**
 * The interface of a creative node type (ADR 0031 point 5), kept apart from its pure descriptor: React and icons live
 * here, never in `engine/nodecore`. Each entry feeds the add menu, the library and the card icon.
 */
export interface NodeUi {
  kind: GraphNodeData['kind'];
  icon: LucideIcon;
  label: string;
  /** The line under the name in the library. */
  sub: string;
  /** What the library search matches besides the label. */
  keywords: string;
  /** What the compatible-nodes menu search matches (its own words, as before). */
  menuKeywords: string;
  /** The tip of the menu item, given the port type the menu was opened for. */
  tip(accepts?: PortType | null): string;
  /** The library chip that filters it. */
  chip: MediaKind | 'text';
}

/** The card icon of every node kind: the catalog entries below take theirs from here. */
export const KIND_ICON = { text: Type, image: ImageIcon, video: Film, audio: Music, model3d: Box, tool: Wand, asset: FileImage, ref: Layers } as const;

/** Order here is the order of the add menu and the library. */
export const NODE_UIS: readonly NodeUi[] = [
  { kind: 'text', chip: 'text', icon: KIND_ICON.text, label: 'Text', sub: 'Prompt or copy that feeds other nodes', keywords: 'text prompt copy', menuKeywords: 'Text prompt copy', tip: () => 'Prompt or copy that feeds other nodes' },
  { kind: 'image', chip: 'image', icon: KIND_ICON.image, label: 'Image', sub: 'Generate images', keywords: 'image generation reference', menuKeywords: 'Image generation reference', tip: (a) => (a === 'image' ? 'Use it as a reference' : 'Generate images') },
  { kind: 'video', chip: 'video', icon: KIND_ICON.video, label: 'Video', sub: 'Generate video', keywords: 'video generation first frame motion', menuKeywords: 'Video generation first frame motion', tip: (a) => (a === 'image' ? 'Use it as the first frame' : a === 'audio' ? 'Use it as speech or soundtrack' : 'Generate video') },
  { kind: 'audio', chip: 'audio', icon: KIND_ICON.audio, label: 'Audio', sub: 'Generate music or song lyrics', keywords: 'audio music song lyrics voice', menuKeywords: 'Audio music song lyrics', tip: (a) => (a === 'text' ? 'Use it as the prompt of a song' : 'Generate music or song lyrics') },
  { kind: 'model3d', chip: 'model3d', icon: KIND_ICON.model3d, label: '3D model', sub: 'Generate a GLB model from text or image', keywords: '3d model glb', menuKeywords: '3D model GLB', tip: () => 'Generate a GLB model from text or image' },
];
