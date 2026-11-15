import { OPS, OP_IDS } from '../ops';
import { useStore } from '../../store/store';
import type {
  Asset,
  DesignDoc,
  GraphNode,
  GraphNodeData,
  LinkKind,
  ModelAttachMode,
  NodeTypeSpec,
  PortSpec,
  PortType,
  ProviderId,
  RefNodeData,
  SystemNodeType,
} from '../types';

export const SYSTEM_NODE_TYPES: Record<SystemNodeType, NodeTypeSpec> = {
  chat: {
    type: 'chat',
    title: 'Chat',
    ports: [
      { id: 'session', direction: 'in', kind: 'control', type: 'session', multi: false, label: 'Session' },
      { id: 'ref', direction: 'in', kind: 'ref', type: 'any', multi: true, label: 'References' },
      { id: 'in', direction: 'in', kind: 'data', type: 'any', multi: true, label: 'Input' },
      { id: 'agent', direction: 'out', kind: 'control', type: 'control', multi: true, label: 'Agent' },
      { id: 'context', direction: 'out', kind: 'ref', type: 'any', multi: true, label: 'Context' },
      { id: 'out', direction: 'out', kind: 'data', type: 'text', multi: true, label: 'Prompt' },
    ],
    commands: ['nodes.system.ensure', 'nodes.system.link', 'nodes.system.unlink', 'nodes.system.attach_model'],
  },
  agent: {
    type: 'agent',
    title: 'Agent',
    ports: [
      { id: 'chat', direction: 'in', kind: 'control', type: 'control', multi: true, label: 'Controller' },
      { id: 'model', direction: 'in', kind: 'control', type: 'model', multi: true, label: 'Models' },
      { id: 'tools', direction: 'in', kind: 'control', type: 'toolset', multi: true, label: 'Tools' },
      { id: 'ref', direction: 'in', kind: 'ref', type: 'any', multi: true, label: 'References' },
      { id: 'in', direction: 'in', kind: 'data', type: 'any', multi: true, label: 'Input' },
      { id: 'control', direction: 'out', kind: 'control', type: 'control', multi: true, label: 'Control' },
      { id: 'target', direction: 'out', kind: 'ref', type: 'any', multi: true, label: 'Targets' },
      { id: 'out', direction: 'out', kind: 'data', type: 'text', multi: true, label: 'Plan / Prompt' },
    ],
    commands: ['nodes.system.attach_model', 'nodes.system.detach_model', 'nodes.system.link', 'nodes.system.unlink'],
  },
  model: {
    type: 'model',
    title: 'Model',
    ports: [
      { id: 'provider', direction: 'in', kind: 'control', type: 'provider', multi: false, label: 'Provider' },
      { id: 'ref', direction: 'in', kind: 'ref', type: 'any', multi: true, label: 'References' },
      { id: 'in', direction: 'in', kind: 'data', type: 'text', multi: false, label: 'Prompt' },
      { id: 'model', direction: 'out', kind: 'control', type: 'model', multi: true, label: 'Model' },
      { id: 'schema', direction: 'out', kind: 'ref', type: 'any', multi: true, label: 'Schema' },
      { id: 'out', direction: 'out', kind: 'data', type: 'any', multi: true, label: 'Output' },
    ],
    commands: ['nodes.system.attach_model', 'nodes.system.detach_model', 'nodes.system.link', 'nodes.system.unlink'],
  },
  provider: {
    type: 'provider',
    title: 'Provider',
    ports: [
      { id: 'control', direction: 'in', kind: 'control', type: 'control', multi: true, label: 'Control' },
      { id: 'provider', direction: 'out', kind: 'control', type: 'provider', multi: true, label: 'Models' },
      { id: 'ref', direction: 'out', kind: 'ref', type: 'any', multi: true, label: 'Catalog' },
    ],
    commands: ['nodes.system.link', 'nodes.system.unlink'],
  },
  session: {
    type: 'session',
    title: 'Session',
    ports: [
      { id: 'control', direction: 'in', kind: 'control', type: 'control', multi: true, label: 'Control' },
      { id: 'ref', direction: 'in', kind: 'ref', type: 'any', multi: true, label: 'References' },
      { id: 'session', direction: 'out', kind: 'control', type: 'session', multi: true, label: 'Session' },
      { id: 'context', direction: 'out', kind: 'ref', type: 'any', multi: true, label: 'Context' },
    ],
    commands: ['nodes.system.link', 'nodes.system.unlink'],
  },
  space: {
    type: 'space',
    title: 'Space',
    ports: [
      { id: 'control', direction: 'in', kind: 'control', type: 'control', multi: true, label: 'Control' },
      { id: 'ref', direction: 'in', kind: 'ref', type: 'any', multi: true, label: 'References' },
      { id: 'in', direction: 'in', kind: 'data', type: 'any', multi: true, label: 'Assets in' },
      { id: 'out_control', direction: 'out', kind: 'control', type: 'control', multi: true, label: 'Control' },
      { id: 'space', direction: 'out', kind: 'ref', type: 'any', multi: true, label: 'Space' },
      { id: 'out', direction: 'out', kind: 'data', type: 'image', multi: true, label: 'Selected asset' },
    ],
    commands: ['nodes.system.link', 'nodes.system.unlink'],
  },
  'designer.doc': {
    type: 'designer.doc',
    title: 'Designer Doc',
    ports: [
      { id: 'control', direction: 'in', kind: 'control', type: 'control', multi: true, label: 'Control' },
      { id: 'ref', direction: 'in', kind: 'ref', type: 'any', multi: true, label: 'References' },
      { id: 'in', direction: 'in', kind: 'data', type: 'image', multi: true, label: 'Layer input' },
      { id: 'out_control', direction: 'out', kind: 'control', type: 'control', multi: true, label: 'Control' },
      { id: 'doc', direction: 'out', kind: 'ref', type: 'any', multi: true, label: 'Document' },
      { id: 'out', direction: 'out', kind: 'data', type: 'image', multi: true, label: 'Render' },
    ],
    commands: ['nodes.system.link', 'nodes.system.unlink', 'designer.doc.create'],
  },
  library: {
    type: 'library',
    title: 'Library',
    ports: [
      { id: 'control', direction: 'in', kind: 'control', type: 'control', multi: true, label: 'Control' },
      { id: 'in_ref', direction: 'in', kind: 'ref', type: 'any', multi: true, label: 'Subjects in' },
      { id: 'in', direction: 'in', kind: 'data', type: 'image', multi: true, label: 'Save image' },
      { id: 'ref', direction: 'out', kind: 'ref', type: 'any', multi: true, label: 'Subjects' },
      { id: 'out', direction: 'out', kind: 'data', type: 'image', multi: true, label: 'Subject image' },
    ],
    commands: ['nodes.system.link', 'nodes.system.unlink', 'library.subject.save'],
  },
  toolset: {
    type: 'toolset',
    title: 'Tools',
    ports: [
      { id: 'control', direction: 'in', kind: 'control', type: 'control', multi: true, label: 'Control' },
      { id: 'tools', direction: 'out', kind: 'control', type: 'toolset', multi: true, label: 'Tools' },
      { id: 'ref', direction: 'out', kind: 'ref', type: 'any', multi: true, label: 'Catalog' },
    ],
    commands: ['nodes.system.link', 'nodes.system.unlink'],
  },
};

