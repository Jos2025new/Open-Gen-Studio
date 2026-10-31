import { useEffect, useMemo, useState } from 'react';
import { Bot, Box, Brain, Eye, Check, ChevronDown, Cpu, Gauge, Lightbulb, ListChecks, MessagesSquare, Search, Sparkles } from 'lucide-react';
import { loadLlmCatalog, pickAgentModel, repickAgentModel } from '../../../engine/catalog';
import { LLM_LABELS, LLM_TIERS, filterLlm, limitedLlmFallback, llmMakers, type LlmCapability, type LlmModel, type LlmSort } from '../../../engine/providers/llm';
import type { LlmProviderId } from '../../../engine/types';
import { setSettings, toast, useStore } from '../../../store/store';
import { Popover, PopoverHeader, usePopover } from '../../ui/Popover';
import { Button, Chip, Segmented, Spinner } from '../../ui/primitives';
import { VisionTag } from '../../ui/VisionTag';
import { LlmFilterBar, LlmRowBody } from '../../ui/LlmFilters';
import { PeopleLookRow } from '../PeopleLookRow';
import { SetGroup, SetRow } from './SettingsRows';

function LlmModelPicker() {
  const agent = useStore((s) => s.settings.agent);
  const provider = agent.provider === 'offline' ? null : agent.provider;
  const models = useStore((s) => (provider ? s.catalog.llm[provider] : undefined));
  const status = useStore((s) => (provider ? s.catalog.llmStatus[provider] : undefined));
  const pop = usePopover();
  const [q, setQ] = useState('');
  const [browseAll, setBrowseAll] = useState(false);
  const [caps, setCaps] = useState<LlmCapability[]>([]);
  const [sort, setSort] = useState<LlmSort>('recommended');
  const [maker, setMaker] = useState('');
  const [shown, setShown] = useState(100);
  useEffect(() => {
    if (provider) void loadLlmCatalog(provider);
  }, [provider]);
  const withTools = useMemo(() => (models ?? []).filter((m) => m.tools), [models]);
  // Recommended = the tier lists, in priority order, as far as this provider offers them.
  const groups = useMemo(
    () =>
      (['normal', 'top'] as const)
        .map((tier) => ({ tier, models: LLM_TIERS[tier].map((id) => withTools.find((m) => m.id === id)).filter((m): m is LlmModel => Boolean(m)) }))
        .filter((g) => g.models.length),
    [withTools],
  );
  const needle = q.trim().toLowerCase();
  // Any filter or order shows the whole catalog through it; otherwise the recommended tiers first.
  const full = browseAll || Boolean(needle) || caps.length > 0 || Boolean(maker) || sort !== 'recommended' || !groups.length;
  const list = useMemo(() => (full ? filterLlm(models ?? [], { caps, q: needle, sort, maker }) : []), [full, models, caps, needle, sort, maker]);
  const makers = useMemo(() => llmMakers(models ?? []), [models]);
  // Long catalogs render in steps of 100; the button says how many remain, nothing is cut silently.
  useEffect(() => setShown(100), [caps, needle, sort, maker, provider]);
  if (!provider) return null;
  const current = models?.find((m) => m.id === agent.model);
  const row = (m: LlmModel) => (
    <button
      key={m.id}
      type="button"
      title={m.id}
      className={`ml-row ${m.id === agent.model ? 'is-selected' : ''}`}
      onClick={() => {
        pickAgentModel(m.id);
        pop.close();
      }}
    >
      <LlmRowBody m={m} />
      {m.id === agent.model ? <Check size={14} className="ml-check" /> : null}
    </button>
  );
  return (
    <>
      <Chip ref={pop.ref} onClick={pop.toggle} active={pop.open} className="wide-chip">
        <span className="truncate">{current?.name ?? (agent.model || (status === 'loading' ? 'Loading models…' : 'Choose a model'))}</span>
        {current ? <VisionTag vision={current.vision} full /> : null}
        <ChevronDown size={13} />
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={460} label="Agent model">
        <PopoverHeader title="Agent model" sub={`${LLM_LABELS[provider]} · all models, tool calling marked`} />
        <div className="ml-search">
          <Search size={14} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" aria-label="Search agent models" />
        </div>
        <LlmFilterBar caps={caps} onCaps={setCaps} sort={sort} onSort={setSort} makers={makers} maker={maker} onMaker={setMaker} />
        <div className="ml-scroll">
          {full && !list.length && status !== 'loading' ? <div className="ml-empty">No model matches these filters.</div> : null}
          {status === 'loading' ? (
            <div className="ml-empty">
              <Spinner /> Loading…
            </div>
          ) : null}
          {status === 'error' ? <div className="ml-error">Could not load the model list.</div> : null}
          {full
            ? <>{list.slice(0, shown).map(row)}{list.length > shown ? <button type="button" className="ml-row" onClick={() => setShown((n) => n + 100)}>Show {Math.min(100, list.length - shown)} more · {list.length - shown} hidden</button> : null}</>
            : groups.map((g) => (
                <div key={g.tier} className="ml-group">
                  <div className="ml-group-head">{g.tier === 'normal' ? 'Recommended' : 'Top tier'}</div>
                  {g.models.map(row)}
                </div>
              ))}
        </div>
        <div className="ml-foot">
          {groups.length && !needle ? (
            <button type="button" className="ml-foot-main" onClick={() => setBrowseAll((v) => !v)}>
              {browseAll ? 'Show recommended' : `Browse all models (${models?.length ?? 0})`}
            </button>
          ) : (
            <span className="ml-foot-main faint">{full ? `${list.length} of ${withTools.length}` : withTools.length} models</span>
          )}
          <span className="faint ml-foot-note" data-tip="USD per million input / output tokens">$/M tokens</span>
        </div>
      </Popover>
    </>
  );
}

