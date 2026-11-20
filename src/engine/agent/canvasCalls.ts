import type { ChatMessageMeta } from '../feedMeta';
import type { ChatResult } from '../providers/llm';
import type { LlmMessage, Workspace } from '../types';
import { editGraphTool } from './nodeTools';
import { activeDoc } from '../design/actions';
import { currentExportTarget, deliverDesignExport, prepareDesignExport, rememberDesignExport, resolveExportTarget } from '../design/exportDesign';
import { exportDownloadFile } from '../design/exportJob';
import { BUILTIN_EXPORTS, DEFAULT_EXPORT } from '../design/exportSettings';
import { exportDesignSchema } from './designerTools';
import { designerFxTool } from './designerFx';
import { findCommandsTool, runCommandsTool } from './commandCalls';
import { nodeIdsSchema } from './tools';
import { isAbort } from '../../lib/http';
import { chatToNodes } from '../flow/fromChat';
import { nodesToChat } from '../flow/fromNodes';
import { chatToDesigner } from '../design/fromChat';
import { findAssets, viewTargets, VIEW_MAX } from './assetSearch';
import type { LlmContentPart, PlanFeedItem } from '../types';
import { setUi, useStore } from '../../store/store';
import { findModelsResult } from './modelIndex';
import { agentSeesImages, attachmentParts, userMessage } from './attachments';
import { recordMetric } from './metrics';
import { readGuide, guideWorkspaceProblem } from '../skills';
import { cardInsteadOfGuide } from '../skills/workflowCard';
import { earlyModelGuide, inConversation, modelGuidesFor } from './requestGuides';
import { readGraph } from '../flow/graphView';
import { backToChatCanvas, moveToCanvas, openBoard } from './agentCanvas';
import { canvasParts } from './canvasView';
import { nodeSelection } from '../flow/selection';
import { continueInChatSchema, continueInDesignerSchema, findAssetsSchema, findModelsSchema, readGraphSchema, viewCanvasSchema, readGuideSchema, recoverPlanSchema, formatZodError } from './tools';
import { agentChoice, agentOf, feedOfAgent, get, session } from './runtimeShared';
import { flushToolResults, guideLabel } from './conversation';
import { planRecovery, planRecoveryProblem, presentNodeRun, RETRY_NEEDS_USER, resumePlan } from './planRun';
import { activityLog } from './activityLog';
import { generationStatus, generationStatusSchema } from './jobStatus';

type CallCtx = {
  sessionId: string;
  /** The agent whose turn this is: everything the call writes goes to it. */
  owner: string;
  workspace: Workspace;
  call: ChatResult['toolCalls'][number];
  parsed: { value: unknown };
  index: number;
  log: ReturnType<typeof activityLog>;
  until: <T,>(work: Promise<T>) => Promise<T>;
  /** The turn's own: Stop reaches every wait that can spend. */
  signal: AbortSignal;
  respond: (content: string) => void;
  ignoreRest: (fromIndex: number) => void;
  toolResults: LlmMessage[];
  afterTools: LlmMessage[];
  cardMeta?: () => ChatMessageMeta;
  onCardCommitted?: () => void;
};

