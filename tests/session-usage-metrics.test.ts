import {describe,it,expect,vi,afterEach} from 'vitest';
vi.hoisted(()=>Object.assign(globalThis,{window:{setTimeout,clearTimeout,addEventListener:()=>undefined},document:{addEventListener:()=>undefined,visibilityState:'visible'}}));
vi.mock('../src/lib/idb',()=>({stateDb:{get:async()=>undefined,set:async()=>undefined,del:async()=>undefined},cacheDb:{get:async()=>undefined,set:async()=>undefined},getAssetBlob:async()=>undefined,putAssetBlob:async()=>undefined}));
import {sendAgentMessage} from '../src/engine/agent/runtime';
import {MAX_METRICS,startRequest,recordMetric,closeRequest,sessionMetricsTotals} from '../src/engine/agent/metrics';
import {createSession,useStore} from '../src/store/store';
afterEach(()=>vi.unstubAllGlobals());
describe('session usage versus request metrics',()=>{
 it('keeps the entire sum via aggregate + kept metrics after more than 50 requests',async()=>{
  const s=createSession('test'); useStore.setState(st=>({sessions:{...st.sessions,[s.id]:s},activeSessionId:s.id,settings:{...st.settings,keys:{...st.settings.keys,nanogpt:'k'},agent:{...st.settings.agent,provider:'nanogpt',model:'m'}},composer:{...st.composer,agentStyle:'direct',attachments:[]}}));
  for(let i=0;i<50;i++){ startRequest(s.id,{request:'old',workspace:'chat',engine:'m',attachments:0}); recordMetric(s.id,{type:'call',inputTokens:1000,outputTokens:50,usd:.001}); closeRequest(s.id,'approved'); }
  useStore.setState(st=>({sessions:{...st.sessions,[s.id]:{...st.sessions[s.id],usage:{inputTokens:50000,outputTokens:2500,llmUsd:.05}}}}));
  vi.stubGlobal('fetch',async (_url:string,init?:RequestInit)=>{const body=init?.body?JSON.parse(String(init.body)):{}; if(!body.messages)return new Response(JSON.stringify({data:[]})); return new Response('data: '+JSON.stringify({choices:[{delta:{content:'ok'}}],usage:{prompt_tokens:1000,completion_tokens:50,cost:0.001}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})});
  await sendAgentMessage('new'); const session=useStore.getState().sessions[s.id];
  expect(session.agentMetrics).toHaveLength(MAX_METRICS);
  expect(session.usage.inputTokens).toBe((session.agentMetricsAggregate?.inputTokens??0)+(session.agentMetrics??[]).reduce((a,m)=>a+m.inputTokens,0));
  expect(session.usage.outputTokens).toBe((session.agentMetricsAggregate?.outputTokens??0)+(session.agentMetrics??[]).reduce((a,m)=>a+m.outputTokens,0));
  expect(session.usage.llmUsd).toBeCloseTo((session.agentMetricsAggregate?.llmUsd??0)+(session.agentMetrics??[]).reduce((a,m)=>a+m.llmUsd,0));
  expect(sessionMetricsTotals(session)).toMatchObject({requests:51,inputTokens:session.usage.inputTokens,outputTokens:session.usage.outputTokens});
 });
 it('loads older saved sessions without agentMetricsAggregate and folds overflow when trimmed',()=>{
  const legacy=createSession('legacy');
  legacy.usage={inputTokens:200,outputTokens:20,llmUsd:0.02};
  legacy.agentMetrics=Array.from({length:2},(_,i)=>({id:`am_${i}`,startedAt:i,request:'r',workspace:'chat',engine:'m',style:'direct',attachments:0,llmCalls:1,inputTokens:100,outputTokens:10,llmUsd:0.01,agentMs:5,questionRounds:0,plans:0,revisions:0,rejectedPlans:0,findModels:0,models:[]}));
  const merge=useStore.persist.getOptions().merge!;
  const merged=merge({sessions:{[legacy.id]:legacy},activeSessionId:legacy.id},useStore.getState());
  const loaded=merged.sessions[legacy.id];
  expect(loaded.agentMetricsAggregate).toBeUndefined();
  expect(sessionMetricsTotals(loaded)).toMatchObject({requests:2,inputTokens:200,outputTokens:20});
  expect(sessionMetricsTotals(loaded).llmUsd).toBeCloseTo(0.02);
  useStore.setState({sessions:{...useStore.getState().sessions,[loaded.id]:loaded}});
  for(let i=0;i<MAX_METRICS;i++){ startRequest(loaded.id,{request:`n${i}`,workspace:'chat',engine:'m',attachments:0}); recordMetric(loaded.id,{type:'call',inputTokens:10,outputTokens:1,usd:0.001}); closeRequest(loaded.id,'approved'); }
  const trimmed=useStore.getState().sessions[loaded.id];
  expect(trimmed.agentMetrics).toHaveLength(MAX_METRICS);
  expect(trimmed.agentMetricsAggregate).toMatchObject({requests:2,inputTokens:200,outputTokens:20});
  expect(sessionMetricsTotals(trimmed)).toMatchObject({requests:52,inputTokens:700,outputTokens:70});
 });
 it('records wrap-up tokens on the open request',()=>{const s=createSession('test');useStore.setState(st=>({sessions:{...st.sessions,[s.id]:s}})); startRequest(s.id,{request:'x',workspace:'chat',engine:'m',attachments:0}); recordMetric(s.id,{type:'call',inputTokens:7,outputTokens:3,usd:.01,wrapUp:true});expect(useStore.getState().sessions[s.id].agentMetrics?.[0]).toMatchObject({inputTokens:7,outputTokens:3,wrapUpCalls:1});});
});
