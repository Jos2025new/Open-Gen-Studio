import { PromptHistory, recordCreatePrompt, usePromptHistory } from './PromptHistory';
import { useRef } from 'react';
import { Paperclip } from 'lucide-react';
import { setComposer, toast, useStore } from '../../store/store';
import { attachFiles } from '../../engine/actions';
import { attachProblem } from './actionRoute';
import { hasImageTwin } from './actionGo';
import type { ComposerMode, MediaKind } from '../../engine/types';
import { MODES } from '../composer/ModeMenu';
import { MediaControls } from '../composer/MediaControls';
import { AttachStrip, SendDirect } from '../composer/Composer';
import { SpaceHead } from './SpaceFrame';

const PLACEHOLDER: Record<MediaKind, string> = {
  image: 'Describe the image…',
  video: 'Describe the shot and the motion…',
  audio: 'Describe the music: genre, mood, tempo, instruments, voice…',
  model3d: 'Describe the object, material and shape…',
};
const CREATE_MODES = MODES.filter((m): m is (typeof MODES)[number] & { id: MediaKind } => m.id !== 'agent');

/**
 * The Space Panel of Create Media: mode tabs, then the composer's own state (prompt, references, model and its
 * parameters) stacked as cards, and Generate pinned below. Nothing here has state of its own: it edits
 * `composer`, and Generate is the composer's SendDirect (check, cost confirmation, generateDirect).
 */
export function SpacePanel() {
  const stored = useStore((s) => s.composer.mode);
  const mode: MediaKind = stored === 'agent' ? 'image' : stored;
  const text = useStore((s) => s.composer.text);
  const history = usePromptHistory(text);
  const attachments = useStore((s) => s.composer.attachments);
  const assets = useStore((s) => s.assets);
  const slots = useStore((s) => s.catalog.schemas[s.composer[mode].modelRef]?.slots);
  const fileRef = useRef<HTMLInputElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const live = attachments.filter((id) => assets[id]);
  const ref = useStore((s) => s.composer[mode].modelRef);
  const twin = hasImageTwin(mode, ref);
  const takesInput = attachProblem('image', mode, slots, twin) === null;
  const takesAudio = Boolean(slots?.audio || slots?.refAudios || (mode === 'video' && slots?.mixedRefs));
  const pick = (m: ComposerMode) => setComposer({ mode: m });
  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    if (!takesInput && !(takesAudio && list.every((f) => f.type.startsWith('audio/')))) { toast('The selected model does not take input files.', 'error'); return; }
    void attachFiles(list);
  };
  return <aside className="space-panel" aria-label="Create settings">
    <SpaceHead title="Create" />
    <div className="space-tabs" role="tablist" aria-label="Media type">
      {CREATE_MODES.map((m) => <button key={m.id} type="button" role="tab" aria-selected={m.id === mode} className={`space-tab ${m.id === mode ? 'is-active' : ''}`} onClick={() => pick(m.id)}>
        <m.icon size={14} strokeWidth={1.8} />{m.label}
      </button>)}
    </div>
    <div className="space-panel-body">
      <div className="space-card">
        <span className="space-card-label">Prompt</span>
        <textarea className="space-prompt" rows={4} value={text} placeholder={PLACEHOLDER[mode]} aria-label="Prompt" onChange={(e) => setComposer({ text: e.target.value })}
          onKeyDown={(e) => {
            history.onKeyDown(e);
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              foot.current?.querySelector<HTMLButtonElement>('.send-btn.is-generate')?.click();
            }
          }} />
        <PromptHistory history={history.history} onChoose={history.choose} />
      </div>
      <div className="space-card">
        <span className="space-card-label">References</span>
        <AttachStrip ids={live} />
        <input ref={fileRef} type="file" hidden multiple accept={['image/png,image/jpeg,image/webp', slots?.clips || slots?.refVideos || slots?.mixedRefs ? 'video/mp4,video/webm' : '', takesAudio ? 'audio/*' : '', mode === 'model3d' ? '.glb,model/gltf-binary' : ''].filter(Boolean).join(',')} onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
        <button type="button" className="space-add" disabled={!takesInput && !takesAudio} onClick={() => fileRef.current?.click()}>
          <Paperclip size={14} />{takesInput || takesAudio ? 'Add references' : 'This model takes no input files'}
        </button>
      </div>
      <div className="space-controls" aria-label="Model and settings"><MediaControls kind={mode} /></div>
    </div>
    <footer ref={foot} className="space-panel-foot"><SendDirect kind={mode} onLaunch={recordCreatePrompt} /></footer>
  </aside>;
}
