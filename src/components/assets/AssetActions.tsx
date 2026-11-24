import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from '../ui/icons';
import {
  ArrowLeft,
  Camera,
  AudioLines,
  Image as ImageIcon,
  ChevronDown,
  ChevronLeft,
  Brush,
  Eraser,
  Clapperboard,
  Crop,
  Download,
  Ellipsis,
  Sparkle,
  FastForward,
  FileText,
  Film,
  Frame,
  Grid3x3,
  IdCard,
  Images,
  LayoutGrid,
  Maximize,
  Paperclip,
  PenTool,
  Plus,
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
  Pencil,
  Sparkles,
} from '../ui/icons';
import { OPS, opsFor } from '../../engine/ops';
import { downloadAsset, libraryItem, saveSheetViews, sendToNodes, SUBJECT_KINDS, subjectFromAsset, toggleFavorite, addAsReference } from '../../engine/actions';
import { createItem, saveItem } from '../../engine/libraryVersions';
import { uid } from '../../lib/id';
import { beginAssetEdit } from '../../engine/assetRevisions';
import { openAssetInDesigner } from '../../engine/design/actions';
import type { Graph, OpId, Subject, SubjectKind } from '../../engine/types';
import { setUi, toast, useStore } from '../../store/store';
import { Popover, usePopover } from '../ui/Popover';
import { Button, Chip, IconButton, MenuItem, Segmented } from '../ui/primitives';
import { DOCK_GROUP_LABEL, DOCK_GROUP_ORDER, opGroup, type OpGroupId } from './opGroups';
import { OpForm } from './OpForm';
import { SaveStyleForm } from './SaveStyleForm';
import { captureOfAsset } from '../../engine/captureLibrary';

export const OP_ICONS: Record<OpId, LucideIcon> = {
  relight: Sun,
  replace_background: ImageIcon,
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
  fx: Sparkle,
};

export const QUICK_LABEL: Partial<Record<OpId, string>> = {
  remove_bg: 'Remove BG',
  angle: 'Angle',
  extract_frame: 'Frame',
  continue: 'Continue',
};

const DOCK_GROUP_ICON: Record<OpGroupId, LucideIcon> = { edit: Pencil, explore: Shuffle, reuse: Clapperboard, finalize: Sparkles };

export function OpChip({ assetId, op, parentId, compact, fullLabel }: { assetId: string; op: OpId; parentId?: string; compact?: boolean; fullLabel?: boolean }) {
  const pop = usePopover();
  const Icon = OP_ICONS[op];
  const def = OPS[op];
  return (
    <>
      {compact ? (
        <IconButton ref={pop.ref} icon={Icon} label={def.label} size="sm" active={pop.open} onClick={pop.toggle} />
      ) : (
        <Chip ref={pop.ref} icon={Icon} active={pop.open} onClick={pop.toggle} data-tip={def.description}>
          {fullLabel ? def.label : (QUICK_LABEL[op] ?? def.label)}
        </Chip>
      )}
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={320} label={def.label}>
        <OpForm op={op} target={{ kind: 'asset', assetId, parentId }} onClose={pop.close} />
      </Popover>
    </>
  );
}

/** Operations available for an asset, by type: grouped dock tabs (or one "Tools ▾" menu when `menuOnly` on cards). */
export function AssetActions({ assetId, parentId, compact = false, menuOnly = false }: { assetId: string; parentId?: string; compact?: boolean; menuOnly?: boolean }) {
  const asset = useStore((s) => s.assets[assetId]);
  const more = usePopover();
  const [view, setView] = useState<'menu' | OpId>('menu');
  const [activeGroup, setActiveGroup] = useState<OpGroupId | null>(null);
  useEffect(() => {
    setActiveGroup(null);
  }, [assetId]);
  if (!asset) return null;
  const ops = opsFor(asset.kind);
  const grouped = DOCK_GROUP_ORDER.map((id) => ({ id, ops: ops.filter((o) => opGroup(o.id) === id) })).filter((g) => g.ops.length > 0);
  const activeOps = activeGroup ? grouped.find((g) => g.id === activeGroup)?.ops ?? [] : [];
  const rest = menuOnly ? ops : [];
  // Only operations live here; sending, favorite and download have their own buttons (SendToMenu, card and viewer).
  const hasMenu = rest.length > 0 || asset.kind === 'image';
  if (menuOnly && !hasMenu) return null;

  const close = () => {
    more.close();
    setView('menu');
  };

  return (
    <>
      {/* One row only: the group tabs, or (inside an open group) a back arrow and that group's ops. */}
      <div className="asset-actions">
        {!menuOnly && activeGroup ? (
          <>
            <IconButton icon={ArrowLeft} label="Volver a los grupos" size="sm" className="lb-dock-back" onClick={() => setActiveGroup(null)} />
            {activeOps.map((o) => (
              <OpChip key={o.id} assetId={assetId} op={o.id} parentId={parentId} compact={compact} fullLabel />
            ))}
          </>
        ) : (
          <>
            {!menuOnly && asset.kind === 'image' ? (
              compact ? (
                <IconButton icon={Brush} label="Pintar" size="sm" onClick={() => beginAssetEdit(assetId)} />
              ) : (
                <Chip icon={Brush} className="lb-tab" onClick={() => beginAssetEdit(assetId)} data-tip="Pintar sobre la imagen">
                  Pintar
                </Chip>
              )
            ) : null}
            {!menuOnly
              ? grouped.map((g) => (
                  <Chip key={g.id} icon={DOCK_GROUP_ICON[g.id]} className="lb-tab" onClick={() => setActiveGroup(g.id)}>
                    {DOCK_GROUP_LABEL[g.id]}
                  </Chip>
                ))
              : null}
          </>
        )}
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
        ) : hasMenu && !activeGroup ? (
          <IconButton
            ref={more.ref}
            icon={Ellipsis}
            label="More"
            size="sm"
            active={more.open}
            onClick={() => {
              setActiveGroup(null);
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
                // Icon and label only; the description is the hover tooltip (the form repeats it).
                <MenuItem key={o.id} icon={OP_ICONS[o.id]} label={o.label} tip={o.description} onClick={() => setView(o.id)} />
              ))}
              {asset.kind === 'image' ? (
                <>
                  {menuOnly ? (
                    <MenuItem
                      icon={Brush}
                      label="Paint / Edit image"
                      tip="Paint over the image on a copy, then save as a copy or apply to original"
                      onClick={() => {
                        close();
                        beginAssetEdit(assetId);
                      }}
                    />
                  ) : null}
                  <MenuItem
                    icon={Eraser}
                    label="Edit region / Remove object"
                    tip="Paint the area in Sketch, then describe the change"
                    onClick={() => {
                      close();
                      setUi({ sketch: { assetId, mode: 'mask' } });
                    }}
                  />
                </>
              ) : null}
            </div>
          ) : (
            <OpForm op={view} target={{ kind: 'asset', assetId, parentId }} onClose={close} onBack={() => setView('menu')} />
          )}
        </Popover>
      </div>
    </>
  );
}

