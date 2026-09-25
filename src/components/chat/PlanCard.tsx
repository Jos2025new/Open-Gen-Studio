import { Check, CircleAlert, Film, Image as ImageIcon, LoaderCircle, Minus, Music, Type, Wand, Layers, Zap, ArrowRight } from 'lucide-react';
import { approvePlan, cancelPlan } from '../../engine/agent/runtime';
import { estimateSteps } from '../../engine/executor';
import { OPS } from '../../engine/ops';
import { aspectLabel, durationLabel } from '../../engine/params';
import { needsSpendCheck } from '../../engine/pricing';
import type { PlanFeedItem, PlanStep, StepState } from '../../engine/types';
import { formatUsd } from '../../lib/format';
import { setUi, useStore } from '../../store/store';
import { AssetMedia } from '../ui/AssetMedia';
import { Button, CostTag, costLabel } from '../ui/primitives';

function stepIcon(s: PlanStep) {
  switch (s.kind) {
    case 'image':
      return <ImageIcon size={13} />;
    case 'video':
      return <Film size={13} />;
    case 'audio':
      return <Music size={13} />;
    case 'op':
      return <Wand size={13} />;
    case 'text':
      return <Type size={13} />;
    case 'layer':
      return <Layers size={13} />;
  }
}

function stepDetail(s: PlanStep, modelName: (ref: string) => string): string {
  switch (s.kind) {
    case 'image':
      return [modelName(s.modelRef), s.settings.aspect ? aspectLabel(s.settings.aspect) : '', s.settings.count > 1 ? `×${s.settings.count}` : '', s.refs.length ? `${s.refs.length} ref` : ''].filter(Boolean).join(' · ');
    case 'video':
      return [modelName(s.modelRef), s.settings.duration ? durationLabel(s.settings.duration) : '', s.firstFrame ? `from ${s.firstFrame}` : ''].filter(Boolean).join(' · ');
    case 'audio':
      return [modelName(s.modelRef), s.lyricsFrom ? `lyrics from ${s.lyricsFrom}` : s.settings.extras?.lyrics ? 'with lyrics' : s.settings.advanced.is_instrumental ? 'instrumental' : ''].filter(Boolean).join(' · ');
    case 'op':
      return `${OPS[s.op].label} of ${s.input}`;
    case 'text':
      return s.text.length > 60 ? `${s.text.slice(0, 59)}…` : s.text;
    case 'layer':
      return s.layerType === 'raster' ? `raster · ${s.target === 'base' ? 'layer 1' : s.target === 'new' ? 'new layer' : s.target}` : `${s.layerType}${s.text ? ` · “${s.text.slice(0, 30)}”` : ''}`;
  }
}

function StateIcon({ state }: { state: StepState }) {
  if (state === 'running') return <LoaderCircle size={13} className="spin accent" />;
  if (state === 'done') return <Check size={13} className="ok" />;
  if (state === 'error') return <CircleAlert size={13} className="danger" />;
  if (state === 'skipped') return <Minus size={13} className="faint" />;
  return <span className="state-dot" />;
}

const WS_NAMES = { chat: 'Chat', node: 'Node', designer: 'Designer' } as const;

export function PlanCard({ item, sessionId }: { item: PlanFeedItem; sessionId: string }) {
  const models = useStore((s) => s.catalog.models);
  const schemas = useStore((s) => s.catalog.schemas);
  const generations = useStore((s) => s.generations);
  const remaining = useStore((s) => s.settings.budgetUsd - s.spentUsd);
  const workspace = useStore((s) => s.ui.workspace);
  const { plan } = item;
  // Prices may load after the plan was proposed; show the live estimate while it waits.
  const live = item.status === 'awaiting' ? estimateSteps(plan.steps) : null;
  void schemas;
  const total = live?.total ?? item.estimate;
  const perStep = live?.perStep;
  const name = (ref: string) => models[ref]?.name ?? (ref.startsWith('local::') ? (ref.endsWith('video') ? 'Local Motion' : 'Local Sketch') : ref.split('::')[1] ?? ref);
  const doneCount = Object.values(item.stepStates).filter((s) => s === 'done').length;
  const over = total.usd != null && total.usd > remaining + 1e-9;
  const free = !needsSpendCheck(total);

  return (
    <article className={`plan-card status-${item.status}`}>
      <header className="plan-head">
        <div>
          <div className="plan-kicker">
            Plan · {WS_NAMES[plan.workspace]} · {item.style === 'auto' ? 'Auto' : 'Guided'}
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
          return (
            <li key={s.id} className={`plan-step st-${state}`}>
              <span className="step-id num">{s.id}</span>
              <span className={`kind-icon k-${s.kind === 'op' ? OPS[s.op].output : s.kind}`}>{stepIcon(s)}</span>
              <span className="step-text">
                <span className="step-title">{s.title}</span>
                <span className="step-detail faint">{stepDetail(s, name)}</span>
              </span>
              {gen?.assetIds.length ? (
                <button type="button" className="step-thumb" onClick={() => setUi({ lightbox: { assetIds: gen.assetIds, index: 0 } })} aria-label="Open result">
                  <AssetMedia assetId={gen.assetIds[0]} hoverPlay={false} draggable={false} />
                </button>
              ) : perStep && perStep[s.id] && (perStep[s.id].usd ?? 1) > 0 ? (
                <span className="step-cost num faint">{costLabel(perStep[s.id], { short: true })}</span>
              ) : null}
              <StateIcon state={state} />
            </li>
          );
        })}
      </ol>
      {plan.adjustments.length ? <p className="plan-note faint">Adjusted to the model: {plan.adjustments.join('; ')}</p> : null}
      {item.error ? <p className="plan-error">{item.error}</p> : null}
      <footer className="plan-foot">
        {item.status === 'awaiting' ? (
          <>
            <span className="plan-budget faint num">
              {total.usd == null ? 'Price not published — billed at actual cost' : free ? 'Nothing to pay' : `Budget left ${formatUsd(Math.max(0, remaining))}`}
            </span>
            <Button variant="ghost" onClick={() => cancelPlan(sessionId, item.id)}>
              Cancel
            </Button>
            <Button variant="primary" icon={Zap} disabled={over} onClick={() => void approvePlan(sessionId, item.id)} data-tip={over ? 'Over your remaining budget' : undefined}>
              {free ? 'Run' : `Run · ${costLabel(total, { short: true })}`}
            </Button>
          </>
        ) : item.status === 'running' ? (
          <span className="plan-progress faint num">
            <LoaderCircle size={13} className="spin" /> Running {doneCount}/{plan.steps.length}
          </span>
        ) : (
          <>
            <span className={`plan-final st-${item.status} num`}>
              {item.status === 'done' ? 'Done' : item.status === 'partial' ? 'Finished with errors' : item.status === 'canceled' ? 'Canceled' : 'Failed'}
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
