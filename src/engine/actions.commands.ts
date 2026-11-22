import { z } from 'zod';
import { defineCommand } from './commands/types';
import { useStore } from '../store/store';
import { estimateOp } from './costs';
import { opChoice, opSpecForModel } from './opSpec';
import { OP_IDS, OPS } from './ops';
import { MEDIA_KINDS, type AdvancedValue, type OpId } from './types';
import * as A from './actions';

function estimateStudioOp(
  opId: OpId,
  opParams: Record<string, AdvancedValue>,
  opts: { sourceAssetId?: string; sourceDims?: { width: number; height: number }; modelRef?: string; origin: 'op' | 'designer'; sessionId?: string },
) {
  const st = useStore.getState();
  const engine = OPS[opId].engine;
  const src = opts.sourceAssetId ? st.assets[opts.sourceAssetId] : opts.sourceDims;
  if (['local', 'transcribe', 'voice'].includes(engine)) return estimateOp(opId, opParams, src, st.composer.video.settings, opts.modelRef);
  const choice = opChoice({ op: opId, params: opParams, sourceAssetId: opts.sourceAssetId ?? '', modelRef: opts.modelRef });
  if (!choice.ref) return estimateOp(opId, opParams, src, st.composer.video.settings, opts.modelRef);
  const spec = opSpecForModel(
    { sessionId: opts.sessionId ?? '', origin: opts.origin, op: opId, params: opParams, sourceAssetId: opts.sourceAssetId ?? '', sourceDims: opts.sourceDims, modelRef: opts.modelRef },
    choice.ref,
    choice.viaEdit,
    st.catalog.schemas[choice.ref],
  );
  return spec.estimate ?? estimateOp(opId, opParams, src, spec.settings, choice.ref);
}

const id = z.string().min(1);
const kind = z.enum(MEDIA_KINDS);
const mode = z.enum([...MEDIA_KINDS, 'agent']);
const op = z.enum(OP_IDS as [OpId, ...OpId[]]);
const params = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
const estimate = z.object({ usd: z.number().nullable(), approximate: z.boolean(), lowerBound: z.boolean().optional(), note: z.string().optional(), exact: z.boolean().optional() }).strict();
const point = z.object({ x: z.number(), y: z.number() }).strict();
const session = (ctx: { on: { session?: string } }) => useStore.getState().sessions[ctx.on.session!] ? true : `No session "${ctx.on.session}".`;
/** For the commands whose action works on the session on screen: any other session is refused, never swapped silently. */
const onScreen = (ctx: { on: { session?: string } }) => {
  const known = session(ctx);
  if (known !== true) return known;
  return useStore.getState().activeSessionId === ctx.on.session ? true : `Session "${ctx.on.session}" is not on screen; this command acts on the one on screen.`;
};
const asset = (id?: string) => !id || useStore.getState().assets[id] ? true : `No asset "${id}".`;
const generation = (id?: string) => !id || useStore.getState().generations[id] ? true : `No generation "${id}".`;
const layer = (ctx: { on: { session?: string } }, args?: { docId?: string; layerId?: string }) => {
  const doc = useStore.getState().sessions[ctx.on.session!]?.docs.find((d) => d.id === args?.docId);
  if (args?.docId && !doc) return `No document "${args.docId}".`;
  if (args?.layerId && !doc?.layers.some((l) => l.id === args.layerId)) return `No layer "${args.layerId}".`;
  return true;
};

