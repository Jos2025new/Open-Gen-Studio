import { previewRun } from '../../engine/flow/actions';
import { useEffect, useState } from 'react';
import { Box, Check, ChevronDown, ChevronRight, CircleAlert, Film, Image as ImageIcon, LoaderCircle, Minus, Music, Type, Wand, Layers, Zap, ArrowRight, UserRound, Palette, Pencil } from 'lucide-react';
import { approvePlan, cancelPlan, resolveStepCostReview, sendAgentMessage } from '../../engine/agent/runtime';
import { toggleStep } from '../../engine/plan';
import { estimateSteps } from '../../engine/executor';
import { OPS } from '../../engine/ops';
import { aspectLabel, durationLabel } from '../../engine/params';
import { needsSpendCheck } from '../../engine/pricing';
import { acceptOverLimit, overLimit, overLimitText, remainingBudget } from '../../engine/budget';
import type { PlanFeedItem, PlanStep, StepState } from '../../engine/types';
import { formatUsd } from '../../lib/format';
import { setUi, updateFeedItem, useStore } from '../../store/store';
import { AssetMedia } from '../ui/AssetMedia';
import { PlanRecoveryChips } from './RecoveryActions';
import { Button, CostTag, costLabel } from '../ui/primitives';

function stepIcon(s: PlanStep) {
  switch (s.kind) {
    case 'image':
      return <ImageIcon size={13} />;
    case 'video':
      return <Film size={13} />;
    case 'audio':
      return <Music size={13} />;
    case 'model3d':
      return <Box size={13} />;
    case 'op':
      return <Wand size={13} />;
    case 'text':
      return <Type size={13} />;
    case 'layer':
      return <Layers size={13} />;
  }
}

/** An adjustment about a model the user picked (kept it, could not use it, a stand-in). */
const aboutUserModel = (a: string) => /\byour [\w-]+ model\b/.test(a);

/** `ref` names an input in words for the card: a step by its title, an asset as "your image" or "the earlier clip". */
type RefName = (ref: string) => string;

function stepDetail(s: PlanStep, modelName: (ref: string) => string, refName: RefName): string {
  switch (s.kind) {
    case 'image':
      return [modelName(s.modelRef), s.settings.aspect ? aspectLabel(s.settings.aspect) : '', s.settings.count > 1 ? `×${s.settings.count}` : '', s.refs.length ? `${s.refs.length} ref` : ''].filter(Boolean).join(' · ');
    case 'model3d':
      return [modelName(s.modelRef), s.refs.length ? `${s.refs.length} ref` : 'from text'].join(' · ');
    case 'video':
      return [modelName(s.modelRef), s.settings.duration ? durationLabel(s.settings.duration) : '', s.firstFrame ? `from ${refName(s.firstFrame)}` : ''].filter(Boolean).join(' · ');
    case 'audio':
      return [modelName(s.modelRef), s.lyricsFrom ? `lyrics from ${refName(s.lyricsFrom)}` : s.settings.extras?.lyrics ? 'with lyrics' : s.settings.advanced.is_instrumental ? 'instrumental' : ''].filter(Boolean).join(' · ');
    case 'op':
      return `${OPS[s.op].label} of ${refName(s.input)}`;
    case 'text':
      return s.text.length > 60 ? `${s.text.slice(0, 59)}…` : s.text;
    case 'layer':
      return s.layerType === 'raster' ? `raster · ${s.target === 'base' ? 'layer 1' : s.target === 'new' ? 'new layer' : s.target}` : `${s.layerType}${s.text ? ` · “${s.text.slice(0, 30)}”` : ''}`;
  }
}

/** The text a step sends to the model: its prompt, or the op's instruction. Shown as the step's script (F5). */
function stepScript(s: PlanStep): string {
  if (s.kind === 'image' || s.kind === 'video' || s.kind === 'audio' || s.kind === 'model3d') return s.prompt.trim();
  if (s.kind === 'op') {
    return Object.values(s.params).filter((v): v is string => typeof v === 'string' && v.trim().length > 12).join(' · ');
  }
  return '';
}

