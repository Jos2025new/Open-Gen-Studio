import { VisionTag } from '../ui/VisionTag';
import { LlmFilterBar, LlmRowBody } from '../ui/LlmFilters';
import { filterLlm, type LlmCapability, type LlmSort } from '../../engine/providers/llm';
import { ArrowLeft, Check, ChevronDown, ChevronRight, ChevronUp, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { modelSummary, pickComposerModel, preferredModel, resetAgentModel, resetComposerModel } from '../../engine/catalog';
import type { ModelSummary } from '../../engine/types';
import { setComposer, setSettings, useStore } from '../../store/store';
import { Chip } from '../ui/primitives';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { ModelList } from './ModelList';

type PickerId = 'director' | 'image' | 'video' | 'audio' | 'model3d';
const label: Record<PickerId, string> = { director: 'Director', image: 'Image', video: 'Video', audio: 'Music', model3d: '3D' };
const mediaKinds = ['image', 'video', 'audio', 'model3d'] as const;

function modelName(ref: string | null | undefined): string {
  if (!ref) return 'No connected model';
  return modelSummary(ref)?.name ?? ref.split('::')[1] ?? ref;
}

const mediaModel = (m: ModelSummary) => !m.tags.length;

function SummaryRow({ id, name, state, onClick }: { id: PickerId; name: string; state: 'auto' | 'manual' | 'default'; onClick: () => void }) {
  return (
    <button type="button" className="agent-model-row" onClick={onClick}>
      <span className="agent-model-role">{label[id]}</span>
      <span className="agent-model-name" title={name}>{name}</span>
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
  const [caps, setCaps] = useState<LlmCapability[]>([]);
  const [sort, setSort] = useState<LlmSort>('recommended');
  if (agent.provider === 'offline') return <div className="ml-empty">The local planner is active. Choose an agent provider in Settings to use another Director.</div>;
  const needle = q.trim().toLowerCase();
  const list = filterLlm(models ?? [], { caps, q: needle, sort });
  // An order puts every model in one list; otherwise by family.
  const flat = sort !== 'recommended';
  const pick = (id: string) => {
    setSettings((s) => ({ agent: { ...s.agent, model: id, modelPinned: true } }));
    done();
  };
  const families = new Map<string, typeof list>();
  for (const m of list) {
    const family = directorFamily(m.id, m.name);
    families.set(family, [...(families.get(family) ?? []), m]);
  }
  return (
    <>
      <div className="ml-search"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Director models" aria-label="Search Director models" /></div>
      <LlmFilterBar caps={caps} onCaps={setCaps} sort={sort} onSort={setSort} />
      <div className="ml-scroll agent-director-list">
        <button type="button" className={`ml-row ${agent.modelPinned ? '' : 'is-selected'}`} onClick={() => { void resetAgentModel(); done(); }}>
          <span className="ml-main"><span className="ml-name">Auto</span><span className="ml-sub">{agent.tier === 'top' ? 'Top tier' : 'Normal tier'} · {agent.model || 'No model resolved'} <VisionTag vision={models?.find((m) => m.id === agent.model)?.vision} /></span></span>
          {!agent.modelPinned ? <Check size={14} className="ml-check" /> : null}
        </button>
        {flat ? list.map((m) => (
          <button key={m.id} type="button" className={`ml-row ${agent.modelPinned && m.id === agent.model ? 'is-selected' : ''}`} onClick={() => pick(m.id)}>
            <LlmRowBody m={m} />
            {agent.modelPinned && m.id === agent.model ? <Check size={14} className="ml-check" /> : null}
          </button>
        )) : [...families.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([family, entries]) => {
          const selected = entries.some((m) => agent.modelPinned && m.id === agent.model);
          const open = Boolean(needle) || caps.length > 0 || selected || openFamilies.includes(family);
          return (
            <div key={family} className="ml-group is-family">
              <button type="button" className={`ml-family ${open ? 'is-open' : ''}`} onClick={() => setOpenFamilies((xs) => xs.includes(family) ? xs.filter((x) => x !== family) : [...xs, family])} aria-expanded={open}>
                <ChevronDown size={13} /><span>{family}</span><span className="faint num">{entries.length}</span>
              </button>
              {open ? entries.map((m) => (
                <button key={m.id} type="button" className={`ml-row ${agent.modelPinned && m.id === agent.model ? 'is-selected' : ''}`} onClick={() => pick(m.id)}>
                  <LlmRowBody m={m} />
                  {agent.modelPinned && m.id === agent.model ? <Check size={14} className="ml-check" /> : null}
                </button>
              )) : null}
            </div>
          );
        })}
        {!list.length ? <div className="ml-empty">{models?.length ? 'No model with tool calling matches these filters.' : 'The Director catalog is not loaded. It will remain on the current automatic model.'}</div> : null}
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
  useStore((s) => s.catalog.models);

  // Saved route overrides remain visible as a category choice until the user replaces or releases it.
  const manual = {
    image: Boolean(composer.userPicked?.image || ops.edit),
    video: Boolean(composer.userPicked?.video || Object.keys(composer.videoRoutes ?? {}).length || ops.videoEdit),
    audio: Boolean(composer.userPicked?.audio),
    model3d: Boolean(composer.userPicked?.model3d),
  };
  const manualCount = Number(Boolean(agent.modelPinned)) + mediaKinds.filter(kind => manual[kind]).length;
  const rows = [
    { id: 'director' as const, name: agent.provider === 'offline' ? 'Local planner' : agent.model || 'No model resolved', state: agent.modelPinned ? 'manual' as const : 'auto' as const },
    ...mediaKinds.map(kind => ({ id: kind, name: modelName(composer[kind].modelRef), state: manual[kind] ? 'manual' as const : 'auto' as const })),
  ];
  const close = () => { setPicker(null); pop.close(); };
  const releaseOverrides = (kind: typeof mediaKinds[number]) => {
    if (kind === 'image') setSettings(s => ({ ops: { ...s.ops, edit: null } }));
    if (kind === 'video') {
      setComposer({ videoRoutes: undefined });
      setSettings(s => ({ ops: { ...s.ops, videoEdit: null } }));
    }
  };
  const choose = (ref: string | null) => {
    if (!picker || picker === 'director') return;
    releaseOverrides(picker);
    if (ref) void pickComposerModel(picker, ref);
    else void resetComposerModel(picker);
    setPicker(null);
  };
  const pickerConfig = picker && picker !== 'director'
    ? { kind: picker, value: composer.userPicked?.[picker] ? composer[picker].modelRef : null, auto: `Connected default (${modelName(preferredModel(picker))})` }
    : null;
  const resetAll = () => {
    void resetAgentModel();
    for (const kind of mediaKinds) {
      releaseOverrides(kind);
      if (manual[kind]) void resetComposerModel(kind);
    }
  };

  return (
    <>
      <Chip ref={pop.ref} className="models-chip" active={pop.open || manualCount > 0} onClick={pop.toggle} data-tip="Models used by the agent">
        {manualCount ? `Models · ${manualCount}` : 'Models'}
        {pop.open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={close} width={picker ? 520 : 400} label="Agent models" className="agent-model-pop">
        {picker ? (
          <>
            <button type="button" className="agent-model-back" onClick={() => setPicker(null)}><ArrowLeft size={14} /> Models</button>
            <PopoverHeader title={label[picker]} sub={picker === 'director' ? 'Choose the planner or leave it on Auto.' : 'Choose a model. Its compatible input variant is resolved automatically; Auto uses the connected default.'} />
            {picker === 'director' ? <DirectorList done={() => setPicker(null)} /> : pickerConfig ? (
              <ModelList kind={pickerConfig.kind} value={pickerConfig.value ?? null} filter={pickerConfig.kind === 'image' ? mediaModel : undefined} autoOption={pickerConfig.auto} familyTree automaticVariants onSelect={choose} />
            ) : null}
          </>
        ) : (
          <>
            <PopoverHeader title="Models" sub="Input variants resolve automatically." />
            <div className="agent-model-summary">
              {rows.map((r) => <SummaryRow key={r.id} {...r} onClick={() => setPicker(r.id)} />)}
            </div>
            {manualCount > 0 && <div className="agent-model-foot">
              <button type="button" className="link-btn" onClick={resetAll}><RotateCcw size={12} /> Reset all to Auto</button>
            </div>}
          </>
        )}
      </Popover>
    </>
  );
}
