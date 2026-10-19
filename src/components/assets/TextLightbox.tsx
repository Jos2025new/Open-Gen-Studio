import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { IconButton } from '../ui/primitives';
import { GenerationInfo } from './GenerationInfo';
import { TextResult } from './TextResult';
import './text-result.css';

export function TextLightbox() {
  const id = useStore((s) => s.ui.textView);
  const g = useStore((s) => id ? s.generations[id] : undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (g && id) dialog.current?.showModal?.();
    return () => dialog.current?.close?.();
  }, [id, g?.id]);
  if (!id || !g) return null;
  return <dialog ref={dialog} className="text-lightbox" aria-label="Text viewer" onCancel={(e) => { e.preventDefault(); setUi({ textView: null }); }}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setUi({ textView: null }); } }}>
    <header className="lb-head"><h2>Text result</h2><IconButton icon={X} label="Close text" onClick={() => setUi({ textView: null })} /></header>
    <TextResult g={g} />
    <GenerationInfo generation={g} />
  </dialog>;
}