export const commands = [
  defineCommand({
    id: 'studio.budget.problem',
    title: 'Check budget',
    description: 'Check budget.',
    args: z.object({ estimate }).strict(),
    effect: 'read',
    needs: ['session'],
    available: (ctx) => session(ctx),
    run: ({ on, budgetPass }, args) => { const problem = A.budgetProblem(args.estimate, on.session, budgetPass); if (problem) throw new Error(problem); },
  }),
  defineCommand({
    id: 'studio.direct.check',
    title: 'Check direct generation',
    description: 'Check direct generation.',
    args: z.object({ kind }).strict(),
    effect: 'read',
    needs: ['session'],
    available: (ctx) => onScreen(ctx),
    debt: 'Reads the composer and the active session and workspace.',
    run: (_ctx, args) => { const result = A.checkDirect(args.kind); if (!result.ok) throw new Error(result.reason ?? "Cannot generate yet."); return result; },
  }),
  defineCommand({
    id: 'studio.generation.estimate',
    title: 'Estimate regeneration',
    description: 'Estimate regeneration.',
    args: z.object({ generationId: id }).strict(),
    effect: 'read',
    needs: ['session'],
    available: (ctx, args) => session(ctx) !== true ? session(ctx) : generation(args?.generationId),
    run: (_ctx, args) => { const result = A.regenerateEstimate(args.generationId); if (!result) throw new Error("Generation estimate unavailable."); return result; },
  }),
  defineCommand({
    id: 'studio.asset.estimate',
    title: 'Estimate asset operation',
    description: 'Estimate asset operation.',
    args: z.object({ assetId: id, op, params, modelRef: id.optional() }).strict(),
    effect: 'write',
    needs: ['session'],
    available: (ctx, args) => onScreen(ctx) !== true ? onScreen(ctx) : asset(args?.assetId),
    debt: 'Reads the active session and may fetch and cache provider schemas.',
    run: (_ctx, args) => { return A.opEstimate(args.assetId, args.op, args.params, args.modelRef); },
  }),
  defineCommand({
    id: 'studio.layer.estimate',
    title: 'Estimate layer operation',
    description: 'Estimate layer operation.',
    args: z.object({ docId: id, layerId: id, op, params }).strict(),
    effect: 'write',
    needs: ['session'],
    available: (ctx, args) => session(ctx) !== true ? session(ctx) : layer(ctx, args),
    debt: 'May fetch and cache provider schemas while estimating.',
    run: ({ on }, args) => { return A.layerOpEstimate(on.session!, args.docId, args.layerId, args.op, args.params); },
  }),
  defineCommand({
    id: 'studio.schema.ready',
    title: 'Check model schema',
    description: 'Check model schema.',
    args: z.object({ ref: id }).strict(),
    effect: 'read',
    needs: ['session'],
    available: (ctx) => session(ctx),
    run: (_ctx, args) => { if (!A.schemaReady(args.ref)) throw new Error("Model schema is not ready."); return true; },
  }),
  defineCommand({
    id: 'studio.images.accepts',
    title: 'Check image inputs',
    description: 'Check image inputs.',
    args: z.object({ kind }).strict(),
    effect: 'read',
    needs: ['session'],
    available: (ctx) => session(ctx),
    debt: 'Reads the composer model for the requested kind.',
    run: (_ctx, args) => { return A.acceptsImages(args.kind); },
  }),
  defineCommand({
    id: 'studio.param.has',
    title: 'Check model parameter',
    description: 'Check model parameter.',
    args: z.object({ kind, role: z.enum(['aspect', 'resolution', 'duration', 'count', 'audio', 'seed', 'negative', 'other']) }).strict(),
    effect: 'read',
    needs: ['session'],
    available: (ctx) => session(ctx),
    debt: 'Reads the composer model for the requested kind.',
    run: (_ctx, args) => { if (!A.hasParam(args.kind, args.role)) throw new Error("Model parameter is unavailable."); return true; },
  }),
  defineCommand({
    id: 'studio.lyrics.apply',
    title: 'Apply lyrics',
    description: 'Apply lyrics.',
    args: z.object({ text: z.string() }).strict(),
    effect: 'write',
    needs: ['session'],
    available: (ctx) => session(ctx),
    debt: 'Reads and changes the composer; the action reports some failures only as notices.',
    run: async (_ctx, args) => { await A.applyLyrics(args.text); },
  }),
  defineCommand({
    id: 'studio.generation.edit',
    title: 'Edit generation in composer',
    description: 'Edit generation in composer.',
    args: z.object({ generationId: id }).strict(),
    effect: 'write',
    needs: ['session'],
    available: (ctx, args) => session(ctx) !== true ? session(ctx) : generation(args?.generationId),
    debt: 'Reads and changes the composer; unsupported generations only produce a notice.',
    run: async (_ctx, args) => { await A.editInComposer(args.generationId); },
  }),
  defineCommand({
    id: 'studio.asset.favorite',
    title: 'Toggle favorite',
    description: 'Toggle favorite.',
    args: z.object({ assetId: id }).strict(),
    effect: 'write',
    needs: ['session'],
    available: (ctx, args) => session(ctx) !== true ? session(ctx) : asset(args?.assetId),
    run: (_ctx, args) => { A.toggleFavorite(args.assetId); },
  }),
  defineCommand({
    id: 'studio.asset.reference',
    title: 'Use asset as reference',
    description: 'Use asset as reference.',
    args: z.object({ assetId: id }).strict(),
    effect: 'write',
    needs: ['session'],
    available: (ctx, args) => session(ctx) !== true ? session(ctx) : asset(args?.assetId),
    debt: 'Changes the composer and screen; missing model views only produce a notice.',
    run: (_ctx, args) => { A.addAsReference(args.assetId); },
  }),
  defineCommand({
    id: 'studio.asset.attach',
    title: 'Toggle agent attachment',
    description: 'Toggle agent attachment.',
    args: z.object({ assetId: id }).strict(),
    effect: 'write',
    needs: ['session'],
    available: (ctx, args) => session(ctx) !== true ? session(ctx) : asset(args?.assetId),
    debt: 'Changes the composer attachment list.',
    run: (_ctx, args) => { const a = useStore.getState().assets[args.assetId]; if (!A.AGENT_ATTACHABLE.includes(a.kind)) throw new Error("This asset cannot be attached."); A.toggleAgentAttachment(args.assetId); },
  }),
  defineCommand({
    id: 'studio.node.add_asset',
    title: 'Add asset node',
    description: 'Add asset node.',
    args: z.object({ assetId: id, position: point.optional() }).strict(),
    effect: 'write',
    needs: ['session'],
    available: (ctx, args) => session(ctx) !== true ? session(ctx) : asset(args?.assetId),
    run: ({ on }, args) => { A.addAssetNode(on.session!, args.assetId, args.position); },
  }),
  defineCommand({
    id: 'studio.node.send_asset',
    title: 'Send asset to nodes',
    description: 'Send asset to nodes.',
    args: z.object({ assetId: id }).strict(),
    effect: 'write',
    needs: ['session'],
    available: (ctx, args) => onScreen(ctx) !== true ? onScreen(ctx) : asset(args?.assetId),
    debt: 'Reads the active session and changes the screen.',
    run: (_ctx, args) => { A.sendToNodes(args.assetId); },
  }),
  defineCommand({
    id: 'studio.model.prepare',
    title: 'Prepare model',
    description: 'Prepare model.',
    args: z.object({ ref: id }).strict(),
    effect: 'write',
    needs: ['session'],
    available: (ctx) => session(ctx),
    debt: 'May fetch a provider schema and change the catalog.',
    run: async (_ctx, args) => { await A.prepareModel(args.ref); },
  }),
  defineCommand({
    id: 'studio.generate.start',
    title: 'Start generation',
    description: 'Start generation.',
    args: z.object({ kind }).strict(),
    effect: 'spend',
    needs: ['session'],
    available: (ctx) => onScreen(ctx),
    estimate: (_ctx, args) => A.checkDirect(args.kind).estimate,
    debt: 'Reads the active session, composer and screen; the action reports some failures only as notices.',
    run: async ({ on, budgetPass }, args) => { const check = A.checkDirect(args.kind); if (!check.ok) throw new Error(check.reason ?? "Cannot generate yet."); const problem = A.budgetProblem(check.estimate, on.session, budgetPass); if (problem) throw new Error(problem); await A.generateDirect(args.kind, budgetPass); },
  }),
  defineCommand({
    id: 'studio.generation.regenerate',
    title: 'Regenerate',
    description: 'Regenerate.',
    args: z.object({ generationId: id }).strict(),
    effect: 'spend',
    needs: ['session'],
    available: (ctx, args) => session(ctx) !== true ? session(ctx) : generation(args?.generationId),
    estimate: (_ctx, args) => A.regenerateEstimate(args.generationId) ?? useStore.getState().generations[args.generationId]?.estimate ?? { usd: null, approximate: true },
    debt: 'The action reports some failures only as notices.',
    run: async ({ budgetPass }, args) => { const e = A.regenerateEstimate(args.generationId); if (!e) throw new Error("Generation estimate unavailable."); const problem = A.budgetProblem(e, useStore.getState().generations[args.generationId].sessionId, budgetPass); if (problem) throw new Error(problem); await A.regenerate(args.generationId, budgetPass); },
  }),
  defineCommand({
    id: 'studio.asset.run_op',
    title: 'Run asset operation',
    description: 'Run asset operation.',
    args: z.object({ assetId: id, op, params, parentId: id.optional(), modelRef: id.optional(), place: z.enum(['studio', 'canvas', 'designer', 'space-create', 'space-tools']).optional(), mode: mode.optional() }).strict(),
    effect: 'spend',
    needs: ['session'],
    available: (ctx, args) => onScreen(ctx) !== true ? onScreen(ctx) : asset(args?.assetId),
    estimate: ({ on }, args) => estimateStudioOp(args.op, args.params, { sourceAssetId: args.assetId, modelRef: args.modelRef, origin: 'op', sessionId: on.session }),
    debt: 'Reads the active session and screen; failures can be reported only as notices.',
    run: async ({ on, budgetPass }, args) => { const e = estimateStudioOp(args.op, args.params, { sourceAssetId: args.assetId, modelRef: args.modelRef, origin: 'op', sessionId: on.session }); const problem = A.budgetProblem(e, on.session, budgetPass); if (problem) throw new Error(problem); const result = await A.runAssetOp(args.assetId, args.op, args.params, args.parentId, args.modelRef, args.place, args.mode, budgetPass); if (!result.length) throw new Error("Asset operation did not produce a result."); return result; },
  }),
  defineCommand({
    id: 'studio.layer.run_op',
    title: 'Run layer operation',
    description: 'Run layer operation.',
    args: z.object({ docId: id, layerId: id, op, params }).strict(),
    effect: 'spend',
    needs: ['session'],
    available: (ctx, args) => session(ctx) !== true ? session(ctx) : layer(ctx, args),
    estimate: ({ on }, args) => { const st = useStore.getState(); const l = st.sessions[on.session!]?.docs.find((d) => d.id === args.docId)?.layers.find((x) => x.id === args.layerId); return estimateStudioOp(args.op, args.params, { sourceDims: l?.type === 'raster' ? { width: l.pxWidth, height: l.pxHeight } : undefined, origin: 'designer', sessionId: on.session }); },
    debt: 'The action catches failures and reports them only as notices.',
    run: async ({ on, budgetPass }, args) => { const st = useStore.getState(); const l = st.sessions[on.session!]?.docs.find((d) => d.id === args.docId)?.layers.find((x) => x.id === args.layerId); const e = estimateStudioOp(args.op, args.params, { sourceDims: l?.type === 'raster' ? { width: l.pxWidth, height: l.pxHeight } : undefined, origin: 'designer', sessionId: on.session }); const problem = A.budgetProblem(e, on.session, budgetPass); if (problem) throw new Error(problem); await A.runLayerOp(on.session!, args.docId, args.layerId, args.op, args.params, budgetPass); },
  }),
  defineCommand({
    id: 'studio.generation.delete',
    title: 'Delete generation',
    description: 'Delete generation.',
    args: z.object({ generationId: id }).strict(),
    effect: 'delete',
    needs: ['session'],
    available: (ctx, args) => session(ctx) !== true ? session(ctx) : generation(args?.generationId),
    run: (_ctx, args) => { A.deleteGeneration(args.generationId); },
  }),
  defineCommand({
    id: 'studio.assets.delete',
    title: 'Delete assets',
    description: 'Delete assets.',
    args: z.object({ ids: z.array(id).min(1) }).strict(),
    effect: 'delete',
    needs: ['session'],
    available: (ctx, args) => session(ctx) !== true ? session(ctx) : args?.ids?.map(asset).find((v) => v !== true) ?? true,
    debt: 'The action reports assets in use only as a notice.',
    run: (_ctx, args) => { A.deleteAssets(args.ids); },
  }),
  defineCommand({
    id: 'studio.session.delete',
    title: 'Delete session',
    description: 'Delete session.',
    args: z.object({  }).strict(),
    effect: 'delete',
    needs: ['session'],
    available: (ctx) => session(ctx),
    debt: 'May change the session on screen when deleting a session.',
    run: ({ on }) => { A.deleteSession(on.session!); },
  }),
];

