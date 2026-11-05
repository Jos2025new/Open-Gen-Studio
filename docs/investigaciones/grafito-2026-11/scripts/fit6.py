import numpy as np,json
from concurrent.futures import ProcessPoolExecutor
src=open('fit5.py').read().split("\nif __name__")[0];exec(src)
FP=json.load(open('fit5.json'))
PAD=26;N=S+2*PAD
def gblur(a,sig):
    h,w=a.shape;fy=np.fft.fftfreq(h)[:,None];fx=np.fft.fftfreq(w)[None,:];return np.real(np.fft.ifft2(np.fft.fft2(a)*np.exp(-2*(np.pi*sig)**2*(fx*fx+fy*fy))))
def hand(seed,dens):
    "A loose hand: strokes curved and tilted, random starts and ends, uneven spacing and pressure; not the engine's job, the user's."
    r=np.random.default_rng(seed);out=[];y=PAD-2
    while y<N-PAD:
        y+=r.uniform(.8,dens*2-.8);out.append(dict(y=y,x0=PAD+r.normal(0,2.2),x1=N-PAD+r.normal(0,4)+r.exponential(3),tilt=r.normal(0,.035),bow=r.normal(0,2.2),ph=r.uniform(0,6.28),w=r.uniform(.8,1.2),gain=float(np.exp(r.normal(0,.22))),seed=int(r.integers(1e6))))
    return out
def swatch3(lead,G_,g):
    G[lead]=G_;H_=mk(N,N,g);fine=mk(N,N,1.05,seed=77);mott=mk(N,N,18,seed=31)*2-1;T=np.full((N*SS,N*SS),PAPER);col=L2G(G_['L']);dep=np.zeros_like(T)
    for ps,s0 in enumerate((11,29)):
        for st in hand(s0,G_.get('dens',3.2)):
            n=st['seed'];r=np.random.default_rng(n);size=8*st['w'];wd=size/2*G_['w']*1.1+5;a=max(0,int((st['y']-wd-abs(st['bow'])-5)*SS));b=min(N*SS,int((st['y']+wd+abs(st['bow'])+5)*SS))
            if b<=a:continue
            yy,xx=np.mgrid[a:b,0:N*SS];yy=(yy+.5)/SS;xx=(xx+.5)/SS;u=(xx-N/2)/N;yc=st['y']+st['tilt']*(xx-N/2)+st['bow']*np.sin(u*3.1+st['ph'])
            yn=(st['y']-PAD)/S;p0=max(.06,G_.get('top',1)*max(0.,1-yn)**G_.get('py',1.1))*st['gain'];nx=xx.shape[1];pe=p0;al=pe*(1+G_.get('dp',.2)*(noise1(nx,50*SS,r)-.5)+.1*(noise1(nx,9*SS,r)-.5))[None,:]*np.maximum(.1,1+G_.get('mot',.25)*mott[a:b])
            wv=size/2*G_['w']*(.6+.4*min(1,p0));drift=(noise1(nx,70*SS,r)[None,:]-.5)*5;v=(yy-yc)/wv;edge=1-sm(G_.get('edge',.45),1.1,np.abs(v))
            sn=noise1(8192,1,r);idx=np.clip((((v+1)*.5*9+drift)+sn[0]*40).astype(int),0,8190);fr=(idx-((v+1)*.5*9+drift+sn[0]*40));tip=1+G_['st']*(sn[idx]-.5)
            ends=sm(st['x0']-1,st['x0']+r.uniform(2,9),xx)*(1-sm(st['x1']-r.uniform(3,14),st['x1'],xx));al2=al*ends
            lev=.72*H_[a:b]+.28*fine[a:b]+G_.get('jit',.07)*(mk(N,N,1.3,100+n%40)[a:b]*2-1);th=1-np.clip(G_['c']*al2**.8*edge**.5,0,1);sf=G_.get('soft',.14);c=sm(th-sf,th+sf,lev)
            m=np.clip(edge*tip*G_['k']*(.22+.78*al2**G_.get('gam',1.15))*(G_['v']+(1-G_['v'])*c)*ends,0,1);T[a:b]=T[a:b]*(1-m)+col*m;dep[a:b]+=m
    # Rare graphite grit: thin dark hairs; dust: a faint blurred veil beyond the strokes.
    r=np.random.default_rng(5)
    for i in range(int(G_.get('hairs',5))):
        y=r.uniform(PAD,N-PAD);t=r.normal(0,.03);x0=r.uniform(PAD,N-PAD-20);l=r.uniform(15,70);yy,xx=np.mgrid[0:N*SS,0:N*SS];yy=(yy+.5)/SS;xx=(xx+.5)/SS;d=np.abs(yy-y-t*(xx-x0))
        m=(1-sm(.15,.75,d))*sm(x0,x0+3,xx)*(1-sm(x0+l-3,x0+l,xx))*.32;T=T*(1-m)+col*m
    veil=np.clip(gblur(np.minimum(dep,3),G_.get('dustr',7)*SS)*G_.get('dust',.07),0,.6);T=T*(1-veil)+col*veil
    return down(T)