export function systemNodePorts(data: RefNodeData): PortSpec[] {
  return SYSTEM_NODE_TYPES[data.type]?.ports ?? [];
}

export function allNodePorts(
  data: GraphNodeData,
  _assets: Record<string, Asset>,
  creativeIn: Array<{ id: string; type: PortType; label: string; multi: boolean }>,
  creativeOut: PortType | null,
): PortSpec[] {
  if (data.kind === 'ref') return systemNodePorts(data);
  const ports: PortSpec[] = creativeIn.map((p) => ({
    id: p.id,
    direction: 'in',
    kind: 'data',
    type: p.type,
    multi: p.multi,
    label: p.label,
  }));
  if (creativeOut) ports.push({ id: 'out', direction: 'out', kind: 'data', type: creativeOut, multi: true, label: 'Output' });
  ports.push(
    { id: 'sys_ref', direction: 'in', kind: 'ref', type: 'any', multi: true, label: 'References' },
    { id: 'out_ref', direction: 'out', kind: 'ref', type: 'any', multi: true, label: 'Reference' },
    { id: 'model', direction: 'in', kind: 'control', type: 'model', multi: false, label: 'Model' },
    { id: 'control', direction: 'in', kind: 'control', type: 'control', multi: true, label: 'Control' },
    { id: 'out_control', direction: 'out', kind: 'control', type: 'control', multi: true, label: 'Control' },
  );
  return ports;
}

