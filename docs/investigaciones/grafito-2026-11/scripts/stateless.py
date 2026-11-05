import numpy as np
SS=2;PAPER=.965
lin=lambda v:np.where(v<=.04045,v/12.92,((v+.055)/1.055)**2.4);Ls=lambda v:116*np.cbrt(lin(v))-16
def mk(W,H,g=1.6,Hu=.5,seed=5):
    S=(H*SS,W*SS);r=np.random.default_rng(seed);F=np.fft.fft2(r.standard_normal(S));fy=np.fft.fftfreq(S[0])[:,None];fx=np.fft.fftfreq(S[1])[None,:];q=np.hypot(fx,fy*1.15)+1e-6
    hi=1/(g*SS);lo=hi/3;h=np.real(np.fft.ifft2(F*q**(-(1+Hu))*np.exp(-(q/hi)**4)*(1-np.exp(-(q/lo)**2))));o=h.ravel().argsort();u=np.empty(o.size);u[o]=np.linspace(0,1,o.size);return u.reshape(S)
def sm(a,b,x):
    t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)
# sigma: Bertin MPa. ceil: display grey at many passes, read BY EYE from the user's 12-grade sheet (file not available to measure).
G={'6H':(1400,.80),'2H':(884,.74),'HB':(600,.55),'2B':(332,.33),'4B':(117,.25),'6B':(50,.24)}
P=dict(c=1.25,ex=.42,soft=.16,k=.62,floor=.10,jit=.09,widen=.35)
def down(a): 
    h,w=a.shape;return a.reshape(h//SS,SS,w//SS,SS).mean((1,3))
def stroke_mask(h,noise,p,f,lead):
    s,_=G[lead];a=np.clip(P['c']*p*(117/s)**P['ex'],0,1)*f**.5
    lev=h+P['jit']*noise;c=sm(1-a-P['soft'],1-a+P['soft'],lev)*(f>0)
    return np.clip(f*(P['k']*(.35+.65*p)*c+P['floor']*p*(1-c)),0,1)
def full(h,masks,lead):
    "state-reading comparison: valleys rise with deposit"
    pass
def swatch(lead,S=190):
    h=mk(S,S);T=np.full((S*SS,S*SS),PAPER);_,col=G[lead];yy,xx=np.mgrid[0:S*SS,0:S*SS];yy=(yy+.5)/SS;xx=(xx+.5)/SS;line=0;r=np.random.default_rng(3)
    for ps in range(2):
        for y0 in np.arange(6,S-6,5.):
            line+=1;p=1-.85*y0/S;n=mk(S,S,g=1.2,seed=100+line)*2-1;yc=y0+np.sin(line*7.3)*1.5+np.sin(xx*.05+line)*.8
            w=4*(1+P['widen']*(1-G[lead][0]/1400))*(.55+.45*p);f=(1-sm(.5,1.1,np.abs(yy-yc)/w))*sm(4,8,xx)*(1-sm(S-8,S-4,xx))
            m=stroke_mask(h,n,p,f,lead);T=T*(1-m)+col*m
    return down(T)
def line(lead,W=500,H=24,size=3.2):
    h=mk(W,H);yy,xx=np.mgrid[0:H*SS,0:W*SS];y=(yy+.5)/SS-H/2;s=G[lead][0];w=size/2*(1+P['widen']*2*(1-s/1400));f=1-sm(.5,1.1,np.abs(y)/w);m=stroke_mask(h,mk(W,H,g=1.2,seed=9)*2-1,.6,f,lead);T=PAPER*(1-m)+G[lead][1]*m;return down(T)
def passes(lead,ns=(1,2,3,5,10,20)):
    S=120;h=mk(S,40);T=np.full((40*SS,S*SS),PAPER);out={}
    for i in range(1,max(ns)+1):
        m=stroke_mask(h,mk(S,40,g=1.2,seed=100+i)*2-1,.6,np.ones_like(h),lead);T=T*(1-m)+G[lead][1]*m
        if i in ns:out[i]=(round(float(Ls(down(T)).mean())),round(float(Ls(down(T)).std())))
    return out
for n,(ref,wr) in {'6H':(89,4),'HB':(66,4),'2B':(42,5),'6B':(45,7)}.items():
    a=Ls(line(n));m=a.min(0);med=np.median(a,1).min();print(n,'línea L* ref',ref,'modelo',round(float(np.median(m))),'var',round(float(m.std()),1),'ancho',int((np.median(a,1)<(Ls(np.array(PAPER))+med)/2).sum()),'ref',wr)
for l in('2H','HB','4B'):print(l,'pasadas',passes(l))
def save(a,n):
    open(n,'wb').write(f'P5\n{a.shape[1]} {a.shape[0]}\n255\n'.encode()+np.uint8(np.clip(a,0,1)*255+.5).tobytes())
for l in('2H','HB','4B','6B'):save(swatch(l),f'sw_new_{l}.pgm')
