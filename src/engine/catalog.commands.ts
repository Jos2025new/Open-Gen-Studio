import { z } from 'zod';
import { defineCommand } from './commands/types';
import { useStore } from '../store/store';
import * as C from './catalog';

const kind = z.enum(['image', 'video', 'audio', 'model3d']);
const ref = z.string().min(1);
const modelAvailable = (value?: string) => !value || C.modelSummary(value) ? true : `No model "${value}".`;
export const commands = [
  defineCommand({ id: 'models.kind.list', title: 'List models of a kind', args: z.object({ kind }).strict(), effect: 'read', run: (_ctx, args) => C.modelsOf(args.kind) }),
  defineCommand({ id: 'models.model.get', title: 'Read model summary', args: z.object({ ref }).strict(), effect: 'read', available: (_ctx, args) => modelAvailable(args?.ref), run: (_ctx, args) => { const model = C.modelSummary(args.ref); if (!model) throw new Error('Model not found.'); return model; } }),
  defineCommand({ id: 'models.catalog.load', title: 'Load model catalogs', args: z.object({ force: z.boolean().optional(), preferRemote: z.boolean().optional() }).strict(), effect: 'write', debt: 'Loading catalogs can change the composer models on screen.', run: async (_ctx, args) => { await C.loadCatalogs(args); return { loaded: true }; } }),
  defineCommand({ id: 'models.composer.pick', title: 'Pick composer model', args: z.object({ kind, ref }).strict(), effect: 'write', needs: ['session'], debt: 'Changes the composer on screen and the action reads the active session to remember the choice.', available: (ctx, args) => { const st = useStore.getState(); if (!ctx.on.session || !st.sessions[ctx.on.session]) return `No session "${ctx.on.session}".`; if (st.activeSessionId !== ctx.on.session) return 'The composer belongs to the active session.'; const model = args?.ref && C.modelSummary(args.ref); return args?.ref && (!model || (args.kind && model.kind !== args.kind)) ? `No matching model "${args.ref}".` : true; }, run: async (_ctx, args) => { await C.pickComposerModel(args.kind, args.ref); return { kind: args.kind, ref: args.ref }; } }),
  defineCommand({ id: 'models.composer.reset', title: 'Reset composer model', args: z.object({ kind }).strict(), effect: 'write', debt: 'Changes the composer on screen.', run: async (_ctx, args) => { await C.resetComposerModel(args.kind); return { kind: args.kind, ref: useStore.getState().composer[args.kind].modelRef }; } }),
  defineCommand({ id: 'models.agent.pick', title: 'Pick agent model', args: z.object({ model: ref }).strict(), effect: 'write', run: (_ctx, args) => { C.pickAgentModel(args.model); return { model: args.model }; } }),
  defineCommand({ id: 'models.agent.reset', title: 'Reset agent model', args: z.object({}).strict(), effect: 'write', run: async () => { await C.resetAgentModel(); return { model: useStore.getState().settings.agent.model }; } }),
];
export const CATALOG_ACTIONS = {
  isConnected: '- provider helper', connectedProviders: '- provider helper', apiKeyFor: '- returns a secret',
  loadCatalogs: 'models.catalog.load', loadLlmCatalog: '- internal catalog helper', repickAgentModel: '- internal selection helper',
  pickAgentModel: 'models.agent.pick', resetAgentModel: 'models.agent.reset', modelSummary: 'models.model.get',
  ensureSchema: '- internal schema loading helper', resolveModel: '- internal model resolution helper', modelsOf: 'models.kind.list',
  preferredModel: '- internal selection helper', ensureComposerModels: '- internal selection helper', pickComposerModel: 'models.composer.pick',
  fillVideoRoutes: '- internal selection helper', pickImageEditModel: '- internal selection helper', resetComposerModel: 'models.composer.reset',
  composerChosen: '- internal selection helper', selectComposerModel: '- internal selection helper', defaultModelFor: '- internal routing helper',
  defaultModelChoice: '- internal routing helper', transcriberFor: '- internal routing helper', opFollowsSource: '- internal routing helper',
  opModelFromRef: '- internal routing helper', inputVariant: '- internal routing helper', sentModelRef: '- internal routing helper',
  variantLine: '- internal routing helper', lineRoutes: '- internal routing helper', opModelForAsset: '- internal routing helper',
  videoOpFits: '- internal routing helper', isVideoUpscaler: '- internal routing helper', opModelFor: '- internal routing helper',
} as const;
