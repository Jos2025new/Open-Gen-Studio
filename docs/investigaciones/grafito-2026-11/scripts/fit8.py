import numpy as np,json
from concurrent.futures import ProcessPoolExecutor
src=open('fit7.py').read().split("\nP=json.load")[0];exec(src)
def swatch4(lead,p):
    "Thin strokes in several layers. Per-pixel ceiling from the paper height; deposit proportional to penetration."
    r=np.random.default_rng(11);T=np.full((N*SS,N*SS),PAPER);col=L2G(p['L']);ceil=col+p['dc']*(1-PR)**1.4*(PAPER-col);YY,XX=np.mgrid[0:N*SS,0:N*SS];YY=(YY+.5)/SS;XX=(XX+.5)/SS
    fine=mk(N,N,1.25,seed=61)
    for layer in range(int(p['layers'])):
        tiltL=r.normal(0,.03);y=PAD-1.5
        while y<N-PAD+1:
            y+=r.uniform(.4,p['dens']*2-.4);w=r.uniform(.8,1.25)*p['w'];bow=r.normal(0,1.4);a=max(0,int((y-w-abs(bow)-6)*SS));b=min(N*SS,int((y+w+abs(bow)+6)*SS))
            if b<=a:continue
            x=XX[a:b];u=(x-N/2)/N;yc=y+(tiltL+r.normal(0,.012))*(x-N/2)+bow*np.sin(u*3.1+r.uniform(0,6.28));d=np.abs(YY[a:b]-yc)/w;edge=1-sm(p['edge'],1.15,d)
            yn=(y-PAD)/S;gain=float(np.exp(r.normal(0,p['gv'])));p0=max(.05,p['top']*max(0.,1-yn)**p['py'])*gain
            nx=x.shape[1];al=p0*(1+.35*(noise1(nx,30*SS,r)-.5)+.25*(noise1(nx,7*SS,r)-.5))[None,:]
            x0=PAD+r.normal(0,1.8)-r.exponential(1.2);x1=N-PAD+r.normal(0,2.2)+r.exponential(2.2);ends=sm(x0,x0+r.uniform(1,12),x)*(1-sm(x1-r.uniform(3,28),x1,x));al=al*ends
            lev=.8*PR[a:b]+.2*fine[a:b]+p['jit']*(mk(N,N,1.2,100+int(r.integers(30)))[a:b]*2-1);th=1-np.clip(p['c']*al**.7,0,1.2);pen=np.clip((lev-th+p['soft'])/(2*p['soft']),0,1)
            m=np.clip(edge*ends*p['k']*(.2+.8*al**p['gam'])*(p['v']+(1-p['v'])*pen**p['gp']),0,1);sub=T[a:b];T[a:b]=sub-(sub-ceil[a:b])*m*(sub>ceil[a:b])
    return down(T)
def climb(lead):
    r=np.random.default_rng(sum(map(ord,lead)));tg=metrics2(ref(lead));f=json.load(open('fit6.json'))[lead]
    cur=dict(L=f['L']*.85,dc=.35,k=f['k']*.28,v=min(.6,f['v']),c=f['c'],soft=.22,gp=1.2,gam=1.,py=f.get('py',1.1),top=1.,jit=.05,edge=.3,w=1.3,gv=.3,dens=1.6,layers=3.)
    ev=lambda q:loss2(metrics2(swatch4(lead,q)[PAD:PAD+S,PAD:PAD+S]),tg);start=best=ev(cur)
    for i in range(70):
        t=dict(cur)
        for k_ in t:
            if k_!='layers' and r.random()<.3:t[k_]=t[k_]*float(np.exp(r.normal(0,.15)))
        if r.random()<.1:t['layers']=float(np.clip(t['layers']+r.choice([-1,1]),1,5))
        t.update(L=min(90,t['L']),v=min(.95,t['v']),soft=float(np.clip(t['soft'],.05,.5)),c=min(2.2,t['c']),dens=float(np.clip(t['dens'],.9,3)),dc=min(.9,t['dc']),w=float(np.clip(t['w'],.7,2.4)),jit=min(.2,t['jit']),edge=min(.8,t['edge']),k=min(.9,t['k']))
        l=ev(t)
        if l<best:best,cur=l,t
    a=swatch4(lead,cur);np.save(f'fit8_{lead}.npy',a);return lead,start,best,cur,metrics2(a[PAD:PAD+S,PAD:PAD+S]).tolist(),tg.tolist()
if __name__=='__main__':
    gr=['2H','HB','2B','4B','6B']
    with ProcessPoolExecutor(5) as ex:res=list(ex.map(climb,gr))
    tiles=[];out={}
    for lead,st,b,c,m,t in res:
        print(lead,'pérdida',round(st),'→',round(b),'L*',[round(v) for v in m[0:15:3]],'ref',[round(v) for v in t[0:15:3]],'grano',[round(v,1) for v in m[1:15:3]],'ref',[round(v,1) for v in t[1:15:3]],'ac',[round(v,2) for v in m[2:15:3]],'ref',[round(v,2) for v in t[2:15:3]]);out[lead]=c
        tiles.append(np.vstack([ref_full(lead),np.ones((6,N)),np.load(f'fit8_{lead}.npy')]))
    json.dump(out,open('fit8.json','w'));sheet=np.hstack([np.hstack([t,np.ones((t.shape[0],6))]) for t in tiles]);open('fit8.pgm','wb').write(f'P5\n{sheet.shape[1]} {sheet.shape[0]}\n255\n'.encode()+np.uint8(np.clip(sheet,0,1)*255+.5).tobytes())
