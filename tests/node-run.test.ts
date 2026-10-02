import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Generation, Graph, GraphNode, Subject } from '../src/engine/types';
import { graphToSteps } from '../src/engine/flow/graph';
import { nodeRequest, stable } from '../src/engine/flow/freshness';
import { graphEditProblem, lockNodes } from '../src/engine/flow/locks';
import { previewRun, runNodes, patchNodeData } from '../src/engine/flow/actions';
import { useStore } from '../src/store/store';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));
const execute = vi.hoisted(() => vi.fn());
vi.mock('../src/engine/executor', async importOriginal => ({ ...await importOriginal<typeof import('../src/engine/executor')>(), executeSteps: execute }));
const settings = { count: 1, advanced: {} };
const node = (id: string, kind: 'image' | 'video' | 'audio' = 'image'): GraphNode => ({ id, position: { x: 0, y: 0 }, data: { kind, title: id, modelRef: `local::${kind}`, prompt: id, settings: { ...settings }, generationId: `g${id}`, outputIndex: 0 } });
const edge = (source: string, target: string, port = 'ref') => ({ id: `${source}-${target}`, source, target, sourceHandle: 'out', targetHandle: port });
let graph: Graph, gens: Record<string, Generation>;
function finish(library: Subject[] = []) {
  for (const n of graph.nodes) if ('generationId' in n.data && n.data.generationId) {
    gens[n.data.generationId] = { id: n.data.generationId, status: 'done', assetIds: [`a${n.id}`, `b${n.id}`], inputs: { refs: [] }, prompt: 'prompt' in n.data ? n.data.prompt : '', settings } as unknown as Generation;
  }
  for (const n of graph.nodes) if ('generationId' in n.data && n.data.generationId) gens[n.data.generationId].nodeRequest = stable(nodeRequest(graph, n, gens, library));
}
beforeEach(() => { graph = { nodes: [node('character'), node('key'), node('final', 'video'), node('sibling'), node('child')], edges: [edge('character','key'), edge('key','final','first'), edge('character','sibling'), edge('final','child')] }; gens = {}; finish(); execute.mockReset(); });
describe('node Run freshness', () => {
  it('updates only affected ancestors of the forced target', () => {
    (graph.nodes[0].data as any).prompt = 'new character';
    const run = graphToSteps(graph, ['final'], gens, { force: true });
    expect(run.runIds).toEqual(['character', 'key', 'final']);
    expect(run.steps.find(s => s.id === 'key')).toMatchObject({ refs: ['character'] });
    expect(run.steps.find(s => s.id === 'final')).toMatchObject({ firstFrame: 'key' });
  });
  it('global skips current results; individual still forces its target', () => {
    expect(graphToSteps(graph, graph.nodes.map(n => n.id), gens, { force: false }).runIds).toEqual([]);
    expect(graphToSteps(graph, ['final'], gens).runIds).toEqual(['final']);
    (graph.nodes[0].data as any).prompt = 'new';
    expect(graphToSteps(graph, ['final'], gens, { force: false }).runIds).toEqual(['character', 'key', 'final']);
    finish();
    expect(graphToSteps(graph, graph.nodes.map(n => n.id), gens, { force: false }).runIds).toEqual([]);
  });
  it('ignores title, position, automatic seed and provider-transformed prompt', () => {
    graph.nodes[0].data.title = 'renamed'; graph.nodes[0].position.x = 999;
    gens.gcharacter.settings.seed = 123; gens.gcharacter.prompt = 'provider prompt';
    expect(graphToSteps(graph, ['final'], gens, { force: false }).runIds).toEqual([]);
    delete gens.gcharacter.nodeRequest;
    gens.gcharacter.prompt = 'character'; gens.gcharacter.modelRef = 'local::image';
    expect(graphToSteps(graph, ['final'], gens, { force: false }).runIds).toEqual([]);
  });
  it('selected candidate invalidates consumers, and uses its index in the same chain', () => {
    (graph.nodes[0].data as any).outputIndex = 1;
    expect(graphToSteps(graph, ['final'], gens, { force: false }).runIds).toEqual(['key','final']);
    (graph.nodes[0].data as any).prompt = 'new';
    expect(graphToSteps(graph, ['final'], gens).steps.find(s => s.id === 'key')).toMatchObject({ refs: ['character#2'] });
  });
  it('propagates asset and text changes through image/video/audio/operation', () => {
    graph = { nodes: [
      { id: 'asset', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Ref', assetId: 'old' } },
      { id: 'text', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Prompt', text: 'old text' } },
      node('image'), node('video','video'), node('audio','audio'),
      { id: 'op', position: { x: 0, y: 0 }, data: { kind: 'tool', title: 'Split', op: 'grid_split', params: { grid: 2 }, outputIndex: 0, generationId: 'gop' } },
    ], edges: [edge('asset','image'), edge('text','image','prompt'), edge('text','audio','lyrics'), edge('image','video','last'), edge('image','op','input')] };
    gens = {}; finish();
    (graph.nodes[0].data as any).assetId = 'new';
    (graph.nodes[1].data as any).text = 'new text';
    expect(graphToSteps(graph, ['video','op','audio'], gens, { force: false }).runIds).toEqual(['image','video','op','audio']);
  });
  it('compares the image behind @Name and keeps local subjects separate', () => {
    const subject = { id: 's', name: 'Actor', frontalAssetId: 'old', refAssetIds: [], description: '' } as Subject;
    (graph.nodes[0].data as any).prompt = '@Actor walking'; finish([subject]);
    expect(graphToSteps(graph, ['final'], gens, { force: false, library: [subject] }).runIds).toEqual([]);
    expect(graphToSteps(graph, ['final'], gens, { force: false, library: [{ ...subject, frontalAssetId: 'new' }] }).runIds).toEqual(['character','key','final']);
    gens.gcharacter.inputs.subjects = [subject]; finish([{ ...subject, frontalAssetId: 'new' }]);
  });
  it('blocks replacement of a Sketch, while a current Sketch can feed a target', () => {
    (graph.nodes[0].data as any).sketchAssetId = 'sketch'; finish();
    expect(graphToSteps(graph, ['final'], gens).errors).toEqual([]);
    (graph.nodes[0].data as any).prompt = 'new';
    expect(graphToSteps(graph, ['final'], gens).errors.join()).toContain('Sketch');
  });
  it('tracks plan-local identities by existing source node, including reuse and replacement', () => {
    (graph.nodes[1].data as any).prompt = '@Actor walking';
    (graph.nodes[1].data as any).subjects = [{ name: 'Actor', from: 'character', description: 'adult' }];
    graph.edges = graph.edges.filter(e => !(e.source === 'character' && e.target === 'key'));
    finish();
    expect(graphToSteps(graph, ['final'], gens, { force: false }).runIds).toEqual([]);
    (graph.nodes[0].data as any).prompt = 'new character';
    const run = graphToSteps(graph,['final'],gens);
    expect(run.runIds).toEqual(['character','key','final']);
    expect(run.steps.find(s => s.id === 'key')).toMatchObject({ nodeSubjects: [{ name:'Actor',from:'character' }], after: ['character'] });
  });
  it('does not invalidate equivalent explicit schema defaults', () => {
    const schemas = { 'local::image': { ref:'local::image', slots:{}, params:[{ key:'resolution',role:'resolution',type:'enum',default:'1K',options:['1K','2K'] }] } } as any;
    for (const n of graph.nodes) if ('generationId' in n.data) gens[n.data.generationId!].nodeRequest = stable(nodeRequest(graph,n,gens,[],{schemas}));
    (graph.nodes[0].data as any).settings.resolution = '1K';
    expect(graphToSteps(graph,['final'],gens,{force:false,schemas}).runIds).toEqual([]);
    (graph.nodes[0].data as any).settings.resolution = '2K';
    expect(graphToSteps(graph,['final'],gens,{force:false,schemas}).runIds).toEqual(['character','key','final']);
  });
  it('locks only involved nodes and their input edges, allowing movement/title and unrelated edits', () => {
    const release = lockNodes('test', ['character','key','final']);
    const copy = structuredClone(graph); copy.nodes[0].data.title = 'new'; copy.nodes[0].position.x = 30;
    expect(graphEditProblem('test', graph, copy)).toBeNull();
    (copy.nodes[3].data as any).prompt = 'sibling'; expect(graphEditProblem('test',graph,copy)).toBeNull();
    expect(() => lockNodes('test',['key'])).toThrow('already running');
    copy.edges.pop(); expect(graphEditProblem('test',graph,copy)).toBeNull();
    copy.edges.shift(); expect(graphEditProblem('test',graph,copy)).toContain('in use'); release();
  });
  it('two runs may read the same input; a node being generated is neither run nor read by another', () => {
    const a = lockNodes('share', ['n1'], ['n1', 'src']);
    const b = lockNodes('share', ['n1copy'], ['n1copy', 'src']); // the duplicate reads the same source
    expect(() => lockNodes('share', ['src'])).toThrow('already running'); // writing a node others read
    expect(() => lockNodes('share', ['after'], ['after', 'n1'])).toThrow('already running'); // reading a node being written
    a(); b();
    expect(() => lockNodes('share', ['src'])()).not.toThrow();
  });
  it('previews include ancestors and revalidate inputs and prices before spending', async () => {
    const st = useStore.getState(), sid = st.activeSessionId;
    (graph.nodes[0].data as any).prompt = 'new';
    useStore.setState({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph } }, generations: gens });
    const approved = previewRun(sid,['final']); expect(approved.runIds).toEqual(['character','key','final']);
    patchNodeData(sid,'final',{ title: 'rename' }); expect(previewRun(sid,['final']).signature).toBe(approved.signature);
    patchNodeData(sid,'key',{ prompt: 'changed after review' });
    expect(await runNodes(sid,['final'],approved)).toBeNull(); expect(execute).not.toHaveBeenCalled();
  });  it('blocks overlap and input edits, preserves the old output on failure, and releases locks', async () => {
    const st=useStore.getState(), sid=st.activeSessionId;
    useStore.setState({ sessions: {...st.sessions,[sid]:{...st.sessions[sid],graph}}, generations:gens, assets:Object.fromEntries(Object.values(gens).flatMap(g=>g.assetIds.map(id=>[id,{id,kind:'image'}]))) as any });
    let finishRun!: () => void;
    const gate=new Promise<void>(resolve=>{finishRun=resolve;});
    execute.mockImplementation(async (_steps, ctx) => {
      ctx.onState('final','running',{generationId:'new-failed'});
      await gate;
      ctx.onState('final','error',{error:'simulated failure'});
      return { outputs:new Map(),failed:[{stepId:'final',error:'simulated failure'}],skipped:[] };
    });
    const p=await import('../src/engine/flow/actions');
    const approved=await p.prepareNodeRun(sid,['final']);
    expect(approved.errors).toEqual([]);
    const running=p.runNodes(sid,['final'],approved);
    await vi.waitFor(()=>expect(execute).toHaveBeenCalledTimes(1));
    expect(p.patchNodeData(sid,'key',{prompt:'cannot edit'})).toContain('in use');
    expect(p.patchNodeData(sid,'sibling',{prompt:'allowed'})).toBeNull();
    expect(await p.runNodes(sid,['final'],approved)).toBeNull();
    finishRun(); await running;
    expect((useStore.getState().sessions[sid].graph.nodes.find(n=>n.id==='final')!.data as any).generationId).toBe('gfinal');
    expect(p.patchNodeData(sid,'key',{prompt:'allowed after failure'})).toBeNull();
  });

});
