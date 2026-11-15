import { describe,it,expect,vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis,{window:{setTimeout,clearTimeout,addEventListener:()=>undefined},document:{addEventListener:()=>undefined,visibilityState:'visible'}}));
vi.mock('../src/lib/idb',()=>({stateDb:{get:async()=>undefined,set:async()=>undefined,del:async()=>undefined},cacheDb:{get:async()=>undefined,set:async()=>undefined},getAssetBlob:async()=>undefined,putAssetBlob:async()=>undefined}));
import {ensureOmniNodes} from '../src/engine/nodes/omni';
import {createSession,useStore} from '../src/store/store';
describe('omnicanvas asset discovery',()=>{
 it('shows newest eight and does not duplicate them on reopening',()=>{
  const s=createSession('test'); const assets=Object.fromEntries(Array.from({length:8},(_,i)=>[`a${i}`,{id:`a${i}`,sessionId:s.id,kind:'image',createdAt:100+i}]));
  useStore.setState(st=>({sessions:{...st.sessions,[s.id]:s},assets:{...st.assets,...assets} as any})); ensureOmniNodes(s.id); ensureOmniNodes(s.id);
  expect(useStore.getState().sessions[s.id].graph.nodes.filter(n=>n.data.kind==='asset')).toHaveLength(8);
 });
 it('does not lose new assets that share a timestamp with the previous newest',()=>{
  const s=createSession('test'); const asset=(id:string)=>({id,sessionId:s.id,kind:'image',createdAt:100});
  useStore.setState(st=>({sessions:{...st.sessions,[s.id]:s},assets:{...st.assets,a:asset('a')} as any})); ensureOmniNodes(s.id);
  useStore.setState(st=>({assets:{...st.assets,b:asset('b')} as any})); ensureOmniNodes(s.id);
  expect(useStore.getState().sessions[s.id].graph.nodes.filter(n=>n.data.kind==='asset').map(n=>(n.data as any).assetId)).toContain('b');
 });
});
