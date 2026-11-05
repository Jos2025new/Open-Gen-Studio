#!/usr/bin/env python3
"""Random search of a graphite model. Local and silent: prints a short table, writes top.json and top.png.
Physics: bearing-area contact (top fraction of the paper field, coverage = c*F/sigma, Bertin), paper PSD q^-3 (H=.5, Bertin),
per-contact deposit with capacity (Sousa), reflectance mixed per pixel with Yule-Nielsen. Run: sweep.py [N] [--ref scan.png]"""
import json,sys,numpy as np
from concurrent.futures import ProcessPoolExecutor
N=int(sys.argv[1]) if len(sys.argv)>1 and sys.argv[1].isdigit() else 300
REF=sys.argv[sys.argv.index('--ref')+1] if '--ref' in sys.argv else None
import os
SS=2; W,H=int(os.environ.get('GW',240)),int(os.environ.get('GH',48)); RP=.90
SIGMA={'2H':884,'HB':600,'2B':332,'4B':117}                # MPa, nanoindentation (Bertin, Table I)
GRAPHITE={'2H':.60,'HB':.68,'4B':.79,'2B':.74}             # Sousa's table; 2B interpolated
lin=lambda v:np.where(v<=.04045,v/12.92,((v+.055)/1.055)**2.4); srgb=lambda v:np.where(v<=.0031308,v*12.92,1.055*np.maximum(v,1e-9)**(1/2.4)-.055)
Lstar=lambda y:np.where(y>.008856,116*np.cbrt(y)-16,903.3*y)
_cache={}
def paper(g,Hu,seed=5):
    k=(g,Hu,seed)
    if k in _cache: return _cache[k]
    S=(H*SS,W*SS); r=np.random.default_rng(seed); F=np.fft.fft2(r.standard_normal(S))
    fy=np.fft.fftfreq(S[0])[:,None]; fx=np.fft.fftfreq(S[1])[None,:]; q=np.hypot(fx,fy*1.15)+1e-6
    hi=1/(g*SS); lo=hi/3
    amp=q**(-(1+Hu))*np.exp(-(q/hi)**4)*(1-np.exp(-(q/lo)**2))
    h=np.real(np.fft.ifft2(F*amp)); o=h.ravel().argsort(); u=np.empty(o.size); u[o]=np.linspace(0,1,o.size)
    _cache[k]=u.reshape(S); return _cache[k]
def smooth(a,b,x): t=np.clip((x-a)/(b-a),0,1); return t*t*(3-2*t)
def field(seed,g):
    # What differs between passes: the tip's micro-shape and the hand. Same spectrum family, independent draw.
    return paper(max(g*.7,1.2),.5,seed=100+seed)*2-1
def foot(size):
    y=(np.arange(H*SS)[:,None]+.5)/SS-H/2; x=(np.arange(W*SS)[None,:]+.5)/SS; u=np.clip((x-15)/(W-30),0,1); p=.12+.88*u
    r=np.maximum(.5,size/2*(.45+.55*p)); return (1-smooth(.5,1.05,np.abs(y)/r))*smooth(13,20,x)*(1-smooth(W-20,W-13,x)),p
def run(P,lead,press,passes,size=None):
    "press: scalar or array along x. Returns sRGB tone (H,W)."
    h0=paper(P['grain'],P['H']); m=np.zeros_like(h0); x=np.linspace(0,1,h0.shape[1])[None,:]
    p=press if np.ndim(press)==0 else np.interp(x,np.linspace(0,1,len(press)),press)
    f=1
    if size: f,p=foot(size)
    rg=P['rg0']+(1-P['rg0'])*(1-GRAPHITE[lead])/(1-.60)*P['rgs']   # darkness ceiling from the graphite share
    for i in range(passes):
        a=np.clip(P['c']*p*f*(117/SIGMA[lead])**P['ex'],0,1)
        lev=h0+P['fill']*(1-h0)*np.clip(m/P['cap'],0,1)+P['jit']*field(i,P['grain'])
        contact=f*smooth(1-a-P['soft'],1-a+P['soft'],lev)
        m=np.minimum(P['cap'],m+P['K']*(p**P.get('beta',0))*contact*(1-m/P['cap'])+P['fines']*P['K']*p*f*(1-contact))
    A=1-np.exp(-m/P['m0']); R=A*rg+(1-A)*RP
    n=P['n']; R=(R**(1/n)).reshape(H,SS,W,SS).mean((1,3))**n
    return R
