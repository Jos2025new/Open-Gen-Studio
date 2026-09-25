import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, CircleStop, Layers, Paperclip, Pencil, X, Zap } from 'lucide-react';
import { setComposer, toast, useStore } from '../../store/store';
import { sendAgentMessage, stopAgent } from '../../engine/agent/runtime';
import { attachFiles, checkDirect, generateDirect } from '../../engine/actions';
import { activeLayer } from '../../engine/design/doc';
import { activeDoc } from '../../engine/design/actions';
import { clipTrim, paramByRole, placeKeyframes } from '../../engine/params';
import type { MediaKind } from '../../engine/types';
import { AssetMedia } from '../ui/AssetMedia';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { Chip, costLabel, IconButton } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';
import { ModeMenu } from './ModeMenu';
import { AgentControls } from './AgentControls';
import { MediaControls } from './MediaControls';
import { ThreadPeek } from './ThreadPeek';

/** Keyframe second (keyframe models) or clip trim (clip models) of one attachment; click to change it. */
function AttachTiming({ id }: { id: string }) {
  const mode = useStore((s) => s.composer.mode);
  const schema = useStore((s) => (s.composer.mode === 'agent' ? undefined : s.catalog.schemas[s.composer[s.composer.mode].modelRef]));
  const attachments = useStore((s) => s.composer.attachments);
  const assets = useStore((s) => s.assets);
  const times = useStore((s) => s.composer.times);
  const trims = useStore((s) => s.composer.trims);
  const chosen = useStore((s) => s.composer.video.settings.duration);
  const pop = usePopover();
  const asset = assets[id];
  const kf = mode === 'video' ? schema?.slots.keyframes : undefined;
  const clips = schema?.slots.clips;
  if (!asset || (!kf && !clips) || (kf && asset.kind !== 'image') || (clips && asset.kind !== 'video')) return null;

  let label: string;
  let body: ReactNode;
  if (kf) {
    // Same length rule as the job runner: the chosen duration, else the model default.
    const def = Number(paramByRole(schema, 'duration')?.default);
    const duration = chosen != null && chosen > 0 ? chosen : Number.isFinite(def) && def > 0 ? def : 5;
    const images = attachments.filter((a) => assets[a]?.kind === 'image');
    const frames = placeKeyframes(images.length, duration, kf.fps, images.map((a) => times?.[a]));
    const at = frames[images.indexOf(id)] / kf.fps;
    label = `${at.toFixed(1)}s`;
    body = (
      <div className="attach-timing">
        <label>
          At second
          <input type="number" min={0} max={duration} step={0.1} value={Number(at.toFixed(2))} onChange={(e) => setComposer((c) => ({ times: { ...c.times, [id]: Number(e.target.value) } }))} />
        </label>
        <p className="faint">
          Frame {frames[images.indexOf(id)]} of {Math.round(duration * kf.fps)} ({kf.fps} fps). One image opens the clip, two pin start and end, more are spread evenly unless set here.
        </p>
        <button type="button" className="link" onClick={() => setComposer((c) => ({ times: Object.fromEntries(Object.entries(c.times ?? {}).filter(([k]) => k !== id)) }))}>
          Spread evenly
        </button>
      </div>
    );
  } else {
    const [start, end] = clipTrim(clips!, asset.duration, trims?.[id]);
    label = end === 0 ? 'Whole' : `${start}–${end}s`;
    const set = (next: [number, number]) => setComposer((c) => ({ trims: { ...c.trims, [id]: next } }));
    body = (
      <div className="attach-timing">
        <label>
          From
          <input type="number" min={0} step={clips!.integer ? 1 : 0.1} value={start} onChange={(e) => set([Number(e.target.value), end])} />
        </label>
        <label>
          To
          <input type="number" min={0} step={clips!.integer ? 1 : 0.1} value={end} onChange={(e) => set([start, Number(e.target.value)])} />
        </label>
        <p className="faint">
          {clips!.maxSpan ? `At most ${clips!.maxSpan} s are used.` : clips!.wholeEnd === 0 ? 'To 0 uses the whole clip.' : ''}
          {asset.duration ? ` Clip length ${asset.duration.toFixed(1)} s.` : ''}
        </p>
      </div>
    );
  }
  return (
    <>
      <button ref={pop.ref} type="button" className="attach-time" onClick={pop.toggle} data-tip={kf ? 'Keyframe position' : 'Clip trim'}>
        {label}
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={240} label={kf ? 'Keyframe' : 'Clip trim'}>
        <PopoverHeader title={kf ? 'Keyframe' : 'Clip trim'} />
        {body}
      </Popover>
    </>
  );
}

