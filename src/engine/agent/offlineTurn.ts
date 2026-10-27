import { activeDoc } from '../design/actions';
import { activeSkill, workflowById } from '../skills';
import type { Workspace } from '../types';
import { appendFeed } from '../../store/store';
import { offlinePlan } from './offline';
import { startTurnLog, type TurnOutcome, type TurnRoute } from './turnLog';
import { designerDims, feedBase, get, notice, presentPlan, session, showQuestions } from './runtimeShared';

export async function offlineTurn(sessionId: string, workspace: Workspace, route: TurnRoute): Promise<void> {
  const end = startTurnLog(sessionId, 'offline', route);
  end(await offlinePass(sessionId, workspace));
}

async function offlinePass(sessionId: string, workspace: Workspace): Promise<TurnOutcome> {
  const s = session(sessionId);
  const draft = s.agent.draft ?? { request: '', answers: {}, attachments: [] };
  const st = get();
  const docDims = workspace === 'designer' ? activeDoc(sessionId) ?? designerDims() : undefined;
  const action = offlinePlan({
    request: draft.request,
    answers: draft.answers,
    round: s.agent.questionRound,
    maxRounds: st.settings.guidedRounds,
    style: st.composer.agentStyle,
    workspace,
    attachments: draft.attachments.map((id) => ({ id, kind: st.assets[id]?.kind ?? 'image' })).filter((a) => st.assets[a.id]),
    skillHint: activeSkill(st.composer.skillId, st.composer.workflowId)?.promptHint,
    workflow: workflowById(st.composer.workflowId),
    doc: docDims ? { width: docDims.width, height: docDims.height } : undefined,
  });
  if (action.kind === 'reply') {
    appendFeed(sessionId, { ...feedBase(workspace), type: 'assistant', text: action.text, engine: 'Local planner' });
    return 'text';
  }
  if (action.kind === 'questions') {
    showQuestions(sessionId, workspace, action.intro, action.questions, null);
    return 'questions';
  }
  const result = await presentPlan(sessionId, workspace, action.plan, null);
  if (result.errors.length) notice(sessionId, workspace, `The plan could not be built: ${result.errors.join(' ')}`);
  return result.errors.length ? 'error' : 'plan';
}