/**
 * The agent needs tool calling and image input. When the provider has no such model the app does not pick a
 * limited one by itself: it explains what is lost and asks. A model chosen by hand that cannot see images gets a note.
 */
function AgentVisionNotice() {
  const agent = useStore((s) => s.settings.agent);
  const provider = agent.provider === 'offline' ? null : agent.provider;
  const models = useStore((s) => (provider ? s.catalog.llm[provider] : undefined));
  if (!provider || !models?.length) return null;
  const limits =
    "it will not see your attachments or its own results, so it cannot describe a character from a photo, give each reference its role or check a framing; it only gets each image's size and type. Text-only requests work normally.";
  const current = models.find((m) => m.id === agent.model);
  if (current) {
    if (current.vision !== false && current.vision !== undefined) return null;
    return <p className="set-note is-warn">{current.vision === false ? 'This model cannot see images:' : 'This provider does not say whether this model sees images. If it does not,'} {limits}</p>;
  }
  if (agent.model) return null;
  const candidate = limitedLlmFallback(models);
  if (!candidate) return null;
  return (
    <div className="set-warn">
      <p>
        {LLM_LABELS[provider]} has no model with tool calling and image input. {candidate.name} can plan, but{' '}
        {candidate.vision === false ? 'cannot see images' : 'does not say whether it sees images'}: {limits}
      </p>
      <p className="faint">Until you choose, the agent uses the local planner.</p>
      <div className="set-warn-actions">
        <Button size="sm" variant="primary" onClick={() => pickAgentModel(candidate.id)}>
          Use {candidate.name} anyway
        </Button>
      </div>
    </div>
  );
}

