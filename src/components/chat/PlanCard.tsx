import { previewRun } from '../../engine/flow/actions';
import { useEffect, useState } from 'react';
import { Box, Check, ChevronDown, ChevronRight, CircleAlert, Film, Image as ImageIcon, LoaderCircle, Minus, Music, Type, Wand, Layers, ArrowRight, UserRound, RotateCw } from 'lucide-react';
import { approvePlan, cancelPlan, resolveStepCostReview, sendAgentMessage } from '../../engine/agent/runtime';
import { cancelGeneration } from '../../engine/jobs';
import { plannedSpend, spentLabel } from './planSpent';
import { stopPlanRun } from '../../engine/planStop';
import { stepSentPrompt } from '../../engine/sentPrompt';
import { toggleStep } from '../../engine/plan';
import { DRAFT, HQ, reusedDraft } from '../../engine/agent/draftFirst';
import { estimateSteps } from '../../engine/executor';
import { OPS } from '../../engine/ops';
import { aspectLabel, durationLabel } from '../../engine/params';
import { needsSpendCheck } from '../../engine/pricing';
import { acceptOverLimit, overLimit, overLimitText, remainingBudget } from '../../engine/budget';
import type { Estimate, Generation, PlanFeedItem, PlanStep, StepState, StepAuthorization } from '../../engine/types';
import { formatUsd } from '../../lib/format';
import { setUi, updateFeedItem, useStore } from '../../store/store';
import { priceMargin } from '../../engine/priceAuthorization';
import { PlanRecoveryChips } from './RecoveryActions';
import { Button, IconButton, costLabel } from '../ui/primitives';
import { planSections, recheckPlanPrice, usePlanRewrite } from '../../engine/agent/planSettings';
import { PlanSettings, RewriteFailed } from './PlanSettings';
import { AspectShape } from './aspectShape';
import { Collapsible, EditLine, RefThumb, SuggestBox, SuggestButton } from './PlanParts';
import { ResultThumb, StepThumb } from './StepThumb';

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
/** A result short of what the user asked ("short of 8K") is a promise the plan cannot keep: never folded either. */
const shortOfRequest = (a: string) => /\bshort of\b/.test(a);
const neverFolded = (a: string) => aboutUserModel(a) || shortOfRequest(a) || a.startsWith('video total:');

/** `ref` names an input in words for the card: a step by its title, an asset as "your image" or "the earlier clip". */
type RefName = (ref: string) => string;

