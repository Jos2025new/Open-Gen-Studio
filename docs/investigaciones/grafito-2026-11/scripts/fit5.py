import numpy as np,subprocess,json,sys
from concurrent.futures import ProcessPoolExecutor
src=open('v5.py').read().split("if __name__")[0].replace("SS=3;","SS=2;")
exec(src)
BANDS=5;S=170
def box(a,r=7):
    c=np.cumsum(np.cumsum(np.pad(a,((r+1,r),(r+1,r)),mode='edge'),0),1);n=(2*r+1)**2
    return (c[2*r+1:,2*r+1:]-c[:-2*r-1,2*r+1:]-c[2*r+1:,:-2*r-1]+c[:-2*r-1,:-2*r-1])/n
def metrics(g):
    "g: sRGB 0..1 patch. Per band: median L*, high-passed L* sd, lag-1 correlation of the grain."
    L_=Ls(g);hp=L_-box(L_);h=g.shape[0]//BANDS;out=[]
    for j in range(BANDS):
        a=L_[j*h:(j+1)*h];b=hp[j*h:(j+1)*h];s=(b*b).mean()+1e-9;out+= [float(np.median(a)),float(np.sqrt(s)),float((b[:,1:]*b[:,:-1]).mean()/s)]
    return np.array(out)
def loss(m,r):
    d=np.abs(m-r);return float(d[0::3].sum()+1.5*d[1::3].sum()+8*d[2::3].sum())
s=subprocess.run(['magick','../refs/user/grid.png','-depth','8','gray:-'],capture_output=True).stdout
w,h=map(int,subprocess.run(['magick','identify','-format','%w %h','../refs/user/grid.png'],capture_output=True,text=True).stdout.split());IM=np.frombuffer(s,np.uint8).reshape(h,w)/255;K=w/1200
NAMES=['4H','3H','2H','H','F','HB','B','2B','3B','4B','5B','6B'];X=[125,380,635,890];Y=[315,605,895]
def ref(n):
    i=NAMES.index(n);x=int((X[i%4]+8)*K);y=int((Y[i//4]+6)*K);return IM[y:y+int(S*K),x:x+int(S*K)]
def swatch2(lead,G_,GR_):
    G[lead]=G_;GR.update(GR_);N=S+20
    H_=mk(N,N,GR['g']);T=np.full((N*SS,N*SS),PAPER);col=L2G(G_['L']);n=0;win=None
    for ps in range(2):
        for y0 in np.arange(6,N-6,5.):
            n+=1;p=max(.08,1-.95*y0/N);wd=8/2*G_['w']*1.1+3;a=max(0,int((y0-wd-2)*SS));b=min(N*SS,int((y0+wd+2)*SS))
            yy,xx=np.mgrid[a:b,0:N*SS];yy=(yy+.5)/SS;xx=(xx+.5)/SS;yc=y0+np.sin(n*7.3)*1.4+np.sin(xx*.04+n)*.9
            m=stroke_s(yy,xx,N,lead,p,yc,8,n,H_,a,b)*sm(0,3,xx)*(1-sm(N-3,N,xx));T[a:b]=T[a:b]*(1-m)+col*m
    return down(T)[10:10+S,10:10+S]
def stroke_s(yy,xx,N,lead,p,yc,size,seed,h,a,b):
    g=G[lead];r=np.random.default_rng(seed);nx=xx.shape[1];pe=p*min(1.6,(8/size)**.45);al=(pe*(1+g.get('dp',.16)*(noise1(nx,55*SS,r)-.5)+.08*(noise1(nx,12*SS,r)-.5)))[None,:]
    wd=size/2*g['w']*(.55+.45*min(1,pe));v=(yy-yc)/wd;edge=1-sm(GR['edge'],1.08,np.abs(v));st=noise1(4096,1,r);idx=np.clip(((v+1)*.5*14+st[0]*30).astype(int),0,4090);tip=1+g['st']*(st[idx]-.5)
    th=1-np.clip(g['c']*al**.8*edge**.5,0,1);lev=h[a:b]+g.get('jit',GR['jit'])*(mk(N,N,1.3,100+seed%40)[a:b]*2-1);sf=g.get('soft',GR['soft']);c=sm(th-sf,th+sf,lev)
    k=g['k']*(.22+.78*al**g.get('gam',GR['gam']));return np.clip(edge*tip*k*(g['v']+(1-g['v'])*c),0,1)
def climb(lead):
    r=np.random.default_rng(hash(lead)%1000);tg=metrics(ref(lead));base=dict(G[lead]);base.update(jit=GR['jit'],soft=GR['soft'],gam=GR['gam'],dp=.16);gg=GR['g']
    cur=dict(base);start=best=loss(metrics(swatch2(lead,cur,{'g':gg})),tg);cg=gg
    for i in range(110):
        t=dict(cur);tg_g=cg
        for key in t:
            if r.random()<.35:t[key]=t[key]*float(np.exp(r.normal(0,.14)))
        if r.random()<.2:tg_g=float(np.clip(cg*np.exp(r.normal(0,.12)),1,3))
        t['L']=min(90,t['L']);t['v']=min(.95,t['v']);t['soft']=max(.04,t['soft']);t['c']=min(2,t['c'])
        l=loss(metrics(swatch2(lead,t,{'g':tg_g})),tg)
        if l<best:best,cur,cg=l,t,tg_g
    a=swatch2(lead,cur,{'g':cg});np.save(f'fit_{lead}.npy',a);return lead,start,best,cur,cg,metrics(a).tolist(),tg.tolist()
if __name__=='__main__':
    grades=['2H','HB','2B','4B','6B']
    for n in grades:print(n,'ref L* bandas',[round(v) for v in metrics(ref(n))[0::3]],'grano',[round(v,1) for v in metrics(ref(n))[1::3]],'ac1',[round(v,2) for v in metrics(ref(n))[2::3]])
    for id_,n in (('pencil-2h','2H'),('pencil-hb','HB'),('pencil-4b','4B')):
        raw=open(f'sw_cur_{id_}.pgm','rb').read();a=np.frombuffer(raw[-190*190:],np.uint8).reshape(190,190)/255;a=a[10:10+S,10:10+S];print('ACTUAL',n,'pérdida',round(loss(metrics(a),metrics(ref(n))),1),'L*',[round(v) for v in metrics(a)[0::3]],'grano',[round(v,1) for v in metrics(a)[1::3]])
    with ProcessPoolExecutor(5) as ex:res=list(ex.map(climb,grades))
    out={}
    for lead,st,b,c,g,m,t in res:
        print('NUEVO',lead,'pérdida',round(st,1),'→',round(b,1),'L*',[round(v) for v in m[0::3]],'grano',[round(v,1) for v in m[1::3]],'ac1',[round(v,2) for v in m[2::3]]);out[lead]=dict(c,g=g)
    json.dump(out,open('fit5.json','w'))
    tiles=[]
    for lead,*_ in res:
        a=np.load(f'fit_{lead}.npy');r_=ref(lead);r_=r_[:S,:S];tiles.append(np.vstack([r_,np.ones((6,S)),a]))
    sheet=np.hstack([np.hstack([t,np.ones((t.shape[0],6))]) for t in tiles]);open('fit5.pgm','wb').write(f'P5\n{sheet.shape[1]} {sheet.shape[0]}\n255\n'.encode()+np.uint8(np.clip(sheet,0,1)*255+.5).tobytes())
