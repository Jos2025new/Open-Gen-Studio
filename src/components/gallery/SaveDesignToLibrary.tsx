import { useState } from 'react';
import type { DesignDoc } from '../../engine/types';
import { runDesignOutput } from '../designer/designerFile';
import { Images } from '../ui/icons';
import { Button, Segmented } from '../ui/primitives';
import { SaveToLibrary } from './SaveToLibrary';

export function SaveDesignToLibrary({ doc, sessionId, space, busy, setBusy, onDone, onCancel }: {
  doc: DesignDoc; sessionId: string; space: 'designer' | 'studio'; busy: boolean;
  setBusy: (busy: boolean) => void; onDone: () => void; onCancel: () => void;
}) {
  const [mode, setMode] = useState<'image' | 'editable'>(doc.library ? 'editable' : 'image');
  const saveImage = async () => {
    if (busy) return;
    setBusy(true);
    onDone();
    try { await runDesignOutput(sessionId, doc.id, true, undefined); } finally { setBusy(false); }
  };
  return <div className="confirm-pop">
    <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'image', label: 'Image' }, { value: 'editable', label: 'Editable' }]} />
    {mode === 'editable' ? <SaveToLibrary space={space} sessionId={sessionId} doc={doc} onDone={onDone} /> : <>
      <p>Save <strong>{doc.name}</strong> to Library as an image?</p>
      <div className="confirm-pop-actions">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" icon={Images} disabled={busy} onClick={() => void saveImage()}>Save</Button>
      </div>
    </>}
  </div>;
}