const PLACEHOLDER = {
  agent: {
    chat: 'Describe what you want to create…',
    node: 'Describe a flow — the agent builds and connects the nodes…',
    designer: 'Describe a design — the agent works in layers…',
  },
  image: 'Describe the image…',
  video: 'Describe the shot and the motion…',
};

function DesignerTargetChip() {
  const sessionId = useStore((s) => s.activeSessionId);
  const target = useStore((s) => s.composer.designerTarget);
  const doc = useStore(() => activeDoc(sessionId));
  const layer = activeLayer(doc);
  const pop = usePopover();
  const canReplace = layer?.type === 'raster' && !layer.locked;
  const effective = target === 'replace' && canReplace ? 'replace' : 'new';
  return (
    <>
      <Chip ref={pop.ref} icon={Layers} active={pop.open} onClick={pop.toggle} data-tip="Where the generated image goes">
        {!doc?.layers.length ? 'Layer 1' : effective === 'replace' ? `Replace “${layer?.name}”` : 'New layer'}
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={280} label="Target layer">
        <PopoverHeader title="Target" sub="Generated images only go on raster layers." />
        <div className="menu">
          <button
            type="button"
            className={`menu-item ${effective === 'new' ? 'is-active' : ''}`}
            onClick={() => {
              setComposer({ designerTarget: 'new' });
              pop.close();
            }}
          >
            <span className="menu-text">
              <span className="menu-label">New raster layer</span>
              <span className="menu-detail">{doc?.layers.length ? 'Above the active layer' : 'Becomes layer 1'}</span>
            </span>
          </button>
          <button
            type="button"
            className={`menu-item ${effective === 'replace' ? 'is-active' : ''}`}
            disabled={!canReplace}
            onClick={() => {
              setComposer({ designerTarget: 'replace' });
              pop.close();
            }}
          >
            <span className="menu-text">
              <span className="menu-label">Replace active layer</span>
              <span className="menu-detail">
                {canReplace ? `Pixels of “${layer!.name}”` : layer ? `“${layer.name}” is a ${layer.locked ? 'locked' : layer.type} layer` : 'No active layer'}
              </span>
            </span>
          </button>
        </div>
      </Popover>
    </>
  );
}

function SendDirect({ kind }: { kind: MediaKind }) {
  const composer = useStore((s) => s.composer);
  const schema = useStore((s) => s.catalog.schemas[s.composer[kind].modelRef]);
  const assets = useStore((s) => s.assets);
  const spent = useStore((s) => s.spentUsd);
  const budget = useStore((s) => s.settings.budgetUsd);
  const workspace = useStore((s) => s.ui.workspace);
  const models = useStore((s) => s.catalog.models);
  // Recompute whenever any input of the check changes.
  const check = useMemo(() => checkDirect(kind), [kind, composer, schema, assets, spent, budget, workspace, models]);
  const pop = usePopover();
  const unknown = check.estimate.usd == null;
  const onClick = () => {
    if (!check.ok) {
      toast(check.reason ?? 'Not ready', 'error');
      return;
    }
    if (unknown) pop.toggle();
    else void generateDirect(kind);
  };
  return (
    <>
      <button
        ref={pop.ref}
        type="button"
        className={`send-btn is-generate ${check.ok ? '' : 'is-blocked'}`}
        onClick={onClick}
        aria-disabled={!check.ok}
        data-tip={check.ok ? (unknown ? 'Price not published: you will confirm first' : 'Generate (Enter)') : check.reason}
      >
        <Zap size={14} strokeWidth={2} />
        <span>Generate</span>
        <span className="send-cost num">{costLabel(check.estimate, { short: true })}</span>
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={300} label="Confirm cost">
        <SpendConfirm
          title="Generate"
          estimate={check.estimate}
          confirmLabel="Generate"
          onConfirm={() => {
            pop.close();
            void generateDirect(kind);
          }}
          onCancel={pop.close}
        />
      </Popover>
    </>
  );
}

