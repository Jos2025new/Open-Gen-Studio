import numpy as np,sys
PAD,S=26,170
def L(g):
    g=g/255.;y=np.where(g<=.04045,g/12.92,((g+.055)/1.055)**2.4);return np.where(y>.008856,116*np.cbrt(y)-16,903.3*y)
for g in ['2H','HB','2B','4B','6B']:
    a=np.fromfile(f'js_{g}.gray',np.uint8).reshape(222,222)[PAD:PAD+S,PAD:PAD+S];b=np.array_split(L(a.astype(float)),5,0)
    print(g,[round(float(x.mean())) for x in b],'grano',[round(float(x.std()),1) for x in b])
