import { AudioLines, Brush, Captions, Clapperboard, Eraser, Film, FastForward, Image, Maximize2, Play, Scissors, Wand2, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { isConnected, modelSummary, opModelFor, pickImageEditModel, transcriberFor } from '../../../engine/catalog';
import type { ModelSummary } from '../../../engine/types';
import type { OpEngine } from '../../../engine/ops';
import { setSettings, useStore, type Settings } from '../../../store/store';
import { Popover, usePopover } from '../../ui/Popover';
import { Chip } from '../../ui/primitives';
import { ModelList } from '../../composer/ModelList';
import { SetGroup, SetRow } from './SettingsRows';

/** Models that take an inpainting mask: known from the loaded schema, else from the endpoint name. */
function takesMask(m: ModelSummary): boolean {
  const schema = useStore.getState().catalog.schemas[m.ref];
  if (schema) return Boolean(schema.slots.mask);
  return m.kind === 'image' && /inpaint|object-removal|ideogram\/v[23].*\/edit|gpt-image-2(\.5)?.*\/edit/.test(m.id);
}

/** Speech-to-text model for Transcribe: Auto (preferred list) or a pick from the provider's catalog. */
function TranscriberRow() {
  const value = useStore((s) => s.settings.ops.transcribe);
  const all = useStore((s) => s.catalog.transcribers);
  useStore((s) => s.settings.keys);
  const list = Object.values(all ?? {}).filter((m) => isConnected(m.provider));
  const auto = transcriberFor();
  const price = (usd?: number) => (usd != null ? ` · $${usd}/min` : '');
  return (
    <SetRow icon={Captions} label="Transcribe">
      <select
        className="wide-chip"
        value={value ?? ''}
        onChange={(e) => setSettings((s) => ({ ops: { ...s.ops, transcribe: e.target.value || null } }))}
        aria-label="Transcribe model"
      >
        <option value="">{`Auto · ${auto ? auto.name + price(auto.usdPerMinute) : 'no connected provider'}`}</option>
        {list.map((m) => (
          <option key={m.ref} value={m.ref}>
            {m.name}
            {price(m.usdPerMinute)}
            {m.diarization ? ' · speakers' : ''}
          </option>
        ))}
      </select>
    </SetRow>
  );
}

function OpsModelRow({ icon, label, tip, slot, kind, engine, filter }: { icon: LucideIcon; label: string; tip?: string; slot: keyof Settings['ops']; kind: 'image' | 'video'; engine: OpEngine; filter: (m: ModelSummary) => boolean }) {
  const value = useStore((s) => s.settings.ops[slot]);
  useStore((s) => s.catalog.models);
  const pop = usePopover();
  const auto = opModelFor(engine);
  const autoName = !auto.ref ? 'no connected provider' : modelSummary(auto.ref)?.name ?? (auto.ref.startsWith('local::') ? 'Local demo' : auto.ref);
  const current = value ? modelSummary(value)?.name ?? value : `Auto · ${autoName}${auto.viaEdit ? ' (instruction)' : ''}`;
  return (
    <SetRow icon={icon} label={label} tip={tip}>
      <Chip ref={pop.ref} onClick={pop.toggle} active={pop.open} className="wide-chip">
        <span className="truncate">{current}</span>
        <ChevronDown size={13} />
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={400} label={label}>
        <ModelList
          kind={kind}
          value={value}
          filter={filter}
          autoOption={`Picks the best connected model (${autoName})`}
          onSelect={(ref) => {
            if (slot === 'edit') pickImageEditModel(ref);
            else setSettings((s) => ({ ops: { ...s.ops, [slot]: ref } }));
            pop.close();
          }}
        />
      </Popover>
    </SetRow>
  );
}

/** Settings → Operations: the model each one-click operation uses, by media type. */
export function OpsTab() {
  return <>
    <SetGroup icon={Image} title="Image">
      <OpsModelRow icon={Wand2} label="Image edits" tip="Edit, relight, change angle, reframe, variations" slot="edit" kind="image" engine="edit" filter={(m) => m.acceptsImage && !m.tags.length} />
      <OpsModelRow icon={Maximize2} label="Upscale" tip="Image upscale" slot="upscale" kind="image" engine="upscale" filter={(m) => m.acceptsImage} />
      <OpsModelRow icon={Scissors} label="Remove BG" tip="Remove the background of an image" slot="removeBg" kind="image" engine="remove_bg" filter={(m) => m.acceptsImage} />
      <OpsModelRow icon={Brush} label="Edit region" tip="Edit a painted area (mask)" slot="editRegion" kind="image" engine="inpaint" filter={takesMask} />
      <OpsModelRow icon={Eraser} label="Remove object" tip="Remove what you paint over (mask)" slot="removeObject" kind="image" engine="remove_object" filter={takesMask} />
    </SetGroup>
    <SetGroup icon={Film} title="Video">
      <OpsModelRow icon={Play} label="Animate" tip="Animate an image or continue a shot" slot="video" kind="video" engine="video" filter={(m) => m.acceptsImage && !m.needsVideo} />
      <OpsModelRow icon={Maximize2} label="Video upscale" slot="videoUpscale" kind="video" engine="video_upscale" filter={(m) => Boolean(m.acceptsVideo)} />
      <OpsModelRow icon={Clapperboard} label="Video edit" slot="videoEdit" kind="video" engine="video_edit" filter={(m) => Boolean(m.acceptsVideo)} />
      <OpsModelRow icon={FastForward} label="Video extend" slot="videoExtend" kind="video" engine="video_extend" filter={(m) => Boolean(m.acceptsVideo)} />
    </SetGroup>
    <SetGroup icon={AudioLines} title="Audio">
      <TranscriberRow />
    </SetGroup>
  </>;
}