/** Settings → Agent: the engine and its model, how it reasons, and how a conversation goes. */
export function AgentTab() {
  const settings = useStore((s) => s.settings);
  const engines: Array<{ value: LlmProviderId | 'offline'; label: string; tip: string }> = [
    { value: 'offline', label: 'Local', tip: 'Built-in planner, no LLM' },
    ...(['openrouter', 'nanogpt', 'atlas'] as const).map((p) => ({ value: p, label: LLM_LABELS[p], tip: settings.keys[p] ? `Agent via ${LLM_LABELS[p]}` : `Add a ${LLM_LABELS[p]} key first` })),
  ];
  const setEngine = (v: LlmProviderId | 'offline') => {
    if (v !== 'offline' && !settings.keys[v]) {
      toast(`Add your ${LLM_LABELS[v]} key in Providers first.`, 'error');
      return;
    }
    const changed = v !== settings.agent.provider;
    setSettings((s) => ({ agent: { ...s.agent, provider: v, model: changed ? '' : s.agent.model, modelPinned: false } }));
    if (changed || !settings.agent.model) void repickAgentModel();
  };
  const reasons = settings.agent.provider === 'openrouter' || settings.agent.provider === 'nanogpt';
  return <>
    <SetGroup icon={Bot} title="Model">
      <SetRow icon={Cpu} label="Engine" col>
        <Segmented value={settings.agent.provider} options={engines} onChange={setEngine} size="sm" />
      </SetRow>
      {settings.agent.provider !== 'offline' ? <>
        <SetRow icon={Gauge} label="Tier" tip="Normal: GLM 5.3 Flash, GPT-6 Luna, DeepSeek V4.1 Flash. Top: GPT-6 Sol, GPT-5.6 Sol, Claude Opus 5.5, Qwen 3.8 Max. Picks the first one your provider offers with tool calling.">
          <Segmented
            value={settings.agent.tier}
            options={[{ value: 'normal', label: 'Normal' }, { value: 'top', label: 'Top' }]}
            onChange={(v) => {
              setSettings((s) => ({ agent: { ...s.agent, tier: v, modelPinned: false } }));
              void repickAgentModel();
            }}
            size="sm"
          />
        </SetRow>
        <SetRow icon={Box} label="Model"><LlmModelPicker /></SetRow>
        <AgentVisionNotice />
      </> : <p className="set-note">The local planner handles common requests without an LLM. Connect a provider for the full agent.</p>}
    </SetGroup>
    {reasons ? <SetGroup icon={Lightbulb} title="Thinking">
      <SetRow icon={Brain} label="Reasoning" tip="How long the model thinks before answering. Lower answers sooner; None skips thinking on models that allow it">
        <Segmented
          value={settings.agent.effort}
          options={[{ value: 'none', label: 'None' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]}
          onChange={(v) => setSettings((s) => ({ agent: { ...s.agent, effort: v } }))}
          size="sm"
        />
      </SetRow>
      <SetRow icon={Eye} label="Show thinking" tip="Show the model's reasoning while it works, in the activity block of each turn. It costs nothing extra: the model thinks the same either way">
        <Segmented
          value={settings.agent.showThinking === false ? 'off' : 'on'}
          options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
          onChange={(v) => setSettings((s) => ({ agent: { ...s.agent, showThinking: v === 'on' } }))}
          size="sm"
        />
      </SetRow>
    </SetGroup> : null}
    <SetGroup icon={MessagesSquare} title="Conversation">
      <SetRow icon={ListChecks} label="Guided rounds" tip="Guided mode asks at most this many rounds of questions before proposing the plan">
        <Segmented
          value={String(settings.guidedRounds) as '1' | '2' | '3'}
          options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }]}
          onChange={(v) => setSettings({ guidedRounds: Number(v) })}
          size="sm"
        />
      </SetRow>
      <label className="check-row">
        <input
          type="checkbox"
          checked={Boolean(settings.agent.updateComposerDefaults)}
          onChange={(e) => setSettings((s) => ({ agent: { ...s.agent, updateComposerDefaults: e.target.checked } }))}
        />
        <Sparkles size={14} className="set-row-icon" aria-hidden />
        Update the composer's default model when I change the model in a session
      </label>
      <PeopleLookRow />
    </SetGroup>
  </>;
}
