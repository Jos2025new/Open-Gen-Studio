// Lightweight candidate: paper in a precomputed tile, contact as a smoothstep on it, deposit from the layer's alpha; no hash, no hypot per pixel.
const TILE=512,MASK=TILE-1;
function makeTile(grain=2.2){ // Band-limited by three box-blurred noises (cheap, no FFT), then rank-normalised to 0..255.
  const n=TILE*TILE,out=new Float32Array(n); let s=12345;const r=()=>{s=Math.imul(s^s>>>15,2246822519)^Math.imul(s^s>>>13,3266489917);return ((s^=s>>>16)>>>0)/4294967296};
  for(const [rad,w] of [[Math.round(grain),1],[Math.round(grain*2.2),.5]]){const a=new Float32Array(n),b=new Float32Array(n);for(let i=0;i<n;i++)a[i]=r()-.5;
    for(let pass=0;pass<2;pass++){for(let y=0;y<TILE;y++){let t=0;for(let k=-rad;k<=rad;k++)t+=a[y*TILE+(k&MASK)];for(let x=0;x<TILE;x++){b[y*TILE+x]=t;t+=a[y*TILE+((x+rad+1)&MASK)]-a[y*TILE+((x-rad)&MASK)]}}
      for(let x=0;x<TILE;x++){let t=0;for(let k=-rad;k<=rad;k++)t+=b[(k&MASK)*TILE+x];for(let y=0;y<TILE;y++){a[y*TILE+x]=t;t+=b[((y+rad+1)&MASK)*TILE+x]-b[((y-rad)&MASK)*TILE+x]}}}
    const norm=Math.sqrt(a.reduce((q,v)=>q+v*v,0)/n);for(let i=0;i<n;i++)out[i]+=w*a[i]/norm}
  const idx=Array.from({length:n},(_,i)=>i).sort((p,q)=>out[p]-out[q]),u=new Uint8Array(n);idx.forEach((id,k)=>u[id]=k*256/n);return u}
const t0=performance.now();const PAPER=makeTile();const tileMs=performance.now()-t0;
function stampLight(img,ox,oy,ax,ay,bx,by,width,p,base){ // base: Uint8 alpha of the layer before the stroke (or null). Same max-coverage rule as the capsule.
  const r=Math.max(.5,width/2),dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy,R=r+1,R2=R*R,W=img.width,D=img.data;
  const y0=Math.max(0,Math.floor(Math.min(ay,by)-R-oy)),y1=Math.min(img.height,Math.ceil(Math.max(ay,by)+R-oy));
  const cov=1.4*p*.53,soft=.12,a=1-cov,lo=a-soft,inv=1/(2*soft),rim=r*.5,rimInv=1/(r*.55);
  for(let y=y0;y<y1;y++){const py=y+oy+.5;
    // Only the span the capsule can touch on this row, not the whole box.
    let xa,xb; if(Math.abs(dy)<1e-6){xa=Math.min(ax,bx)-R;xb=Math.max(ax,bx)+R}else{const t=Math.min(1,Math.max(0,(py-ay)/dy)),cx=ax+dx*t,ex=R*Math.sqrt(1+dx*dx/(dy*dy));xa=cx-ex;xb=cx+ex}
    const x0=Math.max(0,Math.floor(xa-ox)),x1=Math.min(W,Math.ceil(xb-ox)),row=y*W,tr=(y+oy&MASK)*TILE;
    for(let x=x0;x<x1;x++){const px=x+ox+.5,qx=px-ax,qy=py-ay;let t=l2?(qx*dx+qy*dy)/l2:0;t=t<0?0:t>1?1:t;const ex=qx-t*dx,ey=qy-t*dy,d2=ex*ex+ey*ey;if(d2>R2)continue;
      let h=PAPER[tr+(x+ox&MASK)]/255; if(base){const m=base[row+x]/255;h+=.6*(1-h)*m}
      let c=(h-lo)*inv;c=c<0?0:c>1?1:c;c=c*c*(3-2*c);
      const dist=Math.sqrt(d2);let f=(dist-rim)*rimInv;f=f<0?1:f>1?0:1-f*f*(3-2*f);
      const v=c*f*p*255|0,i=(row+x)*4+3;if(v>D[i])D[i]=v}}}
