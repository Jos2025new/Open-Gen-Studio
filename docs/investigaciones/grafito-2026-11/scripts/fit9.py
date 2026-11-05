import numpy as np,json
from concurrent.futures import ProcessPoolExecutor
src=open('fit8.py').read().split("\ndef climb")[0].replace("edge=1-sm(p['edge'],1.15,d)","edge=1-sm(p['edge'],p['ou'],d)").replace("lev=.8*PR[a:b]+.2*fine[a:b]","lev=(1-p['fm'])*PR[a:b]+p['fm']*fine[a:b]");exec(src)
DEF={'2H':1.,'HB':.72,'2B':.48,'4B':.3,'6B':.18}   # definition: most on the hard end, a little even on the soft end
lerp=lambda a,b,t:a+(b-a)*t
def apply_def(p,d):
    q=dict(p);q.update(edge=lerp(.5,.88,d),ou=lerp(1.12,1.02,d),w=p['w']*lerp(1.,.62,d),soft=p['soft']*lerp(.85,.45,d),gv=lerp(p['gv'],.42,d),dens=p['dens']*lerp(1.,1.25,d),fm=lerp(.35,.6,d),v=p['v']*lerp(.95,.7,d),jit=p['jit']*lerp(1.,.6,d));return q
def sharp(a):
    L_=Ls(a);return float(np.abs(np.diff(L_,axis=0)).mean())
def climb(lead):
    r=np.random.default_rng(sum(map(ord,lead))+3);tg=metrics(ref(lead));cur=apply_def(json.load(open('fit8.json'))[lead],DEF[lead])
    # Definition is fixed by the grade; only tone-carrying weights move, so the fit cannot blur it away.
    def ev(q):
        m=metrics(swatch4(lead,q)[PAD:PAD+S,PAD:PAD+S]);return float(np.abs(m[0::3]-tg[0::3]).sum()+.5*np.abs(m[1::3]-tg[1::3]).sum())
    start=best=ev(cur)
    for i in range(26):
        t=dict(cur)
        for k_ in('k','top','py','L','dc','c'):
            if r.random()<.5:t[k_]=t[k_]*float(np.exp(r.normal(0,.12)))
        t.update(k=min(.95,t['k']),L=min(90,t['L']),dc=min(.9,t['dc']),c=min(2.2,t['c']));l=ev(t)
        if l<best:best,cur=l,t
    a=swatch4(lead,cur);np.save(f'fit9_{lead}.npy',a);return lead,start,best,cur,metrics(a[PAD:PAD+S,PAD:PAD+S]).tolist(),tg.tolist(),sharp(a[PAD:PAD+S,PAD:PAD+S]),sharp(ref(lead))
if __name__=='__main__':
    gr=['2H','HB','2B','4B','6B']
    with ProcessPoolExecutor(5) as ex:res=list(ex.map(climb,gr))
    tiles=[];out={}
    for lead,st,b,c,m,t,sm_,sr in res:
        print(lead,'L*',[round(v) for v in m[0::3]],'ref',[round(v) for v in t[0::3]],'grano',[round(v,1) for v in m[1::3]],'ref',[round(v,1) for v in t[1::3]],'nitidez',round(sm_,1),'ref',round(sr,1));out[lead]=c
        tiles.append(np.vstack([ref_full(lead),np.ones((6,N)),np.load(f'fit9_{lead}.npy')]))
    json.dump(out,open('fit9.json','w'));sheet=np.hstack([np.hstack([t,np.ones((t.shape[0],6))]) for t in tiles]);open('fit9.pgm','wb').write(f'P5\n{sheet.shape[1]} {sheet.shape[0]}\n255\n'.encode()+np.uint8(np.clip(sheet,0,1)*255+.5).tobytes())
