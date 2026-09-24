import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Eye, EyeOff, ExternalLink, Search, Trash, Check } from 'lucide-react';
import { loadCatalogs, loadLlmCatalog, modelSummary, opModelFor, repickAgentModel } from '../../engine/catalog';
import { PROVIDER_SITES, REMOTE_PROVIDERS } from '../../engine/providers/registry';
import { PROVIDER_LABELS } from '../../engine/providers/types';
import { LLM_LABELS } from '../../engine/providers/llm';
import type { LlmProviderId, RemoteProviderId } from '../../engine/types';
import { formatUsd } from '../../lib/format';
import { setCatalog, setSettings, toast, useStore, wipeAllData } from '../../store/store';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { Button, Chip, Segmented, Spinner } from '../ui/primitives';
import { ModelList } from '../composer/ModelList';

function ProviderRow({ id }: { id: RemoteProviderId }) {
  const saved = useStore((s) => s.settings.keys[id]);
  const status = useStore((s) => s.catalog.status[id]);
  const error = useStore((s) => s.catalog.errors[id]);
  const count = useStore((s) => Object.values(s.catalog.models).filter((m) => m.provider === id).length);
  const [value, setValue] = useState(saved);
  const [show, setShow] = useState(false);
  useEffect(() => setValue(saved), [saved]);

  const commit = () => {
    const v = value.trim();
    if (v === saved) return;
    const wasConnected = Boolean(saved);
    setSettings((s) => ({ keys: { ...s.keys, [id]: v } }));
    // Schemas may include prices that depend on the key.
    setCatalog((c) => ({ schemas: Object.fromEntries(Object.entries(c.schemas).filter(([ref]) => !ref.startsWith(`${id}::`))) }));
    void loadCatalogs({ force: true, preferRemote: Boolean(v) && !wasConnected });
    if (v && (id === 'openrouter' || id === 'nanogpt' || id === 'atlas')) void loadLlmCatalog(id);
    toast(v ? `${PROVIDER_LABELS[id]} key saved` : `${PROVIDER_LABELS[id]} disconnected`, 'success');
  };

  const dot = !saved ? 'off' : status === 'ready' ? 'ok' : status === 'error' ? 'err' : 'busy';
  return (
    <div className="prov-row">
      <div className="prov-head">
        <span className={`dot dot-${dot}`} />
        <span className="prov-name">{PROVIDER_LABELS[id]}</span>
        <span className="prov-status faint">
          {!saved ? 'Not connected' : status === 'ready' ? `${count} models` : status === 'error' ? 'Catalog error' : status === 'loading' ? 'Loading…' : 'Connected'}
        </span>
        <a className="prov-link" href={PROVIDER_SITES[id].keys} target="_blank" rel="noreferrer" data-tip="Get an API key">
          <ExternalLink size={13} />
        </a>
      </div>
      <div className="key-input">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          placeholder="API key"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          aria-label={`${PROVIDER_LABELS[id]} API key`}
        />
        <button type="button" aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow((v) => !v)}>
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {saved && status === 'error' ? <div className="prov-error">{error}</div> : null}
    </div>
  );
}

