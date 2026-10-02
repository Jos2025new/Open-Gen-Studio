import { ArrowLeft, Check, ChevronDown, ChevronRight, ChevronUp, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  defaultModelFor,
  modelSummary,
  opModelFor,
  pickImageEditModel,
  fillVideoRoutes,
  pickComposerModel,
  preferredModel,
  resetAgentModel,
  resetComposerModel,
} from '../../engine/catalog';
import { routeHead, type RouteMode } from '../../engine/routing';
import { variantRoute } from '../../engine/variants';
import type { ModelSummary } from '../../engine/types';
import { setComposer, setSettings, useStore } from '../../store/store';
import { Chip } from '../ui/primitives';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { ModelList } from './ModelList';

type PickerId = 'director' | 'image' | 'imageEdit' | 'videoText' | 'videoImage' | 'videoReference' | 'videoEdit' | 'audio';

const label: Record<PickerId, string> = {
  director: 'Director',
  image: 'Image',
  imageEdit: 'Image edit',
  videoText: 'Text → video',
  videoImage: 'Image → video',
  videoReference: 'Reference → video',
  videoEdit: 'Video edit',
  audio: 'Audio',
};

const modeOf: Partial<Record<PickerId, RouteMode>> = {
  videoText: 'text',
  videoImage: 'image',
  videoReference: 'reference',
};

function modelName(ref: string | null | undefined): string {
  if (!ref) return 'No connected model';
  return modelSummary(ref)?.name ?? ref.split('::')[1] ?? ref;
}

function setRouteModel(mode: RouteMode, ref: string | null): void {
  setComposer((c) => {
    const videoRoutes = { ...(c.videoRoutes ?? {}) };
    if (ref) videoRoutes[mode] = ref;
    else delete videoRoutes[mode];
    return { videoRoutes: Object.keys(videoRoutes).length ? videoRoutes : undefined };
  });
}

function routeDefault(mode: RouteMode): string {
  const st = useStore.getState();
  if (st.composer.userPicked?.video) return defaultModelFor('video', mode !== 'text');
  const head = routeHead('normal', (ref) => Boolean(st.catalog.models[ref]));
  return head?.refs[mode] ?? defaultModelFor('video', mode !== 'text');
}

const plainImage = (m: ModelSummary) =>
  m.acceptsText && !m.tags.length && !/(?:\/|\b)(?:edit|inpaint|image-to-image|remove-background|upscal)/i.test(m.id);
const imageEdit = (m: ModelSummary) => m.acceptsImage && !m.tags.length;
const textVideo = (m: ModelSummary) => m.acceptsText && !m.needsVideo && !/(?:image|reference)-to-video/i.test(m.id);
const imageVideo = (m: ModelSummary) => m.acceptsImage && !m.needsVideo && !/reference-to-video/i.test(m.id);
// Reference-to-video: a reference variant, or a model whose schema takes two or more reference images.
const referenceVideo = (m: ModelSummary) => {
  if (!m.acceptsImage || m.needsVideo) return false;
  if (variantRoute(m) === 'reference') return true;
  const slots = useStore.getState().catalog.schemas[m.ref]?.slots;
  return Boolean(slots?.mixedRefs || (slots?.images?.max ?? 0) >= 2);
};
const ROUTE_FILTER = { text: textVideo, image: imageVideo, reference: referenceVideo } as const;
const editVideo = (m: ModelSummary) => Boolean(m.acceptsVideo);

function SummaryRow({ id, name, state, onClick }: { id: PickerId; name: string; state: 'auto' | 'manual' | 'default'; onClick: () => void }) {
  return (
    <button type="button" className="agent-model-row" onClick={onClick}>
      <span className="agent-model-role">{label[id]}</span>
      <span className="agent-model-name">{name}</span>
      <span className={`agent-model-state is-${state}`}>{state === 'manual' ? 'set' : state === 'default' ? 'default' : 'auto'}</span>
      <ChevronRight size={13} />
    </button>
  );
}

function directorFamily(id: string, name: string): string {
  const text = `${id} ${name}`.toLowerCase();
  if (/deepseek/.test(text)) return 'DeepSeek';
  if (/\bglm\b|zhipu/.test(text)) return 'GLM';
  if (/\bgpt\b|openai/.test(text)) return 'GPT';
  if (/claude/.test(text)) return 'Claude';
  if (/qwen/.test(text)) return 'Qwen';
  if (/gemini/.test(text)) return 'Gemini';
  if (/mistral/.test(text)) return 'Mistral';
  return name.split(/[\s:/-]+/)[0] || 'Other';
}

