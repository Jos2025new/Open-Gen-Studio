import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AudioLines,
  Brush,
  Eraser,
  Clapperboard,
  Crop,
  Download,
  Ellipsis,
  FastForward,
  FileText,
  Frame,
  Grid3x3,
  LayoutGrid,
  Maximize,
  Paperclip,
  PenTool,
  Rotate3d,
  Scissors,
  Shuffle,
  SkipForward,
  Star,
  Sun,
  WandSparkles,
  Workflow,
} from 'lucide-react';
import { OPS, opsFor } from '../../engine/ops';
import { downloadAsset, sendToNodes, toggleFavorite, useAsReference } from '../../engine/actions';
import { openAssetInDesigner } from '../../engine/design/actions';
import type { OpId } from '../../engine/types';
import { setUi, useStore } from '../../store/store';
import { Popover, usePopover } from '../ui/Popover';
import { Chip, IconButton, MenuItem } from '../ui/primitives';
import { OpForm } from './OpForm';

export const OP_ICONS: Record<OpId, LucideIcon> = {
  relight: Sun,
  angle: Rotate3d,
  upscale: Maximize,
  remove_bg: Scissors,
  reframe: Crop,
  variations: Shuffle,
  edit: WandSparkles,
  animate: Clapperboard,
  extract_frame: Frame,
  continue: FastForward,
  contact_sheet: Grid3x3,
  grid_split: LayoutGrid,
  video_upscale: Maximize,
  video_edit: WandSparkles,
  video_extend: SkipForward,
  transcribe: FileText,
  create_voice: AudioLines,
  edit_region: Brush,
  remove_object: Eraser,
};

const QUICK_LABEL: Partial<Record<OpId, string>> = {
  remove_bg: 'Remove BG',
  angle: 'Angle',
  extract_frame: 'Frame',
  continue: 'Continue',
};

function OpChip({ assetId, op, parentId, compact }: { assetId: string; op: OpId; parentId?: string; compact?: boolean }) {
  const pop = usePopover();
  const Icon = OP_ICONS[op];
  const def = OPS[op];
  return (
    <>
      {compact ? (
        <IconButton ref={pop.ref} icon={Icon} label={def.label} size="sm" active={pop.open} onClick={pop.toggle} />
      ) : (
        <Chip ref={pop.ref} icon={Icon} active={pop.open} onClick={pop.toggle} data-tip={def.description}>
          {QUICK_LABEL[op] ?? def.label}
        </Chip>
      )}
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={320} label={def.label}>
        <OpForm op={op} target={{ kind: 'asset', assetId, parentId }} onClose={pop.close} />
      </Popover>
    </>
  );
}

/** Operations available for an asset, by type, plus a "more" menu. */
export function AssetActions({ assetId, parentId, compact = false, showQuick = true }: { assetId: string; parentId?: string; compact?: boolean; showQuick?: boolean }) {
  const asset = useStore((s) => s.assets[assetId]);
  const sessionId = useStore((s) => s.activeSessionId);
  const more = usePopover();
  const [view, setView] = useState<'menu' | OpId>('menu');
  if (!asset) return null;
  const ops = opsFor(asset.kind);
  const quick = showQuick ? ops.filter((o) => o.quick) : [];
  const rest = ops.filter((o) => !quick.includes(o));

  const close = () => {
    more.close();
    setView('menu');
  };

  return (
    <div className="asset-actions">
      {quick.map((o) => (
        <OpChip key={o.id} assetId={assetId} op={o.id} parentId={parentId} compact={compact} />
      ))}
      <IconButton
        ref={more.ref}
        icon={Ellipsis}
        label="More"
        size="sm"
        active={more.open}
        onClick={() => {
          setView('menu');
          more.toggle();
        }}
      />
      <Popover open={more.open} anchor={more.ref} onClose={close} width={view === 'menu' ? 250 : 320} label="More actions">
        {view === 'menu' ? (
          <div className="menu">
            {rest.length ? <div className="menu-sep-label">{asset.kind === 'image' ? 'Image operations' : asset.kind === 'audio' ? 'Audio operations' : 'Video operations'}</div> : null}
            {rest.map((o) => (
              <MenuItem key={o.id} icon={OP_ICONS[o.id]} label={o.label} detail={o.description} onClick={() => setView(o.id)} />
            ))}
            {asset.kind === 'image' ? (
              <MenuItem
                icon={Brush}
                label="Edit region / Remove object"
                detail="Paint the area in Sketch, then describe the change"
                onClick={() => {
                  close();
                  setUi({ sketch: { assetId, mode: 'mask' } });
                }}
              />
            ) : null}
            {rest.length ? <div className="menu-sep" /> : null}
            {asset.kind === 'image' ? (
              <>
                <MenuItem
                  icon={PenTool}
                  label="Open in Designer"
                  detail="As layer 1 of a new design"
                  onClick={() => {
                    close();
                    void openAssetInDesigner(sessionId, assetId);
                  }}
                />
                <MenuItem
                  icon={Paperclip}
                  label="Use as reference"
                  onClick={() => {
                    close();
                    useAsReference(assetId);
                  }}
                />
              </>
            ) : null}
            <MenuItem
              icon={Workflow}
              label="Add to Node canvas"
              onClick={() => {
                close();
                sendToNodes(assetId);
              }}
            />
            <MenuItem
              icon={Download}
              label="Download"
              onClick={() => {
                close();
                void downloadAsset(assetId);
              }}
            />
            <MenuItem icon={Star} label={asset.favorite ? 'Remove favorite' : 'Favorite'} onClick={() => toggleFavorite(assetId)} active={asset.favorite} />
          </div>
        ) : (
          <OpForm op={view} target={{ kind: 'asset', assetId, parentId }} onClose={close} onBack={() => setView('menu')} />
        )}
      </Popover>
    </div>
  );
}
