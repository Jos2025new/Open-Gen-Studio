import { useState } from 'react';
import { Camera } from 'lucide-react';
import { captureOfAsset, saveCaptureStyle } from '../../engine/captureLibrary';
import { libraryItem } from '../../engine/actions';
import { useStore } from '../../store/store';
import { Button } from '../ui/primitives';

/** Nombre y, si quieres, la imagen como referencia de estilo; guarda el CTLT del resultado en «Mis estilos». */
export function SaveStyleForm({ assetId, onDone }: { assetId: string; onDone: () => void }) {
  const isImage = useStore((s) => s.assets[assetId]?.kind === 'image');
  const [name, setName] = useState('');
  const [withImage, setWithImage] = useState(false);
  const capture = captureOfAsset(assetId);
  const taken = name.trim() ? libraryItem(name) : undefined;
  const replace = taken?.kind === 'style';
  return (
    <form
      className="subject-new"
      onSubmit={(e) => {
        e.preventDefault();
        if (saveCaptureStyle(assetId, name, withImage, replace)) onDone();
      }}
    >
      <input autoFocus placeholder="Nombre, p. ej. Tarde de skate" value={name} onChange={(e) => setName(e.target.value)} />
      {capture ? <p className="faint">{capture.camera} · {capture.tone} · {capture.light} · {capture.texture}</p> : null}
      {isImage ? <label className="subject-split"><input type="checkbox" checked={withImage} onChange={(e) => setWithImage(e.target.checked)} /> Usar la imagen como referencia de estilo</label> : null}
      {taken ? <p className="subject-warn">{replace ? `«${taken.name}» ya existe. Guardar lo reemplaza en todas las sesiones.` : `@${taken.name} es otro elemento de la biblioteca: elige otro nombre.`}</p> : null}
      <Button size="sm" icon={Camera} type="submit" variant={replace ? 'danger' : undefined} disabled={!name.trim() || !capture || (Boolean(taken) && !replace)}>
        {replace ? `Reemplazar «${taken!.name}»` : 'Guardar estilo'}
      </Button>
      <p className="faint">Aparece en «Mis estilos» del selector de captura y el agente lo usa con «con mi estilo {name.trim() || 'X'}».</p>
    </form>
  );
}