function DirectorList({ done }: { done: () => void }) {
  const agent = useStore((s) => s.settings.agent);
  const models = useStore((s) => (agent.provider === 'offline' ? undefined : s.catalog.llm[agent.provider]));
  const [q, setQ] = useState('');
  const [openFamilies, setOpenFamilies] = useState<string[]>([]);
  if (agent.provider === 'offline') return <div className="ml-empty">The local planner is active. Choose an agent provider in Settings to use another Director.</div>;
  const needle = q.trim().toLowerCase();
  const list = (models ?? []).filter((m) => m.tools && (!needle || m.name.toLowerCase().includes(needle) || m.id.toLowerCase().includes(needle)));
  const families = new Map<string, typeof list>();
  for (const m of list) {
    const family = directorFamily(m.id, m.name);
    families.set(family, [...(families.get(family) ?? []), m]);
  }
  return (
    <>
      <div className="ml-search"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Director models" aria-label="Search Director models" /></div>
      <div className="ml-scroll agent-director-list">
        <button type="button" className={`ml-row ${agent.modelPinned ? '' : 'is-selected'}`} onClick={() => { void resetAgentModel(); done(); }}>
          <span className="ml-main"><span className="ml-name">Auto</span><span className="ml-sub">{agent.tier === 'top' ? 'Top tier' : 'Normal tier'} · {agent.model || 'No model resolved'}</span></span>
          {!agent.modelPinned ? <Check size={14} className="ml-check" /> : null}
        </button>
        {[...families.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([family, entries]) => {
          const selected = entries.some((m) => agent.modelPinned && m.id === agent.model);
          const open = Boolean(needle) || selected || openFamilies.includes(family);
          return (
            <div key={family} className="ml-group is-family">
              <button type="button" className={`ml-family ${open ? 'is-open' : ''}`} onClick={() => setOpenFamilies((xs) => xs.includes(family) ? xs.filter((x) => x !== family) : [...xs, family])} aria-expanded={open}>
                <ChevronDown size={13} /><span>{family}</span><span className="faint num">{entries.length}</span>
              </button>
              {open ? entries.map((m) => (
                <button key={m.id} type="button" className={`ml-row ${agent.modelPinned && m.id === agent.model ? 'is-selected' : ''}`} onClick={() => { setSettings((s) => ({ agent: { ...s.agent, model: m.id, modelPinned: true } })); done(); }}>
                  <span className="ml-main"><span className="ml-name">{m.name}</span><span className="ml-sub">{m.id}</span></span>
                  {agent.modelPinned && m.id === agent.model ? <Check size={14} className="ml-check" /> : null}
                </button>
              )) : null}
            </div>
          );
        })}
        {!list.length ? <div className="ml-empty">The Director catalog is not loaded. It will remain on the current automatic model.</div> : null}
      </div>
    </>
  );
}

