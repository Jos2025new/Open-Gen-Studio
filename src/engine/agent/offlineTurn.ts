import { activeDoc } from '../design/actions';
import { activeSkill, workflowById } from '../skills';
import type { Workspace } from '../types';
import { uid } from '../../lib/id';
import { appendFeed } from '../../store/store';
import { offlinePlan } from './offline';
import { startTurnLog, type TurnOutcome, type TurnRoute } from './turnLog';
import { agentOf, designerDims, feedBase, get, messageMeta, notice, presentPlan, showQuestions } from './runtimeShared';

export async function offlineTurn(sessionId: string, owner: string | undefined, workspace: Workspace, route: TurnRoute, runId = uid('turn')): Promise<void> {
  const end = startTurnLog(sessionId, 'offline', route, runId);
  end(await offlinePass(sessionId, owner, workspace, runId));
}

async function offlinePass(sessionId: string, owner: string | undefined, workspace: Workspace, runId: string): Promise<TurnOutcome> {
  const draft = agentOf(sessionId, owner).draft ?? { request: '', answers: {}, attachments: [] };
  const st = get();
  const docDims = workspace === 'designer' ? activeDoc(sessionId) ?? designerDims() : undefined;
  const action = offlinePlan({
    request: draft.request,
    answers: draft.answers,
    round: agentOf(sessionId, owner).questionRound,
    maxRounds: st.settings.guidedRounds,
    style: st.composer.agentStyle,
    workspace,
    attachments: draft.attachments.map((id) => ({ id, kind: st.assets[id]?.kind ?? 'image' })).filter((a) => st.assets[a.id]),
    skillHint: activeSkill(st.composer.skillId, st.composer.workflowId)?.promptHint,
    workflow: workflowById(st.composer.workflowId),
    doc: docDims ? { width: docDims.width, height: docDims.height } : undefined,
  });
  const meta = messageMeta(workspace, { agent: 'Local planner', provider: 'offline', model: 'Local planner', runId }, sessionId, owner);
  if (action.kind === 'reply') {
    appendFeed(sessionId, {
      ...feedBase(workspace),
      type: 'assistant',
      text: action.text,
      engine: 'Local planner',
      meta,
    });
    return 'text';
  }
  if (action.kind === 'questions') {
    showQuestions(sessionId, workspace, action.intro, action.questions, null, owner, meta);
    return 'questions';
  }
  const result = await presentPlan(sessionId, workspace, action.plan, null, owner, false, undefined, undefined, meta);
  if (result.errors.length) notice(sessionId, workspace, `The plan could not be built: ${result.errors.join(' ')}`, 'error', undefined, meta);
  return result.errors.length ? 'error' : 'plan';
}