export function Composer() {
  const mode = useStore((s) => s.composer.mode);
  const text = useStore((s) => s.composer.text);
  const attachments = useStore((s) => s.composer.attachments);
  const editing = useStore((s) => s.composer.editing);
  const editingPrompt = useStore((s) => (s.composer.editing ? s.generations[s.composer.editing.generationId]?.prompt : undefined));
  const workspace = useStore((s) => s.ui.workspace);
  const focusTick = useStore((s) => s.ui.focusComposer);
  const busy = useStore((s) => s.sessions[s.activeSessionId]?.agent.busy ?? false);
  const assets = useStore((s) => s.assets);
  const acceptsImages = useStore((s) => {
    if (s.composer.mode === 'agent') return true;
    const slots = s.catalog.schemas[s.composer[s.composer.mode].modelRef]?.slots;
    return s.composer.mode === 'image' ? Boolean(slots?.images || slots?.clips) : Boolean(slots?.firstFrame || slots?.images || slots?.mixedRefs || slots?.keyframes);
  });
  // Reference-to-video models: several references, and videos too when the model takes them.
  const mediaSlots = useStore((s) => (s.composer.mode === 'agent' ? undefined : s.catalog.schemas[s.composer[s.composer.mode].modelRef]?.slots));
  // Reference-to-video, keyframe and clip models: several inputs, and videos where the model takes them.
  const videoRefs =
    mode === 'video'
      ? { multiple: Boolean(mediaSlots?.images || mediaSlots?.mixedRefs || mediaSlots?.keyframes), videos: Boolean(mediaSlots?.refVideos || mediaSlots?.mixedRefs || mediaSlots?.clips) }
      : { multiple: true, videos: Boolean(mediaSlots?.clips) };
  // Audio attachments: speech for lip-sync / avatars, a soundtrack, or reference audio.
  const takesAudio = mode === 'agent' || Boolean(mediaSlots?.audio || mediaSlots?.refAudios || (mode === 'video' && mediaSlots?.mixedRefs));
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (focusTick) taRef.current?.focus();
  }, [focusTick]);

  // Video cannot live on designer layers: switch the composer to image there.
  useEffect(() => {
    if (workspace === 'designer' && mode === 'video') {
      setComposer({ mode: 'image' });
      toast('Designer layers hold images, text and shapes — switched to Image.', 'info');
    }
  }, [workspace, mode]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
  }, [text, mode]);

  const liveAttachments = attachments.filter((id) => assets[id]);
  const canSendAgent = !busy && (text.trim().length > 0 || liveAttachments.length > 0);

  const submit = () => {
    if (mode === 'agent') {
      if (canSendAgent) void sendAgentMessage(text);
      return;
    }
    const check = checkDirect(mode);
    if (!check.ok) {
      toast(check.reason ?? 'Not ready', 'error');
      return;
    }
    // Unknown prices always go through the confirmation popover on the button.
    if (check.estimate.usd == null) {
      (document.querySelector('.send-btn.is-generate') as HTMLButtonElement | null)?.click();
      return;
    }
    void generateDirect(mode);
  };

  const addAssets = (ids: string[]) => {
    const kinds = ids.map((id) => useStore.getState().assets[id]?.kind);
    if (mode !== 'agent' && !videoRefs.videos && kinds.includes('video')) {
      toast('This model takes no reference videos. Extract a frame to use one as an image.', 'error');
      return;
    }
    if (!takesAudio && kinds.includes('audio')) {
      toast('This model takes no audio.', 'error');
      return;
    }
    setComposer((c) => ({ attachments: [...c.attachments, ...ids.filter((id) => !c.attachments.includes(id))] }));
  };

  const onFiles = (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const list = [...files];
    const onlyAudio = list.every((f) => f.type.startsWith('audio/'));
    if (!acceptsImages && !(takesAudio && onlyAudio)) {
      toast('The selected model does not take input images.', 'error');
      return;
    }
    if (!takesAudio && list.some((f) => f.type.startsWith('audio/'))) {
      toast('This model takes no audio.', 'error');
      return;
    }
    void attachFiles(list);
  };

  return (
    <div className={`composer-dock dock-${workspace}`}>
      {workspace !== 'chat' ? <ThreadPeek /> : null}
      <div
        className={`composer ${dragOver ? 'is-drop' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-ogs-asset')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          setDragOver(false);
          const assetId = e.dataTransfer.getData('application/x-ogs-asset');
          if (assetId) {
            e.preventDefault();
            if (!acceptsImages) toast('The selected model does not take input images.', 'error');
            else addAssets([assetId]);
            return;
          }
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            onFiles(e.dataTransfer.files);
          }
        }}
      >
        {editing || liveAttachments.length ? (
          <div className="composer-top">
            {editing ? (
              <span className="editing-chip" data-tip={editingPrompt}>
                <Pencil size={12} />
                Editing
                <button type="button" aria-label="Stop editing" onClick={() => setComposer({ editing: null })}>
                  <X size={12} />
                </button>
              </span>
            ) : null}
            {liveAttachments.map((id) => (
              <span key={id} className="attach-thumb">
                <AssetMedia assetId={id} hoverPlay={false} draggable={false} />
                <AttachTiming id={id} />
                <button type="button" aria-label="Remove attachment" onClick={() => setComposer((c) => ({ attachments: c.attachments.filter((a) => a !== id) }))}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          ref={taRef}
          className="composer-input"
          rows={1}
          value={text}
          placeholder={mode === 'agent' ? PLACEHOLDER.agent[workspace] : PLACEHOLDER[mode]}
          onChange={(e) => setComposer({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
            if (files.length) {
              e.preventDefault();
              onFiles(files);
            }
          }}
          aria-label="Prompt"
        />
        <div className="composer-bar">
          <ModeMenu />
          <div className="composer-controls">
            {mode === 'agent' ? <AgentControls /> : <MediaControls kind={mode} />}
            {workspace === 'designer' && mode === 'image' ? <DesignerTargetChip /> : null}
          </div>
          <div className="composer-end">
            <IconButton
              icon={Paperclip}
              label={
                acceptsImages ? (mode === 'video' ? (videoRefs.multiple ? 'Attach references' : 'Start frame') : 'Attach images') : takesAudio ? 'Attach audio' : 'This model takes no input files'
              }
              size="md"
              disabled={!acceptsImages && !takesAudio}
              onClick={() => fileRef.current?.click()}
            />
            <input
              ref={fileRef}
              type="file"
              accept={['image/png,image/jpeg,image/webp', mode === 'agent' || videoRefs.videos ? 'video/mp4,video/webm' : '', takesAudio ? 'audio/*' : ''].filter(Boolean).join(',')}
              multiple={mode !== 'video' || videoRefs.multiple}
              hidden
              onChange={(e) => {
                onFiles(e.target.files);
                e.target.value = '';
              }}
            />
            {mode === 'agent' ? (
              busy ? (
                <button type="button" className="send-btn is-stop" onClick={stopAgent} aria-label="Stop" data-tip="Stop the agent">
                  <CircleStop size={16} />
                </button>
              ) : (
                <button type="button" className="send-btn is-agent" disabled={!canSendAgent} onClick={submit} aria-label="Send" data-tip="Send (Enter)">
                  <ArrowUp size={16} strokeWidth={2.2} />
                </button>
              )
            ) : (
              <SendDirect kind={mode} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
