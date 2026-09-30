import { describe, expect, it, vi } from 'vitest';
import type { PlanStep } from '../src/engine/types';
vi.hoisted(()=> Object.assign(globalThis,{window:{setTimeout,clearTimeout,addEventListener(){}},document:{addEventListener(){},visibilityState:'visible'}}));
vi.mock('../src/lib/idb',()=>({stateDb:{get:async()=>undefined,set:async()=>undefined},cacheDb:{get:async()=>undefined,set:async()=>undefined}}));
const requests=vi.hoisted(()=>[] as any[]);
const outputs=vi.hoisted(()=>new Map<string,string[]>());
vi.mock('../src/engine/jobs',async original=>({ ...await original<typeof import('../src/engine/jobs')>(),
 createGeneration:(spec:any)=>{requests.push(spec);return {...spec,id:spec.stepId};},
 runGeneration:async(id:string)=>{if(id==='fail')throw new Error('source failed');return outputs.get(id)??['only'];},
 opSpec:async(spec:any)=>({...spec,kind:'image',op:{id:spec.op,sourceAssetId:spec.sourceAssetId,params:spec.params}}),
}));
import { executeSteps } from '../src/engine/executor';
const settings={count:1,advanced:{}};
const image=(id:string,refs:string[]=[]):PlanStep=>({id,kind:'image',title:id,prompt:id,modelRef:'local::studio-image',settings,refs});
const context={sessionId:'s',workspace:'node' as const,origin:'node' as const,onState:()=>{}};
describe('node chain through the shared executor',()=>{
 it('passes selected candidates to image, first/last video frames, operations and local @Name',async()=>{
  requests.length=0;outputs.clear();outputs.set('source',['first','chosen']);
  const steps:PlanStep[]=[image('source'),image('image',['source#2']),{id:'video',kind:'video',title:'video',prompt:'go',modelRef:'local::studio-video',settings,firstFrame:'source#2',lastFrame:'source#2'},
   {id:'op',kind:'op',title:'op',op:'grid_split',input:'source#2',params:{grid:2}},
   {...image('local'),nodeSubjects:[{name:'Actor',from:'source#2'}],after:['source']}];
  const result=await executeSteps(steps,context);expect(result.failed).toEqual([]);
  expect(requests.find(r=>r.stepId==='image').inputs.refs).toEqual(['chosen']);
  expect(requests.find(r=>r.stepId==='video').inputs).toMatchObject({firstFrame:'chosen',lastFrame:'chosen'});
  expect(requests.find(r=>r.stepId==='op').op.sourceAssetId).toBe('chosen');
  expect(requests.find(r=>r.stepId==='local').inputs.subjects[0].frontalAssetId).toBe('chosen');
 });
 it('never silently replaces a missing candidate with the first',async()=>{
  requests.length=0;outputs.clear();outputs.set('source',['first']);
  const result=await executeSteps([image('source'),image('dependent',['source#2'])],context);
  expect(result.failed[0].error).toContain('Selected candidate 2');
  expect(requests.map(r=>r.stepId)).toEqual(['source']);
 });
 it('keeps successful outputs and skips dependents of a failure',async()=>{
  requests.length=0;outputs.clear();
  const result=await executeSteps([image('ok'),image('fail'),image('skipped',['fail']),image('later',['skipped'])],context);
  expect(result.outputs.has('ok')).toBe(true);expect(result.failed).toHaveLength(1);expect(result.skipped).toEqual(['skipped','later']);
 });
});
