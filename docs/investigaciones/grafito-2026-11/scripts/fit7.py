import numpy as np,json
src=open('fit6.py').read().split("\nif __name__")[0].replace("H_=mk(N,N,g);fine=mk(N,N,1.05,seed=77)","H_=PR;fine=PR");exec(src)
# Paper from the reference's own measured spectrum: radial PSD of the 2B patch's high-passed grain, new random phases, ranked to 0..1.
c=Ls(ref('2B'))[60:];c=c-box(c);C=np.abs(np.fft.fft2(c-c.mean()))**2;h_,w_=C.shape;fy=np.fft.fftfreq(h_)[:,None];fx=np.fft.fftfreq(w_)[None,:];q=np.hypot(fx,fy);bins=np.linspace(0,.71,40);idx=np.digitize(q.ravel(),bins);rad=np.array([C.ravel()[idx==i].mean() if (idx==i).any() else 0 for i in range(1,41)])
print('PSD radial, pico en periodo px',round(1/max(1e-3,bins[int(np.argmax(rad[1:]))+1]),1))
Sz=N*SS;qq=np.hypot(np.fft.fftfreq(Sz)[None,:],np.fft.fftfreq(Sz)[:,None])*SS;amp=np.sqrt(np.interp(qq,bins,rad,right=0));F=np.fft.fft2(np.random.default_rng(5).standard_normal((Sz,Sz)));hh=np.real(np.fft.ifft2(F*amp));o=hh.ravel().argsort();u=np.empty(o.size);u[o]=np.linspace(0,1,o.size);PR=u.reshape(Sz,Sz)
P=json.load(open('fit6.json'));tiles=[]
for lead in ['2H','HB','2B','4B','6B']:
    p=dict(P[lead]);g=p.pop('g');p.update(mot=.05,edge=.72,dust=min(.05,p['dust']),soft=min(.09,p['soft']),jit=min(.05,p['jit']),st=min(.3,p['st']),dens=2.4,v=p['v']*.8)
    a=swatch3(lead,p,g);m=metrics2(a[PAD:PAD+S,PAD:PAD+S]);t=metrics2(ref(lead));print(lead,'L*',[round(v) for v in m[0:15:3]],'ref',[round(v) for v in t[0:15:3]],'grano',[round(v,1) for v in m[1:15:3]],'ref',[round(v,1) for v in t[1:15:3]],'ac',[round(v,2) for v in m[2:15:3]],'ref',[round(v,2) for v in t[2:15:3]])
    tiles.append(np.vstack([ref_full(lead),np.ones((6,N)),a]))
sheet=np.hstack([np.hstack([t,np.ones((t.shape[0],6))]) for t in tiles]);open('fit7.pgm','wb').write(f'P5\n{sheet.shape[1]} {sheet.shape[0]}\n255\n'.encode()+np.uint8(np.clip(sheet,0,1)*255+.5).tobytes())
