import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(()=>Object.assign(globalThis,{window:{setTimeout,clearTimeout,addEventListener(){}},document:{addEventListener(){},visibilityState:'visible'}}));
vi.mock('../src/lib/idb',()=>({stateDb:{get:async()=>undefined,set:async()=>undefined},cacheDb:{get:async()=>undefined,set:async()=>undefined},getAssetBlob:async()=>undefined,putAssetBlob:async()=>undefined}));
const execute=vi.hoisted(()=>vi.fn(async()=>({outputs:new Map(),failed:[],skipped:[]})));
vi.mock('../src/engine/executor',async original=>({...await original<typeof import('../src/engine/executor')>(),executeSteps:execute}));
import { useStore, appendFeed } from '../src/store/store';
import { editGraphTool } from '../src/engine/agent/nodeTools';
import { sendAgentMessage, approvePlan, presentNodeRun, undoNodeDeletion } from '../src/engine/agent/runtime';
import { deleteNodesWithUndo, patchNodeData, connectNodes } from '../src/engine/flow/actions';
import type { Graph, PlanFeedItem } from '../src/engine/types';
let sid:string;
const data=(title:string)=>({kind:'image' as const,title,prompt:'old',modelRef:'local::studio-image',settings:{count:1,advanced:{}},outputIndex:0});
beforeEach(()=>{
 const st=useStore.getState();sid=st.activeSessionId;
 const graph:Graph={nodes:[{id:'key2',position:{x:0,y:0},data:data('Keyframe 2')},{id:'final',position:{x:300,y:0},data:{...data('Final'),kind:'video',modelRef:'local::studio-video'}}],edges:[{id:'edge',source:'key2',target:'final',sourceHandle:'out',targetHandle:'first'}]};
 useStore.setState({sessions:{...st.sessions,[sid]:{...st.sessions[sid],graph,feed:[],agent:{...st.sessions[sid].agent,pending:undefined,busy:false}}},settings:{...st.settings,agent:{...st.settings.agent,provider:'offline'}}});execute.mockClear();
});
afterEach(()=>vi.unstubAllGlobals());
const session=()=>useStore.getState().sessions[sid];
describe('agent actions on existing nodes',()=>{
 it('handles the complete chat tool loop with a simulated LLM',async()=>{
  const replies=[{name:'read_graph',args:{node_ids:['key2','final']}},{name:'edit_node',args:{node_id:'key2',prompt:'walk toward the camera'}},{name:'run_nodes',args:{node_ids:['final']}}];
  vi.stubGlobal('fetch',async(_url:string,init?:RequestInit)=>{
    const body=init?.body?JSON.parse(String(init.body)):{};
    if(!body.messages)return new Response(JSON.stringify({data:[]}));
    const tool=replies.shift();
    const delta=tool ? {tool_calls:[{index:0,id:`call-${replies.length}`,function:{name:tool.name,arguments:JSON.stringify(tool.args)}}]} : {content:'ok'};
    return new Response(`data: ${JSON.stringify({choices:[{delta}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});
  });
  const st=useStore.getState();useStore.setState({ui:{...st.ui,workspace:'node'},settings:{...st.settings,keys:{...st.settings.keys,nanogpt:'test'},agent:{...st.settings.agent,provider:'nanogpt',model:'test'}},composer:{...st.composer,agentStyle:'auto',attachments:[]}});
  await sendAgentMessage('Cambia el prompt del keyframe 2 y actualiza el vídeo final');
  const card=session().feed.find(f=>f.type==='plan') as PlanFeedItem;
  expect(card?.status).toBe('awaiting');expect(card.nodeRun?.targets).toEqual(['final']);expect(card.plan.steps.map(s=>s.id)).toEqual(['key2','final']);
  expect(session().graph.nodes).toHaveLength(2);expect(session().graph.nodes[0].data).toMatchObject({prompt:'walk toward the camera'});expect(execute).not.toHaveBeenCalled();
 });
 it('edits keyframe 2, proposes only existing IDs and waits for approval',async()=>{
  expect((await editGraphTool(sid,'edit_node',{node_id:'key2',prompt:'walk toward the camera'})).text).toContain('Updated');
  const card=await presentNodeRun(sid,['final']);expect(card.errors).toEqual([]);expect(execute).not.toHaveBeenCalled();
  const item=session().feed.find(f=>f.id===card.itemId) as PlanFeedItem;
  expect(item.plan.steps.map(s=>s.id)).toEqual(['key2','final']);expect(session().graph.nodes.map(n=>n.id)).toEqual(['key2','final']);
  expect(item.plan.steps[0]).toMatchObject({prompt:'walk toward the camera'});
  await approvePlan(sid,item.id);expect(execute).toHaveBeenCalledTimes(1);expect(session().graph.nodes).toHaveLength(2);
 });
 it('refreshes the same card after a relevant edit and requires the next approval',async()=>{
  const card=await presentNodeRun(sid,['final']);const id=card.itemId!;
  patchNodeData(sid,'key2',{prompt:'after preview'});await approvePlan(sid,id);expect(execute).not.toHaveBeenCalled();
  expect(session().feed.find(f=>f.id===id)).toMatchObject({status:'awaiting',plan:{steps:[{prompt:'after preview'},{}]}});
  patchNodeData(sid,'key2',{title:'rename'});await approvePlan(sid,id);expect(execute).toHaveBeenCalledTimes(1);
 });
 it('shares cycle/port/model validation and reports missing IDs',async()=>{
  expect((await editGraphTool(sid,'connect_nodes',{source:'final',target:'key2',port:'ref'})).text).not.toContain('Connected existing');
  expect((await editGraphTool(sid,'edit_node',{node_id:'missing',prompt:'x'})).text).toContain('No such node');
  expect((await editGraphTool(sid,'edit_node',{node_id:'key2',model_ref:'local::studio-video'})).text).toContain('not image');
  expect((await editGraphTool(sid,'disconnect_nodes',{edge_ids:['edge']})).text).toContain('Disconnected');expect(session().graph.edges).toHaveLength(0);
 });
 it('offers Undo and restores connections without reverting later edits or deleting results',()=>{
  const beforeAssets=useStore.getState().assets;
  const deleted=deleteNodesWithUndo(sid,['key2']);expect(deleted.error).toBeNull();
  appendFeed(sid,{id:'undo',createdAt:Date.now(),workspace:'node',type:'notice',level:'info',text:'Deleted',undoNodes:deleted.deleted});
  patchNodeData(sid,'final',{prompt:'keep later edit'});
  expect(undoNodeDeletion(sid,'undo')).toBeNull();expect(session().graph.nodes).toHaveLength(2);expect(session().graph.edges.map(e=>e.id)).toEqual(['edge']);
  expect(session().graph.nodes.find(n=>n.id==='final')!.data).toMatchObject({prompt:'keep later edit'});expect(useStore.getState().assets).toBe(beforeAssets);
 });
 it('preserves a subsequently occupied single-input port on Undo',()=>{
  const deleted=deleteNodesWithUndo(sid,['key2']);
  const st=useStore.getState();useStore.setState({sessions:{...st.sessions,[sid]:{...session(),graph:{...session().graph,nodes:[...session().graph.nodes,{id:'new',position:{x:0,y:0},data:data('Later')} ]}}}});
  expect(connectNodes(sid,{source:'new',target:'final',targetHandle:'first'})).toBeNull();
  appendFeed(sid,{id:'undo',createdAt:Date.now(),workspace:'node',type:'notice',level:'info',text:'Deleted',undoNodes:deleted.deleted});
  expect(undoNodeDeletion(sid,'undo')).toBeNull();expect(session().graph.edges).toHaveLength(1);expect(session().graph.edges[0].source).toBe('new');
 });
});
