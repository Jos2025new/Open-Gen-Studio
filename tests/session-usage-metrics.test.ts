import {describe,it,expect,vi,afterEach} from 'vitest';
vi.hoisted(()=>Object.assign(globalThis,{window:{setTimeout,clearTimeout,addEventListener:()=>undefined},document:{addEventListener:()=>undefined,visibilityState:'visible'}}));
vi.mock('../src/lib/idb',()=>({stateDb:{get:async()=>undefined,set:async()=>undefined,del:async()=>undefined},cacheDb:{get:async()=>undefined,set:async()=>undefined},getAssetBlob:async()=>undefined,putAssetBlob:async()=>undefined}));
import {sendAgentMessage} from '../src/engine/agent/runtime';
import {startRequest,recordMetric,closeRequest} from '../src/engine/agent/metrics';
import {createSession,useStore} from '../src/store/store';
afterEach(()=>vi.unstubAllGlobals());
describe('session usage versus request metrics',()=>{
 it('keeps the entire sum after more than 50 requests',async()=>{
  const s=createSession('test'); useStore.setState(st=>({sessions:{...st.sessions,[s.id]:s},activeSessionId:s.id,settings:{...st.settings,keys:{...st.settings.keys,nanogpt:'k'},agent:{...st.settings.agent,provider:'nanogpt',model:'m'}},composer:{...st.composer,agentStyle:'direct',attachments:[]}}));
  for(let i=0;i<50;i++){ startRequest(s.id,{request:'old',workspace:'chat',engine:'m',attachments:0}); recordMetric(s.id,{type:'call',inputTokens:1000,outputTokens:50,usd:.001}); closeRequest(s.id,'approved'); }
  useStore.setState(st=>({sessions:{...st.sessions,[s.id]:{...st.sessions[s.id],usage:{inputTokens:50000,outputTokens:2500,llmUsd:.05}}}}));
  vi.stubGlobal('fetch',async (_url:string,init?:RequestInit)=>{const body=init?.body?JSON.parse(String(init.body)):{}; if(!body.messages)return new Response(JSON.stringify({data:[]})); return new Response('data: '+JSON.stringify({choices:[{delta:{content:'ok'}}],usage:{prompt_tokens:1000,completion_tokens:50,cost:0.001}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})});
  await sendAgentMessage('new'); const session=useStore.getState().sessions[s.id];
  expect(session.usage.inputTokens).toBe((session.agentMetrics??[]).reduce((a,m)=>a+m.inputTokens,0));
 });
 it('records wrap-up tokens on the open request',()=>{const s=createSession('test');useStore.setState(st=>({sessions:{...st.sessions,[s.id]:s}})); startRequest(s.id,{request:'x',workspace:'chat',engine:'m',attachments:0}); recordMetric(s.id,{type:'call',inputTokens:7,outputTokens:3,usd:.01,wrapUp:true});expect(useStore.getState().sessions[s.id].agentMetrics?.[0]).toMatchObject({inputTokens:7,outputTokens:3,wrapUpCalls:1});});
});
