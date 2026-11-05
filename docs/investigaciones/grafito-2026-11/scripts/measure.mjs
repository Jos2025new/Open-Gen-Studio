import { writeFileSync } from 'node:fs';
import { atPressure, tipFor, stampSegment, stampDabStroke, PENCIL_PRESETS, DAB_PRESETS } from './engine.mjs';
const W=320,H=180;
const preset=(id)=>[...PENCIL_PRESETS,...DAB_PRESETS].find(p=>p.id===id).values;
function stroke(o,{pFn=()=>0.5,seed=7,dy=0,W:w=W,H:h=H,x0=30,x1=null}={}){
  const img={data:new Uint8ClampedArray(w*h*4),width:w,height:h};const tip=tipFor(o,false);if(tip.dabs)tip.dabs.seed=seed;
  const segs=[],dens=[];const end=x1??w-30,cy=h/2+dy;
  for(let x=x0;x<end;x+=3){const u=(x-x0)/(end-x0),a=atPressure(o,pFn(u));segs.push([x,cy,x+3,cy,a.width]);dens.push(a.density);}
  if(tip.dabs)stampDabStroke(img,0,0,segs,dens,tip,[0,0,0]);
  else segs.forEach((s,i)=>stampSegment(img,0,0,s,dens[i],tip,[0,0,0],i?{width:segs[i-1][4],density:dens[i-1]}:undefined));
  const al=new Float64Array(w*h);for(let i=0;i<w*h;i++)al[i]=img.data[i*4+3]/255;return al;
}
const lin=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4, Lstar=v=>{const y=lin(v);return y>.008856?116*Math.cbrt(y)-16:903.3*y};
function metrics(al,o,base){
  // Core band: central half of the requested width, middle of the stroke. Alpha over white with the preset's opacity.
  const op=o.opacity??1,w=atPressure(o,.5).width,r=Math.max(1,Math.round(w/4)),cy=H/2,vals=[];let holes=0;
  for(let y=cy-r;y<cy+r;y++)for(let x=60;x<W-60;x++){const a=al[y*W+x]*op,L=Lstar(1-a);vals.push(L);if(a<.05)holes++;}
  const m=vals.reduce((s,v)=>s+v,0)/vals.length,sd=Math.sqrt(vals.reduce((s,v)=>s+(v-m)**2,0)/vals.length);
  let width=0;for(let y=0;y<H;y++){let s=0;for(let x=60;x<W-60;x++)s+=al[y*W+x];if(s/(W-120)>.03)width++;}
  // Edge roughness: std of the top-most painted y per column.
  const tops=[];for(let x=60;x<W-60;x++){let t=H;for(let y=0;y<H;y++)if(al[y*W+x]>.1){t=y;break;}tops.push(t);}const tm=tops.reduce((a,b)=>a+b,0)/tops.length,rough=Math.sqrt(tops.reduce((s,v)=>s+(v-tm)**2,0)/tops.length);
  let d=0;if(base){let n=0;for(let y=cy-r;y<cy+r;y++)for(let x=60;x<W-60;x++){d+=Math.abs(Lstar(1-al[y*W+x]*op)-Lstar(1-base[y*W+x]*op));n++;}d/=n;}
  return {m,sd,holes:holes/vals.length*100,width,rough,d};
}
const fmt=(n,w=6,p=1)=>n.toFixed(p).padStart(w);
function sweep(title,base,key,vals,opt){
  console.log(`\n${title}: ${key}`);console.log('  valor |    L* | contraste | huecos% | ancho | rugosidad | ΔL* paso');
  let prev=null;for(const v of vals){const o={...base,[key]:v},al=stroke(o,opt),m=metrics(al,o,prev);console.log(`${fmt(v,7,2)} |${fmt(m.m)} |${fmt(m.sd,10)} |${fmt(m.holes,8)} |${fmt(m.width,6,0)} |${fmt(m.rough,10,2)} |${prev?fmt(m.d,7,2):'      -'}`);prev=al;}
}
const q=[0,.25,.5,.75,1];
const hb={...preset('pencil-hb'),size:20},b2={...preset('dabs-2b'),size:20};
console.log('=== CÁPSULA, base Pencil HB, size 20, presión 0.5');
for(const k of ['textureStrength','valleyFill','edge','hardness','minDensity','leadHardness'])sweep('Cápsula',hb,k,q);
sweep('Cápsula',hb,'minSize',q);
console.log('\n=== Edge según size (HB, edge .25 y 1)');
for(const s of [3,5,20,80,200]){for(const e of [0,.25,1]){const o={...hb,size:s,edge:e},al=stroke(o),m=metrics(al,o);console.log(`size ${String(s).padStart(3)} edge ${e.toFixed(2)} ancho ${m.width} rugosidad ${m.rough.toFixed(2)} px (${(m.rough/(atPressure(o,.5).width)*100).toFixed(1)} % del ancho)`);}}
console.log('\n=== DABS, base 2B dabs, size 20, presión 0.5');
sweep('Dabs',b2,'dabFlow',[.01,.05,.1,.2,.3,.5,.75,1]);
sweep('Dabs',b2,'dabSpacing',[.05,.1,.25,.5,.75,1]);
sweep('Dabs',b2,'dabScatter',[0,.5,1,1.5,2]);
sweep('Dabs',b2,'dabSizeJitter',q);
sweep('Dabs',b2,'textureStrength',q);
sweep('Dabs',b2,'hardness',q);
console.log('\n=== Lead hardness: densidad a presión 0.25/0.5/0.75');
for(const lh of [0,.15,.26,.34,.5,1])console.log(lh.toFixed(2),[.25,.5,.75].map(p=>atPressure({size:1,pressureDensity:true,minDensity:.3,leadHardness:lh},p).density.toFixed(3)).join(' '));
// Paper texture statistics
import('./engine.mjs').then(({textureAt})=>{const n=512,v=[];for(let y=0;y<n;y++)for(let x=0;x<n;x++)v.push(textureAt('graphite',x,y));
 const z=v.filter(a=>a===0).length/v.length,o=v.filter(a=>a===1).length/v.length,m=v.reduce((a,b)=>a+b,0)/v.length;
 const ac=(dx,dy)=>{let s=0,sa=0,c=0;for(let y=0;y<n-dy;y++)for(let x=0;x<n-dx;x++){const a=v[y*n+x]-m,b=v[(y+dy)*n+x+dx]-m;s+=a*b;sa+=a*a;c++}return s/sa};
 console.log('\n=== Textura Graphite: media',m.toFixed(3),'valle=0:',(z*100).toFixed(1)+'%','cresta=1:',(o*100).toFixed(1)+'%');
 console.log('autocorrelación a 1,2,3,4,6,8 px (x):',[1,2,3,4,6,8].map(d=>ac(d,0).toFixed(3)).join(' '));console.log('(y):',[1,2,3,4,6,8].map(d=>ac(0,d).toFixed(3)).join(' '));
 // Multi-pass: HB/4B at 10 and 20 px, how the tone and holes evolve.
 console.log('\n=== Pasadas (src-over, misma textura, ±1 px de jitter), presión .5');
 for(const id of ['pencil-hb','pencil-4b','dabs-2b'])for(const s of [10,20]){const o={...preset(id),size:s};let T=new Float64Array(W*H).fill(1);const row=[];for(let p=1;p<=20;p++){const al=stroke(o,{seed:p,dy:(p%3)-1}),op=o.opacity??1,mul=o.blend==='multiply';for(let i=0;i<T.length;i++){T[i]=T[i]*(1-al[i]*op);}
   if([1,2,3,5,10,20].includes(p)){const r=Math.max(1,Math.round(atPressure(o,.5).width/4)),vals=[];for(let y=H/2-r;y<H/2+r;y++)for(let x=60;x<W-60;x++)vals.push(Lstar(T[y*W+x]));const m=vals.reduce((a,b)=>a+b,0)/vals.length,sd=Math.sqrt(vals.reduce((a,b)=>a+(b-m)**2,0)/vals.length);row.push(`${p}p L*${m.toFixed(0)}±${sd.toFixed(0)}`);}}
   console.log(id,s+'px',row.join(' · '));}
});
