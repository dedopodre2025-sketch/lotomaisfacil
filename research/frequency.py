"""Exploratório: previsões walk-forward; dados já examinados, não holdout virgem."""
import json,math,re
from pathlib import Path
import numpy as np
from scipy.stats import norm
source=Path(__file__).parents[1]/'js/data/defaultData.js'
history=json.loads(source.read_text().split('export const DEFAULT_HISTORY = ',1)[1].strip().removesuffix(';'))
rows=[]
for line in history.splitlines():
 if re.match(r'^\d+\s*-',line):
  i,nums=line.split('-',1); rows.append((int(i),[int(n) for n in nums.split(',')]))
rows.sort()
assert len(rows)==3779 and [r[0] for r in rows]==list(range(1,3780))
y=np.zeros((len(rows),25))
for t,(_,ns) in enumerate(rows):
 assert len(set(ns))==15 and min(ns)>=1 and max(ns)<=25
 y[t,np.array(ns)-1]=1
out=[]
for window in [50,200,0]:
 diffs=[];hits=[]
 for t in range(500,len(y)):
  past=y[max(0,t-window) if window else 0:t]
  p=(past.sum(axis=0)+60)/(len(past)+100) # prior equivalente a 100 sorteios uniformes
  diffs.append(float(np.mean((p-y[t])**2)-np.mean((.6-y[t])**2)))
  # desempate determinístico; não selecionado com base nos alvos
  pick=np.argsort(-p,kind='stable')[:15]
  hits.append(int(y[t,pick].sum()))
 d=np.array(diffs); n=len(d); centered=d-d.mean()
 # Erro HAC Newey-West 50 defasagens para dependência temporal
 v=float(centered@centered/n)
 for lag in range(1,51): v+=2*(1-lag/51)*float(centered[lag:]@centered[:-lag]/n)
 se=math.sqrt(max(v,0)/n)
 pval=float(norm.cdf(d.mean()/se)) if se else 1.
 out.append(dict(window=window or 'todo passado',n=n,brier_delta=float(d.mean()),
 ci95=[float(d.mean()-1.96*se),float(d.mean()+1.96*se)],p_gain=pval,
 mean_hits=float(np.mean(hits)),hits13plus=sum(h>=13 for h in hits),
 blocks=[float(x.mean()) for x in np.array_split(d,3)]))
for rank,j in enumerate(sorted(range(3),key=lambda j:out[j]['p_gain'])):
 out[j]['p_bonferroni']=min(1,out[j]['p_gain']*3)
result=dict(protocol='Exploratório; treino anterior ao alvo, alvos 501–3779; 3 janelas fixadas; prior 100; delta Brier negativo favorece frequência; HAC50; Bonferroni3. Não mede vantagem de carteira para 15.',models=out)
Path(__file__).with_name('frequency-results.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