export const STUDIO_ACTIONS: Record<string, string> = {
  budgetProblem: 'studio.budget.problem',
  checkDirect: 'studio.direct.check',
  regenerateEstimate: 'studio.generation.estimate',
  opEstimate: 'studio.asset.estimate',
  layerOpEstimate: 'studio.layer.estimate',
  schemaReady: 'studio.schema.ready',
  acceptsImages: 'studio.images.accepts',
  hasParam: 'studio.param.has',
  applyLyrics: 'studio.lyrics.apply',
  editInComposer: 'studio.generation.edit',
  toggleFavorite: 'studio.asset.favorite',
  addAsReference: 'studio.asset.reference',
  toggleAgentAttachment: 'studio.asset.attach',
  addAssetNode: 'studio.node.add_asset',
  sendToNodes: 'studio.node.send_asset',
  prepareModel: 'studio.model.prepare',
  generateDirect: 'studio.generate.start',
  regenerate: 'studio.generation.regenerate',
  runAssetOp: 'studio.asset.run_op',
  runLayerOp: 'studio.layer.run_op',
  deleteGeneration: 'studio.generation.delete',
  deleteAssets: 'studio.assets.delete',
  deleteSession: 'studio.session.delete',
  saveSubject: '- library: wrapped in library.commands.ts',
  deleteSubject: '- library: wrapped in library.commands.ts',
  libraryItem: '- library: wrapped in library.commands.ts',
  subjectFromAsset: '- library: wrapped in library.commands.ts',
  saveSheetViews: '- library: wrapped in library.commands.ts',
  subjectFromAttachments: '- library: wrapped in library.commands.ts',
  createRecraftStyle: '- library: wrapped in library.commands.ts',
  createSubjectVoice: '- library: wrapped in library.commands.ts',
  uploadFiles: '- takes File objects from the browser',
  attachFiles: '- takes File objects from the browser',
  copyText: '- writes to the browser clipboard',
  downloadAsset: '- initiates a browser download',
};
