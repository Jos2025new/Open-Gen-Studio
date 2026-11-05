const TILE=512,MASK=TILE-1,PAPER=new Uint8Array(TILE*TILE);{let s=99;for(let i=0;i<PAPER.length;i++){s=Math.imul(s^s>>>15,2246822519)^Math.imul(s^s>>>13,3266489917);s^=s>>>16;PAPER[i]=s&255}}
function stamp(img,ax,ay,bx,by,width,p,hard,skip){const r=Math.max(.5,width/2),dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy,R=r+1,R2=R*R,W=img.width,D=img.data,y0=Math.max(0,Math.floor(Math.min(ay,by)-R)),y1=Math.min(img.height,Math.ceil(Math.max(ay,by)+R));
 const cov=.74*p,soft=.12,lo=1-cov-soft,inv=1/(2*soft),rim=r*hard,rimInv=1/Math.max(1e-6,r-rim),rc=rim-1,rc2=rc*rc;
 const px_=(x,py,row)=>{const px=x+.5,qx=px-ax,qy=py-ay;let t=l2?(qx*dx+qy*dy)/l2:0;t=t<0?0:t>1?1:t;const ex=qx-t*dx,ey=qy-t*dy,d2=ex*ex+ey*ey;if(d2>R2)return;let c=(PAPER[(row&MASK)*TILE+(x&MASK)]/255-lo)*inv;c=c<0?0:c>1?1:c;c=c*c*(3-2*c);let f=(Math.sqrt(d2)-rim)*rimInv;f=f<0?1:f>1?0:1-f*f*(3-2*f);const v=c*f*p*255|0,i=(row*W+x)*4+3;if(v>D[i])D[i]=v};
 for(let y=y0;y<y1;y++){const py=y+.5;let xa,xb;if(Math.abs(dy)<1e-6){xa=Math.min(ax,bx)-R;xb=Math.max(ax,bx)+R}else{const t=Math.min(1,Math.max(0,(py-ay)/dy)),cx=ax+dx*t,e=R*Math.sqrt(1+dx*dx/(dy*dy));xa=cx-e;xb=cx+e}
  const x0=Math.max(0,Math.floor(xa)),x1=Math.min(W,Math.ceil(xb));let s0=x1,s1=x1;
  if(skip&&rc>0){const v=py-ay;if(v*v<rc2){const h=Math.sqrt(rc2-v*v);s0=Math.max(x0,Math.ceil(ax-h));s1=Math.min(x1,Math.floor(ax+h))}}
  for(let x=x0;x<Math.min(s0,x1);x++)px_(x,py,y);for(let x=Math.max(s1,x0);x<x1;x++)px_(x,py,y)}}
const res={};
for(const hard of [.5,.85])for(const s of [240,500,1000]){const c=s*3,n=s>=1000?30:60,run=(mode)=>{const img={data:new Uint8ClampedArray(c*c*4),width:c,height:c};let t=performance.now(),prevP=.6;for(let i=0;i<n;i++){const x=c/3+i*7,y=c/3+i*7;const p=mode==='rise'?.5+i*.004:.6;stamp(img,x,y,x+7,y+7,s,p,hard,mode==='skip'||(mode==='rise'&&false));}return [(performance.now()-t)/n,img]};
 run('full');const [a,A]=run('full'),[b,B]=run('skip');let diff=0,maxd=0;for(let i=3;i<A.data.length;i+=4){const d=Math.abs(A.data[i]-B.data[i]);if(d){diff++;if(d>maxd)maxd=d}}
 res[`dureza ${hard} size ${s}`]={completo:+a.toFixed(2),soloNuevo:+b.toFixed(2),pxDistintos:diff,difMax:maxd}}
document.body.innerText=JSON.stringify(res);
