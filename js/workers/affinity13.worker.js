// Laboratório de Afinidade 13 — v5.2
// Teste isolado: ZERO13 x NEUTRO13 x HIGH13, com controle aleatório puro.
// Não altera nenhum gerador do aplicativo.

const WORKER_BUILD = 'v5.2-affinity13-lab-20260816';
const PRIMES = new Set([2,3,5,7,11,13,17,19,23]);
const FRAME = new Set([1,2,3,4,5,6,10,11,15,16,20,21,22,23,24,25]);

function bitCount(n) {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;
}
function hashSeed() {
  let h = 2166136261 >>> 0;
  const text = Array.from(arguments).join('|');
  for (let i=0;i<text.length;i++) { h ^= text.charCodeAt(i); h = Math.imul(h,16777619) >>> 0; }
  return h || 1;
}
function createRng(seed) {
  let s = seed >>> 0;
  return function() { s = (Math.imul(s,1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function shufflePick15(rng) {
  const a = Array.from({length:25},(_,i)=>i+1);
  for(let i=24;i>9;i--) { const j=Math.floor(rng()*(i+1)); const t=a[i];a[i]=a[j];a[j]=t; }
  return a.slice(10).sort((x,y)=>x-y);
}
function gameMask(nums) { let m=0; for(const n of nums) m|=(1<<(n-1)); return m; }
function maxSequence(nums) {
  let best=1,cur=1;
  for(let i=1;i<nums.length;i++) { if(nums[i]===nums[i-1]+1){cur++; if(cur>best)best=cur;} else cur=1; }
  return best;
}
function rowCounts(nums) {
  const r=[0,0,0,0,0]; for(const n of nums) r[Math.floor((n-1)/5)]++; return r;
}
function colCounts(nums) {
  const c=[0,0,0,0,0]; for(const n of nums) c[(n-1)%5]++; return c;
}
function features(nums) {
  const sum=nums.reduce((a,b)=>a+b,0);
  const evens=nums.filter(n=>n%2===0).length;
  const primes=nums.filter(n=>PRIMES.has(n)).length;
  const frame=nums.filter(n=>FRAME.has(n)).length;
  const low=nums.filter(n=>n<=13).length;
  const seq=maxSequence(nums);
  return {sum,evens,primes,frame,low,seq,rows:rowCounts(nums),cols:colCounts(nums)};
}
function isBalanced(f) {
  // Faixas deliberadamente pré-definidas: não são derivadas do concurso-alvo nem do futuro.
  if(f.sum<175 || f.sum>215) return false;
  if(f.evens<6 || f.evens>9) return false;
  if(f.primes<4 || f.primes>7) return false;
  if(f.frame<8 || f.frame>11) return false;
  if(f.low<7 || f.low>9) return false;
  if(f.seq>5) return false;
  if(f.rows.some(v=>v<2 || v>4)) return false;
  if(f.cols.some(v=>v<2 || v>4)) return false;
  return true;
}
function structuralDistance(a,b) {
  if(!a||!b) return 0;
  let d=Math.abs(a.sum-b.sum)/10 + Math.abs(a.evens-b.evens) + Math.abs(a.primes-b.primes)
    + Math.abs(a.frame-b.frame) + Math.abs(a.low-b.low) + Math.abs(a.seq-b.seq);
  for(let i=0;i<5;i++) d += 0.35*Math.abs(a.rows[i]-b.rows[i]) + 0.35*Math.abs(a.cols[i]-b.cols[i]);
  return d;
}
function buildBalancedPool(size, seed) {
  const rng=createRng(seed), out=[], seen=new Set();
  const maxAttempts=size*40;
  let attempts=0;
  while(out.length<size && attempts<maxAttempts) {
    attempts++;
    const nums=shufflePick15(rng), mask=gameMask(nums);
    if(seen.has(mask)) continue;
    const f=features(nums);
    if(!isBalanced(f)) continue;
    seen.add(mask); out.push({nums,mask,features:f,affinity13:0,conflict14:0});
    if(out.length%1000===0) self.postMessage({type:'progress',phase:'pool',current:out.length,total:size});
  }
  return {pool:out,attempts};
}
function initializeHistoryCounts(pool, history) {
  const total=history.length;
  for(let h=0;h<total;h++) {
    const hm=history[h].mask;
    for(let i=0;i<pool.length;i++) {
      const hit=bitCount(pool[i].mask & hm);
      if(hit===13) pool[i].affinity13++;
      else if(hit>=14) pool[i].conflict14++;
    }
    if(h%150===0) self.postMessage({type:'progress',phase:'index',current:h+1,total});
  }
}
function removeContestFromCounts(pool, contestMask) {
  for(let i=0;i<pool.length;i++) {
    const hit=bitCount(pool[i].mask & contestMask);
    if(hit===13) pool[i].affinity13--;
    else if(hit>=14) pool[i].conflict14--;
  }
}
function newStat(name) { return {name,totalGames:0,hits11:0,hits12:0,hits13:0,hits14:0,hits15:0,bestHit:0,sumBest:0,rounds:0,roundBest:[],sumAffinity:0,affinitySamples:0}; }
function addRound(stat, games, targetMask, affinities) {
  let best=0;
  for(let i=0;i<games.length;i++) {
    const hit=bitCount(games[i].mask & targetMask);
    stat.totalGames++;
    if(hit>=11)stat.hits11++; if(hit>=12)stat.hits12++; if(hit>=13)stat.hits13++; if(hit>=14)stat.hits14++; if(hit>=15)stat.hits15++;
    if(hit>stat.bestHit)stat.bestHit=hit; if(hit>best)best=hit;
    if(affinities && Number.isFinite(affinities[i])) { stat.sumAffinity+=affinities[i]; stat.affinitySamples++; }
  }
  stat.sumBest+=best;stat.rounds++;stat.roundBest.push(best);
}
function wilson(successes,total,z=1.959963984540054) {
  if(!total)return {low:0,high:0}; const p=successes/total,z2=z*z,den=1+z2/total;
  const center=(p+z2/(2*total))/den,half=(z*Math.sqrt((p*(1-p)+z2/(4*total))/total))/den;
  return {low:Math.max(0,center-half),high:Math.min(1,center+half)};
}
function finalize(stat) {
  stat.avgBest=stat.rounds?stat.sumBest/stat.rounds:0;
  stat.rate11=stat.totalGames?stat.hits11/stat.totalGames:0;
  stat.rate12=stat.totalGames?stat.hits12/stat.totalGames:0;
  stat.rate13=stat.totalGames?stat.hits13/stat.totalGames:0;
  stat.rate14=stat.totalGames?stat.hits14/stat.totalGames:0;
  stat.avgAffinity=stat.affinitySamples?stat.sumAffinity/stat.affinitySamples:null;
  stat.ci13=wilson(stat.hits13,stat.totalGames);
  return stat;
}
function meanCI(values) {
  const arr=values.filter(Number.isFinite),n=arr.length;
  if(!n)return {mean:0,low:0,high:0,n:0}; const mean=arr.reduce((a,b)=>a+b,0)/n;
  if(n<2)return {mean,low:mean,high:mean,n};
  const variance=arr.reduce((a,x)=>a+(x-mean)*(x-mean),0)/(n-1),se=Math.sqrt(variance/n),half=1.959963984540054*se;
  return {mean,low:mean-half,high:mean+half,n};
}
function quantileSorted(values,p) {
  if(!values.length)return 0; const idx=Math.max(0,Math.min(values.length-1,Math.floor((values.length-1)*p))); return values[idx];
}
function sampleDistinct(list,count,rng) {
  if(!list.length)return [];
  const copy=[...list],out=[];
  for(let k=0;k<count && copy.length;k++) { const j=Math.floor(rng()*copy.length); out.push(copy[j]); copy[j]=copy[copy.length-1];copy.pop(); }
  while(out.length<count) out.push(list[Math.floor(rng()*list.length)]);
  return out;
}
function buildGroups(pool) {
  const allowed=[];
  for(let i=0;i<pool.length;i++) if(pool[i].conflict14===0) allowed.push(i);
  if(!allowed.length)return null;
  const positiveAffinities=allowed.map(i=>Math.max(0,pool[i].affinity13)).filter(a=>a>0).sort((a,b)=>a-b);
  if(!positiveAffinities.length) return null;
  const medLo=quantileSorted(positiveAffinities,.40), medHi=quantileSorted(positiveAffinities,.60), highThreshold=quantileSorted(positiveAffinities,.95);
  const zero=[],neutral=[],high=[];
  let maxAffinity=0;
  for(const id of allowed) {
    const a=Math.max(0,pool[id].affinity13); if(a>maxAffinity)maxAffinity=a;
    if(a===0)zero.push(id);
    if(a>0 && a>=medLo && a<=medHi)neutral.push(id);
    if(a>=highThreshold)high.push(id);
  }
  return {allowed,zero,neutral,high,medLo,medHi,highThreshold,maxAffinity};
}
function chooseMatched(pool, groups, gamesCount, rng) {
  if(!groups || groups.zero.length===0 || groups.neutral.length===0 || groups.high.length===0) return null;
  const zeros=sampleDistinct(groups.zero,gamesCount,rng);
  const neutral=[],high=[];
  const usedN=new Set(),usedH=new Set();
  for(const zid of zeros) {
    const zf=pool[zid].features;
    let bestN=null,bestND=Infinity;
    // amostra determinística de até 160 candidatos da faixa neutra para matching estrutural
    const nCandidates=groups.neutral.length<=500?groups.neutral:sampleDistinct(groups.neutral,500,rng);
    for(const id of nCandidates) { if(usedN.has(id)&&groups.neutral.length>=gamesCount)continue; const d=structuralDistance(zf,pool[id].features); if(d<bestND){bestND=d;bestN=id;} }
    if(bestN==null)bestN=groups.neutral[0]; neutral.push(bestN);usedN.add(bestN);
    let bestH=null,bestHD=Infinity,bestHA=-1;
    const hCandidates=groups.high.length<=500?groups.high:sampleDistinct(groups.high,500,rng);
    for(const id of hCandidates) {
      if(usedH.has(id)&&groups.high.length>=gamesCount)continue;
      const d=structuralDistance(zf,pool[id].features),a=pool[id].affinity13;
      if(d<bestHD-1e-9 || (Math.abs(d-bestHD)<1e-9 && a>bestHA)){bestHD=d;bestH=id;bestHA=a;}
    }
    if(bestH==null)bestH=groups.high[0]; high.push(bestH);usedH.add(bestH);
  }
  return {zero:zeros,neutral,high};
}
function idsToGames(pool,ids){return ids.map(id=>pool[id]);}
function randomPureGames(count,rng){const out=[];for(let i=0;i<count;i++){const nums=shufflePick15(rng);out.push({nums,mask:gameMask(nums)});}return out;}
function statSummary(stat){finalize(stat);return {name:stat.name,totalGames:stat.totalGames,hits11:stat.hits11,hits12:stat.hits12,hits13:stat.hits13,hits14:stat.hits14,hits15:stat.hits15,bestHit:stat.bestHit,avgBest:stat.avgBest,rate11:stat.rate11,rate12:stat.rate12,rate13:stat.rate13,rate14:stat.rate14,ci13:stat.ci13,avgAffinity:stat.avgAffinity};}
function blankStrategyStats(){return {random:newStat('Aleatório puro'),zero:newStat('ZERO13 · nunca fez 13+'),neutral:newStat('NEUTRO13 · afinidade mediana'),high:newStat('HIGH13 · top 5% afinidade')};}

function run(data) {
  const startedAt=Date.now();
  const database=Array.isArray(data.database)?data.database:[];
  const gamesCount=Math.max(1,Math.min(5,Number(data.gamesCount)||3));
  const seeds=Math.max(3,Math.min(12,Number(data.seeds)||8));
  const poolSize=Math.max(3000,Math.min(12000,Number(data.poolSize)||10000));
  const eligible=Math.max(0,database.length-50),blockSize=Math.min(1000,Math.floor(eligible/3));
  if(blockSize<100) throw new Error('Base insuficiente para o laboratório de afinidade.');
  const totalTargets=blockSize*3;

  self.postMessage({type:'progress',phase:'pool',current:0,total:poolSize});
  const built=buildBalancedPool(poolSize,hashSeed('affinity13-pool',poolSize));
  const pool=built.pool;
  if(pool.length<3000) throw new Error('Não foi possível formar pool equilibrado suficiente.');

  self.postMessage({type:'progress',phase:'index',current:0,total:database.length-1});
  initializeHistoryCounts(pool,database.slice(1));

  const labels=['Recente','Intermediário','Antigo'];
  const blocks=labels.map(label=>({label,start:null,end:null,seeds:Array.from({length:seeds},()=>blankStrategyStats()),availability:{rounds:0,zeroAvailable:0,avgZeroPool:0,avgNeutralPool:0,avgHighPool:0,avgAllowedPool:0,avgHighThreshold:0,maxAffinitySum:0},distance:{zeroNeutral:0,zeroHigh:0,samples:0}}));
  const auditSelectionHashes=[];

  for(let t=0;t<totalTargets;t++) {
    if(t>0) removeContestFromCounts(pool,database[t].mask);
    const target=database[t],bidx=Math.floor(t/blockSize),block=blocks[bidx];
    if(block.start==null)block.start=target.id;block.end=target.id;
    const groups=buildGroups(pool);
    block.availability.rounds++;
    block.availability.avgAllowedPool+=groups?.allowed.length||0;
    block.availability.avgZeroPool+=groups?.zero.length||0;
    block.availability.avgNeutralPool+=groups?.neutral.length||0;
    block.availability.avgHighPool+=groups?.high.length||0;
    block.availability.avgHighThreshold+=groups?.highThreshold||0;
    block.availability.maxAffinitySum+=groups?.maxAffinity||0;
    if(groups?.zero.length)block.availability.zeroAvailable++;

    for(let s=0;s<seeds;s++) {
      const rng=createRng(hashSeed('affinity13-select',target.id,s,poolSize));
      const triplet=chooseMatched(pool,groups,gamesCount,rng);
      if(t<5 && s===0 && triplet) auditSelectionHashes.push({contestId:target.id,zero:triplet.zero.map(id=>pool[id].mask),neutral:triplet.neutral.map(id=>pool[id].mask),high:triplet.high.map(id=>pool[id].mask)});
      const stats=block.seeds[s];
      const randomGames=randomPureGames(gamesCount,createRng(hashSeed('affinity13-random',target.id,s,gamesCount)));
      addRound(stats.random,randomGames,target.mask,null);
      if(!triplet) continue;
      const zg=idsToGames(pool,triplet.zero),ng=idsToGames(pool,triplet.neutral),hg=idsToGames(pool,triplet.high);
      addRound(stats.zero,zg,target.mask,zg.map(x=>x.affinity13));
      addRound(stats.neutral,ng,target.mask,ng.map(x=>x.affinity13));
      addRound(stats.high,hg,target.mask,hg.map(x=>x.affinity13));
      for(let k=0;k<gamesCount;k++) {
        block.distance.zeroNeutral+=structuralDistance(zg[k].features,ng[k].features);
        block.distance.zeroHigh+=structuralDistance(zg[k].features,hg[k].features);
        block.distance.samples++;
      }
    }
    if(t%25===0)self.postMessage({type:'progress',phase:'walk-forward',current:t+1,total:totalTargets});
  }

  // Resume cada bloco e cada seed sem tratar seeds repetidas do mesmo alvo como amostras temporais independentes.
  const globalSeedStats=Array.from({length:seeds},()=>blankStrategyStats());
  const renderedBlocks=[];
  for(const block of blocks) {
    const seedRows=[];
    for(let s=0;s<seeds;s++) {
      const row={};
      for(const key of ['random','zero','neutral','high']) {
        const st=block.seeds[s][key];
        const summary=statSummary(st);row[key]=summary;
        const dst=globalSeedStats[s][key];
        dst.totalGames+=st.totalGames;dst.hits11+=st.hits11;dst.hits12+=st.hits12;dst.hits13+=st.hits13;dst.hits14+=st.hits14;dst.hits15+=st.hits15;
        dst.bestHit=Math.max(dst.bestHit,st.bestHit);dst.sumBest+=st.sumBest;dst.rounds+=st.rounds;dst.roundBest.push(...st.roundBest);dst.sumAffinity+=st.sumAffinity;dst.affinitySamples+=st.affinitySamples;
      }
      seedRows.push(row);
    }
    const agg={};
    for(const key of ['random','zero','neutral','high']) {
      const temp=newStat(block.seeds[0][key].name);
      for(const s of block.seeds){const st=s[key];temp.totalGames+=st.totalGames;temp.hits11+=st.hits11;temp.hits12+=st.hits12;temp.hits13+=st.hits13;temp.hits14+=st.hits14;temp.hits15+=st.hits15;temp.bestHit=Math.max(temp.bestHit,st.bestHit);temp.sumBest+=st.sumBest;temp.rounds+=st.rounds;temp.sumAffinity+=st.sumAffinity;temp.affinitySamples+=st.affinitySamples;}
      agg[key]=statSummary(temp);
    }
    const seedDeltaZero=seedRows.map(r=>r.zero.avgBest-r.neutral.avgBest),seedDeltaHigh=seedRows.map(r=>r.high.avgBest-r.neutral.avgBest);
    const seedRateZero=seedRows.map(r=>r.zero.rate13-r.neutral.rate13),seedRateHigh=seedRows.map(r=>r.high.rate13-r.neutral.rate13);
    const av=block.availability,den=Math.max(1,av.rounds);
    renderedBlocks.push({label:block.label,startContest:block.start,endContest:block.end,targets:blockSize,aggregate:agg,
      zeroVsNeutral:{avgCI:meanCI(seedDeltaZero),rate13CI:meanCI(seedRateZero),avgWins:seedDeltaZero.filter(x=>x>0).length,rate13Wins:seedRateZero.filter(x=>x>0).length},
      highVsNeutral:{avgCI:meanCI(seedDeltaHigh),rate13CI:meanCI(seedRateHigh),avgWins:seedDeltaHigh.filter(x=>x>0).length,rate13Wins:seedRateHigh.filter(x=>x>0).length},
      availability:{zeroAvailability:av.zeroAvailable/den,avgZeroPool:av.avgZeroPool/den,avgNeutralPool:av.avgNeutralPool/den,avgHighPool:av.avgHighPool/den,avgAllowedPool:av.avgAllowedPool/den,avgHighThreshold:av.avgHighThreshold/den,avgMaxAffinity:av.maxAffinitySum/den},
      structuralDistance:{zeroNeutral:block.distance.samples?block.distance.zeroNeutral/block.distance.samples:0,zeroHigh:block.distance.samples?block.distance.zeroHigh/block.distance.samples:0}
    });
  }

  const globalSeeds=globalSeedStats.map(seed=>{const row={};for(const key of ['random','zero','neutral','high'])row[key]=statSummary(seed[key]);return row;});
  const aggregate={};
  for(const key of ['random','zero','neutral','high']) {
    const temp=newStat(globalSeedStats[0][key].name);
    for(const s of globalSeedStats){const st=s[key];temp.totalGames+=st.totalGames;temp.hits11+=st.hits11;temp.hits12+=st.hits12;temp.hits13+=st.hits13;temp.hits14+=st.hits14;temp.hits15+=st.hits15;temp.bestHit=Math.max(temp.bestHit,st.bestHit);temp.sumBest+=st.sumBest;temp.rounds+=st.rounds;temp.sumAffinity+=st.sumAffinity;temp.affinitySamples+=st.affinitySamples;}
    aggregate[key]=statSummary(temp);
  }
  const zAvg=globalSeeds.map(r=>r.zero.avgBest-r.neutral.avgBest),hAvg=globalSeeds.map(r=>r.high.avgBest-r.neutral.avgBest);
  const z13=globalSeeds.map(r=>r.zero.rate13-r.neutral.rate13),h13=globalSeeds.map(r=>r.high.rate13-r.neutral.rate13);
  const zeroAvgCI=meanCI(zAvg),highAvgCI=meanCI(hAvg),zero13CI=meanCI(z13),high13CI=meanCI(h13);
  const zeroBlocks=renderedBlocks.filter(b=>b.aggregate.zero.avgBest>b.aggregate.neutral.avgBest).length;
  const highBlocks=renderedBlocks.filter(b=>b.aggregate.high.avgBest>b.aggregate.neutral.avgBest).length;
  const zeroSeedWins=zAvg.filter(x=>x>0).length,highSeedWins=hAvg.filter(x=>x>0).length;
  let verdict='tanto_faz',reason='Nenhum extremo de afinidade abriu vantagem estável sobre o neutro.';
  const zeroStrong=zeroAvgCI.low>0 && zeroSeedWins>=Math.ceil(seeds*.75) && zeroBlocks>=2;
  const highStrong=highAvgCI.low>0 && highSeedWins>=Math.ceil(seeds*.75) && highBlocks>=2;
  if(zeroStrong&&!highStrong){verdict='zero13';reason='ZERO13 superou a faixa neutra de forma consistente entre seeds e blocos.';}
  else if(highStrong&&!zeroStrong){verdict='high13';reason='HIGH13 superou a faixa neutra de forma consistente entre seeds e blocos.';}
  else if(zeroStrong&&highStrong){verdict=zeroAvgCI.mean>=highAvgCI.mean?'zero13':'high13';reason='Os dois extremos superaram o neutro; o maior ganho médio define o candidato, mas exige nova validação.';}

  self.postMessage({type:'result',workerBuild:WORKER_BUILD,elapsedMs:Date.now()-startedAt,pool:{requested:poolSize,built:pool.length,attempts:built.attempts,balanceRule:'fixa_sem_lookahead'},gamesCount,seeds,blockSize,totalTargets,aggregate,global:{zeroVsNeutral:{avgCI:zeroAvgCI,rate13CI:zero13CI,avgSeedWins:zeroSeedWins,rate13SeedWins:z13.filter(x=>x>0).length},highVsNeutral:{avgCI:highAvgCI,rate13CI:high13CI,avgSeedWins:highSeedWins,rate13SeedWins:h13.filter(x=>x>0).length},zeroBlocks,highBlocks},blocks:renderedBlocks,verdict,reason,auditSelectionHashes});
}

self.onmessage=e=>{try{run(e.data||{});}catch(err){self.postMessage({type:'error',message:err?.message||String(err),stack:err?.stack||''});}};
