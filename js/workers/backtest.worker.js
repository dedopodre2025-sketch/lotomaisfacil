import {
  buildSmartModel, selectSmartVariants, SMART_COMPONENTS, SMART_WEIGHTS,
  prepareSmartCalibrationRound, calibrateSmartWeightsFromRounds
} from '../generators/smart.js?v=5.1.0';

// Sniper Walk-Forward Backtest Worker
const WORKER_BUILD = 'v5.1-focus-blocks-20260816';
// Validação retroativa reprodutível, sem look-ahead e com controle aleatório.

function bitCount(n) {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;
}

function getMaxSequence(nums) {
  if (!nums || nums.length === 0) return 0;
  const sorted = [...nums].sort((a,b)=>a-b);
  let max=1,cur=1;
  for(let i=1;i<sorted.length;i++) {
    if(sorted[i]===sorted[i-1]+1) cur++;
    else { max=Math.max(max,cur); cur=1; }
  }
  return Math.max(max,cur);
}

function hashSeed() {
  let h = 2166136261 >>> 0;
  const text = Array.from(arguments).join('|');
  for (let i=0;i<text.length;i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h,16777619) >>> 0;
  }
  return h || 1;
}

function createRng(seed) {
  let s = seed >>> 0;
  return function() {
    s = (Math.imul(s,1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shuffleCopy(arr,rng) {
  const out=[...arr];
  for(let i=out.length-1;i>0;i--) {
    const j=Math.floor(rng()*(i+1));
    const t=out[i]; out[i]=out[j]; out[j]=t;
  }
  return out;
}

function randomGame(rng) {
  return shuffleCopy(Array.from({length:25},(_,i)=>i+1),rng).slice(0,15).sort((a,b)=>a-b);
}

function calcularPadroesLocais(db) {
  if(!db || db.length<10) return {sumLo:170,sumHi:220,evenLo:6,evenHi:9,seqCap:5};
  const sums=[],evens=[],seqs=[];
  for(let i=0;i<db.length;i++) {
    sums.push(db[i].sum!=null?db[i].sum:db[i].nums.reduce((a,b)=>a+b,0));
    evens.push(db[i].nums.filter(n=>n%2===0).length);
    seqs.push(db[i].maxSeq!=null?db[i].maxSeq:getMaxSequence(db[i].nums));
  }
  const q=(arr,p)=>{const s=[...arr].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor((s.length-1)*p))];};
  return {sumLo:q(sums,.20),sumHi:q(sums,.80),evenLo:q(evens,.20),evenHi:q(evens,.80),seqCap:q(seqs,.75)};
}

function getHeadlessFocusedGame(targetMaxCoinc,db,rng) {
  let best=null,bestAllowed=null,bestAllowedMatch=-1,minDiff=999;
  for(let i=0;i<3000;i++) {
    const current=randomGame(rng);
    const mask=current.reduce((m,n)=>m|(1<<(n-1)),0);
    let maxMatch=0;
    for(let j=0;j<db.length;j++) {
      const hit=bitCount(mask & db[j].mask);
      if(hit>maxMatch) maxMatch=hit;
      if(maxMatch>targetMaxCoinc+1) break;
    }
    if(maxMatch<=targetMaxCoinc && maxMatch>bestAllowedMatch) {
      bestAllowedMatch=maxMatch; bestAllowed=current;
    }
    const diff=Math.abs(maxMatch-targetMaxCoinc);
    if(diff<minDiff) { minDiff=diff; best=current; }
    if(bestAllowedMatch===targetMaxCoinc) break;
  }
  return bestAllowed || best || randomGame(rng);
}

function buildStructuredModel(db,mode) {
  const freqPerma=new Array(26).fill(0),freqEntry=new Array(26).fill(0),freqExit=new Array(26).fill(0),dezEntrada=new Array(26).fill(0);
  let pairCount=0,transitionPairs=0;
  const limit=Math.min(db.length,1200); // O modelo é calculado uma vez por janela; teto protege bases gigantes.
  for(let i=0;i<limit;i++) {
    const c1=db[i];
    for(let j=i+1;j<limit;j++) {
      const c2=db[j];
      if(bitCount(c1.mask & c2.mask)!==mode) continue;
      pairCount++;
      for(let n=1;n<=25;n++) {
        const a=c1.nums.includes(n),b=c2.nums.includes(n);
        if(a&&b) freqPerma[n]++;
        else if(a||b) freqEntry[n]++;
        else freqExit[n]++;
        if(transitionPairs<50 && !b && a) dezEntrada[n]++;
      }
      if(transitionPairs<50) transitionPairs++;
    }
  }
  const sortNums=f=>f.map((v,n)=>({n,v})).filter(x=>x.n>0).sort((a,b)=>b.v-a.v||a.n-b.n).map(x=>x.n);
  return {
    pairCount,
    nucleusPool:sortNums(freqPerma).slice(0,12),
    rotationPool:sortNums(freqEntry).slice(0,10),
    exclusionPool:sortNums(freqExit).slice(0,8),
    transEntryPool:sortNums(dezEntrada).slice(0,8),
  };
}

function getHeadlessStructuredGame(model,stds,rng) {
  if(!model || !model.pairCount) return randomGame(rng);
  let best=[],bestScore=-1;
  const validate=nums=>{
    const sum=nums.reduce((a,b)=>a+b,0),evens=nums.filter(n=>n%2===0).length,seq=getMaxSequence(nums);
    let score=0;
    if(sum>=stds.sumLo&&sum<=stds.sumHi) score+=3;
    if(evens>=stds.evenLo&&evens<=stds.evenHi) score+=3;
    if(seq<=stds.seqCap) score+=2;
    return score;
  };
  for(let a=0;a<200;a++) {
    const set=new Set();
    const nucCount=6+Math.floor(rng()*3),rotCount=4+Math.floor(rng()*2),transCount=2+Math.floor(rng()*2);
    shuffleCopy(model.nucleusPool,rng).slice(0,nucCount).forEach(n=>set.add(n));
    shuffleCopy(model.rotationPool.filter(n=>!set.has(n)),rng).slice(0,rotCount).forEach(n=>set.add(n));
    shuffleCopy(model.transEntryPool.filter(n=>!set.has(n)),rng).slice(0,transCount).forEach(n=>set.add(n));
    if(set.size<15) {
      const avail=Array.from({length:25},(_,i)=>i+1).filter(n=>!set.has(n));
      const safe=avail.filter(n=>!model.exclusionPool.includes(n));
      const fill=(safe.length>=15-set.size?safe:avail);
      shuffleCopy(fill,rng).slice(0,15-set.size).forEach(n=>set.add(n));
    }
    const candidate=Array.from(set).slice(0,15).sort((a,b)=>a-b);
    if(candidate.length!==15) continue;
    const score=validate(candidate);
    if(score>bestScore) {bestScore=score;best=candidate;}
    if(score===8) break;
  }
  return best.length===15?best:randomGame(rng);
}

function combination(n,k) {
  if(k<0||k>n) return 0;
  k=Math.min(k,n-k);
  let r=1;
  for(let i=1;i<=k;i++) r=r*(n-k+i)/i;
  return r;
}

function randomHitProbability(minHits) {
  const den=combination(25,15);
  let p=0;
  for(let k=minHits;k<=15;k++) p += combination(15,k)*combination(10,15-k)/den;
  return p;
}

function wilson(successes,total,z) {
  if(!total) return {low:0,high:0};
  z=z||1.959963984540054;
  const p=successes/total,z2=z*z,den=1+z2/total;
  const center=(p+z2/(2*total))/den;
  const half=(z*Math.sqrt((p*(1-p)+z2/(4*total))/total))/den;
  return {low:Math.max(0,center-half),high:Math.min(1,center+half)};
}

function newStat(name) {
  return {name,hits11:0,hits12:0,hits13:0,bestHit:0,sumBestHits:0,validPeriods:0,totalGames:0,avg:'0.0',roundBestHits:[]};
}

function finalizeStat(s) {
  s.avg=s.validPeriods?(s.sumBestHits/s.validPeriods).toFixed(2):'0.00';
  s.rate11=s.totalGames?s.hits11/s.totalGames:0;
  s.rate12=s.totalGames?s.hits12/s.totalGames:0;
  s.rate13=s.totalGames?s.hits13/s.totalGames:0;
  s.ci13=wilson(s.hits13,s.totalGames);
  return s;
}

function pairedMeanCI(full, without) {
  const n=Math.min(full.length,without.length);
  if(!n) return {mean:0,low:0,high:0,n:0};
  const diffs=[];
  for(let i=0;i<n;i++) diffs.push((Number(full[i])||0)-(Number(without[i])||0));
  const avg=diffs.reduce((a,b)=>a+b,0)/n;
  if(n<2) return {mean:avg,low:avg,high:avg,n};
  const variance=diffs.reduce((a,x)=>a+((x-avg)*(x-avg)),0)/(n-1);
  const se=Math.sqrt(variance/n);
  const half=1.959963984540054*se;
  return {mean:avg,low:avg-half,high:avg+half,n};
}

// ---- v5: índice incremental de afinidade para Focado 12/13 ----
function _subsetMasks14(nums) {
  const base=nums.reduce((m,n)=>m|(1<<(n-1)),0), out=[];
  for(const n of nums) out.push(base & ~(1<<(n-1)));
  return out;
}
function _subsetMasks13(nums) {
  const base=nums.reduce((m,n)=>m|(1<<(n-1)),0), out=[];
  for(let i=0;i<nums.length;i++) for(let j=i+1;j<nums.length;j++) {
    out.push(base & ~(1<<(nums[i]-1)) & ~(1<<(nums[j]-1)));
  }
  return out;
}
function _mapDelta(map,key,delta) {
  const next=(map.get(key)||0)+delta;
  if(next<=0) map.delete(key); else map.set(key,next);
}
function _indexContest(index,contest,delta) {
  if(!contest?.nums?.length) return;
  for(const m of _subsetMasks13(contest.nums)) _mapDelta(index.count13,m,delta);
  for(const m of _subsetMasks14(contest.nums)) _mapDelta(index.count14,m,delta);
  index.size+=delta;
}
function buildFocusedHistoryIndex(contests,onProgress) {
  const index={count13:new Map(),count14:new Map(),size:0};
  const total=contests.length;
  for(let i=0;i<total;i++) {
    _indexContest(index,contests[i],1);
    if(onProgress && i>0 && i%500===0) onProgress(i,total);
  }
  return index;
}
function evaluateFocused13Candidate(nums,index) {
  for(const m of _subsetMasks14(nums)) if((index.count14.get(m)||0)>0) return {allowed:false,exact:false,affinity13:0};
  let affinity13=0;
  for(const m of _subsetMasks13(nums)) affinity13+=(index.count13.get(m)||0);
  return {allowed:true,exact:affinity13>0,affinity13};
}
function violatesFocused12(nums,index) {
  for(const m of _subsetMasks13(nums)) if((index.count13.get(m)||0)>0) return true;
  return false;
}
function structuralCandidateScore(nums,stds) {
  const sum=nums.reduce((a,b)=>a+b,0), evens=nums.filter(n=>n%2===0).length, seq=getMaxSequence(nums);
  let score=0;
  score += (sum>=stds.sumLo&&sum<=stds.sumHi)?3:Math.max(0,3-Math.min(3,Math.abs(sum-(sum<stds.sumLo?stds.sumLo:stds.sumHi))/12));
  score += (evens>=stds.evenLo&&evens<=stds.evenHi)?3:Math.max(0,3-Math.abs(evens-(evens<stds.evenLo?stds.evenLo:stds.evenHi)));
  score += seq<=stds.seqCap?2:Math.max(0,2-(seq-stds.seqCap));
  return score/8*100;
}
function getFocused13Fast(index,rng,maxAttempts=240) {
  let fallback=null;
  for(let i=0;i<maxAttempts;i++) {
    const game=randomGame(rng), ev=evaluateFocused13Candidate(game,index);
    if(!ev.allowed) continue;
    if(!fallback) fallback={game,meta:ev,attempts:i+1};
    if(ev.exact) return {game,meta:ev,attempts:i+1};
  }
  return fallback || {game:randomGame(rng),meta:{allowed:false,exact:false,affinity13:0},attempts:maxAttempts};
}
function getFocused12Fast(index,trainingMasks,rng,maxAttempts=1800) {
  let fallback=null;
  for(let i=0;i<maxAttempts;i++) {
    const game=randomGame(rng);
    if(violatesFocused12(game,index)) continue;
    const mask=game.reduce((m,n)=>m|(1<<(n-1)),0);
    let maxMatch=0;
    for(const histMask of trainingMasks) {
      const h=bitCount(mask & histMask);
      if(h>maxMatch) maxMatch=h;
      if(maxMatch===12) break; // o índice já garantiu que 13+ é impossível
    }
    const row={game,meta:{allowed:true,exact:maxMatch===12,maxMatch},attempts:i+1};
    if(!fallback || maxMatch>(fallback.meta.maxMatch||0)) fallback=row;
    if(maxMatch===12) return row;
  }
  return fallback || {game:randomGame(rng),meta:{allowed:false,exact:false,maxMatch:null},attempts:maxAttempts};
}
function getFocused13AuditVariants(index,stds,rng,poolSize=48) {
  const candidates=[];
  let attempted=0,rejected14=0,below13=0;
  const maxAttempts=Math.max(poolSize*4,120);
  while(candidates.length<poolSize && attempted<maxAttempts) {
    attempted++;
    const game=randomGame(rng), ev=evaluateFocused13Candidate(game,index);
    if(!ev.allowed) { rejected14++; continue; }
    if(!ev.exact) { below13++; continue; }
    candidates.push({game,affinity13:ev.affinity13,structure:structuralCandidateScore(game,stds)});
  }
  if(!candidates.length) {
    const f=getFocused13Fast(index,rng,300);
    candidates.push({game:f.game,affinity13:f.meta.affinity13||0,structure:structuralCandidateScore(f.game,stds)});
  }
  const current=candidates[0];
  const low=[...candidates].sort((a,b)=>a.affinity13-b.affinity13||b.structure-a.structure)[0];
  const high=[...candidates].sort((a,b)=>b.affinity13-a.affinity13||b.structure-a.structure)[0];
  const structure=[...candidates].sort((a,b)=>b.structure-a.structure||a.affinity13-b.affinity13)[0];
  return {
    variants:{current:current.game,lowAffinity:low.game,highAffinity:high.game,structure:structure.game},
    meta:{attempted,rejected14,below13,exactCandidates:candidates.length,currentAffinity:current.affinity13,lowAffinity:low.affinity13,highAffinity:high.affinity13,currentStructure:current.structure,bestStructure:structure.structure}
  };
}
function recordStatRound(stat,games,targetMask) {
  let roundMax=0;
  for(const game of games) {
    const mask=game.reduce((m,n)=>m|(1<<(n-1)),0), hits=bitCount(mask & targetMask);
    stat.totalGames++;
    if(hits>=11) stat.hits11++;
    if(hits>=12) stat.hits12++;
    if(hits>=13) stat.hits13++;
    if(hits>stat.bestHit) stat.bestHit=hits;
    if(hits>roundMax) roundMax=hits;
  }
  stat.sumBestHits+=roundMax; stat.validPeriods++; stat.roundBestHits.push(roundMax);
  return roundMax;
}



// ---- v5.1: validação por blocos de alvos não sobrepostos ----
// Cada bloco usa alvos distintos. O histórico de treino continua sendo o passado
// natural de cada alvo; portanto os alvos não se repetem, embora as janelas de
// treinamento possam compartilhar concursos antigos (como deve ocorrer em walk-forward).
function runFocused13BlockValidation(database, gamesCount, options={}) {
  const eligible=Math.max(0,database.length-50);
  const requestedBlockSize=Math.max(100,Number(options.blockSize)||1000);
  const blockSize=Math.min(requestedBlockSize,Math.floor(eligible/3));
  if(blockSize<100) return null;

  const totalTargets=blockSize*3;
  const labels=['Recente','Intermediário','Antigo'];
  const blocks=labels.map(label=>({
    label,
    random:newStat('Aleatório'),
    focado13:newStat('Focado 13'),
    startContest:null,endContest:null
  }));

  const index=buildFocusedHistoryIndex(database.slice(1));
  for(let i=0;i<totalTargets;i++) {
    if(i>0) _indexContest(index,database[i],-1);
    const target=database[i];
    const blockIndex=Math.floor(i/blockSize);
    const block=blocks[blockIndex];
    if(!block.startContest) block.startContest=target.id;
    block.endContest=target.id;

    const randomGames=[],focusedGames=[];
    for(let g=0;g<gamesCount;g++) {
      randomGames.push(randomGame(createRng(hashSeed(target.id,'blocks-random',g,database.length))));
      // Mesmo gerador Máx 13 usado no perfil focado; seed própria para tornar o
      // teste de blocos reprodutível e independente do número de cards do Raio-X.
      focusedGames.push(getFocused13Fast(index,createRng(hashSeed(target.id,'blocks-f13',g,database.length)),240).game);
    }
    recordStatRound(block.random,randomGames,target.mask);
    recordStatRound(block.focado13,focusedGames,target.mask);

    if(i%100===0) self.postMessage({type:'progress',phase:'focused-blocks',current:i+1,total:totalTargets});
  }

  let avgWins=0,rate13Wins=0,theoryWins=0;
  const theory13=randomHitProbability(13);
  const rendered=blocks.map(block=>{
    finalizeStat(block.random); finalizeStat(block.focado13);
    const paired=pairedMeanCI(block.focado13.roundBestHits,block.random.roundBestHits);
    const avgDelta=paired.mean;
    const rate13Delta=block.focado13.rate13-block.random.rate13;
    if(avgDelta>0) avgWins++;
    if(rate13Delta>0) rate13Wins++;
    if(block.focado13.rate13>theory13) theoryWins++;
    const result={
      label:block.label,
      targets:block.focado13.validPeriods,
      startContest:block.startContest,
      endContest:block.endContest,
      focado13:{avg:Number(block.focado13.avg),hits11:block.focado13.hits11,hits12:block.focado13.hits12,hits13:block.focado13.hits13,totalGames:block.focado13.totalGames,rate13:block.focado13.rate13,ci13:block.focado13.ci13,bestHit:block.focado13.bestHit},
      random:{avg:Number(block.random.avg),hits11:block.random.hits11,hits12:block.random.hits12,hits13:block.random.hits13,totalGames:block.random.totalGames,rate13:block.random.rate13,ci13:block.random.ci13,bestHit:block.random.bestHit},
      pairedAvg:{mean:paired.mean,low:paired.low,high:paired.high,n:paired.n},
      deltaRate13:rate13Delta
    };
    delete block.random.roundBestHits; delete block.focado13.roundBestHits;
    return result;
  });

  return {
    blockSize,
    totalTargets,
    gamesCount,
    theoreticalRate13:theory13,
    avgWins,
    rate13Wins,
    theoryWins,
    blocks:rendered
  };
}

function runBacktest(data) {
  const startedAt=Date.now();
  const {database,period,strategy,gamesCount,conexaoMode}=data;
  const calibrationWindow=Math.max(8,Math.min(24,Number(data.calibrationWindow)||16));
  const calibrationCandidateCount=Math.max(100,Math.min(280,Number(data.calibrationCandidateCount)||150));
  const requested=Math.min(period,Math.max(0,database.length-50));
  const focusedProfile=strategy==='focado13';
  const executionProfile=focusedProfile?'focado13_deep':'full';
  const strategies=focusedProfile?['random','focado12','focado13']:['random','smart','smartAuto','focado12','focado13','conexoes'];
  const allStats={
    random:newStat('Aleatório'), smart:newStat('Smart Fixo'), smartAuto:newStat('Smart Auto'),
    focado12:newStat('Focado 12'), focado13:newStat('Focado 13'), conexoes:newStat('Conexões 13')
  };
  const compStats={}; for(const k of strategies) compStats[k]=allStats[k];

  const ablationStats=focusedProfile?null:{full:newStat('Smart Completo')};
  if(ablationStats) for(const [key,meta] of Object.entries(SMART_COMPONENTS)) ablationStats[key]=newStat('Sem '+meta.short);

  const f13AuditStats=focusedProfile?{
    current:newStat('Focado 13 atual'),
    lowAffinity:newStat('Afinidade 13 baixa'),
    highAffinity:newStat('Afinidade 13 alta'),
    structure:newStat('Estrutura histórica')
  }:null;
  const f13Meta={attempted:0,rejected14:0,below13:0,exactCandidates:0,currentAffinity:0,lowAffinity:0,highAffinity:0,currentStructure:0,bestStructure:0,rounds:0};

  const totalHits={11:0,12:0,13:0,14:0,15:0};
  let sumBestHits=0,validPeriods=0,allGamesTotal=0,bestHitGlobal=0;
  const roundResults=[];

  // Índice incremental: cada concurso histórico é indexado uma vez. Depois, a janela
  // walk-forward apenas remove o concurso que deixou de pertencer ao passado do alvo.
  self.postMessage({type:'progress',phase:'focused-index',current:0,total:Math.max(0,database.length-1)});
  const focusedIndex=buildFocusedHistoryIndex(database.slice(1),(cur,total)=>self.postMessage({type:'progress',phase:'focused-index',current:cur,total}));

  // Smart nested só existe no perfil completo. O perfil Focado13 evita todo esse custo.
  const calibrationRoundsByIndex=new Map();
  if(!focusedProfile) {
    const maxCalibrationIndex=Math.min(database.length-51,requested+calibrationWindow);
    for(let j=1;j<=maxCalibrationIndex;j++) {
      const innerTraining=database.slice(j+1,Math.min(database.length,j+1+1200));
      if(innerTraining.length<50) continue;
      const target=database[j];
      const round=prepareSmartCalibrationRound(target,innerTraining,{minHistory:50,candidateCount:calibrationCandidateCount,rng:createRng(hashSeed(target.id,'nested-calibration',j,innerTraining.length))});
      if(round) calibrationRoundsByIndex.set(j,round);
      if(j%8===0) self.postMessage({type:'progress',phase:'calibration',current:j,total:maxCalibrationIndex});
    }
  }
  const calibrationTrace=[];

  for(let i=0;i<requested;i++) {
    if(i>0) _indexContest(focusedIndex,database[i],-1);
    const targetContest=database[i];
    const historicalBase=database.slice(i+1);
    if(historicalBase.length<50) break;
    const training=historicalBase.slice(0,Math.min(historicalBase.length,4500));
    const trainingMasks=historicalBase.map(c=>c.mask);
    const stds=calcularPadroesLocais(training);
    if(i%5===0) self.postMessage({type:'progress',phase:'walk-forward',current:i+1,total:requested});

    let model=null,smartModel=null,calibration=null;
    if(!focusedProfile) {
      model=buildStructuredModel(training,conexaoMode||13);
      smartModel=buildSmartModel(training);
      const innerRounds=[];
      for(let j=i+1;j<=i+calibrationWindow;j++) { const round=calibrationRoundsByIndex.get(j); if(round) innerRounds.push(round); }
      calibration=calibrateSmartWeightsFromRounds(innerRounds,{baseWeights:SMART_WEIGHTS,gamesCount,minRounds:8,passes:2,factors:[0.70,1.30],regularization:0.12,minGain:0.003});
      calibrationTrace.push({contestId:targetContest.id,rounds:calibration.rounds,changed:calibration.changed,objectiveDelta:calibration.objectiveDelta,weights:calibration.weights,baselineAvg:calibration.baselineMetrics?.avgBest||0,calibratedAvg:calibration.calibratedMetrics?.avgBest||0});
    }

    const compGames={}; for(const st of strategies) compGames[st]=[];
    const ablationGames={}; if(ablationStats) for(const key of Object.keys(ablationStats)) ablationGames[key]=[];
    const auditGames={}; if(f13AuditStats) for(const key of Object.keys(f13AuditStats)) auditGames[key]=[];

    for(let g=0;g<gamesCount;g++) {
      compGames.random.push(randomGame(createRng(hashSeed(targetContest.id,'random',g,historicalBase.length))));

      if(!focusedProfile) {
        const smartSeed=hashSeed(targetContest.id,'smart-pool',g,training.length);
        const fixedSelection=selectSmartVariants(training,{model:smartModel,rng:createRng(smartSeed),iterations:420,coverageWeight:0});
        const autoSelection=selectSmartVariants(training,{model:smartModel,rng:createRng(smartSeed),iterations:420,coverageWeight:0,weights:calibration.weights});
        compGames.smart.push(fixedSelection.variants.full.game);
        compGames.smartAuto.push(autoSelection.variants.full.game);
        for(const key of Object.keys(ablationGames)) ablationGames[key].push(autoSelection.variants[key]?.game || autoSelection.variants.full.game);
        compGames.conexoes.push(getHeadlessStructuredGame(model,stds,createRng(hashSeed(targetContest.id,'conn',g,training.length))));
      }

      const f12=getFocused12Fast(focusedIndex,trainingMasks,createRng(hashSeed(targetContest.id,'f12-fast',g,historicalBase.length)),3000);
      compGames.focado12.push(f12.game);

      if(focusedProfile) {
        const audit=getFocused13AuditVariants(focusedIndex,stds,createRng(hashSeed(targetContest.id,'f13-audit',g,historicalBase.length)),48);
        compGames.focado13.push(audit.variants.current);
        for(const key of Object.keys(auditGames)) auditGames[key].push(audit.variants[key]);
        for(const key of Object.keys(f13Meta)) if(key!=='rounds') f13Meta[key]+=Number(audit.meta[key]||0);
        f13Meta.rounds++;
      } else {
        const f13=getFocused13Fast(focusedIndex,createRng(hashSeed(targetContest.id,'f13-fast',g,historicalBase.length)),240);
        compGames.focado13.push(f13.game);
      }
    }

    for(const st of strategies) recordStatRound(compStats[st],compGames[st],targetContest.mask);
    if(ablationStats) for(const key of Object.keys(ablationStats)) recordStatRound(ablationStats[key],ablationGames[key],targetContest.mask);
    if(f13AuditStats) for(const key of Object.keys(f13AuditStats)) recordStatRound(f13AuditStats[key],auditGames[key],targetContest.mask);

    const chosen=compGames[strategy] || compGames.focado13 || compGames.random;
    let maxHit=0,bestGame=[];
    for(const game of chosen) {
      const mask=game.reduce((m,n)=>m|(1<<(n-1)),0),hits=bitCount(mask & targetContest.mask);
      allGamesTotal++; if(hits>=11) totalHits[hits]=(totalHits[hits]||0)+1;
      if(hits>bestHitGlobal) bestHitGlobal=hits;
      if(hits>maxHit){maxHit=hits;bestGame=game;}
    }
    sumBestHits+=maxHit; validPeriods++;
    roundResults.push({contestId:targetContest.id,contestNums:targetContest.nums,maxHit,bestGame});
  }

  for(const st of strategies) finalizeStat(compStats[st]);
  if(ablationStats) for(const key of Object.keys(ablationStats)) finalizeStat(ablationStats[key]);
  if(f13AuditStats) for(const key of Object.keys(f13AuditStats)) finalizeStat(f13AuditStats[key]);

  let componentImpact=null,calibrationSummary=null;
  if(ablationStats) {
    const fullAblation=ablationStats.full; componentImpact={};
    for(const [key,meta] of Object.entries(SMART_COMPONENTS)) {
      const without=ablationStats[key],paired=pairedMeanCI(fullAblation.roundBestHits,without.roundBestHits);
      let verdict='inconclusivo'; if(paired.low>0) verdict='ajudou'; else if(paired.high<0) verdict='atrapalhou';
      componentImpact[key]={label:meta.short,fullAvg:Number(fullAblation.avg),withoutAvg:Number(without.avg),deltaAvg:paired.mean,ciLow:paired.low,ciHigh:paired.high,n:paired.n,fullRate12:fullAblation.rate12,withoutRate12:without.rate12,deltaRate12:fullAblation.rate12-without.rate12,fullRate13:fullAblation.rate13,withoutRate13:without.rate13,deltaRate13:fullAblation.rate13-without.rate13,verdict};
    }
    const autoVsFixedCI=pairedMeanCI(compStats.smartAuto.roundBestHits,compStats.smart.roundBestHits);
    const weightKeys=Object.keys(SMART_COMPONENTS),averageWeights={};
    for(const key of weightKeys) averageWeights[key]=calibrationTrace.length?calibrationTrace.reduce((sum,row)=>sum+(Number(row.weights?.[key])||0),0)/calibrationTrace.length:SMART_WEIGHTS[key];
    const latestCalibration=calibrationTrace.length?calibrationTrace[0]:null;
    calibrationSummary={mode:'nested_walk_forward',window:calibrationWindow,candidateCount:calibrationCandidateCount,averageWeights,latestWeights:latestCalibration?.weights||SMART_WEIGHTS,latestRounds:latestCalibration?.rounds||0,changedCount:calibrationTrace.filter(x=>x.changed).length,totalCalibrations:calibrationTrace.length,avgInnerDelta:calibrationTrace.length?calibrationTrace.reduce((a,x)=>a+(Number(x.calibratedAvg)-Number(x.baselineAvg)),0)/calibrationTrace.length:0,autoVsFixed:{mean:autoVsFixedCI.mean,low:autoVsFixedCI.low,high:autoVsFixedCI.high,n:autoVsFixedCI.n}};
  }

  let focused13Audit=null;
  if(f13AuditStats) {
    const current=f13AuditStats.current;
    const variants={};
    for(const key of ['lowAffinity','highAffinity','structure']) {
      const st=f13AuditStats[key],ci=pairedMeanCI(st.roundBestHits,current.roundBestHits);
      let verdict='inconclusivo'; if(ci.low>0) verdict='ajudou'; else if(ci.high<0) verdict='atrapalhou';
      variants[key]={name:st.name,avg:Number(st.avg),rate12:st.rate12,rate13:st.rate13,bestHit:st.bestHit,deltaAvg:ci.mean,ciLow:ci.low,ciHigh:ci.high,n:ci.n,deltaRate12:st.rate12-current.rate12,deltaRate13:st.rate13-current.rate13,verdict};
    }
    const vsRandom=pairedMeanCI(current.roundBestHits,compStats.random.roundBestHits);
    const denom=Math.max(1,f13Meta.rounds);
    focused13Audit={poolSize:48,current:{avg:Number(current.avg),rate12:current.rate12,rate13:current.rate13,bestHit:current.bestHit},vsRandom:{mean:vsRandom.mean,low:vsRandom.low,high:vsRandom.high,n:vsRandom.n},variants,search:{avgAttempts:f13Meta.attempted/denom,reject14Rate:f13Meta.attempted?f13Meta.rejected14/f13Meta.attempted:0,below13Rate:f13Meta.attempted?f13Meta.below13/f13Meta.attempted:0,avgExactCandidates:f13Meta.exactCandidates/denom,avgCurrentAffinity:f13Meta.currentAffinity/denom,avgLowAffinity:f13Meta.lowAffinity/denom,avgHighAffinity:f13Meta.highAffinity/denom,avgCurrentStructure:f13Meta.currentStructure/denom,avgBestStructure:f13Meta.bestStructure/denom}};
  }

  // Validação em 3 blocos de alvos não sobrepostos só é ativada no teste profundo
  // (1.000+ alvos), para não transformar rodadas curtas em operações pesadas.
  let focused13Blocks=null;
  if(focusedProfile && requested>=1000) {
    focused13Blocks=runFocused13BlockValidation(database,gamesCount,{blockSize:1000});
  }

  const chosenKey=compStats[strategy]?strategy:(compStats.focado13?'focado13':'random');
  const chosenStat=compStats[chosenKey],randomStat=compStats.random;
  const lift13=randomStat.rate13>0?((chosenStat.rate13/randomStat.rate13)-1)*100:null;
  const baseline={selectedKey:chosenKey,selectedRate13:chosenStat.rate13,randomRate13:randomStat.rate13,lift13,difference13:chosenStat.rate13-randomStat.rate13,selectedCI13:chosenStat.ci13,randomCI13:randomStat.ci13,theoretical:{p11plus:randomHitProbability(11),p12plus:randomHitProbability(12),p13plus:randomHitProbability(13),p14plus:randomHitProbability(14),p15:randomHitProbability(15)}};

  for(const st of Object.values(compStats)) delete st.roundBestHits;
  if(ablationStats) for(const st of Object.values(ablationStats)) delete st.roundBestHits;
  if(f13AuditStats) for(const st of Object.values(f13AuditStats)) delete st.roundBestHits;

  self.postMessage({type:'result',workerBuild:WORKER_BUILD,totalHits,sumBestHits,validPeriods,allGamesTotal,bestHitGlobal,compStats,roundResults,period:validPeriods,strategy:chosenKey,gamesCount,baseline,ablationStats,componentImpact,calibrationSummary,focused13Audit,focused13Blocks,executionProfile,elapsedMs:Date.now()-startedAt});
}

self.onmessage=function(e){
  try { runBacktest(e.data||{}); }
  catch(err) { self.postMessage({type:'error',message:err?.message||String(err),stack:err?.stack||''}); }
};
