import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AudioLines,
  ChevronDown,
  Brush,
  Eraser,
  Clapperboard,
  Crop,
  Download,
  Ellipsis,
  FastForward,
  FileText,
  Film,
  Frame,
  Grid3x3,
  IdCard,
  LayoutGrid,
  Maximize,
  Paperclip,
  PenTool,
  Rotate3d,
  Scissors,
  Send,
  Shuffle,
  SkipForward,
  Star,
  Sun,
  WandSparkles,
  UserPlus,
  Workflow,
} from 'lucide-react';
import { OPS, opsFor } from '../../engine/ops';
import { downloadAsset, libraryItem, saveSheetViews, sendToNodes, SUBJECT_KINDS, subjectFromAsset, toggleFavorite, useAsReference } from '../../engine/actions';
import { openAssetInDesigner } from '../../engine/design/actions';
import type { OpId, SubjectKind } from '../../engine/types';
import { setUi, useStore } from '../../store/store';
import { Popover, usePopover } from '../ui/Popover';
import { Button, Chip, IconButton, MenuItem, Segmented } from '../ui/primitives';
import { OpForm } from './OpForm';

export const OP_ICONS: Record<OpId, LucideIcon> = {
  relight: Sun,
  angle: Rotate3d,
  upscale: Maximize,
  remove_bg: Scissors,
  reframe: Crop,
  variations: Shuffle,
  reference_sheet: IdCard,
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
  join_clips: Film,
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

/** Operations available for an asset, by type: quick chips plus a menu with the rest. */
/** `menuOnly`: no quick chips, every operation in the menu behind one "Tools ▾" button (overlaid on a card's picture). */
export function AssetActions({ assetId, parentId, compact = false, showQuick = true, menuOnly = false }: { assetId: string; parentId?: string; compact?: boolean; showQuick?: boolean; menuOnly?: boolean }) {
  const asset = useStore((s) => s.assets[assetId]);
  const more = usePopover();
  const [view, setView] = useState<'menu' | OpId>('menu');
  if (!asset) return null;
  const ops = opsFor(asset.kind);
  const quick = showQuick && !menuOnly ? ops.filter((o) => o.quick) : [];
  const rest = ops.filter((o) => !quick.includes(o));
  // Only operations live here; sending, favorite and download have their own buttons (SendToMenu, card and viewer).
  const hasMenu = rest.length > 0 || asset.kind === 'image';

  const close = () => {
    more.close();
    setView('menu');
  };

  return (
    <div className="asset-actions">
      {quick.map((o) => (
        <OpChip key={o.id} assetId={assetId} op={o.id} parentId={parentId} compact={compact} />
      ))}
      {menuOnly ? (
        <Chip
          ref={more.ref}
          icon={WandSparkles}
          className="tools-chip"
          active={more.open}
          data-tip="Operations"
          onClick={() => {
            setView('menu');
            more.toggle();
          }}
        >
          Tools
          <ChevronDown size={13} />
        </Chip>
      ) : hasMenu ? (
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
      ) : null}
      <Popover open={more.open} anchor={more.ref} onClose={close} width={view === 'menu' ? 250 : 320} label="Operations">
        {view === 'menu' ? (
          <div className="menu">
            {rest.length ? <div className="menu-sep-label">{asset.kind === 'image' ? 'Image operations' : asset.kind === 'audio' ? 'Audio operations' : asset.kind === 'video' ? 'Video operations' : '3D model operations'}</div> : null}
            {rest.map((o) => (
              // The short "Tools" menu lists names only; the form repeats the description.
              <MenuItem key={o.id} icon={OP_ICONS[o.id]} label={o.label} detail={menuOnly ? undefined : o.description} tip={menuOnly ? o.description : undefined} onClick={() => setView(o.id)} />
            ))}
            {asset.kind === 'image' ? (
              <MenuItem
                icon={Brush}
                label="Edit region / Remove object"
                detail={menuOnly ? undefined : 'Paint the area in Sketch, then describe the change'}
                tip={menuOnly ? 'Paint the area in Sketch, then describe the change' : undefined}
                onClick={() => {
                  close();
                  setUi({ sketch: { assetId, mode: 'mask' } });
                }}
              />
            ) : null}
          </div>
        ) : (
          <OpForm op={view} target={{ kind: 'asset', assetId, parentId }} onClose={close} onBack={() => setView('menu')} />
        )}
      </Popover>
    </div>
  );
}

/** Where else an asset can go: Designer, the composer (reference), the subject library, the Node canvas. */
export function SendToMenu({ assetId, size = 'sm' }: { assetId: string; size?: 'sm' | 'md' }) {
  const asset = useStore((s) => s.assets[assetId]);
  const sessionId = useStore((s) => s.activeSessionId);
  const pop = usePopover();
  const [subject, setSubject] = useState(false);
  const [subjectName, setSubjectName] = useState('');
  const [subjectKind, setSubjectKind] = useState<SubjectKind>('character');
  // A reference sheet can be saved as its four views (Grid-split); on by default for sheets only.
  const isSheet = useStore((s) => {
    const g = asset?.generationId ? s.generations[asset.generationId] : undefined;
    return g?.op?.id === 'reference_sheet';
  });
  const [split, setSplit] = useState(true);
  const taken = subjectName.trim() ? libraryItem(subjectName) : undefined;
  if (!asset) return null;
  const close = () => {
    pop.close();
    setSubject(false);
  };
  return (
    <>
      <IconButton
        ref={pop.ref}
        icon={Send}
        label="Send to"
        size={size}
        active={pop.open}
        onClick={() => {
          setSubject(false);
          pop.toggle();
        }}
      />
      <Popover open={pop.open} anchor={pop.ref} onClose={close} width={subject ? 320 : 240} label="Send to">
        {subject ? (
          <form
            className="subject-new"
            onSubmit={(e) => {
              e.preventDefault();
              const replace = Boolean(taken);
              if (isSheet && split) {
                const name = subjectName;
                close();
                setSubjectName('');
                void saveSheetViews(assetId, name, subjectKind, replace);
              } else if (subjectFromAsset(assetId, subjectName, subjectKind, { replace })) {
                setSubjectName('');
                close();
              }
            }}
          >
            <input autoFocus placeholder="Name, e.g. Mia" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} />
            <Segmented size="sm" value={subjectKind} options={SUBJECT_KINDS} onChange={setSubjectKind} />
            {isSheet ? (
              <label className="subject-split">
                <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Split into 4 views (free)
              </label>
            ) : null}
            {taken ? <p className="subject-warn">@{taken.name} already exists. Saving replaces it in every session.</p> : null}
            <Button size="sm" icon={UserPlus} type="submit" variant={taken ? 'danger' : undefined} disabled={!subjectName.trim()}>
              {taken ? `Replace @${taken.name}` : 'Save to library'}
            </Button>
            <p className="faint">Kept in Assets for every session. Mention it as @Name in any prompt: its image goes as a reference.</p>
          </form>
        ) : (
          <div className="menu">
            <div className="menu-sep-label">Send to</div>
            {asset.kind === 'image' ? (
              <>
                <MenuItem
                  icon={PenTool}
                  label="Open in Designer"
                  tip="As layer 1 of a new design"
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
                <MenuItem icon={UserPlus} label="Save to library" tip="Keep this character, object, product or style as @Name" onClick={() => setSubject(true)} />
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
          </div>
        )}
      </Popover>
    </>
  );
}

/** Favorite and download as their own buttons. */
export function FavoriteButton({ assetId, size = 'sm' }: { assetId: string; size?: 'sm' | 'md' }) {
  const favorite = useStore((s) => Boolean(s.assets[assetId]?.favorite));
  return <IconButton icon={Star} label={favorite ? 'Remove favorite' : 'Favorite'} size={size} active={favorite} className="fav-btn" onClick={() => toggleFavorite(assetId)} />;
}

export function DownloadButton({ assetId, size = 'sm' }: { assetId: string; size?: 'sm' | 'md' }) {
  return <IconButton icon={Download} label="Download" size={size} onClick={() => void downloadAsset(assetId)} />;
}
