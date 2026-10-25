import { changePlanChoice, changePlanDraft, planDraft, rewritePrompts, type GenKind } from '../../engine/agent/planSettings';
import type { PlanFeedItem, SettingsSection } from '../../engine/types';
import { useStore } from '../../store/store';
import { Button } from '../ui/primitives';
import { DraftChoice, SettingsSectionBlock } from './SettingsCard';

/** Auto's one card: the settings card's draft choice, model and values, on the waiting plan (engine/agent/planSettings). */
export function PlanSettings({ item, sessionId, sections }: { item: PlanFeedItem; sessionId: string; sections: SettingsSection[] }) {
  useStore((s) => s.sessions[sessionId]?.agent.draftMode);
  const models = useStore((s) => s.catalog.models);
  const draft = planDraft(sessionId);
  const titled = sections.length > 1;
  return (
    <div className="plan-set">
      {sections.map((x, i) => (
        <div key={x.kind} className={titled ? 'set-section' : undefined}>
          {titled ? <div className="set-section-title">{x.kind === 'image' ? 'Images' : 'Video'} · {models[x.recommended.modelRef]?.name ?? x.recommended.modelRef}</div> : null}
          <SettingsSectionBlock
            section={x}
            index={i}
            itemId={item.id}
            sessionId={sessionId}
            draft={x.kind === 'video' ? draft : undefined}
            onPick={(c) => void changePlanChoice(sessionId, item.id, x.kind as GenKind, c)}
            onUnlock={() => changePlanDraft(sessionId, item.id, draft.kind, draft.text, true)}
            extra={x.kind === 'video' ? <DraftChoice compact draft={draft} onSelect={(kind, text) => changePlanDraft(sessionId, item.id, kind, text)} /> : undefined}
          />
        </div>
      ))}
    </div>
  );
}

/** The rewrite failed: the plan keeps the old prompt and cannot be approved until it is rewritten. */
export function RewriteFailed({ text, item, sessionId, sections }: { text: string; item: PlanFeedItem; sessionId: string; sections: SettingsSection[] }) {
  return (
    <p className="plan-error">
      {text}{' '}
      <Button size="sm" variant="ghost" onClick={() => { for (const x of sections) void rewritePrompts(sessionId, item.id, x.kind as GenKind); }}>Retry</Button>
    </p>
  );
}