export function portTypeCompatible(kind: LinkKind, outType: string, inType: string): boolean {
  if (outType === 'any' || inType === 'any' || outType === inType) return true;
  if (kind === 'data') return outType === 'model3d' && inType === 'image';
  if (kind === 'control') return outType === 'control' || inType === 'control';
  if (kind === 'ref') return outType === 'ref' || inType === 'ref';
  return false;
}

export function resolveSystemConnection(
  srcPorts: PortSpec[],
  tgtPorts: PortSpec[],
  c: { sourceHandle?: string | null; targetHandle?: string | null; kind?: LinkKind },
): { srcPort?: PortSpec; tgtPort?: PortSpec; kind?: LinkKind; classMismatch?: string } {
  const outs = srcPorts.filter((p) => p.direction === 'out');
  const ins = tgtPorts.filter((p) => p.direction === 'in');
  const rawSrcId = c.sourceHandle && /^out-\d+$/.test(c.sourceHandle) ? 'out' : c.sourceHandle;
  const explicitSrc = rawSrcId ? outs.find((p) => p.id === rawSrcId) : undefined;
  const explicitTgt = c.targetHandle ? ins.find((p) => p.id === c.targetHandle) : undefined;

  if (explicitSrc && explicitTgt && explicitSrc.kind !== explicitTgt.kind) {
    return { srcPort: explicitSrc, tgtPort: explicitTgt, classMismatch: `Link class mismatch: cannot connect ${explicitSrc.kind} port to ${explicitTgt.kind} port.` };
  }
  if (c.kind && explicitTgt && explicitTgt.kind !== c.kind && c.targetHandle !== c.kind) {
    return { srcPort: explicitSrc, tgtPort: explicitTgt, classMismatch: `Link class mismatch: port "${explicitTgt.id}" is ${explicitTgt.kind}, not ${c.kind}.` };
  }
  if (c.kind && explicitSrc && explicitSrc.kind !== c.kind && rawSrcId !== c.kind) {
    return { srcPort: explicitSrc, tgtPort: explicitTgt, classMismatch: `Link class mismatch: port "${explicitSrc.id}" is ${explicitSrc.kind}, not ${c.kind}.` };
  }

  const desiredKind: LinkKind | undefined = c.kind ?? explicitTgt?.kind ?? explicitSrc?.kind;
  let tgtPort = explicitTgt && (!desiredKind || explicitTgt.kind === desiredKind) ? explicitTgt : undefined;
  if (!tgtPort && desiredKind && (!c.targetHandle || c.targetHandle === desiredKind)) {
    const kindIns = ins.filter((p) => p.kind === desiredKind);
    const kindOuts = outs.filter((p) => p.kind === desiredKind);
    tgtPort = kindIns.find((inp) => kindOuts.some((outp) => portTypeCompatible(desiredKind, outp.type, inp.type))) ?? kindIns[0];
  }
  const resolvedKind = desiredKind ?? tgtPort?.kind;
  let srcPort = explicitSrc && (!resolvedKind || explicitSrc.kind === resolvedKind) ? explicitSrc : undefined;
  if (!srcPort && resolvedKind && (!rawSrcId || rawSrcId === resolvedKind || rawSrcId === 'out')) {
    const kindOuts = outs.filter((p) => p.kind === resolvedKind);
    srcPort = tgtPort ? kindOuts.find((outp) => portTypeCompatible(resolvedKind, outp.type, tgtPort!.type)) ?? kindOuts[0] : kindOuts[0];
  }
  return { srcPort, tgtPort, kind: resolvedKind };
}