function StateIcon({ state }: { state: StepState }) {
  if (state === 'running') return <LoaderCircle size={13} className="spin accent" />;
  if (state === 'done') return <Check size={13} className="ok" />;
  if (state === 'review') return <CircleAlert size={13} className="accent" />;
  if (state === 'error') return <CircleAlert size={13} className="danger" />;
  if (state === 'skipped') return <Minus size={13} className="faint" />;
  return <span className="state-dot" />;
}

const WS_NAMES = { chat: 'Chat', node: 'Node', designer: 'Designer' } as const;

export function PlanCard({ item, sessionId }: { item: PlanFeedItem; sessionId: string }) {
  const graph = useStore(s => s.sessions[sessionId].graph);
  const library = useStore(s => s.library);
  const composer = useStore(s => s.composer);
  const models = useStore((s) => s.catalog.models);
  const schemas = useStore((s) => s.catalog.schemas);
  const generations = useStore((s) => s.generations);
  const assets = useStore((s) => s.assets);
  useStore((s) => s.spentUsd);
  useStore((s) => s.settings);
  useStore((s) => s.quotes); // exact Atlas prices replace the estimate when they arrive
  const remaining = remainingBudget();
  const workspace = useStore((s) => s.ui.workspace);
  // While the agent revises this plan after a comment, it must not run in its old form.
  const revising = useStore((s) => s.sessions[sessionId]?.agent.revising === item.id);
  const { plan } = item;
  const awaiting = item.status === 'awaiting';
  const nodePreview = awaiting && item.nodeRun ? previewRun(sessionId, item.nodeRun.targets, item.nodeRun.force) : null;
  useEffect(() => {
    if (!nodePreview || !item.nodeRun || nodePreview.signature === item.nodeRun.signature) return;
    updateFeedItem<PlanFeedItem>(sessionId, item.id, { nodeRun: { ...item.nodeRun, signature: nodePreview.signature }, plan: { ...plan, steps: nodePreview.steps }, estimate: nodePreview.estimate, error: nodePreview.errors.join(' ') || 'Execution updated. Review before running.' });
  }, [nodePreview?.signature, graph, library, composer, item.id, sessionId]);
  const off = new Set(item.skipped ?? []);
  // Checkboxes only when there is a choice to make.
  const selectable = awaiting && !item.nodeRun && plan.steps.length > 1;
  const toggle = (id: string) => updateFeedItem<PlanFeedItem>(sessionId, item.id, { skipped: toggleStep(plan.steps, item.skipped ?? [], id) });
  // Prices may load after the plan was proposed; show the live estimate (of the checked steps) while it waits.
  const live = awaiting ? estimateSteps(plan.steps.filter((s) => !off.has(s.id))) : null;
  const none = awaiting && off.size === plan.steps.length;
  void schemas;
  const total = live?.total ?? item.estimate;
  const perStep = live?.perStep;
  const name = (ref: string) => models[ref]?.name ?? (ref.startsWith('local::') ? (ref.endsWith('video') ? 'Local Motion' : 'Local Sketch') : ref.split('::')[1] ?? ref);
  const refName: RefName = (ref) => {
    if (ref.startsWith('asset:')) {
      const a = assets[ref.slice(6)];
      const what = a?.kind === 'video' ? 'clip' : a?.kind === 'audio' ? 'audio' : 'image';
      return a?.origin === 'upload' ? `your ${what}` : `the earlier ${what}`;
    }
    const st = plan.steps.find((x) => x.id === ref.split('#')[0]);
    return st ? `“${st.title}”` : ref;
  };
  const doneCount = Object.values(item.stepStates).filter((s) => s === 'done').length;
  const over = awaiting && overLimit(total);
  // Scripts open while the plan waits for approval, so the user reads what each clip does before paying.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [showAdj, setShowAdj] = useState(false);
  const flip = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const free = !needsSpendCheck(total);

  return (
    <article className={`plan-card status-${item.status}`}>
      <header className="plan-head">
        <div>
          <div className="plan-kicker">
            Plan · {WS_NAMES[plan.workspace]} · {item.style === 'auto' ? 'Auto' : 'Guided'}{item.revised ? ' · Revised' : ''}{revising ? ' · Revising…' : ''}
          </div>
          <h4 className="plan-title">{plan.title}</h4>
          {plan.summary ? <p className="plan-summary">{plan.summary}</p> : null}
        </div>
        <CostTag estimate={total} />
      </header>
      <ol className="plan-steps">
        {plan.steps.map((s) => {
          const genId = item.stepGenerations[s.id];
          const gen = genId ? generations[genId] : undefined;
          const state = item.stepStates[s.id] ?? 'pending';
          const script = stepScript(s);
          const shown = open.has(s.id);
          return (
            <li key={s.id} className={`plan-step st-${state}${awaiting && off.has(s.id) ? ' is-off' : ''}`}>
              {selectable ? (
                <input type="checkbox" className="step-check" checked={!off.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Run ${s.id} · ${s.title}`} />
              ) : null}
              <span className="step-id num">{s.id.replace(/^pln_[A-Za-z0-9]+_/, "")}</span>
              <span className={`kind-icon k-${s.kind === 'op' ? OPS[s.op].output : s.kind}`}>{stepIcon(s)}</span>
              {script ? (
                <button type="button" className="step-text step-toggle" onClick={() => flip(s.id)} aria-expanded={shown}>
                  <span className="step-title">
                    {shown ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {s.title}
                  </span>
                  <span className="step-detail faint">{stepDetail(s, name, refName)}</span>
                </button>
              ) : (
                <span className="step-text">
                  <span className="step-title">{s.title}</span>
                  <span className="step-detail faint">{stepDetail(s, name, refName)}</span>
                </span>
              )}
              {awaiting && (s.kind === 'image' || s.kind === 'video' || s.kind === 'audio' || s.kind === 'model3d') ? <SuggestChange label={`"${s.title}"`} /> : null}
              {gen?.assetIds.length ? (
                <button type="button" className="step-thumb" onClick={() => setUi({ lightbox: { assetIds: gen.assetIds, index: 0 } })} aria-label="Open result">
                  <AssetMedia assetId={gen.assetIds[0]} hoverPlay={false} draggable={false} />
                </button>
              ) : perStep && perStep[s.id] && (perStep[s.id].usd ?? 1) > 0 ? (
                <span className="step-cost num faint">{costLabel(perStep[s.id], { short: true })}</span>
              ) : null}
              <StateIcon state={state} />
              {script && shown ? <p className="step-script">{script}</p> : null}
              {state === 'review' && item.stepCostReviews?.[s.id] ? (
                <div className="step-script">
                  <p>{item.stepCostReviews[s.id].message}</p>
                  <Button size="sm" variant="primary" onClick={() => { void resolveStepCostReview(sessionId, item.id, s.id, 'continue'); }}>Continuar</Button>
                  <Button size="sm" variant="ghost" onClick={() => { void resolveStepCostReview(sessionId, item.id, s.id, 'cancel'); }}>Cancelar paso</Button>
                </div>
              ) : null}
              {item.stepVariantNotes?.[s.id] ? <p className="step-script faint">{item.stepVariantNotes[s.id]}</p> : null}
              {s.kind === 'image' && s.variations?.length ? <Variations title={s.title} variations={s.variations} editable={awaiting} /> : null}
            </li>
          );
        })}
      </ol>
      {plan.subjects?.length ? (
        <p className="plan-subjects">
          <UserRound size={12} />
          {plan.subjects.map((x) => `@${x.name} ← ${x.from.startsWith('asset:') ? 'your image (saved to your library when you run it)' : `${x.from} (this plan only)`}`).join(' · ')}
          <span className="faint"> — kept identical in every step that mentions it</span>
        </p>
      ) : null}
      {plan.style ? (
        <p className="plan-subjects">
          <Palette size={12} />
          <span>Style: {plan.style}</span>
        </p>
      ) : null}
      {/* Changes to a model the user picked are never folded away. */}
      {plan.adjustments.filter(aboutUserModel).map((a, i) => (
        <p key={`u${i}`} className="plan-user-model"><CircleAlert size={12} /> {a}</p>
      ))}
      {plan.adjustments.length ? (
        <div className="plan-note faint">
          <button type="button" className="plan-adj-toggle" onClick={() => setShowAdj((v) => !v)} aria-expanded={showAdj}>
            {showAdj ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {plan.adjustments.length} adjustment{plan.adjustments.length === 1 ? '' : 's'} to the models
          </button>
          {showAdj ? <ul className="plan-adj">{plan.adjustments.map((a, i) => <li key={i}>{a}</li>)}</ul> : null}
        </div>
      ) : null}
      {item.error ? <p className="plan-error">{item.error}</p> : null}
      {item.status === 'error' || item.status === 'partial' ? <PlanRecoveryChips sessionId={sessionId} item={item} /> : null}
      <footer className="plan-foot">
        {item.status === 'awaiting' ? (
          <>
            <span className="plan-budget faint num">
              {total.usd == null ? 'Price not published — billed at actual cost' : free ? 'Nothing to pay' : remaining == null ? 'No spending limit' : `Budget left ${formatUsd(Math.max(0, remaining))}`}
            </span>
            <Button variant="ghost" onClick={() => cancelPlan(sessionId, item.id)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={Zap}
              disabled={revising || none || Boolean(nodePreview?.errors.length)}
              onClick={() => {
                if (over) acceptOverLimit();
                void approvePlan(sessionId, item.id);
              }}
              data-tip={over ? overLimitText(total) : revising ? 'The agent is revising this plan' : undefined}
            >
              {free ? 'Run' : `${over ? 'Run anyway' : 'Run'} · ${costLabel(total, { short: true })}`}
            </Button>
          </>
        ) : item.status === 'running' ? (
          <span className="plan-progress faint num">
            <LoaderCircle size={13} className="spin" /> Running {doneCount}/{plan.steps.length}
          </span>
        ) : (
          <>
            <span className={`plan-final st-${item.status} num`}>
              {item.status === 'review' ? 'Necesita revisión' : item.status === 'done' ? 'Done' : item.status === 'partial' ? 'Finished with errors' : item.status === 'canceled' ? 'Canceled' : 'Failed'}
            </span>
            {plan.workspace !== workspace && (item.status === 'done' || item.status === 'partial') && plan.workspace !== 'chat' ? (
              <Button variant="ghost" size="sm" onClick={() => setUi({ workspace: plan.workspace })}>
                Open in {WS_NAMES[plan.workspace]} <ArrowRight size={13} />
              </Button>
            ) : null}
          </>
        )}
      </footer>
    </article>
  );
}

/**
 * A pencil that opens a short field: what the user writes goes to the agent as a comment on the waiting plan, which
 * revises only that step or option (the existing revision path).
 */
function SuggestChange({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const send = () => {
    const t = text.trim();
    if (!t) return;
    void sendAgentMessage(`${label}: ${t}`, { attachments: [] });
    setOpen(false);
    setText('');
  };
  return (
    <>
      <button type="button" className="icon-btn step-variation-edit" aria-label={`Suggest changes to ${label}`} data-tip="Suggest changes" onClick={() => { setOpen((o) => !o); setText(''); }}>
        <Pencil size={12} />
      </button>
      {open ? (
        <input
          autoFocus
          className="q-custom step-variation-input"
          placeholder="What should change here?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); if (e.key === 'Escape') setOpen(false); }}
        />
      ) : null}
    </>
  );
}

/** The candidates of a step, each a slight variation of the shared prompt, each with its own pencil. */
function Variations({ title, variations, editable }: { title: string; variations: string[]; editable: boolean }) {
  return (
    <ol className="step-variations">
      {variations.map((v, i) => (
        <li key={i}>
          <span className="num faint">{i + 1}</span>
          <span className="step-variation">{v}</span>
          {editable ? <SuggestChange label={`"${title}", option ${i + 1}`} /> : null}
        </li>
      ))}
    </ol>
  );
}