def L(R): return float(Lstar(R).mean())
def stats(R):
    Lv=Lstar(R); a=Lv-Lv.mean(); s=(a*a).mean()+1e-9
    return float(np.std(Lv)),float((a[:,1:]*a[:,:-1]).mean()/s)
def score(P):
    s=0; d={}
    L_=lambda lead,p,n:L(run(P,lead,p,n))
    t={l:[L_(l,p,1) for p in (.25,.5,.75,1)] for l in('2H','HB','4B')}
    for i in range(4):
        s+=max(0,2+t['HB'][i]-t['2H'][i])*2+max(0,3+t['4B'][i]-t['HB'][i])*2      # order: soft is darker
    for l in t:
        steps=np.diff(t[l]); s+=8*(np.std(steps)/(abs(np.mean(steps))+1e-3)) + max(0,-(-steps).min()+.5)*3   # even, monotonic pressure response
    ps={l:[L_(l,.5,n) for n in (1,2,3,5,10,20)] for l in('HB','4B')}
    for l in ps:
        dd=-np.diff(ps[l]); s+=sum(max(0,.2-v)*4 for v in dd)+sum(max(0,dd[i+1]/(dd[i]+1e-3)-1.05) for i in range(len(dd)-1))*2   # build-up: always darker, decelerating
    tg={'HB':36,'4B':24}
    for l in tg: s+=abs(ps[l][-1]-tg[l])*.6   # ceiling at 20 passes (modelled from Sousa as display intensity; artists' value, not measured)
    s+=abs(L_('2H',1,20)-46)*.6
    light=run(P,'HB',.25,1); strong=run(P,'4B',1,10)
    holes=float((Lstar(light)>80).mean()); closed=float((Lstar(strong)>60).mean()); s+=max(0,.45-holes)*20+closed*30+max(0,holes-.9)*20
    test=run(P,'HB',.6,1); sdL,ac=stats(test); Lv=Lstar(test)
    s+=max(0,.35-ac)*30+max(0,ac-.75)*40+abs(sdL-9)*.6                       # no pixel noise, no blotches, moderate grain contrast
    k=8; c=Lv[:Lv.shape[0]//k*k,:Lv.shape[1]//k*k].reshape(Lv.shape[0]//k,k,Lv.shape[1]//k,k).mean((1,3)); s+=max(0,float(c.std())/(sdL+1e-3)-.22)*60   # energy must live in the fine grain
    hist=np.histogram(Lv,bins=12,range=(Lv.min(),Lv.max()+1e-6))[0]/Lv.size; s+=max(0,.32-float(hist[3:9].sum()))*40  # gradation, not two flat levels
    d.update(t=t,ps=ps,holes=holes,closed=closed,sdL=sdL,ac=ac); return s,d
SEED=None
try:
    import os
    if os.path.exists('top.json') and '--refine' in sys.argv: SEED=json.load(open('top.json'))
except Exception: pass
def sample(i):
    r=np.random.default_rng(1000+i); c=lambda *v:float(r.choice(v))
    if SEED:
        P=dict(SEED[i%len(SEED)]['P']); P.setdefault('beta',.6)
        for k in P:
            if r.random()<.45: P[k]=float(P[k]*np.exp(r.normal(0,.22)))
        P['grain']=min(7,max(1.6,P['grain'])); P['n']=max(1,P['n']); P['c']=min(2.5,P['c']); P['H']=min(.85,max(.2,P['H'])); P['soft']=max(.02,P['soft'])
        return P
    return {'grain':c(1.6,2.0,2.5,3,3.5),'H':c(.3,.5,.5,.7),'c':c(.5,.7,.9,1.1,1.4),'ex':c(.35,.5,.7,1),'soft':c(.08,.12,.18,.25),'jit':c(.02,.05,.08,.12,.18),
      'K':c(.15,.25,.4,.6,.9),'cap':c(1.2,2,3),'fill':c(0,.2,.4,.6,.8),'fines':c(0,.02,.05,.1),'m0':c(.5,.8,1.2),'n':c(1,1.3,1.7,2.2),'rg0':c(.008,.015,.03),'rgs':c(.03,.06,.1,.15)}
def alpha_only(P,lead,p,passes):
    # Same model, but the state between passes is ONLY what a layer keeps: one alpha per pixel (a pass still resolves sub-pixel inside itself).
    h0=paper(P['grain'],P['H']); rg=P['rg0']+(1-P['rg0'])*(1-GRAPHITE[lead])/(1-.60)*P['rgs']; alpha=np.zeros((H,W))
    for i in range(passes):
        mpx=np.minimum(-np.log(np.maximum(1-alpha,1e-6))*P['m0'],P['cap']); m=np.repeat(np.repeat(mpx,SS,0),SS,1)
        a=np.clip(P['c']*p*(117/SIGMA[lead])**P['ex'],0,1)
        lev=h0+P['fill']*(1-h0)*np.clip(m/P['cap'],0,1)+P['jit']*field(i,P['grain']); c=smooth(1-a-P['soft'],1-a+P['soft'],lev)
        m=np.minimum(P['cap'],m+P['K']*(p**P.get('beta',0))*c*(1-m/P['cap'])+P['fines']*P['K']*p*(1-c))
        alpha=(1-np.exp(-m/P['m0'])).reshape(H,SS,W,SS).mean((1,3))
    return (alpha*rg+(1-alpha)*RP)
def job(i):
    P=sample(i); s,d=score(P); return float(s),P,d
if __name__=='__main__':
    with ProcessPoolExecutor(4) as ex: res=sorted(ex.map(job,range(N)),key=lambda v:v[0])
    json.dump([{'score':s,'P':P,'d':d} for s,P,d in res[:5]],open('top.json','w'),indent=0)
    for s,P,d in res[:3]:
        print(f"{s:6.1f} grain {P['grain']} H {P['H']} c {P['c']} ex {P['ex']} K {P['K']} fill {P['fill']} jit {P['jit']} n {P['n']} | holes {d['holes']:.2f} closed {d['closed']:.2f} ac1 {d['ac']:.2f}")
        print('   2H',[round(v) for v in d['t']['2H']],'HB',[round(v) for v in d['t']['HB']],'4B',[round(v) for v in d['t']['4B']],'| pasadas HB',[round(v) for v in d['ps']['HB']],'4B',[round(v) for v in d['ps']['4B']])
    print('peor',round(res[-1][0],1),'mediana',round(res[len(res)//2][0],1))

    P=res[0][1]; rows=[]
    ramp=np.linspace(.12,1,8)
    for l,n in [('2H',1),('HB',1),('HB',3),('HB',10),('4B',1),('4B',3),('4B',10)]: rows.append(run(P,l,ramp,n))
    np.save('rows.npy',np.array(rows)); open('best.json','w').write(json.dumps(P))
    print('capa-solo-alfa vs estado completo, |dL*| medio:',{f'{l}/{n}p':round(float(np.abs(Lstar(run(P,l,.6,n))-Lstar(alpha_only(P,l,.6,n))).mean()),1) for l,n in[('HB',3),('HB',10),('4B',3),('4B',10)]})
    print('tono medio alfa-solo vs completo HB 10p:',round(L(alpha_only(P,'HB',.6,10)),1),round(L(run(P,'HB',.6,10)),1))