export function modelLabelForRef(ref: string): string {
  const st = useStore.getState();
  if (!ref) return 'Offline Planner';
  const catalogModel = st.catalog.models[ref];
  if (catalogModel) return catalogModel.name;
  for (const list of Object.values(st.catalog.llm)) {
    const found = list?.find((m) => m.id === ref);
    if (found) return found.name;
  }
  if (ref.startsWith('local::')) return ref.includes('video') ? 'Local Motion' : 'Local Sketch';
  const parts = ref.split(/[:/]/).filter(Boolean);
  return parts[parts.length - 1] ?? ref;
}

export interface LiveSystemSummary {
  type: SystemNodeType;
  ref: string;
  title: string;
  subtitle: string;
  badge?: string;
  chips: string[];
  details: string[];
  attachedModels?: Array<{ nodeId: string; ref: string; title: string; mode: ModelAttachMode; mediaKind?: string }>;
  doc?: DesignDoc;
}

/** Resolve live data from the store without copying or migrating anything. */
export function resolveSystemNodeLive(sessionId: string, node: GraphNode): LiveSystemSummary | null {
  if (node.data.kind !== 'ref') return null;
  const d = node.data;
  const st = useStore.getState();
  const session = st.sessions[sessionId];
  const graph = session?.graph;

  switch (d.type) {
    case 'chat': {
      const targetSession = st.sessions[d.ref] ?? session;
      const feed = targetSession?.feed ?? [];
      const userCount = feed.filter((f) => f.type === 'user').length;
      const genCount = feed.filter((f) => f.type === 'generation').length;
      const lastMsg = [...feed].reverse().find((f) => f.type === 'user' || f.type === 'assistant');
      const preview = lastMsg && 'text' in lastMsg ? lastMsg.text.slice(0, 90) : 'Conversation ready';
      return {
        type: 'chat',
        ref: targetSession?.id ?? d.ref,
        title: d.title || 'Chat',
        subtitle: `${feed.length} items · ${userCount} turns`,
        badge: st.ui.workspace === 'chat' ? 'Active' : 'Live',
        chips: [`${userCount} messages`, `${genCount} results`, ...(d.mergedModels ?? []).map((m) => modelLabelForRef(m))],
        details: [preview],
      };
    }
    case 'agent': {
      const targetSession = st.sessions[d.ref] ?? session;
      const ag = targetSession?.agent;
      const llmRef = st.settings.agent.provider === 'offline' ? 'offline' : st.settings.agent.model || 'offline';
      const attached: NonNullable<LiveSystemSummary['attachedModels']> = [];
      if (graph) {
        for (const edge of graph.edges) {
          if ((edge.kind ?? 'data') !== 'control') continue;
          const otherId = edge.target === node.id ? edge.source : edge.source === node.id ? edge.target : null;
          if (!otherId) continue;
          const other = graph.nodes.find((n) => n.id === otherId);
          if (other?.data.kind === 'ref' && other.data.type === 'model') {
            attached.push({
              nodeId: other.id,
              ref: other.data.ref,
              title: other.data.title || modelLabelForRef(other.data.ref),
              mode: other.data.attachMode ?? 'wired',
              mediaKind: other.data.mediaKind,
            });
          }
        }
      }
      for (const mRef of d.mergedModels ?? []) {
        if (!attached.some((a) => a.ref === mRef && a.mode === 'merged')) {
          attached.push({ nodeId: node.id, ref: mRef, title: modelLabelForRef(mRef), mode: 'merged' });
        }
      }
      return {
        type: 'agent',
        ref: targetSession?.id ?? d.ref,
        title: d.title || 'Agent',
        subtitle: ag?.busy ? `Working (${ag.phase ?? 'working'})` : `Style: ${st.composer.agentStyle}`,
        badge: ag?.busy ? 'Busy' : st.settings.agent.provider,
        chips: [
          `Director: ${modelLabelForRef(llmRef)}`,
          `Mode: ${st.composer.mode}`,
          ...(st.composer.skillId ? [`Skill: ${st.composer.skillId}`] : []),
        ],
        details: [`${ag?.history.length ?? 0} turns in memory · ${attached.length} model(s) attached`],
        attachedModels: attached,
      };
    }
    case 'model': {
      const cat = st.catalog.models[d.ref];
      const provider = cat?.provider ?? (d.ref.includes('::') ? d.ref.split('::')[0] : st.settings.agent.provider);
      const kind = d.mediaKind ?? cat?.kind ?? 'llm';
      const mode = d.attachMode ?? 'wired';
      return {
        type: 'model',
        ref: d.ref,
        title: d.title || modelLabelForRef(d.ref),
        subtitle: `${provider} · ${kind}`,
        badge: mode,
        chips: [`Kind: ${kind}`, `Attach: ${mode}`],
        details: [d.ref || 'offline'],
      };
    }
    case 'provider': {
      const pid = (d.ref || 'openrouter') as ProviderId;
      const status = st.catalog.status[pid] ?? 'idle';
      const count = Object.values(st.catalog.models).filter((m) => m.provider === pid).length;
      return {
        type: 'provider',
        ref: pid,
        title: d.title || pid,
        subtitle: `Status: ${status}`,
        badge: status,
        chips: [`${count} models`],
        details: [`Provider ${pid}`],
      };
    }
    case 'designer.doc': {
      const docs = session?.docs ?? [];
      const doc = docs.find((x) => x.id === d.ref) ?? docs.find((x) => x.id === session?.activeDocId) ?? docs[0];
      const isActive = Boolean(doc && session?.activeDocId === doc.id);
      return {
        type: 'designer.doc',
        ref: doc?.id ?? d.ref,
        title: doc?.name || d.title || 'Designer Doc',
        subtitle: doc ? `${doc.width} × ${doc.height} px · ${doc.layers.length} layer(s)` : 'No layers yet (points to active doc)',
        badge: isActive ? 'Active' : 'Doc',
        chips: doc ? [`${doc.layers.length} layers`, `${doc.width}×${doc.height}`] : ['Empty canvas'],
        details: doc ? doc.layers.slice(0, 3).map((l) => `${l.type}: ${l.name}`) : ['Ready for Designer layers'],
        doc,
      };
    }
    case 'space': {
      const spaceId = d.ref || 'create';
      const isActive = st.ui.space === spaceId;
      const spaceSession = Object.values(st.sessions).find((s) => s.hidden);
      const assetCount = Object.values(st.assets).filter((a) => a.sessionId === sessionId || (spaceSession && a.sessionId === spaceSession.id)).length;
      return {
        type: 'space',
        ref: spaceId,
        title: d.title || (spaceId === 'tools' ? 'Tools Space' : 'Create Space'),
        subtitle: spaceId === 'tools' ? `Operation: ${st.ui.toolOp ?? 'relight'}` : 'Quick generation board',
        badge: isActive ? 'Open' : 'Space',
        chips: [`Space: ${spaceId}`, `${assetCount} assets`],
        details: [spaceId === 'tools' ? 'Direct asset transformations' : 'Panel + Board workspace'],
      };
    }
    case 'session': {
      const s = st.sessions[d.ref] ?? session;
      return {
        type: 'session',
        ref: s?.id ?? d.ref,
        title: s?.title || d.title || 'Session',
        subtitle: `${s?.feed.length ?? 0} feed · ${s?.docs.length ?? 0} docs`,
        badge: st.activeSessionId === s?.id ? 'Current' : 'Session',
        chips: [`${s?.docs.length ?? 0} docs`, `${s?.graph.nodes.length ?? 0} nodes`],
        details: [s?.title ?? 'Untitled session'],
      };
    }
    case 'library': {
      const subjects = [...st.library, ...(session?.subjects ?? [])];
      return {
        type: 'library',
        ref: d.ref || 'library',
        title: d.title || 'Library',
        subtitle: `${subjects.length} subject(s)`,
        badge: 'Shared',
        chips: subjects.slice(0, 3).map((s) => `@${s.name}`),
        details: [subjects.length ? subjects.map((s) => s.name).join(', ') : 'Characters, objects & styles'],
      };
    }
    case 'toolset':
      return {
        type: 'toolset',
        ref: d.ref || 'toolset',
        title: d.title || 'Tools',
        subtitle: `${OP_IDS.length} operations available`,
        badge: 'Catalog',
        chips: OP_IDS.slice(0, 3).map((id) => OPS[id].label),
        details: ['Relight, Upscale, Remove BG, Reframe, Animate…'],
      };
  }
}
