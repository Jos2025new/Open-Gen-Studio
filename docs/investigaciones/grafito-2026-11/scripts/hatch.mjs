// Hatches the sheet's swatch with the real engine: same stroke count per pixel as a hand, pressure falling top to bottom as in the fit.
import { stampSegment, tipFor } from './lead.mjs';
import { writeFileSync } from 'node:fs';
const FIT={'2H':[.718,1.753,4],HB:[.969,1.533,5],'2B':[1.219,2.4,4],'4B':[.877,2.4,4],'6B':[1.483,1.37,5]};
const N=222,PAD=26,S=170;let rng=12345;const R=()=>{rng=Math.imul(rng,1664525)+1013904223>>>0;return rng/4294967296};
const tiles=[];let ms=0,segs=0;
for(const g of Object.keys(FIT)){const [py,w,layers]=FIT[g];const T=new Float64Array(N*N).fill(1);
 for(let l=0;l<layers;l++){const tilt=(R()-.5)*.06;for(let y=PAD-2;y<N-PAD+2;y+=2*w/1.5*(.7+.6*R())){
  const img={data:new Uint8ClampedArray(N*N*4),width:N,height:N},yn=(y-PAD)/S,p=Math.max(.05,Math.max(0,1-yn)**py)*1;
  const tip=tipFor({size:2*w,lead:g,pressureDensity:true},false);tip.lead.seed=R()*0x7fffffff|0;const x0=PAD-R()*5,x1=N-PAD+R()*7,bow=(R()-.5)*3,ph=R()*6.28;
  let px=x0,py0=y+tilt*(x0-N/2);for(let x=x0+8;x<x1;x+=8){const yy=y+tilt*(x-N/2)+bow*Math.sin((x-N/2)/N*3.1+ph);const t=performance.now();stampSegment(img,0,0,[px,py0,x,yy,2*w],p,tip,[0,0,0],{width:2*w,density:p});ms+=performance.now()-t;segs++;px=x;py0=yy}
  for(let i=0;i<N*N;i++){const a=img.data[i*4+3]/255;if(!a)continue;const c=img.data[i*4]/255;if(T[i]>c)T[i]-=(T[i]-c)*a}
 }}
 const b=new Uint8Array(N*N);for(let i=0;i<N*N;i++)b[i]=T[i]*255+.5;writeFileSync(`js_${g}.gray`,b);tiles.push(g)}
const tt=performance.now();console.log('ms/segmento 8px, tamaño ~3-5:',(ms/segs).toFixed(4));
// cost at the sizes the user paints
for(const size of [5,20,80,240]){const M=size*2+40,img={data:new Uint8ClampedArray(M*M*4),width:M,height:M},tip=tipFor({size,lead:'2B',pressureDensity:true},false);let t=performance.now();const n=200;for(let i=0;i<n;i++)stampSegment(img,0,0,[M/2-5,M/2,M/2+5,M/2,size],.7,tip,[0,0,0]);console.log('size',size,'ms/seg 10px',((performance.now()-t)/n).toFixed(3))}