/** Runs one of the tool calls answered by the canvas, finder and read tools. Each branch either handles its call ("handled"), ends the turn ("stop"), or leaves the call for the next branch (propose_plan). */
export async function runCanvasCall(c: CallCtx): Promise<{ handled: boolean; stop?: boolean; workspace: Workspace }> {
  const { sessionId, call, parsed, index, log, until, respond, ignoreRest, toolResults, afterTools } = c;
          if (call.name === 'find_models') {
  // Local search in the app's refined catalog; the agent continues in the next round.
  const v = findModelsSchema.safeParse(parsed.value);
  recordMetric(sessionId, { type: 'findModels' });
  if (v.success) log.action({ icon: 'search', label: 'Explored models', detail: v.data.query });
  respond(v.success ? await until(findModelsResult(v.data.query, v.data.kind)) : `Invalid find_models input: ${formatZodError(v.error)}`);
  return { handled: true, workspace: c.workspace };
          }
          if (call.name === 'recover_plan') {
  // Starts in the background: the plan card shows progress; the agent answers in the next round.
  const v = recoverPlanSchema.safeParse(parsed.value);
  if (!v.success) {
    respond(`Invalid recover_plan input: ${formatZodError(v.error)}`);
    return { handled: true, workspace: c.workspace };
  }
  const mode = v.data.action === 'check_status' ? 'check' : 'retry';
  const target = [...feedOfAgent(sessionId, c.owner)].reverse().find((f): f is PlanFeedItem => f.type === 'plan' && (f.status === 'error' || f.status === 'partial'));
  const problem = target ? planRecoveryProblem(target, mode, sessionId) : 'There is no failed plan in this chat.';
  // A retry may charge again for something the provider already received: only the user's button starts it, never the model.
  // Said before the budget text: the answer must not depend on the limit (the button handles the limit itself).
  if (target && mode === 'retry' && planRecovery(target)) { respond(RETRY_NEEDS_USER); return { handled: true, workspace: c.workspace }; }
  if (target && !problem) {
    log.action({ icon: 'fix', label: 'Checked the status of the failed steps', detail: target.plan.title });
    void resumePlan(sessionId, target.id, mode);
  }
  respond(problem ?? `Checking the providers for "${target!.plan.title}"; the plan card shows the progress. Tell the user in one short sentence.`);
  return { handled: true, workspace: c.workspace };
          }
          if (['edit_node', 'connect_nodes', 'disconnect_nodes', 'delete_nodes', 'restore_nodes'].includes(call.name)) {
  if (c.workspace !== 'node') { respond('Graph actions work only on the node canvas.'); return { handled: true, workspace: c.workspace }; }
  try {
    const result = await until(editGraphTool(sessionId, call.name, parsed.value));
    respond(result.text);
  } catch (error) { respond(`Cannot ${call.name}: ${(error as Error).message}`); }
  return { handled: true, workspace: c.workspace };
          }
          if (call.name === 'run_nodes') {
  const v = nodeIdsSchema.safeParse(parsed.value);
  if (c.workspace !== 'node') { respond('run_nodes works only on the node canvas.'); return { handled: true, workspace: c.workspace }; }
  if (!v.success) { respond(`Invalid run_nodes: ${v.error.message}`); return { handled: true, workspace: c.workspace }; }
  const proposed = await until(presentNodeRun(sessionId, v.data.node_ids, call.id, c.cardMeta?.(), c.owner));
  if (proposed.errors.length) { respond(`Run blocked before spending: ${proposed.errors.join(' ')}`); return { handled: true, workspace: c.workspace }; }
  c.onCardCommitted?.();
  log.action({ icon: 'plan', label: 'Proposed Run of existing nodes', detail: v.data.node_ids.join(', ') });
  ignoreRest(index); flushToolResults(sessionId, toolResults, c.owner); return { handled: true, stop: true, workspace: c.workspace };
          }
          if (call.name === 'export_design') {
  const doc = c.workspace === 'designer' ? activeDoc(sessionId) : null;
  const input = exportDesignSchema.safeParse(parsed.value);
  if (!doc) respond('Open a design on the Designer canvas before exporting.');
  else if (!input.success) respond(formatZodError(input.error));
  else {
    const base = BUILTIN_EXPORTS.find((preset) => preset.id === input.data.preset)?.settings
      ?? { ...DEFAULT_EXPORT, format: input.data.format ?? DEFAULT_EXPORT.format };
    const settings = { ...base, area: input.data.area ?? base.area };
    const draft = { settings, target: input.data.layer_id ?? currentExportTarget(doc, settings) };
    try {
      const { files, notices } = await until(prepareDesignExport(doc, settings, resolveExportTarget(doc, draft)));
      const file = await until(exportDownloadFile(doc.name, files));
      const name = deliverDesignExport(file);
      rememberDesignExport(sessionId, doc.id, draft);
      respond([`Browser download requested for ${name}.`, ...notices].join(' '));
    } catch (error) {
      if (isAbort(error)) throw error;
      respond(error instanceof Error ? error.message : 'Export failed. Try a smaller size or another format.');
    }
  }
  return { handled: true, workspace: c.workspace };
          }
          if (call.name === 'designer_fx') {
  const r = c.workspace === 'designer' ? designerFxTool(sessionId, parsed.value) : { text: 'designer_fx works only in the Designer.', done: false };
  if (r.done) log.action({ icon: 'fix', label: 'Changed filters and effects', detail: r.text });
  respond(r.text);
  return { handled: true, workspace: c.workspace };
          }
          if (call.name === 'find_commands' || call.name === 'run_commands') {
  const r = call.name === 'find_commands' ? findCommandsTool(sessionId, parsed.value) : await until(runCommandsTool(sessionId, parsed.value, c.signal, c.cardMeta?.()));
  if (r.done && call.name === 'run_commands') log.action({ icon: 'fix', label: 'Ran commands', detail: r.text });
  respond(r.text);
  return { handled: true, workspace: c.workspace };
          }
          if (call.name === 'view_canvas') {
  // Read-only look at the page or one layer; the image follows the tool results.
  const v = viewCanvasSchema.safeParse(parsed.value);
  if (!v.success) respond(`Invalid view_canvas input: ${formatZodError(v.error)}`);
  else if (c.workspace !== 'designer') respond('view_canvas works only in the Designer.');
  else if (!agentSeesImages(sessionId, c.owner)) respond('The selected agent model cannot see images.');
  else {
    const view = await until(canvasParts(sessionId, v.data.layer_id)).catch((e) => { if (isAbort(e)) throw e; return 'The page could not be rendered.'; });
    if (typeof view === 'string') respond(view);
    else {
      log.action({ icon: 'search', label: 'Looked at the canvas', detail: v.data.layer_id });
      respond('The image follows in the next message.');
      afterTools.push(userMessage('Canvas view:', view));
    }
  }
  return { handled: true, workspace: c.workspace };
          }
          if (call.name === 'generation_status') {
  const v = generationStatusSchema.safeParse(parsed.value ?? {});
  if (!v.success) respond(`Invalid generation_status input: ${formatZodError(v.error)}`);
  else {
    log.action({ icon: 'search', label: 'Checked running generations' });
    respond(await generationStatus(sessionId, v.data.check_now ?? true, until));
  }
  return { handled: true, workspace: c.workspace };
          }
          if (call.name === 'find_assets') {
  const v = findAssetsSchema.safeParse(parsed.value ?? {});
  if (!v.success) respond(`Invalid find_assets input: ${formatZodError(v.error)}`);
  else {
    const st = useStore.getState();
    const found = findAssets(session(sessionId), c.workspace, st.assets, st.generations, v.data);
    log.action({ icon: 'search', label: v.data.view ? 'Looked at results' : 'Searched results', detail: [v.data.kind?.join(','), v.data.query, v.data.since].filter(Boolean).join(' · ') || undefined });
    if (!v.data.view || !found.rows.length) respond(found.text);
    else if (!agentSeesImages(sessionId, c.owner)) respond(`${found.text}\n\nNone sent: the agent model the user picked (${agentChoice(sessionId, c.owner).model}) cannot see images, on any canvas. Tell the user exactly that, and that a model with vision (chosen in Settings → Agent) can look; never describe the results.`);
    else {
      const parts: LlmContentPart[] = [];
      for (const t of viewTargets(found.rows, get().assets)) {
        if (!t.show) parts.push({ type: 'text', text: `${t.note}.` });
        else {
          if (t.note !== `asset:${t.show}`) parts.push({ type: 'text', text: `${t.note}:` });
          parts.push(...(await until(attachmentParts([t.show]))));
        }
      }
      const shown = parts.some((p) => p.type === 'image_url');
      respond(`${found.text}\n\n${shown ? `The first ${Math.min(found.rows.length, VIEW_MAX)} follow as images in the next message.` : 'None of them could be shown as an image.'}`);
      if (shown) afterTools.push(userMessage('Results you asked to see:', parts));
    }
  }
  return { handled: true, workspace: c.workspace };
          }
          if (call.name === 'continue_in_designer') {
  const v = continueInDesignerSchema.safeParse(parsed.value ?? {});
  if (!v.success) respond(`Invalid continue_in_designer input: ${formatZodError(v.error)}`);
  else {
    const r = await until(chatToDesigner(sessionId, { assetIds: v.data.asset_ids, as: v.data.as }));
    if (r.docs.length > 0 || !!r.openedExisting) c.workspace = moveToCanvas('designer');
    log.action({ icon: 'guide', label: r.docs.length ? `Sent ${r.docs.reduce((n, d) => n + d.layers, 0)} images to the Designer` : 'Nothing sent to the Designer' });
    const lines = [
      r.docs.length ? `In the Designer now (nothing generated): ${r.docs.map((d) => `design ${d.id} "${d.name}" (${d.layers} raster layer${d.layers === 1 ? '' : 's'})`).join('; ')}.` : r.openedExisting ? `No duplicates added. Chat images are already imported; opened existing design ${r.openedExisting} in the Designer.` : 'No image was sent. Do not claim anything was imported.',
      r.skipped.length ? `Skipped, no such layers yet: ${r.skipped.join(', ')}.` : '',
      r.missing.length ? `Unknown ids: ${r.missing.join(', ')}.` : '',
    ];
    respond(lines.filter(Boolean).join('\n'));
  }
  return { handled: true, workspace: c.workspace };
          }
          if (call.name === 'continue_in_canvas') {
  {
    // From any canvas: the chat's work comes to Nodes and the user's view follows ("pasémonos al canvas").
    const { added } = chatToNodes(sessionId);
    c.workspace = moveToCanvas('nodes');
    log.action({ icon: 'guide', label: added.length ? `Brought ${added.length} chat results to the node canvas` : 'Nothing new from chat' });
    respond(added.length
      ? `Added ${added.length} nodes from the chat (up to date, nothing ran): ${added.map((n) => `${n.id} ${n.data.kind} "${n.data.title}"`).join('; ')}. They are in the node index from now on.`
      : 'Every chat result is already on the node canvas; nothing added. The user\'s view is now the node canvas.');
  }
  return { handled: true, workspace: c.workspace };
          }
          if (call.name === 'continue_in_chat') {
  const v = continueInChatSchema.safeParse(parsed.value ?? {});
  if (!v.success) respond(`Invalid continue_in_chat input: ${formatZodError(v.error)}`);
  else {
    const { added } = nodesToChat(sessionId, v.data.node_ids);
    if (get().ui.workspace !== 'chat') setUi({ workspace: 'chat', panel: null, lightbox: null });
    c.workspace = backToChatCanvas();
    log.action({ icon: 'guide', label: added.length ? `Brought ${added.length} node results to Chat` : 'Nothing new from Nodes' });
    respond(added.length
      ? `Shown in Chat (same generations, selected results, nothing ran): ${added.map((item) => `${item.nodeId} → ${item.generationId} result ${item.outputIndex + 1}`).join('; ')}.`
      : 'No node result was added. The requested results are already in Chat or those nodes have no current file result. The user\'s view is now Chat.');
  }
  return { handled: true, workspace: c.workspace };
          }
          if (call.name === 'open_board') {
  const r = openBoard(parsed.value, session(sessionId).graph, sessionId);
  if (r.canvas) c.workspace = r.canvas;
  if (r.label) log.action({ icon: 'guide', label: r.label });
  respond(r.text);
  return { handled: true, workspace: c.workspace };
          }
          if (call.name === 'read_graph') {
  // Read-only view of the node graph; the agent continues in the next round.
  const v = readGraphSchema.safeParse(parsed.value);
  if (!v.success) respond(`Invalid read_graph input: ${formatZodError(v.error)}`);
  else if (c.workspace !== 'node') respond('read_graph works only on the node canvas.');
  else {
    log.action({ icon: 'search', label: 'Read the node graph', detail: v.data.node_ids?.join(', ') });
    respond(readGraph(session(sessionId).graph, useStore.getState().generations, nodeSelection(sessionId), v.data));
  }
  return { handled: true, workspace: c.workspace };
          }
          if (call.name === 'read_guide') {
  // Loaded on demand from the index in the system prompt; the agent continues in the next round.
  const v = readGuideSchema.safeParse(parsed.value);
  // A workflow made for another canvas is refused with what to do instead (the index marks it too).
  const wrongCanvas = v.success ? guideWorkspaceProblem(v.data.id, c.workspace) : undefined;
  if (wrongCanvas) {
    respond(wrongCanvas);
    return { handled: true, workspace: c.workspace };
  }
  // A video model's prompting guide waits for phase 2: only the confirmed model's comes with the confirmation.
  const early = v.success && c.workspace !== 'node' ? earlyModelGuide(sessionId, c.owner, v.data.id) : undefined;
  if (early) {
    respond(early);
    return { handled: true, workspace: c.workspace };
  }
  // A workflow asks before it loads: the short card (no metric, no "Read the…" action) until answered.
  const card = v.success ? cardInsteadOfGuide(v.data, agentOf(sessionId, c.owner).questionRound, get().composer.agentStyle === 'direct') : undefined;
  if (card) {
    respond(card);
    return { handled: true, workspace: c.workspace };
  }
  const text = v.success ? readGuide(v.data.id) : undefined;
  // Once per conversation: a guide already in the history is not sent again (C4).
  const seen = text != null && inConversation(sessionId, c.owner, text);
  // A video workflow brings the guide of the video model the plan will use, in the same result (no extra round).
  // ... and of the image model for its image steps (sheets, key frames, renders).
  const attach = v.success && text && !seen ? modelGuidesFor(sessionId, c.owner, v.data.id) : '';
  if (v.success && text && !seen) {
    recordMetric(sessionId, { type: 'guide', id: v.data.id });
    log.action({ icon: 'guide', label: `Read the ${guideLabel(v.data.id)}` });
  }
  respond(
    seen
      ? `Guide "${v.data?.id}" is already loaded earlier in this conversation; follow it.`
      : text != null ? text + attach : v.success ? `No guide "${v.data.id}". Use an id from the index.` : `Invalid read_guide input: ${formatZodError(v.error)}`,
  );
  return { handled: true, workspace: c.workspace };
          }
  return { handled: false, workspace: c.workspace };
}
