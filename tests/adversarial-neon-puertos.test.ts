import { ReactFlowProvider } from '@xyflow/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(globalThis, {
    window: { setTimeout, clearTimeout, addEventListener: () => undefined },
    document: { addEventListener: () => undefined, visibilityState: 'visible' },
  });
});

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { LinkHandles } from '../src/components/node/SystemNode';
import { run } from '../src/engine/commands';
import { connectNodes, tryConnect } from '../src/engine/flow/actions';
import { cablePortProblem, inputPorts, nodePorts, outputPort } from '../src/engine/flow/graph';
import { allNodePorts, CREATIVE_LINK_PORTS, resolveSystemConnection } from '../src/engine/nodes/spec';
import { ensureSystemNodes } from '../src/engine/nodes/system';
import { createSession, setGraph, useStore } from '../src/store/store';
import type { GraphEdge, GraphNode, GraphNodeData, LinkKind, PortSpec } from '../src/engine/types';

const settings = { count: 1, advanced: {} };

const imgNode = (id: string): GraphNode => ({
  id,
  position: { x: 0, y: 0 },
  data: { kind: 'image', title: id, prompt: '', modelRef: 'local::studio-image', settings, outputIndex: 0 },
});

const vidNode = (id: string): GraphNode => ({
  id,
  position: { x: 200, y: 0 },
  data: { kind: 'video', title: id, prompt: '', modelRef: 'local::studio-video', settings, outputIndex: 0 },
});

const modelNode = (id: string, ref = 'local::studio-image'): GraphNode => ({
  id,
  position: { x: -200, y: 0 },
  data: { kind: 'ref', type: 'model', ref, title: id, mediaKind: 'image', attachMode: 'wired' },
});

const agentNode = (id: string, sessionId: string): GraphNode => ({
  id,
  position: { x: -200, y: 200 },
  data: { kind: 'ref', type: 'agent', ref: sessionId, title: id },
});

const providerNode = (id: string): GraphNode => ({
  id,
  position: { x: -400, y: 0 },
  data: { kind: 'ref', type: 'provider', ref: 'openrouter', title: id },
});

const EXPECTED_CREATIVE_LINK_PORTS: PortSpec[] = [
  { id: 'sys_ref', direction: 'in', kind: 'ref', type: 'any', multi: true, label: 'References' },
  { id: 'out_ref', direction: 'out', kind: 'ref', type: 'any', multi: true, label: 'Reference' },
  { id: 'model', direction: 'in', kind: 'control', type: 'model', multi: false, label: 'Model' },
  { id: 'control', direction: 'in', kind: 'control', type: 'control', multi: true, label: 'Control' },
  { id: 'out_control', direction: 'out', kind: 'control', type: 'control', multi: true, label: 'Control' },
];

let sid = '';
const graph = () => useStore.getState().sessions[sid].graph;
const edgeShape = (e: GraphEdge) => ({
  source: e.source,
  target: e.target,
  sourceHandle: e.sourceHandle,
  targetHandle: e.targetHandle,
  kind: e.kind ?? 'data',
  both: Boolean(e.both),
});

beforeEach(() => {
  const session = createSession('Adversarial creative ports');
  sid = session.id;
  useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: session } }));
});

