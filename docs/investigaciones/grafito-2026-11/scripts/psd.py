import numpy as np
src=open('fit7.py').read().split("\nSz=N*SS")[0];exec(src)
a=np.sqrt(rad);a=a/a[1:].max();Q=[.01,.02,.03,.045,.06,.075,.09,.11,.13,.16,.2,.25,.3,.35,.4,.45,.5]
print([round(float(np.interp(q,bins,a)),3) for q in Q])
