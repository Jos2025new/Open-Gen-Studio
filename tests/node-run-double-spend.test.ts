import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(()=>Object.assign(globalThis,{window:{setTimeout,clearTimeout,addEventListener(){}},document:{addEventListener(){},visibilityState:'visible'}}));
vi.mock('../src/lib/idb',()=>({stateDb:{get:async()=>undefined,set:async()=>undefined},cacheDb:{get:async()=>undefined,set:async()=>undefined},getAssetBlob:async()=>undefined,putAssetBlob:async()=>undefined}));
const execute=vi.hoisted(()=>vi.fn(async()=>({outputs:new Map(),failed:[],skipped:[]})));
vi.mock('../src/engine/executor',async original=>({...await original<typeof import('../src/engine/executor')>(),executeSteps:execute}));
import { useStore } from '../src/store/store';
import { approvePlan, presentNodeRun } from '../src/engine/agent/runtime';
import * as action from '../src/engine/nodecore/action';
import { prepareAction, runAction } from '../src/engine/nodecore/action';
import type { Graph } from '../src/engine/types';
import { agentsWith } from './helpers/threads';
let sid:string;
const data=(title:string)=>({kind:'image' as const,title,prompt:'old',modelRef:'local::studio-image',settings:{count:1,advanced:{}},outputIndex:0});
beforeEach(()=>{
 const st=useStore.getState();sid=st.activeSessionId;
 const graph:Graph={nodes:[{id:'key2',position:{x:0,y:0},data:data('Keyframe 2')},{id:'final',position:{x:300,y:0},data:{...data('Final'),kind:'video',modelRef:'local::studio-video'}}],edges:[{id:'edge',source:'key2',target:'final',sourceHandle:'out',targetHandle:'first'}]};
 useStore.setState({sessions:{...st.sessions,[sid]:{...st.sessions[sid],graph,feed:[],agents: agentsWith(st.sessions[sid], { pending:undefined,busy:false })}},settings:{...st.settings,agent:{...st.settings.agent,provider:'offline'}}});execute.mockClear();
});
afterEach(()=>vi.unstubAllGlobals());

describe('one approval pays one send',()=>{
 beforeEach(()=>execute.mockClear());
 it('a double click on Run approves once: one execution',async()=>{
  const card=await presentNodeRun(sid, ['final'], null, undefined, 'main');expect(card.errors).toEqual([]);
  const adopt=vi.spyOn(action,'runApproved');
  const a=approvePlan(sid,card.itemId!);const b=approvePlan(sid,card.itemId!);
  await Promise.all([a,b]);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(adopt).toHaveBeenCalledTimes(1); // the second click never reached a second approval
 });
 it('a send that fails before the provider answers still spends the approval',async()=>{
  const p=await prepareAction(sid,['final']);expect(p.ok).toBe(true);if(!p.ok)return;
  execute.mockRejectedValueOnce(new Error('network down'));
  const first=await runAction(p.snapshot,'run-a');expect(first.status).toBe('failed');
  const second=await runAction(p.snapshot,'run-b');
  expect(second.status).toBe('stale');expect(execute).toHaveBeenCalledTimes(1);
 });
});
