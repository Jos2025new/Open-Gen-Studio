import {A,B,C} from './all.mjs';import {writeFileSync} from 'node:fs';
const W=170,H=170;let rng=9;const R=()=>{rng=Math.imul(rng,1664525)+1013904223>>>0;return rng/4294967296};
const fns={A,B,C};const out={};
for(const g of ['2H','2B','6B'])for(const k of Object.keys(fns)){rng=9;const img={data:new Uint8ClampedArray(W*H*4),width:W,height:H},tip={hardness:1,lead:{grade:g,seed:12345}};
 // a hand hatching one diagonal zigzag without lifting, then again over the top half
 let x=25,y=145,d=1;const seg=(nx,ny,p)=>{const dx=nx-x,dy=ny-y,n=Math.max(1,Math.ceil(Math.hypot(dx,dy)/3));let px=x,py=y;for(let i=1;i<=n;i++){const qx=x+dx*i/n,qy=y+dy*i/n,pr=p*(.6+.4*Math.sin(i/n*3.14));fns[k](img,0,0,[px,py,qx,qy,4.5],pr,tip,[0,0,0]);px=qx;py=qy}x=nx;y=ny};
 for(let i=0;i<34;i++){seg(25+i*3.2+40+R()*8,50+R()*14,.65);seg(25+(i+1)*3.2+R()*3,145-R()*18,.65)}
 const T=new Uint8Array(W*H);let s=0,c=0;for(let i=0;i<W*H;i++){const a=img.data[i*4+3]/255,v=img.data[i*4]/255,t=1-(1-v)*a;T[i]=t*255;if(a>0){s+=t*255;c++}}writeFileSync(`${g}_${k}.gray`,T);out[g+k]=+(s/c).toFixed(1)}
console.log(JSON.stringify(out));