/** Where else an asset can go: Designer, the composer (reference), the subject library, the Node canvas. */
export function SendToMenu({ assetId, size = 'sm' }: { assetId: string; size?: 'sm' | 'md' }) {
  const asset = useStore((s) => s.assets[assetId]), sessionId = useStore((s) => s.activeSessionId);
  const library = useStore((s) => s.library), workspace = useStore((s) => s.ui.workspace);
  const pop = usePopover();
  const [subject, setSubject] = useState(false), [styleForm, setStyleForm] = useState(false);
  const [mood, setMood] = useState(false), [moodBusy, setMoodBusy] = useState(false), moodRef = useRef(false);
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
  const moodboards = library.filter((s) => s.kind === 'moodboard' && !s.userHidden);
  const close = () => { pop.close(); setSubject(false); setStyleForm(false); setMood(false); };
  const addToMoodboard = async (target?: Subject) => {
    if (moodRef.current) return;
    moodRef.current = true; setMoodBusy(true);
    try {
      const space = workspace === 'chat' ? 'studio' : workspace === 'node' ? 'nodes' : 'designer';
      const node = { id: uid('nd'), position: { x: 0, y: 0 }, data: { kind: 'asset' as const, title: asset.name || 'Image', assetId } };
      if (target) {
        const prev = target.graph ?? { nodes: [], edges: [] };
        await saveItem({ subjectId: target.id, mode: 'overwrite', space, by: 'user', sessionId, graph: { ...prev, nodes: [...prev.nodes, node] } as Graph });
        toast(`Added to "${target.name}".`, 'success');
      } else {
        const name = `Moodboard ${moodboards.length + 1}`;
        await createItem({ name, kind: 'moodboard', space, by: 'user', sessionId, graph: { nodes: [node], edges: [] }, draft: false, open: false });
        toast(`Added to "${name}".`, 'success');
      }
      close();
    } catch (e) { toast((e as Error).message, 'error'); } finally { moodRef.current = false; setMoodBusy(false); }
  };
  return (
    <>
      <IconButton ref={pop.ref} icon={Send} label="Send to" size={size} active={pop.open} onClick={() => { setSubject(false); setMood(false); pop.toggle(); }} />
      <Popover open={pop.open} anchor={pop.ref} onClose={close} width={subject || styleForm ? 320 : 240} label="Send to">
        {mood ? (
          <div className="menu">
            <MenuItem icon={ChevronLeft} label="Add to moodboard" onClick={() => setMood(false)} />
            {moodboards.map((m) => <MenuItem key={m.id} icon={Images} label={m.name} disabled={moodBusy} onClick={() => void addToMoodboard(m)} />)}
            <MenuItem icon={Plus} label="New moodboard" disabled={moodBusy} onClick={() => void addToMoodboard()} />
          </div>
        ) : styleForm ? (
          <SaveStyleForm assetId={assetId} onDone={close} />
        ) : subject ? (
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
                    addAsReference(assetId);
                  }}
                />
                <MenuItem icon={UserPlus} label="Save to library" tip="Keep this character, object, product or style as @Name" onClick={() => setSubject(true)} />
                <MenuItem icon={Images} label="Add to moodboard" onClick={() => setMood(true)} />
              </>
            ) : null}
            {asset.kind !== 'audio' && asset.kind !== 'model3d' && captureOfAsset(assetId) ? <MenuItem icon={Camera} label="Guardar como estilo" tip="Guarda la cámara, el tono, la luz y la textura de este resultado" onClick={() => setStyleForm(true)} /> : null}
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

/** Attach this file to the prompt (as a reference, start frame or input, depending on the mode). */
export function AttachButton({ assetId, size = 'sm' }: { assetId: string; size?: 'sm' | 'md' }) {
  return <IconButton icon={Paperclip} label="Attach to prompt" size={size} onClick={() => addAsReference(assetId)} />;
}

export function DownloadButton({ assetId, size = 'sm' }: { assetId: string; size?: 'sm' | 'md' }) {
  return <IconButton icon={Download} label="Download" size={size} onClick={() => void downloadAsset(assetId)} />;
}