export function AgentModelControls() {
  const pop = usePopover();
  const [picker, setPicker] = useState<PickerId | null>(null);
  const composer = useStore((s) => s.composer);
  const agent = useStore((s) => s.settings.agent);
  const ops = useStore((s) => s.settings.ops);
  const models = useStore((s) => s.catalog.models);

  const routeManual = composer.videoRoutes ?? {};
  // A route model saved before this check that cannot do its route goes back to Auto.
  useEffect(() => {
    for (const mode of Object.keys(routeManual) as RouteMode[]) {
      const m = routeManual[mode] ? models[routeManual[mode]!] : undefined;
      if (m && !ROUTE_FILTER[mode](m)) setRouteModel(mode, null);
    }
  }, [routeManual, models]);
  const manualCount =
    Number(Boolean(agent.modelPinned)) +
    Number(Boolean(composer.userPicked?.image)) +
    Number(Boolean(composer.userPicked?.audio)) +
    Number(Boolean(composer.userPicked?.video)) +
    Number(Boolean(ops.edit)) +
    Object.keys(routeManual).length +
    Number(Boolean(ops.videoEdit));

  const rows = useMemo(() => {
    const globalVideo = Boolean(composer.userPicked?.video);
    return [
      { id: 'director' as const, name: agent.provider === 'offline' ? 'Local planner' : agent.model || 'No model resolved', state: agent.modelPinned ? 'manual' as const : 'auto' as const },
      { id: 'image' as const, name: modelName(composer.image.modelRef), state: composer.userPicked?.image ? 'manual' as const : 'auto' as const },
      { id: 'imageEdit' as const, name: modelName(ops.edit || opModelFor('edit').ref), state: ops.edit ? 'manual' as const : 'auto' as const },
      ...(['videoText', 'videoImage', 'videoReference'] as const).map((id) => {
        const mode = modeOf[id]!;
        return { id, name: modelName(routeManual[mode] ?? routeDefault(mode)), state: routeManual[mode] ? 'manual' as const : globalVideo ? 'default' as const : 'auto' as const };
      }),
      { id: 'videoEdit' as const, name: modelName(ops.videoEdit || opModelFor('video_edit').ref), state: ops.videoEdit ? 'manual' as const : 'auto' as const },
      { id: 'audio' as const, name: modelName(composer.audio.modelRef), state: composer.userPicked?.audio ? 'manual' as const : 'auto' as const },
    ];
  }, [agent.model, agent.modelPinned, agent.provider, composer.audio.modelRef, composer.image.modelRef, composer.userPicked, models, ops.edit, ops.videoEdit, routeManual]);

  const close = () => { setPicker(null); pop.close(); };
  const choose = (ref: string | null) => {
    if (!picker) return;
    if (picker === 'image' || picker === 'audio') {
      if (ref) void pickComposerModel(picker, ref);
      else void resetComposerModel(picker);
    } else if (picker === 'imageEdit') pickImageEditModel(ref);
    else if (picker === 'videoEdit') setSettings((s) => ({ ops: { ...s.ops, videoEdit: ref } }));
    else {
      const mode = modeOf[picker];
      // Picking one route fills the others with the same model's routes, when they exist.
      if (mode && ref) fillVideoRoutes(ref);
      if (mode) setRouteModel(mode, ref);
    }
    setPicker(null);
  };

  const pickerConfig = picker === 'image'
    ? { kind: 'image' as const, value: composer.userPicked?.image ? composer.image.modelRef : null, filter: plainImage, auto: `Connected default (${modelName(preferredModel('image'))})` }
    : picker === 'audio'
      ? { kind: 'audio' as const, value: composer.userPicked?.audio ? composer.audio.modelRef : null, filter: undefined, auto: `Connected default (${modelName(preferredModel('audio'))})` }
    : picker === 'imageEdit'
      ? { kind: 'image' as const, value: ops.edit, filter: imageEdit, auto: `Best connected edit model (${modelName(opModelFor('edit').ref)})` }
      : picker === 'videoEdit'
        ? { kind: 'video' as const, value: ops.videoEdit, filter: editVideo, auto: `Best connected video edit model (${modelName(opModelFor('video_edit').ref)})` }
        : picker && modeOf[picker]
          ? { kind: 'video' as const, value: routeManual[modeOf[picker]!], filter: ROUTE_FILTER[modeOf[picker]!], auto: `Agent routing for ${modeOf[picker]} input (${modelName(routeDefault(modeOf[picker]!))})` }
          : null;

  const resetAll = () => {
    setComposer({ videoRoutes: undefined });
    setSettings((s) => ({ ops: { ...s.ops, edit: null, videoEdit: null } }));
    void resetAgentModel();
    if (composer.userPicked?.image) void resetComposerModel('image');
    if (composer.userPicked?.audio) void resetComposerModel('audio');
    if (composer.userPicked?.video) void resetComposerModel('video');
  };

  return (
    <>
      <Chip ref={pop.ref} active={pop.open || manualCount > 0} onClick={pop.toggle} data-tip="Models used by the agent">
        {manualCount ? `Models · ${manualCount}` : 'Models'}
        {pop.open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={close} width={520} label="Agent models" className="agent-model-pop">
        {picker ? (
          <>
            <button type="button" className="agent-model-back" onClick={() => setPicker(null)}><ArrowLeft size={14} /> Models</button>
            <PopoverHeader title={label[picker]} sub="Auto keeps the established routing; a choice affects only this row." />
            {picker === 'director' ? <DirectorList done={() => setPicker(null)} /> : pickerConfig ? (
              <ModelList kind={pickerConfig.kind} value={pickerConfig.value ?? null} filter={pickerConfig.filter} autoOption={pickerConfig.auto} familyTree onSelect={choose} />
            ) : null}
          </>
        ) : (
          <>
            <PopoverHeader title="Models" sub="The agent chooses in Auto. Fix only the routes you want to control." />
            <div className="agent-model-summary">
              {rows.map((r) => <SummaryRow key={r.id} {...r} onClick={() => setPicker(r.id)} />)}
            </div>
            <div className="agent-model-foot">
              {composer.userPicked?.video ? <button type="button" className="link-btn" onClick={() => void resetComposerModel('video')}>Release global video default</button> : <span />}
              {manualCount ? <button type="button" className="link-btn" onClick={resetAll}><RotateCcw size={12} /> Reset all to Auto</button> : null}
            </div>
          </>
        )}
      </Popover>
    </>
  );
}