const size=[5,10,20,40,80,240,1000],SEG=10,N=(s)=>s>=240?40:400;
const rows=[];
function bench(name,fn){const out={name};for(const s of size){const c=Math.max(1200,s*3),img={data:new Uint8ClampedArray(c*c*4),width:c,height:c},n=N(s);let t=performance.now();for(let i=0;i<n;i++){const x=c/3+(i%60)*SEG*.7,y=c/3+(i%60)*SEG*.7;fn(img,x,y,x+SEG*.7,y+SEG*.7,s)}out[s]=(performance.now()-t)/n}rows.push(out)}
const pv=(id)=>[...E.PENCIL_PRESETS,...E.DAB_PRESETS].find(p=>p.id===id).values;
const tipOf=(o)=>E.tipFor(o,false);
for(let round=0;round<2;round++){rows.length=0;
bench('actual HB (hypot, ruido, edge)',(img,ax,ay,bx,by,s)=>{const o={...pv('pencil-hb'),size:s};E.stampSegment(img,0,0,[ax,ay,bx,by,s],.6,bench.t??(bench.t=tipOf(o)),[0,0,0])});
bench.t=null;
bench('actual sin edge',(img,ax,ay,bx,by,s)=>{E.stampSegment(img,0,0,[ax,ay,bx,by,s],.6,bench.u??(bench.u=tipOf({...pv('pencil-hb'),size:s,edge:0})),[0,0,0])});
bench.u=null;
let seed=1;bench('actual 2B dabs (segmento suelto)',(img,ax,ay,bx,by,s)=>{const t=bench.v??(bench.v=tipOf({...pv('dabs-2b'),size:s}));t.dabs.seed=7;const ox=Math.floor(ax-s*2),oy=Math.floor(ay-s*2),w=Math.ceil(s*4+10);const m={data:new Uint8ClampedArray(w*w*4),width:w,height:w};E.stampDabStroke(m,ox,oy,[[ax,ay,bx,by,s]],[.6],t,[0,0,0])});
bench.v=null;
bench('ligero sin leer capa',(img,ax,ay,bx,by,s)=>stampLight(img,0,0,ax,ay,bx,by,s,.6,null));
{const zero=new Uint8Array(4000*4000);bench('ligero con depósito de capa',(img,ax,ay,bx,by,s)=>stampLight(img,0,0,ax,ay,bx,by,s,.6,img.width<=4000?zero:new Uint8Array(img.width*img.height)))}
}
// Canvas costs: what paintLive does around the stamp, per segment.
const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
const can={};
for(const S of [1024,2048,4096]){const base=canvas(S,S),buf=canvas(S,S),mask=canvas(S,S),bx=base.getContext('2d'),bu=buf.getContext('2d'),mx=mask.getContext('2d');bx.fillStyle='#888';bx.fillRect(0,0,S,S);bu.drawImage(base,0,0);
 const all=new ImageData(S,S);const R=64,n=120;let t;
 t=performance.now();for(let i=0;i<n;i++)mx.putImageData(all,0,0,(i*7)%(S-R),(i*11)%(S-R),R,R);const put=(performance.now()-t)/n;
 t=performance.now();for(let i=0;i<n;i++){const x=(i*7)%(S-R),y=(i*11)%(S-R);bu.clearRect(x,y,R,R);bu.drawImage(base,x,y,R,R,x,y,R,R);bu.drawImage(mask,x,y,R,R,x,y,R,R)}bu.getImageData(0,0,1,1);const comp=(performance.now()-t)/n;
 t=performance.now();const full=bx.getImageData(0,0,S,S);const read=performance.now()-t;
 t=performance.now();const tile=bx.getImageData(10,10,256,256);const tileR=performance.now()-t;
 t=performance.now();new Uint8Array(S*S);const al=new Uint8Array(S*S);for(let i=0;i<S*S;i++)al[i]=full.data[i*4+3];const ext=performance.now()-t;
 can[S]={putDirty64:+put.toFixed(3),clearDrawDraw64:+comp.toFixed(3),getImageDataFull:+read.toFixed(1),getImageDataTile256:+tileR.toFixed(2),extractAlpha:+ext.toFixed(1)}}
document.body.innerText=JSON.stringify({tileMs:+tileMs.toFixed(1),hw:navigator.hardwareConcurrency,msPorSegmento10px:rows.map(r=>({name:r.name,...Object.fromEntries(size.map(s=>[s,+r[s].toFixed(3)]))})),canvas:can},null,0);
