import numpy as np,sys,json,os
SS=3;PAPER=.965
lin=lambda v:np.where(v<=.04045,v/12.92,((v+.055)/1.055)**2.4);Ls=lambda v:116*np.cbrt(lin(np.clip(v,0,1)))-16
def sm(a,b,x):
    t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)
_c={}
def mk(W,H,g,seed=5):
    k=(W,H,g,seed)
    if k in _c:return _c[k]
    S=(H*SS,W*SS);r=np.random.default_rng(seed);F=np.fft.fft2(r.standard_normal(S));fy=np.fft.fftfreq(S[0])[:,None];fx=np.fft.fftfreq(S[1])[None,:];q=np.hypot(fx,fy*1.15)+1e-6
    hi=1/(g*SS);h=np.real(np.fft.ifft2(F*(np.exp(-(np.log(q/hi))**2/(2*.45**2))+.35*np.exp(-(np.log(q/(hi/3)))**2/(2*.5**2)))));o=h.ravel().argsort();u=np.empty(o.size);u[o]=np.linspace(0,1,o.size);_c[k]=u.reshape(S);return _c[k]
def noise1(n,period,r):
    m=int(n/period)+3;a=r.random(m);x=np.arange(n)/period;i=x.astype(int);t=x-i;t=t*t*(3-2*t);return a[i]*(1-t)+a[i+1]*t
L2G=lambda L:float(np.clip(((((L+16)/116)**3)**(1/2.4)*1.055-.055),0,1))
# per grade: ceiling L*, flow, veil share, coverage, tip streak strength, width factor. Starting values read from the references.
G={'6H':dict(L=70,k=.16,v=.6,c=1.3,st=.25,w=.9),'2H':dict(L=55,k=.30,v=.48,c=1.2,st=.35,w=1.),'HB':dict(L=40,k=.46,v=.34,c=1.05,st=.45,w=1.),'2B':dict(L=30,k=.62,v=.25,c=1.1,st=.5,w=1.1),'4B':dict(L=22,k=.78,v=.18,c=1.2,st=.5,w=1.3),'6B':dict(L=17,k=.88,v=.15,c=1.3,st=.45,w=1.45)}
GR=dict(g=1.5,soft=.14,jit=.07,gam=1.15,edge=.55)
def stroke(yy,xx,W,H,lead,p,yc,size,seed,h):
    g=G[lead];r=np.random.default_rng(seed);nx=xx.shape[1];pe=p*min(1.6,(8/size)**.45);alongp=(pe*(1+.16*(noise1(nx,55*SS,r)-.5)+.08*(noise1(nx,12*SS,r)-.5)))[None,:]
    wd=size/2*g['w']*(.55+.45*min(1,pe));v=(yy-yc)/wd;edge=1-sm(GR['edge'],1.08,np.abs(v))
    st=noise1(4096,1,r);idx=np.clip(((v+1)*.5*14+st[0]*30).astype(int),0,4090);tip=1+g['st']*(st[idx]-.5)
    th=1-np.clip(g['c']*alongp**.8*edge**.5,0,1);lev=h+GR['jit']*(mk(W,H,1.3,100+seed%40)*2-1);c=sm(th-GR['soft'],th+GR['soft'],lev)
    k=g['k']*(.22+.78*alongp**GR['gam']);m=edge*tip*k*(g['v']+(1-g['v'])*c);return np.clip(m,0,1)
def down(a):
    h,w=a.shape;return a.reshape(h//SS,SS,w//SS,SS).mean((1,3))
def swatch(lead,S=190):
    h=mk(S,S,GR['g']);T=np.full((S*SS,S*SS),PAPER);col=L2G(G[lead]['L']);yy,xx=np.mgrid[0:S*SS,0:S*SS];yy=(yy+.5)/SS;xx=(xx+.5)/SS;n=0
    win=sm(4,10,xx)*(1-sm(S-10,S-4,xx))
    for ps in range(2):
        for y0 in np.arange(6,S-6,5.):
            n+=1;p=max(.08,1-.95*y0/S);yc=y0+np.sin(n*7.3)*1.4+np.sin(xx*.04+n)*.9
            T=T*(1-stroke(yy,xx,S,S,lead,p,yc,8,n,h)*win)+col*stroke(yy,xx,S,S,lead,p,yc,8,n,h)*win
    return down(T)
def line(lead,W=500,H=24,size=3.2,p=.85):
    yy,xx=np.mgrid[0:H*SS,0:W*SS];yy=(yy+.5)/SS;xx=(xx+.5)/SS;m=stroke(yy,xx,W,H,lead,p,np.full_like(xx,H/2,dtype=float),size,7,mk(W,H,GR['g']));return down(PAPER*(1-m)+L2G(G[lead]['L'])*m)
def passes(lead,ns=(1,3,10,20,40),p=.7):
    S=120;H=40;h=mk(S,H,GR['g']);T=np.full((H*SS,S*SS),PAPER);yy,xx=np.mgrid[0:H*SS,0:S*SS];yy=(yy+.5)/SS;xx=(xx+.5)/SS;out=[];col=L2G(G[lead]['L'])
    for i in range(1,max(ns)+1):
        m=stroke(yy,xx,S,H,lead,p,np.full_like(xx,H/2,dtype=float)+np.random.default_rng(i).random()*2-1,40,i+200,h);T=T*(1-m)+col*m
        if i in ns:
            a=Ls(down(T))[12:28,20:100];out.append(f'{i}p {a.mean():.0f}±{a.std():.0f}')
    return ' '.join(out)
REFL={'6H':89,'HB':66,'2B':42,'6B':45}
if __name__=='__main__':
    if os.path.exists('v5params.json'):
        d=json.load(open('v5params.json'));GR.update(d.get('GR',{}));[G[k].update(v) for k,v in d.get('G',{}).items()]
    for n,t in REFL.items():
        a=Ls(line(n));m=a.min(0);print(n,'línea ref',t,'nuevo',round(float(np.median(m))),'var',round(float(m.std()),1))
    for l in('2H','HB','4B','6B'):print(l,passes(l))
    out=[]
    for l in('2H','HB','2B','4B','6B'):
        a=swatch(l);open(f'v5_{l}.pgm','wb').write(f'P5\n{a.shape[1]} {a.shape[0]}\n255\n'.encode()+np.uint8(np.clip(a,0,1)*255+.5).tobytes())