function LlmModelPicker() {
  const agent = useStore((s) => s.settings.agent);
  const provider = agent.provider === 'offline' ? null : agent.provider;
  const models = useStore((s) => (provider ? s.catalog.llm[provider] : undefined));
  const status = useStore((s) => (provider ? s.catalog.llmStatus[provider] : undefined));
  const pop = usePopover();
  const [q, setQ] = useState('');
  useEffect(() => {
    if (provider) void loadLlmCatalog(provider);
  }, [provider]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (models ?? [])
      .filter((m) => m.tools)
      .filter((m) => !needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle))
      .slice(0, 200);
  }, [models, q]);
  if (!provider) return null;
  const current = models?.find((m) => m.id === agent.model);
  return (
    <>
      <Chip ref={pop.ref} onClick={pop.toggle} active={pop.open} className="wide-chip">
        <span className="truncate">{current?.name ?? (agent.model || (status === 'loading' ? 'Loading models…' : 'Choose a model'))}</span>
        <ChevronDown size={13} />
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={380} label="Agent model">
        <PopoverHeader title="Agent model" sub={`${LLM_LABELS[provider]} · models with tool calling`} />
        <div className="ml-search">
          <Search size={14} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" aria-label="Search agent models" />
        </div>
        <div className="ml-scroll">
          {status === 'loading' ? (
            <div className="ml-empty">
              <Spinner /> Loading…
            </div>
          ) : null}
          {status === 'error' ? <div className="ml-error">Could not load the model list.</div> : null}
          {list.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`ml-row ${m.id === agent.model ? 'is-selected' : ''}`}
              onClick={() => {
                setSettings((s) => ({ agent: { ...s.agent, model: m.id } }));
                pop.close();
              }}
            >
              <span className="ml-name">{m.name}</span>
              <span className="ml-meta faint">{m.id}</span>
              <span className="ml-price num">{m.inputPrice != null ? `${formatUsd(m.inputPrice)}/${formatUsd(m.outputPrice)}` : ''}</span>
              {m.id === agent.model ? <Check size={14} className="ml-check" /> : null}
            </button>
          ))}
        </div>
        <div className="pop-foot faint">Prices per million input/output tokens.</div>
      </Popover>
    </>
  );
}

function OpsModelRow({ label, slot, kind, engine, filter }: { label: string; slot: 'edit' | 'upscale' | 'removeBg' | 'video'; kind: 'image' | 'video'; engine: 'edit' | 'upscale' | 'remove_bg' | 'video'; filter: (m: { acceptsImage: boolean; tags: string[] }) => boolean }) {
  const value = useStore((s) => s.settings.ops[slot]);
  useStore((s) => s.catalog.models);
  const pop = usePopover();
  const auto = opModelFor(engine);
  const autoName = modelSummary(auto.ref)?.name ?? (auto.ref.startsWith('local::') ? 'Local demo' : auto.ref);
  const current = value ? modelSummary(value)?.name ?? value : `Auto · ${autoName}${auto.viaEdit ? ' (instruction)' : ''}`;
  return (
    <div className="set-row">
      <span className="set-label">{label}</span>
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
            setSettings((s) => ({ ops: { ...s.ops, [slot]: ref } }));
            pop.close();
          }}
        />
      </Popover>
    </div>
  );
}