function stepDetail(s: PlanStep, modelName: (ref: string) => string, refName: RefName, authorization?: StepAuthorization): string {
  switch (s.kind) {
    case 'image':
      return [modelName(s.modelRef), s.settings.aspect ? aspectLabel(s.settings.aspect) : '', s.settings.count > 1 ? `×${s.settings.count}` : '', s.refs.length ? `${s.refs.length} ref` : ''].filter(Boolean).join(' · ');
    case 'model3d':
      return [modelName(s.modelRef), s.refs.length ? `${s.refs.length} ref` : 'from text'].join(' · ');
    case 'video':
      return [modelName(s.modelRef), s.settings.duration ? durationLabel(s.settings.duration) : '', s.firstFrame ? `from ${refName(s.firstFrame)}` : '', s.refs?.length ? `${s.refs.length} ref` : ''].filter(Boolean).join(' · ');
    case 'audio':
      return [modelName(s.modelRef), s.lyricsFrom ? `lyrics from ${refName(s.lyricsFrom)}` : s.settings.extras?.lyrics ? 'with lyrics' : s.settings.advanced.is_instrumental ? 'instrumental' : ''].filter(Boolean).join(' · ');
    case 'op':
      return [
        `${OPS[s.op].label} of ${refName(s.input)}`,
        s.op === 'upscale' && s.params.factor ? `×${String(s.params.factor)}` : '',
        OPS[s.op].engine === 'local' ? 'Local operation' : authorization?.modelRef ? modelName(authorization.modelRef) : 'Model pending',
        authorization?.parameters.aspect ? aspectLabel(authorization.parameters.aspect) : '',
        authorization?.parameters.resolution ?? '',
        OPS[s.op].engine !== 'local' && !s.input.startsWith('asset:') ? 'Provisional until source exists' : '',
      ].filter(Boolean).join(' · ');
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

/** Steps that make media get thumbnails (the app's pending placeholder until the result arrives); text and layers keep their icon. */
const thumbed = (s: PlanStep) => s.kind === 'image' || s.kind === 'video' || s.kind === 'audio' || s.kind === 'model3d' || s.kind === 'op';

/** The estimate-versus-minimum distinction the label's symbol carries, said in words on the approve button. */
function costTip(e: Estimate): string | undefined {
  const m = priceMargin();
  // The margin the app enforces, said where the price is shown (Settings → Budget → Price margin).
  const guard = m === 'off' ? 'No price stop: steps run at their price and the card shows any difference.' : `A step that would cost more than ${m}% over this (at least 1¢) waits for you.`;
  const base = e.note ?? (e.lowerBound ? 'Minimum: the final price can be higher.' : e.approximate ? 'Estimate: the final price may differ.' : undefined);
  return e.usd ? (base ? `${base} ${guard}` : guard) : base;
}

/** "model · shape ratio · rest": the aspect ratio drawn at its real proportion, tight to its label. */
function DetailLine({ step, detail }: { step: PlanStep; detail: string }) {
  const aspect = step.kind === 'image' || step.kind === 'video' ? step.settings.aspect : undefined;
  const parts = detail.split(' · ');
  let at = aspect ? parts.indexOf(aspectLabel(aspect)) : -1;
  if (aspect && at < 0 && step.kind === 'video') { parts.splice(1, 0, aspectLabel(aspect)); at = 1; }
  return (
    <span className="step-detail faint">
      {parts.map((p, i) => (
        <span key={i} className="cc-dpart">{i > 0 ? ' · ' : ''}{i === at && aspect ? <span className="cc-inline"><AspectShape value={aspect} max={12} />{p}</span> : p}</span>
      ))}
    </span>
  );
}

const WS_NAMES = { chat: 'Chat', node: 'Node', designer: 'Designer' } as const;

export function PlanCard({ item, sessionId }: { item: PlanFeedItem; sessionId: string }) {
  const graph = useStore(s => s.sessions[sessionId].graph);
  const library = useStore(s => s.library);
  const composer = useStore(s => s.composer);
  const models = useStore((s) => s.catalog.models);
  const schemas = useStore((s) => s.catalog.schemas);
  const assets = useStore((s) => s.assets);
  useStore((s) => s.spentUsd);
  useStore((s) => s.settings);
  useStore((s) => s.quotes); // exact Atlas prices replace the estimate when they arrive
  const remaining = remainingBudget();
  const workspace = useStore((s) => s.ui.workspace);
  // While the agent revises this plan after a comment, it must not run in its old form.
  const revising = useStore((s) => s.sessions[sessionId]?.agent.revising === item.id);
  const reused = useStore((s) => reusedDraft(s.sessions[sessionId]?.feed ?? [], item.id));
  const { plan } = item;
  const awaiting = item.status === 'awaiting';
  // Auto: the settings card's choices live on this card; changing the model rewrites its prompts here.
  const feed = useStore((s) => s.sessions[sessionId]?.feed);
  const sections = awaiting ? planSections(feed ?? [], item) : [];
  const rewriting = usePlanRewrite((s) => Boolean(s.busy[item.id]));
  const rewriteFailed = usePlanRewrite((s) => s.failed[item.id]);
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
  /** The catalog id of the model, as the send path sees it (some realism clauses depend on it). */
  const modelIdOf = (ref: string) => models[ref]?.id ?? ref.split('::')[1] ?? '';
  const refName: RefName = (ref) => {
    if (ref.startsWith('asset:')) {
      const a = assets[ref.slice(6)];
      const what = a?.kind === 'video' ? 'clip' : a?.kind === 'audio' ? 'audio' : 'image';
      return a?.origin === 'upload' ? `your ${what}` : `the earlier ${what}`;
    }
    const st = plan.steps.find((x) => x.id === ref.split('#')[0]);
    return st ? `“${st.title}”` : ref;
  };
  const over = awaiting && overLimit(total);
  const [showAdj, setShowAdj] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const generations = useStore((s) => s.generations);
  const free = !needsSpendCheck(total);
  const running = item.status === 'running';
  const results = running ? resultRows(plan.steps, item, generations) : [];
  const resultsDone = results.filter((r) => r.done).length;
  const refIds = [...new Set(plan.steps.flatMap(refAssets))];
  const spent = spentLabel(plannedSpend(item.stepGenerations, generations));
  const stopRun = () => { stopPlanRun(plan.id); for (const id of Object.values(item.stepGenerations)) if (generations[id] && ['running', 'queued'].includes(generations[id].status)) cancelGeneration(id); };
  /** Only a waiting plan can be edited: the other states show the same lines without the Edit button. */
  const editable = (label: string, node: React.ReactNode) => (awaiting ? <EditLine label={label}>{node}</EditLine> : node);

  return (
    <article className={`plan-card cc-w status-${item.status}`}>
      <header className="plan-head cc-head">
        <div className="cc-head-main">
          <div className="cc-headline">
            <h4 className="plan-title cc-title">{plan.title}</h4>
            {rewriting ? <span className="cc-state faint"><LoaderCircle size={12} className="spin" /> Adapting the prompt…</span> : item.revised || revising ? <span className="cc-state faint">{revising ? 'Revising…' : 'Revised'}</span> : null}
            {running ? <span className="cc-run num"><LoaderCircle size={14} className="spin accent" />{resultsDone} of {results.length}</span> : null}
          </div>
          {plan.summary ? <p className="plan-summary">{plan.summary}</p> : null}
          {reused && !sections.length ? (
            <p className="plan-summary faint">
              {reused.kind === 'draft' ? DRAFT : reused.kind === 'hq' ? HQ : (reused.text ?? '').trim().slice(0, 40)} (como antes)
              {awaiting ? <> <Button size="sm" variant="ghost" onClick={() => { void sendAgentMessage('Quiero cambiar la elección de borrador/calidad', { attachments: [] }); }}>Cambiar</Button></> : null}
            </p>
          ) : null}
          {plan.continuity?.map((group, i) => <p className="plan-summary" key={i}>Keep: {group.preserve} · from {refName(group.source)} · {group.steps.length} steps. Reference use is checked; visual fidelity still needs review.</p>)}
        </div>
      </header>
      {sections.length ? <PlanSettings item={item} sessionId={sessionId} sections={sections} /> : null}
      {running ? (
        <ol className="plan-steps cc-results">
          {refIds.length ? (
            <li className="plan-step cc-result">
              <RefThumb assetId={refIds[0]} />
              <span className="step-text"><span className="step-title">Reference</span><span className="step-detail faint">{refIds.length} ref</span></span>
            </li>
          ) : null}
          {results.map((r) => (
            <li key={r.key} className={`plan-step cc-result st-${r.status}`}>
              {r.thumb ?? <ResultThumb genId={r.genId} index={r.index} />}
              <span className="step-text">
                <span className={`step-title${r.status === 'waiting' ? ' faint' : ''}`}>{r.name}</span>
                <span className="step-detail faint">{[r.sub, r.status].filter(Boolean).join(' · ')}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
      <ol className="plan-steps">
        {plan.steps.map((s) => {
          const genId = item.stepGenerations[s.id];
          const state = item.stepStates[s.id] ?? 'pending';
          const script = s.kind === 'image' || s.kind === 'video' ? stepSentPrompt(s, modelIdOf(s.modelRef)) : stepScript(s);
          const detail = stepDetail(s, name, refName, live?.authorizations[s.id] ?? item.stepAuthorizations?.[s.id]);
          const ref = refAssets(s)[0];
          const variations = s.kind === 'image' && s.variations?.length ? s.variations : undefined;
          return (
            <li key={s.id} className={`plan-step st-${state}${awaiting && off.has(s.id) ? ' is-off' : ''}`}>
              {selectable ? (
                <input type="checkbox" className="step-check" checked={!off.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Run ${s.id} · ${s.title}`} />
              ) : null}
              {ref ? (
                <RefThumb assetId={ref} />
              ) : thumbed(s) ? (
                <StepThumb genId={genId} count={s.kind === 'image' ? s.settings.count : 1} />
              ) : (
                <span className={`kind-icon k-${s.kind}`}>{stepIcon(s)}</span>
              )}
              <span className="step-text">
                <span className="cc-step-line">
                  <span className="step-title" title={s.id.replace(/^pln_[A-Za-z0-9]+_/, '')}>{s.title}</span>
                  {plan.steps.length > 1 && perStep && perStep[s.id] && (perStep[s.id].usd ?? 1) > 0 ? <span className="step-cost num faint">{costLabel(perStep[s.id], { short: true })}</span> : null}
                  {!awaiting ? <StateIcon state={state} /> : null}
                </span>
                <DetailLine step={s} detail={detail} />
                {variations ? (
                  <>
                    <span className="cc-lab">Prompts · base + variation</span>
                    {variations.map((v, i) => {
                      const full = stepSentPrompt(s, modelIdOf('modelRef' in s ? s.modelRef : ''), v);
                      return (
                        <span key={i} className="cc-var">
                          {editable(`"${s.title}", option ${i + 1}`, (
                            <Collapsible
                              name={`variation ${i + 1} of ${s.title}`}
                              head={<>Variation {i + 1}<span className="cc-vd"> · {v}</span></>}
                              preview={<><u className="cc-delta">{v}</u><span className="cc-base"> · {(s.kind === 'image' ? s.prompt : '').replace(/\s+/g, ' ')}</span></>}
                            >
                              {full.slice(0, full.length - v.length)}<u className="cc-delta">{v}</u>
                            </Collapsible>
                          ))}
                        </span>
                      );
                    })}
                  </>
                ) : script ? (
                  <>
                    <span className="cc-lab">Prompt</span>
                    {editable(`"${s.title}"`, <Collapsible name={`the prompt of ${s.title}`}>{script}</Collapsible>)}
                  </>
                ) : null}
                {state === 'review' && item.status !== 'canceled' && item.stepCostReviews?.[s.id] ? (
                  <span className="step-script">
                    <p>{item.stepCostReviews[s.id].message}</p>
                    <Button size="sm" variant="primary" onClick={() => { void resolveStepCostReview(sessionId, item.id, s.id, 'continue'); }}>Continuar</Button>
                    <Button size="sm" variant="ghost" onClick={() => { void resolveStepCostReview(sessionId, item.id, s.id, 'cancel'); }}>Cancelar paso</Button>
                  </span>
                ) : null}
                {item.stepVariantNotes?.[s.id] ? <span className="step-script faint">{item.stepVariantNotes[s.id]}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      )}
      {!running && plan.subjects?.length ? (
        <p className="plan-subjects">
          <UserRound size={12} />
          {plan.subjects.map((x) => `@${x.name} ← ${x.from.startsWith('asset:') ? 'your image (saved to your library when you run it)' : `${x.from} (this plan only)`}`).join(' · ')}
          <span className="faint"> — kept identical in every step that mentions it</span>
        </p>
      ) : null}
      {!running && plan.style ? (
        <div className="cc-style">
          <span className="cc-lab">Style</span>
          {editable('Style', <Collapsible name="the style">{plan.style}</Collapsible>)}
        </div>
      ) : null}
      {/* Changes to a model the user picked, and results short of what was asked, are never folded away. */}
      {plan.adjustments.filter(neverFolded).map((a, i) => (
        <p key={`u${i}`} className="plan-user-model"><CircleAlert size={12} /> {shortOfRequest(a) ? a.replace(/^[\w-]+: /, '') : a}</p>
      ))}
      {!running && plan.adjustments.length ? (
        <div className="plan-note faint">
          <button type="button" className="plan-adj-toggle" onClick={() => setShowAdj((v) => !v)} aria-expanded={showAdj}>
            {showAdj ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {plan.adjustments.length} adjustment{plan.adjustments.length === 1 ? '' : 's'} to the plan
          </button>
          {showAdj ? <ul className="plan-adj">{plan.adjustments.map((a, i) => <li key={i}>{a}</li>)}</ul> : null}
        </div>
      ) : null}
      {item.error ? <p className="plan-error">{item.error}</p> : null}
      {awaiting && rewriteFailed ? <RewriteFailed text={rewriteFailed} item={item} sessionId={sessionId} sections={sections} /> : null}
      {item.status === 'error' || item.status === 'partial' ? <PlanRecoveryChips sessionId={sessionId} item={item} /> : null}
      {awaiting && suggest ? <SuggestBox onDone={() => setSuggest(false)} /> : null}
      <footer className="plan-foot">
        {item.status === 'awaiting' ? (
          <>
            <span className="plan-budget faint num">
              {total.usd == null ? 'Price not published — billed at actual cost' : free ? 'Nothing to pay' : remaining == null ? 'No spending limit' : `Budget left ${formatUsd(Math.max(0, remaining))}`}
            </span>
            <SuggestButton open={suggest} onClick={() => setSuggest((v) => !v)} />
            <Button variant="ghost" onClick={() => cancelPlan(sessionId, item.id)}>
              Cancel
            </Button>
            {sections.length ? <IconButton icon={RotateCw} label="Check the price again" className="cc-recheck" disabled={rewriting} onClick={() => void recheckPlanPrice(sessionId, item.id)} /> : null}
            <Button
              variant="primary"
              className="cc-approve"
              disabled={revising || rewriting || Boolean(rewriteFailed) || none || Boolean(nodePreview?.errors.length)}
              onClick={() => {
                if (over) acceptOverLimit();
                void approvePlan(sessionId, item.id);
              }}
              data-tip={over ? overLimitText(total) : revising ? 'The agent is revising this plan' : rewriting ? 'The prompt is being adapted to the new model' : rewriteFailed ? 'Retry the prompt for the new model first' : costTip(total)}
            >
              {free ? 'Approve' : <>{over ? 'Approve anyway' : 'Approve'}<span className="cc-ap-sep" aria-hidden>·</span><span className="cc-ap-cost num">{costLabel(total, { short: true })}</span></>}
            </Button>
          </>
        ) : running ? (
          <>
            <span className="cc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={results.length} aria-valuenow={resultsDone}><i style={{ width: `${results.length ? (100 * resultsDone) / results.length : 0}%` }} /></span>
            <span className="plan-progress faint num">{[`${resultsDone} of ${results.length}`, spent].filter(Boolean).join(' · ')}</span>
            <Button variant="ghost" onClick={stopRun}>Cancel</Button>
          </>
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

/** The reference assets a step uses (an input that is a stored asset; step outputs have no image yet). */
function refAssets(s: PlanStep): string[] {
  const refs = 'refs' in s && Array.isArray(s.refs) ? s.refs : [];
  return refs.map((r) => (typeof r === 'string' ? r : r.ref)).filter((r) => r.startsWith('asset:')).map((r) => r.slice(6));
}

interface ResultRow { key: string; name: string; sub: string; status: 'done' | 'waiting' | 'generating' | 'failed'; done: boolean; genId?: string; index: number; thumb?: React.ReactNode }

/** One row per result the plan will produce (a variation, an image of a count, a clip), with where it stands. */
function resultRows(steps: PlanStep[], item: PlanFeedItem, generations: Record<string, Generation>): ResultRow[] {
  return steps.flatMap((s) => {
    const state = item.stepStates[s.id] ?? 'pending';
    if (state === 'skipped' || (item.skipped ?? []).includes(s.id)) return [];
    const genId = item.stepGenerations[s.id];
    const g = genId ? generations[genId] : undefined;
    if (!thumbed(s)) {
      return [{ key: s.id, name: s.title, sub: '', done: state === 'done', status: state === 'done' ? 'done' : state === 'error' ? 'failed' : state === 'running' ? 'generating' : 'waiting', index: 0, thumb: <span className={`kind-icon k-${s.kind}`}>{stepIcon(s)}</span> } satisfies ResultRow];
    }
    const variations = s.kind === 'image' ? s.variations : undefined;
    const n = Math.max(1, variations?.length ?? (s.kind === 'image' ? s.settings.count : 1), g?.assetIds.length ?? 0);
    return Array.from({ length: n }, (_, i): ResultRow => {
      const done = Boolean(g?.assetIds[i]);
      const failed = g?.status === 'error' || state === 'error';
      return {
        key: `${s.id}:${i}`, genId, index: i, done,
        name: variations ? `Variation ${i + 1}` : n > 1 ? `${s.title} ${i + 1}` : s.title,
        sub: variations?.[i] ?? '',
        status: done ? 'done' : failed ? 'failed' : state === 'running' && i === (g?.assetIds.length ?? 0) ? 'generating' : 'waiting',
      };
    });
  });
}