describe('1. saved cables & implicit handle resolution (image & video)', () => {
  it('resolves all five creative link ports identically on saved image and video graphs', () => {
    const imgA = imgNode('imgA');
    const imgB = imgNode('imgB');
    const vidA = vidNode('vidA');
    const vidB = vidNode('vidB');
    const mdl = modelNode('mdl');
    const ag = agentNode('ag', sid);

    for (const creative of [imgA, vidA]) {
      const linkPorts = nodePorts(creative.data).filter((p) => p.kind !== 'data');
      expect(linkPorts).toEqual(EXPECTED_CREATIVE_LINK_PORTS);
    }

    const savedEdges: Array<{
      edge: GraphEdge;
      src: GraphNode;
      tgt: GraphNode;
      expected: { srcId: string; tgtId: string; kind: LinkKind; srcType: string; tgtType: string; tgtMulti: boolean };
    }> = [
      // image node: all 5 creative link ports
      {
        edge: { id: 'e_img_sys_ref', source: 'ag', target: 'imgA', sourceHandle: 'target', targetHandle: 'sys_ref', kind: 'ref' },
        src: ag, tgt: imgA,
        expected: { srcId: 'target', tgtId: 'sys_ref', kind: 'ref', srcType: 'any', tgtType: 'any', tgtMulti: true },
      },
      {
        edge: { id: 'e_img_out_ref', source: 'imgA', target: 'imgB', sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref' },
        src: imgA, tgt: imgB,
        expected: { srcId: 'out_ref', tgtId: 'sys_ref', kind: 'ref', srcType: 'any', tgtType: 'any', tgtMulti: true },
      },
      {
        edge: { id: 'e_img_model', source: 'mdl', target: 'imgA', sourceHandle: 'model', targetHandle: 'model', kind: 'control' },
        src: mdl, tgt: imgA,
        expected: { srcId: 'model', tgtId: 'model', kind: 'control', srcType: 'model', tgtType: 'model', tgtMulti: false },
      },
      {
        edge: { id: 'e_img_control', source: 'ag', target: 'imgA', sourceHandle: 'control', targetHandle: 'control', kind: 'control' },
        src: ag, tgt: imgA,
        expected: { srcId: 'control', tgtId: 'control', kind: 'control', srcType: 'control', tgtType: 'control', tgtMulti: true },
      },
      {
        edge: { id: 'e_img_out_control', source: 'imgA', target: 'imgB', sourceHandle: 'out_control', targetHandle: 'control', kind: 'control' },
        src: imgA, tgt: imgB,
        expected: { srcId: 'out_control', tgtId: 'control', kind: 'control', srcType: 'control', tgtType: 'control', tgtMulti: true },
      },
      // video node: all 5 creative link ports
      {
        edge: { id: 'e_vid_sys_ref', source: 'ag', target: 'vidA', sourceHandle: 'target', targetHandle: 'sys_ref', kind: 'ref' },
        src: ag, tgt: vidA,
        expected: { srcId: 'target', tgtId: 'sys_ref', kind: 'ref', srcType: 'any', tgtType: 'any', tgtMulti: true },
      },
      {
        edge: { id: 'e_vid_out_ref', source: 'vidA', target: 'vidB', sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref' },
        src: vidA, tgt: vidB,
        expected: { srcId: 'out_ref', tgtId: 'sys_ref', kind: 'ref', srcType: 'any', tgtType: 'any', tgtMulti: true },
      },
      {
        edge: { id: 'e_vid_model', source: 'mdl', target: 'vidA', sourceHandle: 'model', targetHandle: 'model', kind: 'control' },
        src: mdl, tgt: vidA,
        expected: { srcId: 'model', tgtId: 'model', kind: 'control', srcType: 'model', tgtType: 'model', tgtMulti: false },
      },
      {
        edge: { id: 'e_vid_control', source: 'ag', target: 'vidA', sourceHandle: 'control', targetHandle: 'control', kind: 'control' },
        src: ag, tgt: vidA,
        expected: { srcId: 'control', tgtId: 'control', kind: 'control', srcType: 'control', tgtType: 'control', tgtMulti: true },
      },
      {
        edge: { id: 'e_vid_out_control', source: 'vidA', target: 'vidB', sourceHandle: 'out_control', targetHandle: 'control', kind: 'control' },
        src: vidA, tgt: vidB,
        expected: { srcId: 'out_control', tgtId: 'control', kind: 'control', srcType: 'control', tgtType: 'control', tgtMulti: true },
      },
    ];

    for (const { edge, src, tgt, expected } of savedEdges) {
      const resolved = resolveSystemConnection(nodePorts(src.data), nodePorts(tgt.data), edge);
      expect(resolved.classMismatch, edge.id).toBeUndefined();
      expect(resolved.kind, edge.id).toBe(expected.kind);
      expect(resolved.srcPort, edge.id).toMatchObject({ id: expected.srcId, kind: expected.kind, type: expected.srcType });
      expect(resolved.tgtPort, edge.id).toMatchObject({ id: expected.tgtId, kind: expected.kind, type: expected.tgtType, multi: expected.tgtMulti });
      expect(cablePortProblem(src, tgt, {}, edge), edge.id).toBeNull();
    }
  });

  it('picks the exact same first compatible port as 4c6815fc when sourceHandle/targetHandle are omitted', () => {
    const img = imgNode('img');
    const vid = vidNode('vid');
    const mdl = modelNode('mdl');
    const ag = agentNode('ag', sid);
    const prov = providerNode('prov');

    // control from model -> image without handles: picks model (first control input, exact type match)
    const modelToImg = resolveSystemConnection(nodePorts(mdl.data), nodePorts(img.data), { kind: 'control' });
    expect(modelToImg.srcPort).toMatchObject({ id: 'model', kind: 'control', type: 'model' });
    expect(modelToImg.tgtPort).toMatchObject({ id: 'model', kind: 'control', type: 'model', multi: false });

    // control from agent/creative -> video without handles:
    // in 4c6815fc, engine order puts `model` before `control` and portTypeCompatible('control', 'control', 'model') is true,
    // so the resolver MUST pick `model` (not `control`).
    const agToVid = resolveSystemConnection(nodePorts(ag.data), nodePorts(vid.data), { kind: 'control' });
    expect(agToVid.srcPort).toMatchObject({ id: 'control', kind: 'control', type: 'control' });
    expect(agToVid.tgtPort).toMatchObject({ id: 'model', kind: 'control', type: 'model', multi: false });

    const imgToVidControl = resolveSystemConnection(nodePorts(img.data), nodePorts(vid.data), { kind: 'control' });
    expect(imgToVidControl.srcPort).toMatchObject({ id: 'out_control', kind: 'control', type: 'control' });
    expect(imgToVidControl.tgtPort).toMatchObject({ id: 'model', kind: 'control', type: 'model', multi: false });

    // control from provider -> image without handles: `provider` is incompatible with `model`, so it picks `control`
    const provToImg = resolveSystemConnection(nodePorts(prov.data), nodePorts(img.data), { kind: 'control' });
    expect(provToImg.srcPort).toMatchObject({ id: 'provider', kind: 'control', type: 'provider' });
    expect(provToImg.tgtPort).toMatchObject({ id: 'control', kind: 'control', type: 'control', multi: true });

    // ref between creative nodes without handles: picks out_ref -> sys_ref
    const imgToVidRef = resolveSystemConnection(nodePorts(img.data), nodePorts(vid.data), { kind: 'ref' });
    expect(imgToVidRef.srcPort).toMatchObject({ id: 'out_ref', kind: 'ref', type: 'any' });
    expect(imgToVidRef.tgtPort).toMatchObject({ id: 'sys_ref', kind: 'ref', type: 'any', multi: true });

    // saved legacy edge with empty/omitted handles still passes cablePortProblem
    const implicitControlEdge = { id: 'legacy_ctrl', source: 'ag', target: 'vid', sourceHandle: '', targetHandle: '', kind: 'control' as const };
    const implicitRefEdge = { id: 'legacy_ref', source: 'img', target: 'vid', sourceHandle: '', targetHandle: '', kind: 'ref' as const };
    expect(cablePortProblem(ag, vid, {}, implicitControlEdge)).toBeNull();
    expect(cablePortProblem(img, vid, {}, implicitRefEdge)).toBeNull();
  });
});

describe('2. UI (tryConnect / connectNodes) vs commands (nodes.edge.connect / nodes.system.link)', () => {
  const setupWithSystemNodes = () => {
    setGraph(sid, () => ({
      nodes: [imgNode('imgA'), imgNode('imgB'), vidNode('vidA'), modelNode('mdl1'), providerNode('prov1')],
      edges: [],
    }));
    ensureSystemNodes(sid);
  };

  it('produces the exact same edge for valid creative links via UI and registered commands', async () => {
    const cases: Array<{
      name: string;
      ui: { source: string; target: string; sourceHandle: string; targetHandle: string; kind?: LinkKind };
      edgeCmd: { source: string; target: string; source_handle: string; target_handle: string; kind?: LinkKind };
      sysCmd: { source: string; target: string; kind: LinkKind; source_handle: string; target_handle: string };
    }> = [
      {
        name: 'creative ref (out_ref -> sys_ref)',
        ui: { source: 'imgA', target: 'vidA', sourceHandle: 'out_ref', targetHandle: 'sys_ref' },
        edgeCmd: { source: 'imgA', target: 'vidA', source_handle: 'out_ref', target_handle: 'sys_ref' },
        sysCmd: { source: 'imgA', target: 'vidA', kind: 'ref', source_handle: 'out_ref', target_handle: 'sys_ref' },
      },
      {
        name: 'creative model (model -> model)',
        ui: { source: 'mdl1', target: 'imgA', sourceHandle: 'model', targetHandle: 'model' },
        edgeCmd: { source: 'mdl1', target: 'imgA', source_handle: 'model', target_handle: 'model' },
        sysCmd: { source: 'mdl1', target: 'imgA', kind: 'control', source_handle: 'model', target_handle: 'model' },
      },
      {
        name: 'creative control (out_control -> control)',
        ui: { source: 'imgA', target: 'imgB', sourceHandle: 'out_control', targetHandle: 'control' },
        edgeCmd: { source: 'imgA', target: 'imgB', source_handle: 'out_control', target_handle: 'control' },
        sysCmd: { source: 'imgA', target: 'imgB', kind: 'control', source_handle: 'out_control', target_handle: 'control' },
      },
    ];

    for (const tc of cases) {
      // Path 1: UI tryConnect
      setupWithSystemNodes();
      const beforeUi = new Set(graph().edges.map((e) => e.id));
      expect(tryConnect(sid, tc.ui), tc.name).toBe(true);
      const uiAdded = graph().edges.filter((e) => !beforeUi.has(e.id));
      expect(uiAdded, tc.name).toHaveLength(1);

      // Path 2: Command nodes.edge.connect
      setupWithSystemNodes();
      const beforeEdge = new Set(graph().edges.map((e) => e.id));
      const edgeRes = await run({ cmd: 'nodes.edge.connect', args: tc.edgeCmd, on: { session: sid } }, { caller: 'agent' });
      expect(edgeRes.ok, tc.name).toBe(true);
      const edgeAdded = graph().edges.filter((e) => !beforeEdge.has(e.id));
      expect(edgeAdded, tc.name).toHaveLength(1);

      // Path 3: Command nodes.system.link
      setupWithSystemNodes();
      const beforeSys = new Set(graph().edges.map((e) => e.id));
      const sysRes = await run({ cmd: 'nodes.system.link', args: tc.sysCmd, on: { session: sid } }, { caller: 'agent' });
      expect(sysRes.ok, tc.name).toBe(true);
      const sysAdded = graph().edges.filter((e) => !beforeSys.has(e.id));
      expect(sysAdded, tc.name).toHaveLength(1);

      expect(edgeShape(edgeAdded[0]), tc.name).toEqual(edgeShape(uiAdded[0]));
      expect(edgeShape(sysAdded[0]), tc.name).toEqual(edgeShape(uiAdded[0]));
    }
  });

  it('rejects incompatible links identically across UI and commands with zero graph mutation', async () => {
    const invalidCases: Array<{
      name: string;
      ui: { source: string; target: string; sourceHandle: string; targetHandle: string; kind?: LinkKind };
      edgeCmd: { source: string; target: string; source_handle: string; target_handle: string; kind?: LinkKind };
      sysCmd: { source: string; target: string; kind: LinkKind; source_handle: string; target_handle: string };
    }> = [
      {
        name: 'class mismatch: out_ref (ref) -> control (control)',
        ui: { source: 'imgA', target: 'imgB', sourceHandle: 'out_ref', targetHandle: 'control' },
        edgeCmd: { source: 'imgA', target: 'imgB', source_handle: 'out_ref', target_handle: 'control' },
        sysCmd: { source: 'imgA', target: 'imgB', kind: 'ref', source_handle: 'out_ref', target_handle: 'control' },
      },
      {
        name: 'class mismatch: out_control (control) -> sys_ref (ref)',
        ui: { source: 'imgA', target: 'vidA', sourceHandle: 'out_control', targetHandle: 'sys_ref' },
        edgeCmd: { source: 'imgA', target: 'vidA', source_handle: 'out_control', target_handle: 'sys_ref' },
        sysCmd: { source: 'imgA', target: 'vidA', kind: 'control', source_handle: 'out_control', target_handle: 'sys_ref' },
      },
      {
        name: 'control type mismatch: provider -> model',
        ui: { source: 'prov1', target: 'imgA', sourceHandle: 'provider', targetHandle: 'model' },
        edgeCmd: { source: 'prov1', target: 'imgA', source_handle: 'provider', target_handle: 'model' },
        sysCmd: { source: 'prov1', target: 'imgA', kind: 'control', source_handle: 'provider', target_handle: 'model' },
      },
      {
        name: 'class mismatch: data out -> sys_ref',
        ui: { source: 'imgA', target: 'imgB', sourceHandle: 'out', targetHandle: 'sys_ref' },
        edgeCmd: { source: 'imgA', target: 'imgB', source_handle: 'out', target_handle: 'sys_ref' },
        sysCmd: { source: 'imgA', target: 'imgB', kind: 'data', source_handle: 'out', target_handle: 'sys_ref' },
      },
    ];

    for (const tc of invalidCases) {
      setupWithSystemNodes();
      const snapshot = structuredClone(graph());

      expect(tryConnect(sid, tc.ui), `tryConnect: ${tc.name}`).toBe(false);
      expect(graph(), `after tryConnect: ${tc.name}`).toEqual(snapshot);

      expect(connectNodes(sid, tc.ui), `connectNodes: ${tc.name}`).not.toBeNull();
      expect(graph(), `after connectNodes: ${tc.name}`).toEqual(snapshot);

      const edgeRes = await run({ cmd: 'nodes.edge.connect', args: tc.edgeCmd, on: { session: sid } }, { caller: 'agent' });
      expect(edgeRes.ok, `nodes.edge.connect: ${tc.name}`).toBe(false);
      expect(graph(), `after nodes.edge.connect: ${tc.name}`).toEqual(snapshot);

      const sysRes = await run({ cmd: 'nodes.system.link', args: tc.sysCmd, on: { session: sid } }, { caller: 'agent' });
      expect(sysRes.ok, `nodes.system.link: ${tc.name}`).toBe(false);
      expect(graph(), `after nodes.system.link: ${tc.name}`).toEqual(snapshot);
    }
  });

  it('resolves omitted targetHandle identically between UI / nodes.edge.connect and nodes.system.link', async () => {
    // Case A: model -> image with targetHandle: null and kind: 'control' must wire to `model`, not `control`
    setupWithSystemNodes();
    const beforeSys = new Set(graph().edges.map((e) => e.id));
    const sysRes = await run(
      { cmd: 'nodes.system.link', args: { source: 'mdl1', target: 'imgA', kind: 'control', source_handle: 'model' }, on: { session: sid } },
      { caller: 'agent' },
    );
    expect(sysRes.ok).toBe(true);
    const sysEdge = graph().edges.find((e) => !beforeSys.has(e.id))!;
    expect(sysEdge.targetHandle).toBe('model');

    setupWithSystemNodes();
    const beforeEdge = new Set(graph().edges.map((e) => e.id));
    const edgeRes = await run(
      { cmd: 'nodes.edge.connect', args: { source: 'mdl1', target: 'imgA', kind: 'control', source_handle: 'model', target_handle: null }, on: { session: sid } },
      { caller: 'agent' },
    );
    expect(edgeRes.ok).toBe(true);
    const edgeCmdEdge = graph().edges.find((e) => !beforeEdge.has(e.id))!;
    expect(edgeShape(edgeCmdEdge)).toEqual(edgeShape(sysEdge));

    // Case B: imgA (out_ref) -> vidA with targetHandle: null and omitted kind must wire to `sys_ref`, never nonexistent `in`
    setupWithSystemNodes();
    const beforeUi = new Set(graph().edges.map((e) => e.id));
    expect(tryConnect(sid, { source: 'imgA', target: 'vidA', sourceHandle: 'out_ref', targetHandle: null })).toBe(true);
    const uiEdge = graph().edges.find((e) => !beforeUi.has(e.id))!;
    expect(uiEdge.targetHandle).toBe('sys_ref');
    expect(cablePortProblem(graph().nodes.find((n) => n.id === 'imgA')!, graph().nodes.find((n) => n.id === 'vidA')!, {}, uiEdge)).toBeNull();
  });

  it('does not materialize unrelated system nodes when linking two creative nodes via nodes.system.link', async () => {
    // Graph with ONLY creative nodes (no ref/system nodes materialized yet)
    setGraph(sid, () => ({ nodes: [imgNode('imgA'), vidNode('vidA')], edges: [] }));
    const beforeReject = structuredClone(graph());

    // Rejected creative link must not mutate the graph
    const bad = await run(
      { cmd: 'nodes.system.link', args: { source: 'imgA', target: 'vidA', kind: 'ref', source_handle: 'out_control', target_handle: 'sys_ref' }, on: { session: sid } },
      { caller: 'agent' },
    );
    expect(bad.ok).toBe(false);
    expect(graph()).toEqual(beforeReject);

    // Valid creative link via nodes.system.link should add the same edge as tryConnect without injecting unrelated system nodes
    const ok = await run(
      { cmd: 'nodes.system.link', args: { source: 'imgA', target: 'vidA', kind: 'ref', source_handle: 'out_ref', target_handle: 'sys_ref' }, on: { session: sid } },
      { caller: 'agent' },
    );
    expect(ok.ok).toBe(true);
    expect(graph().nodes.map((n) => n.id)).toEqual(['imgA', 'vidA']);
    expect(graph().edges).toHaveLength(1);
  });
});

describe('3. multi:false on model port (and multi:true on control/sys_ref) by both paths', () => {
  const setupModelGraph = () => {
    setGraph(sid, () => ({
      nodes: [modelNode('m1', 'local::m1'), modelNode('m2', 'local::m2'), imgNode('img'), vidNode('vid')],
      edges: [],
    }));
    ensureSystemNodes(sid);
  };

  it('enforces multi:false on model via commands: rejects blind second cable, replaces when replaces names occupant', async () => {
    for (const cmdPath of ['nodes.edge.connect', 'nodes.system.link'] as const) {
      setupModelGraph();

      const first = cmdPath === 'nodes.edge.connect'
        ? await run({ cmd: 'nodes.edge.connect', args: { source: 'm1', target: 'img', source_handle: 'model', target_handle: 'model', kind: 'control' }, on: { session: sid } }, { caller: 'agent' })
        : await run({ cmd: 'nodes.system.link', args: { source: 'm1', target: 'img', source_handle: 'model', target_handle: 'model', kind: 'control' }, on: { session: sid } }, { caller: 'agent' });
      expect(first.ok, cmdPath).toBe(true);

      const firstEdge = graph().edges.find((e) => e.target === 'img' && e.targetHandle === 'model')!;
      expect(firstEdge).toMatchObject({ source: 'm1', target: 'img', sourceHandle: 'model', targetHandle: 'model', kind: 'control' });

      // Second cable without `replaces` must be rejected with zero mutation
      const snapshot = structuredClone(graph());
      const blind = cmdPath === 'nodes.edge.connect'
        ? await run({ cmd: 'nodes.edge.connect', args: { source: 'm2', target: 'img', source_handle: 'model', target_handle: 'model', kind: 'control' }, on: { session: sid } }, { caller: 'agent' })
        : await run({ cmd: 'nodes.system.link', args: { source: 'm2', target: 'img', source_handle: 'model', target_handle: 'model', kind: 'control' }, on: { session: sid } }, { caller: 'agent' });
      expect(blind.ok, `${cmdPath} blind`).toBe(false);
      expect(graph(), `${cmdPath} blind no mutation`).toEqual(snapshot);

      // Second cable naming `replaces` must replace the occupant (still exactly 1 cable on model)
      const replaced = cmdPath === 'nodes.edge.connect'
        ? await run({ cmd: 'nodes.edge.connect', args: { source: 'm2', target: 'img', source_handle: 'model', target_handle: 'model', kind: 'control', replaces: firstEdge.id }, on: { session: sid } }, { caller: 'agent' })
        : await run({ cmd: 'nodes.system.link', args: { source: 'm2', target: 'img', source_handle: 'model', target_handle: 'model', kind: 'control', replaces: firstEdge.id }, on: { session: sid } }, { caller: 'agent' });
      expect(replaced.ok, `${cmdPath} replace`).toBe(true);

      const onModel = graph().edges.filter((e) => e.target === 'img' && e.targetHandle === 'model');
      expect(onModel.map((e) => e.source), `${cmdPath} after replace`).toEqual(['m2']);
    }
  });

  it('replaces the occupant on model via UI tryConnect when kind is passed explicitly', () => {
    setupModelGraph();
    expect(tryConnect(sid, { source: 'm1', target: 'img', sourceHandle: 'model', targetHandle: 'model', kind: 'control' })).toBe(true);
    expect(tryConnect(sid, { source: 'm2', target: 'img', sourceHandle: 'model', targetHandle: 'model', kind: 'control' })).toBe(true);
    const onModel = graph().edges.filter((e) => e.target === 'img' && e.targetHandle === 'model');
    expect(onModel.map((e) => e.source)).toEqual(['m2']);
  });

  it('replaces the occupant on model via UI tryConnect without kind (exact NodeWorkspace onConnect call)', () => {
    setupModelGraph();
    expect(tryConnect(sid, { source: 'm1', target: 'img', sourceHandle: 'model', targetHandle: 'model' })).toBe(true);
    // React Flow onConnect never passes `kind` (NodeWorkspace.tsx:437); UI is supposed to replace single-cable ports.
    expect(tryConnect(sid, { source: 'm2', target: 'img', sourceHandle: 'model', targetHandle: 'model' })).toBe(true);
    const onModel = graph().edges.filter((e) => e.target === 'img' && e.targetHandle === 'model');
    expect(onModel.map((e) => e.source)).toEqual(['m2']);
  });

  it('allows multiple cables on multi:true creative ports (control and sys_ref) via both UI and commands', async () => {
    setGraph(sid, () => ({
      nodes: [imgNode('a'), imgNode('b'), vidNode('target')],
      edges: [],
    }));
    ensureSystemNodes(sid);

    // UI path (without kind)
    expect(tryConnect(sid, { source: 'a', target: 'target', sourceHandle: 'out_control', targetHandle: 'control' })).toBe(true);
    expect(tryConnect(sid, { source: 'b', target: 'target', sourceHandle: 'out_control', targetHandle: 'control' })).toBe(true);
    expect(graph().edges.filter((e) => e.target === 'target' && e.targetHandle === 'control').map((e) => e.source).sort()).toEqual(['a', 'b']);

    // Command path (nodes.system.link)
    expect((await run({ cmd: 'nodes.system.link', args: { source: 'a', target: 'target', kind: 'ref', source_handle: 'out_ref', target_handle: 'sys_ref' }, on: { session: sid } }, { caller: 'agent' })).ok).toBe(true);
    expect((await run({ cmd: 'nodes.system.link', args: { source: 'b', target: 'target', kind: 'ref', source_handle: 'out_ref', target_handle: 'sys_ref' }, on: { session: sid } }, { caller: 'agent' })).ok).toBe(true);
    expect(graph().edges.filter((e) => e.target === 'target' && e.targetHandle === 'sys_ref').map((e) => e.source).sort()).toEqual(['a', 'b']);
  });
});

describe('4. aliasing isolation of CREATIVE_LINK_PORTS', () => {
  it('mutating the result of allNodePorts does not alter CREATIVE_LINK_PORTS, future calls, or LinkHandles', () => {
    const beforeConstant = structuredClone(CREATIVE_LINK_PORTS);
    const renderHandles = () => {
      const html = renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(LinkHandles)));
      return [...html.matchAll(/<div\b[^>]*\bdata-handleid="[^"]+"[^>]*>/g)].map(([tag]) => ({
        id: tag.match(/\bdata-handleid="([^"]+)"/)?.[1],
        side: tag.match(/\bdata-handlepos="([^"]+)"/)?.[1],
        top: tag.match(/\bstyle="top:([^;"]+)/)?.[1],
      }));
    };
    const beforeHandles = renderHandles();

    const creativeDatas: GraphNodeData[] = [imgNode('img').data, vidNode('vid').data];
    for (const data of creativeDatas) {
      const ports = allNodePorts(data, {}, inputPorts(data), outputPort(data, {}));
      for (const p of ports) {
        p.id = 'mutated';
        p.direction = p.direction === 'in' ? 'out' : 'in';
        p.kind = 'data';
        p.type = 'text';
        p.multi = !p.multi;
        p.label = 'Corrupted';
      }
      ports.reverse();
      ports.push({ id: 'extra', direction: 'in', kind: 'control', type: 'any', multi: false, label: 'Extra' });
      ports.splice(0, 2);
    }

    expect(CREATIVE_LINK_PORTS).toEqual(beforeConstant);
    expect(CREATIVE_LINK_PORTS.find((p) => p.id === 'model')?.multi).toBe(false);

    for (const data of creativeDatas) {
      const fresh = allNodePorts(data, {}, inputPorts(data), outputPort(data, {}));
      expect(fresh.filter((p) => p.kind !== 'data')).toEqual(EXPECTED_CREATIVE_LINK_PORTS);
    }

    expect(renderHandles()).toEqual(beforeHandles);
  });
});