export function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const spent = useStore((s) => s.spentUsd);
  const [budget, setBudget] = useState(String(settings.budgetUsd));
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => setBudget(String(settings.budgetUsd)), [settings.budgetUsd]);

  const engines: Array<{ value: LlmProviderId | 'offline'; label: string; tip: string }> = [
    { value: 'offline', label: 'Local', tip: 'Built-in planner, no LLM' },
    ...(['openrouter', 'nanogpt', 'atlas'] as const).map((p) => ({ value: p, label: LLM_LABELS[p], tip: settings.keys[p] ? `Agent via ${LLM_LABELS[p]}` : `Add a ${LLM_LABELS[p]} key first` })),
  ];

  const setEngine = (v: LlmProviderId | 'offline') => {
    if (v !== 'offline' && !settings.keys[v]) {
      toast(`Add your ${LLM_LABELS[v]} key above first.`, 'error');
      return;
    }
    const changed = v !== settings.agent.provider;
    setSettings((s) => ({ agent: { ...s.agent, provider: v, model: changed ? '' : s.agent.model } }));
    if (changed || !settings.agent.model) void repickAgentModel();
  };

  return (
    <div className="settings">
      <PopoverHeader title="Settings" sub="Keys stay in this browser (IndexedDB) and are sent only to their provider." />

      <section className="set-section">
        <h3>Providers</h3>
        {REMOTE_PROVIDERS.map((p) => (
          <ProviderRow key={p} id={p} />
        ))}
      </section>

      <section className="set-section">
        <h3>Agent</h3>
        <div className="set-row col">
          <span className="set-label">Engine</span>
          <Segmented value={settings.agent.provider} options={engines} onChange={setEngine} size="sm" />
        </div>
        {settings.agent.provider !== 'offline' ? (
          <>
            <div className="set-row">
              <span className="set-label" data-tip="Normal: GLM 5.3 Flash, GPT-6 Luna, DeepSeek V4.1 Flash. Top: GPT-6 Sol, GPT-5.6 Sol, Claude Opus 5.5, Qwen 3.8 Max. Picks the first one your provider offers with tool calling.">
                Tier
              </span>
              <Segmented
                value={settings.agent.tier}
                options={[
                  { value: 'normal', label: 'Normal' },
                  { value: 'top', label: 'Top' },
                ]}
                onChange={(v) => {
                  setSettings((s) => ({ agent: { ...s.agent, tier: v } }));
                  void repickAgentModel();
                }}
                size="sm"
              />
            </div>
            <div className="set-row">
              <span className="set-label">Model</span>
              <LlmModelPicker />
            </div>
          </>
        ) : (
          <p className="set-note">The local planner handles common requests without an LLM. Connect a provider for the full agent.</p>
        )}
        {settings.agent.provider === 'openrouter' ? (
          <div className="set-row">
            <span className="set-label">Reasoning</span>
            <Segmented
              value={settings.agent.effort}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ]}
              onChange={(v) => setSettings((s) => ({ agent: { ...s.agent, effort: v } }))}
              size="sm"
            />
          </div>
        ) : null}
        <div className="set-row">
          <span className="set-label" data-tip="Guided mode asks at most this many rounds of questions before proposing the plan">
            Guided rounds
          </span>
          <Segmented
            value={String(settings.guidedRounds) as '1' | '2' | '3'}
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
            ]}
            onChange={(v) => setSettings({ guidedRounds: Number(v) })}
            size="sm"
          />
        </div>
      </section>

      <section className="set-section">
        <h3>Operations</h3>
        <OpsModelRow label="Edit · relight · angle" slot="edit" kind="image" engine="edit" filter={(m) => m.acceptsImage && !m.tags.length} />
        <OpsModelRow label="Upscale" slot="upscale" kind="image" engine="upscale" filter={(m) => m.acceptsImage} />
        <OpsModelRow label="Remove background" slot="removeBg" kind="image" engine="remove_bg" filter={(m) => m.acceptsImage} />
        <OpsModelRow label="Animate · continue" slot="video" kind="video" engine="video" filter={(m) => m.acceptsImage} />
      </section>

      <section className="set-section">
        <h3>Budget</h3>
        <div className="set-row">
          <span className="set-label">Limit (USD)</span>
          <input
            className="num-input num"
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            onBlur={() => {
              const v = Number.parseFloat(budget);
              if (Number.isFinite(v) && v >= 0) setSettings({ budgetUsd: Math.round(v * 100) / 100 });
              else setBudget(String(settings.budgetUsd));
            }}
            aria-label="Budget limit in USD"
          />
        </div>
        <div className="set-row">
          <span className="set-label">Spent</span>
          <span className="num">{formatUsd(spent)}</span>
          <Button size="sm" variant="ghost" onClick={() => useStore.setState({ spentUsd: 0 })}>
            Reset
          </Button>
        </div>
        <p className="set-note">Every run shows its estimated cost before spending. Runs above the remaining budget are blocked.</p>
      </section>

      <section className="set-section">
        <h3>Data</h3>
        <div className="set-row">
          <span className="set-label">Local data</span>
          <Button ref={confirmRef} size="sm" variant="danger" icon={Trash} onClick={() => setConfirmOpen(true)}>
            Clear everything
          </Button>
          <Popover open={confirmOpen} anchor={confirmRef} onClose={() => setConfirmOpen(false)} width={300} label="Confirm clear">
            <div className="confirm">
              <p>Delete all sessions, generations, designs and keys stored in this browser? This cannot be undone.</p>
              <div className="spend-actions">
                <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => void wipeAllData()}>
                  Delete all
                </Button>
              </div>
            </div>
          </Popover>
        </div>
      </section>
    </div>
  );
}
