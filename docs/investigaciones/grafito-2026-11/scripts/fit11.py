import numpy as np,json
from concurrent.futures import ProcessPoolExecutor
src=open('fit9.py').read().split("\ndef climb")[0];exec(src)
def swatch5(lead,p):
    "Strokes taper to a point instead of fading; each layer shares one wrist curve; the first layer is a soft veil under the thin lines."
    r=np.random.default_rng(11);MG=11;T=np.full((N*SS,N*SS),PAPER);col=L2G(p['L']);ceil=col+p['dc']*(1-PR)**1.4*(PAPER-col);YY,XX=np.mgrid[0:N*SS,0:N*SS];YY=(YY+.5)/SS;XX=(XX+.5)/SS;fine=mk(N,N,.95,seed=61);D=p['d']
    for layer in range(int(p['layers'])):
        veil=layer==0;tiltL=r.normal(0,.022);arcA=r.normal(p['arc'],p['arc']*.4);y=MG-1.5;Wm=p['vw'] if veil else 1.;Km=p['vk'] if veil else 1.
        while y<N-MG+1:
            y+=r.uniform(.4,p['dens']*2-.4)*(1.6 if veil else 1);w=r.uniform(.8,1.25)*p['w']*Wm;bow=r.normal(0,.6);a=max(0,int((y-w-abs(arcA)*2-abs(bow)-8)*SS));b=min(N*SS,int((y+w+abs(arcA)*2+abs(bow)+8)*SS))
            if b<=a:continue
            x=XX[a:b];u=(x-PAD)/S;yc=y+(tiltL+r.normal(0,.008))*(x-N/2)-arcA*np.clip(u,0,1.2)**3+bow*np.sin(u*3.1+r.uniform(0,6.28))
            se=lerp(2.4,2.6,D);x0=MG+r.normal(0,se)-r.exponential(1.5);x1=N-MG+r.normal(0,se)+r.exponential(lerp(2.2,3.,D));e0=sm(x0,x0+r.uniform(1,lerp(10,4,D)),x);e1=1-sm(x1-r.uniform(2,lerp(26,9,D)),x1,x)
            ws=np.sqrt(e0*e1);wl=np.maximum(w*(lerp(.9,.3,D)+lerp(.1,.7,D)*ws),.25);dv=np.abs(YY[a:b]-yc)/wl;edge=1-sm(p['edge'],p['ou'],dv);fade=(e0*e1)*(1-D*.75)+D*.75*(ws>.02)
            yn=(y-PAD)/S;gain=float(np.exp(r.normal(0,p['gv'])));p0=max(.05,p['top']*max(0.,1-yn)**p['py'])*gain;nx=x.shape[1];al=p0*(1+.3*(noise1(nx,30*SS,r)-.5)+.2*(noise1(nx,7*SS,r)-.5))[None,:]*fade
            lev=(1-p['fm'])*PR[a:b]+p['fm']*fine[a:b]+p['jit']*(mk(N,N,1.2,100+int(r.integers(30)))[a:b]*2-1);th=1-np.clip(p['c']*al**.7,0,1.2);pen=np.clip((lev-th+p['soft'])/(2*p['soft']),0,1)
            m=np.clip(edge*fade*p['k']*Km*(.2+.8*al**p['gam'])*((p['v']*(.45 if veil else 1))+(1-p['v']*(.45 if veil else 1))*pen**p['gp']),0,1);sub=T[a:b];T[a:b]=sub-(sub-ceil[a:b])*m*(sub>ceil[a:b])
    return down(T)
def climb(lead):
    r=np.random.default_rng(sum(map(ord,lead))+7);tg=metrics(ref(lead));d=DEF[lead];cur=dict(json.load(open('fit9.json'))[lead]);cur.update(d=d,arc=lerp(1.5,5.,d),vw=lerp(1.6,3.2,d),vk=lerp(.4,.55,d),w=cur['w']*lerp(1.,.8,d),layers=max(3.,cur['layers']),fm=max(.82,cur['fm']))
    def ev(q):
        m=metrics(swatch5(lead,q)[PAD:PAD+S,PAD:PAD+S]);return float(np.abs(m[0::3]-tg[0::3]).sum()+1.*np.abs(m[1::3]-tg[1::3]).sum())
    start=best=ev(cur)
    for i in range(20):
        t=dict(cur)
        for k_ in('k','top','py','L','dc','c','v','vk'):
            if r.random()<.45:t[k_]=t[k_]*float(np.exp(r.normal(0,.12)))
        t.update(k=min(.95,t['k']),L=min(90,t['L']),dc=min(.9,t['dc']),c=min(2.2,t['c']),v=min(.95,t['v']));l=ev(t)
        if l<best:best,cur=l,t
    a=swatch5(lead,cur);np.save(f'fit11_{lead}.npy',a);return lead,best,cur,metrics(a[PAD:PAD+S,PAD:PAD+S]).tolist(),tg.tolist()
if __name__=='__main__':
    gr=['2H','HB','2B','4B','6B']
    with ProcessPoolExecutor(5) as ex:res=list(ex.map(climb,gr))
    tiles=[];out={}
    for lead,b,c,m,t in res:
        print(lead,'L*',[round(v) for v in m[0::3]],'ref',[round(v) for v in t[0::3]],'grano',[round(v,1) for v in m[1::3]],'ref',[round(v,1) for v in t[1::3]]);out[lead]=c
        tiles.append(np.vstack([ref_full(lead),np.ones((6,N)),np.load(f'fit11_{lead}.npy')/PAPER]))
    json.dump(out,open('fit11.json','w'));sheet=np.hstack([np.hstack([t,np.ones((t.shape[0],6))]) for t in tiles]);open('fit11.pgm','wb').write(f'P5\n{sheet.shape[1]} {sheet.shape[0]}\n255\n'.encode()+np.uint8(np.clip(sheet,0,1)*255+.5).tobytes())
    a=np.load('fit11_2H.npy')/PAPER;R=ref_full('2H');zoom=np.hstack([R[:,N-90:],np.ones((N,6)),a[:,N-90:]]);open('zoom2H.pgm','wb').write(f'P5\n{zoom.shape[1]} {zoom.shape[0]}\n255\n'.encode()+np.uint8(np.clip(zoom,0,1)*255+.5).tobytes())