def metrics2(a):
    m=metrics(a);L_=Ls(a);rows=L_.mean(1);tr=box(rows[None,:].repeat(1,0),0) if False else rows-np.convolve(np.pad(rows,12,mode='edge'),np.ones(25)/25,'valid');return np.append(m,float(tr.std()))
def loss2(m,r):
    d=np.abs(m-r);return float(d[0:15:3].sum()+1.5*d[1:15:3].sum()+12*d[2:15:3].sum()+6*d[15])
def ref_full(n):
    i=NAMES.index(n);x=int(X[i%4]+8-PAD);y=int(Y[i//4]+6-PAD);return IM[y:y+N,x:x+N]
def climb(lead):
    r=np.random.default_rng(sum(map(ord,lead)));tg=metrics2(ref(lead));cur=dict(FP[lead]);g=min(2.2,max(1.2,cur.pop('g')));cur.update(st=min(cur['st'],.35),dp=.2,mot=.25,py=1.1,top=1.,dens=3.2,edge=.45,dust=.07,dustr=7.,hairs=5.,jit=min(.16,cur.get('jit',.07)))
    ev=lambda p,gg:loss2(metrics2(swatch3(lead,p,gg)[PAD:PAD+S,PAD:PAD+S]),tg);start=best=ev(cur,g)
    for i in range(55):
        t=dict(cur);gg=g
        for k in t:
            if r.random()<.3:t[k]=t[k]*float(np.exp(r.normal(0,.14)))
        if r.random()<.2:gg=float(np.clip(g*np.exp(r.normal(0,.1)),1.1,2.6))
        t['L']=min(90,t['L']);t['v']=min(.95,t['v']);t['soft']=max(.04,t['soft']);t['c']=min(2,t['c']);t['dens']=float(np.clip(t['dens'],1.6,5));t['jit']=min(.2,t['jit']);t['st']=min(.5,t['st'])
        l=ev(t,gg)
        if l<best:best,cur,g=l,t,gg
    a=swatch3(lead,cur,g);np.save(f'fit6_{lead}.npy',a);return lead,start,best,dict(cur,g=g),metrics2(a[PAD:PAD+S,PAD:PAD+S]).tolist(),tg.tolist()
if __name__=='__main__':
    gr=['2H','HB','2B','4B','6B']
    with ProcessPoolExecutor(5) as ex:res=list(ex.map(climb,gr))
    tiles=[];out={}
    for lead,st,b,c,m,t in res:
        print(lead,'pérdida',round(st),'→',round(b),'L*',[round(v) for v in m[0:15:3]],'ref',[round(v) for v in t[0:15:3]],'grano',[round(v,1) for v in m[1:15:3]],'ref',[round(v,1) for v in t[1:15:3]],'ac',[round(v,2) for v in m[2:15:3]],'ref',[round(v,2) for v in t[2:15:3]],'filas',round(m[15],2),'ref',round(t[15],2));out[lead]=c
        tiles.append(np.vstack([ref_full(lead),np.ones((6,N)),np.load(f'fit6_{lead}.npy')]))
    json.dump(out,open('fit6.json','w'));sheet=np.hstack([np.hstack([t,np.ones((t.shape[0],6))]) for t in tiles]);open('fit6.pgm','wb').write(f'P5\n{sheet.shape[1]} {sheet.shape[0]}\n255\n'.encode()+np.uint8(np.clip(sheet,0,1)*255+.5).tobytes())
