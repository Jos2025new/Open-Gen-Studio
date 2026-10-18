import { useState } from 'react';
import { Box, ChevronRight, FileImage, Film, Image as ImageIcon, Music, Search, Type, Wand } from 'lucide-react';
import { OPS, OP_IDS } from '../../engine/ops';
import { newNodeData } from '../../engine/flow/actions';
import { inputPorts, portFits } from '../../engine/flow/graph';
import type { GraphNodeData, OpId, PortType } from '../../engine/types';
import { OP_ICONS } from '../assets/AssetActions';
import { MenuItem } from '../ui/primitives';

const MENU_TIP_DELAY = 2500;

/** Node kinds (and tools) to add; with `accepts`, only those that take that port type as input. */
export function AddNodeItems({ accepts, onPick, onAsset, searchable = false }: { accepts?: PortType | null; onPick: (data: GraphNodeData) => void; onAsset?: () => void; searchable?: boolean }) {
  const [tools, setTools] = useState(false);
  const [query, setQuery] = useState('');
  const matches = (text: string) => text.toLowerCase().includes(query.trim().toLowerCase());
  const takes = (kind: 'image' | 'video' | 'audio' | 'model3d') => !accepts || inputPorts(newNodeData(kind)).some((p) => portFits(accepts, p.type));
  const toolIds = OP_IDS.filter((id) => !OPS[id].multiInput && (!accepts || portFits(accepts, OPS[id].input)));
  if (tools && !query.trim()) {
    return (
      <div className="menu">
        <button type="button" className="menu-back" onClick={() => setTools(false)}>
          ‹ Tools
        </button>
        {toolIds.map((id) => (
          <MenuItem key={id} icon={OP_ICONS[id]} label={OPS[id].label} tip={`${OPS[id].input} → ${OPS[id].output}`} tipDelay={MENU_TIP_DELAY} onClick={() => onPick(newNodeData('tool', { op: id as OpId }))} />
        ))}
      </div>
    );
  }
  return (
    <div className="menu">
      {searchable ? <label className="node-add-search"><Search size={14} aria-hidden /><input autoFocus type="search" aria-label="Search compatible nodes" placeholder="Search nodes and tools…" value={query} onChange={(e) => setQuery(e.target.value)} /></label> : null}
      {!accepts && matches('Text prompt copy') ? <MenuItem icon={Type} label="Text" tip="Prompt or copy that feeds other nodes" tipDelay={MENU_TIP_DELAY} onClick={() => onPick(newNodeData('text'))} /> : null}
      {takes('image') && matches('Image generation reference') ? <MenuItem icon={ImageIcon} label="Image" tip={accepts === 'image' ? 'Use it as a reference' : 'Generate images'} tipDelay={MENU_TIP_DELAY} onClick={() => onPick(newNodeData('image'))} /> : null}
      {takes('video') && matches('Video generation first frame motion') ? <MenuItem icon={Film} label="Video" tip={accepts === 'image' ? 'Use it as the first frame' : accepts === 'audio' ? 'Use it as speech or soundtrack' : 'Generate video'} tipDelay={MENU_TIP_DELAY} onClick={() => onPick(newNodeData('video'))} /> : null}
      {takes('audio') && matches('Audio music song lyrics') ? <MenuItem icon={Music} label="Audio" tip={accepts === 'text' ? 'Use it as the prompt of a song' : 'Generate music or song lyrics'} tipDelay={MENU_TIP_DELAY} onClick={() => onPick(newNodeData('audio'))} /> : null}
      {takes('model3d') && matches('3D model GLB') ? <MenuItem icon={Box} label="3D model" tip="Generate a GLB model from text or image" tipDelay={MENU_TIP_DELAY} onClick={() => onPick(newNodeData('model3d'))} /> : null}
      {!query.trim() && toolIds.length ? <MenuItem icon={Wand} label="Tool" tip="Relight, angle, upscale, animate…" tipDelay={MENU_TIP_DELAY} right={<ChevronRight size={14} />} onClick={() => setTools(true)} /> : null}
      {query.trim() ? toolIds.filter((id) => matches(`${OPS[id].label} ${OPS[id].description}`)).map((id) => <MenuItem key={id} icon={OP_ICONS[id]} label={OPS[id].label} tip={`${OPS[id].input} → ${OPS[id].output}`} tipDelay={MENU_TIP_DELAY} onClick={() => onPick(newNodeData('tool', { op: id as OpId }))} />) : null}
      {onAsset && !accepts && matches('Asset gallery') ? <MenuItem icon={FileImage} label="Asset" tip="Drag one from the gallery onto the canvas" tipDelay={MENU_TIP_DELAY} onClick={onAsset} /> : null}
    </div>
  );
}
