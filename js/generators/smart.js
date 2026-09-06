/**
 * Smart Engine v4 — motor headless compartilhado entre o volante e o Sniper.
 *
 * Objetivo: ranquear candidatos usando sinais calculados SOMENTE no histórico disponível:
 * frequência recente (EMA), atraso relativo, Markov por dezena, coocorrência,
 * aderência estrutural e anti-crowd. Nenhum componente representa probabilidade garantida.
 * O Sniper mede o valor incremental de cada componente por ablação walk-forward e
 * calibra pesos por nested walk-forward, sem usar o concurso-alvo.
 */
import { getMaxSequence } from '../core/utils.js';
import { calculateHumanPopularity, calculateCoverageQuality } from '../analytics/scoring.js';

export const SMART_COMPONENTS = Object.freeze({
  frequency:    { label: 'Frequência EMA', short: 'Frequência' },
  delay:        { label: 'Atraso relativo', short: 'Atraso' },
  markov:       { label: 'Markov por dezena', short: 'Markov' },
  cooccurrence: { label: 'Coocorrência', short: 'Coocorrência' },
  adherence:    { label: 'Aderência estrutural', short: 'Aderência' },
  antiCrowd:    { label: 'Anti-Crowd', short: 'Anti-Crowd' },
});

export const SMART_WEIGHTS = Object.freeze({
  frequency: 0.12,
  delay: 0.08,
  markov: 0.18,
  cooccurrence: 0.14,
  adherence: 0.36,
  antiCrowd: 0.12,
});

const ALL_NUMS = Array.from({ length: 25 }, (_, i) => i + 1);
const PRIMES = new Set([2,3,5,7,11,13,17,19,23]);
const FRAME = new Set([1,2,3,4,5,6,10,11,15,16,20,21,22,23,24,25]);

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function safeNums(c) { return Array.isArray(c?.nums) ? c.nums : []; }

function shuffleCopy(arr, rng = Math.random) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function quantile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a,b)=>a-b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor((s.length - 1) * p)));
  return s[idx];
}

function mean(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0) / arr.length : 0; }
function stddev(arr, avg = mean(arr)) {
  if (arr.length < 2) return 1;
  const v = arr.reduce((a,x)=>a + ((x-avg) ** 2), 0) / (arr.length - 1);
  return Math.sqrt(v) || 1;
}

function minMaxNormalize(values, neutral = 50) {
  const finite = values.slice(1).filter(Number.isFinite);
  if (!finite.length) return new Array(26).fill(neutral);
  const lo = Math.min(...finite), hi = Math.max(...finite);
  const out = new Array(26).fill(neutral);
  if (Math.abs(hi - lo) < 1e-12) return out;
  for (let n=1;n<=25;n++) out[n] = clamp(((values[n]-lo)/(hi-lo))*100, 0, 100);
  return out;
}

function scoreRange(value, lo, hi, soft = 1) {
  if (value >= lo && value <= hi) return 100;
  const distance = value < lo ? lo - value : value - hi;
  return clamp(100 - (distance / Math.max(soft, 1e-9)) * 25, 0, 100);
}

function deriveStandards(db) {
  if (!db?.length) {
    return { sumLo:170,sumHi:220,evenLo:6,evenHi:9,primeLo:4,primeHi:7,frameLo:8,frameHi:11,repeatLo:8,repeatHi:10,seqCap:5 };
  }
  const sums=[], evens=[], primes=[], frames=[], seqs=[], repeats=[];
  for (let i=0;i<db.length;i++) {
    const nums=safeNums(db[i]);
    sums.push(db[i].sum ?? nums.reduce((a,b)=>a+b,0));
    evens.push(nums.filter(n=>n%2===0).length);
    primes.push(nums.filter(n=>PRIMES.has(n)).length);
    frames.push(nums.filter(n=>FRAME.has(n)).length);
    seqs.push(db[i].maxSeq ?? getMaxSequence(nums));
    if (i < db.length-1) {
      const older = new Set(safeNums(db[i+1]));
      repeats.push(nums.filter(n=>older.has(n)).length);
    }
  }
  return {
    sumLo:quantile(sums,.20), sumHi:quantile(sums,.80),
    evenLo:quantile(evens,.20), evenHi:quantile(evens,.80),
    primeLo:quantile(primes,.20), primeHi:quantile(primes,.80),
    frameLo:quantile(frames,.20), frameHi:quantile(frames,.80),
    repeatLo:repeats.length?quantile(repeats,.20):8,
    repeatHi:repeats.length?quantile(repeats,.80):10,
    seqCap:quantile(seqs,.75) || 5,
  };
}

function buildFrequencyScores(db, lambda = 0.97) {
  const ema = new Array(26).fill(0);
  // db[0] é o mais recente; processa do mais antigo para o mais recente.
  for (let i=db.length-1;i>=0;i--) {
    const set=new Set(safeNums(db[i]));
    for(let n=1;n<=25;n++) ema[n] = lambda*ema[n] + (1-lambda)*(set.has(n)?1:0);
  }
  return minMaxNormalize(ema);
}

function buildDelayScores(db) {
  const raw = new Array(26).fill(0);
  for (let n=1;n<=25;n++) {
    let currentDelay = db.length;
    for (let i=0;i<db.length;i++) {
      if (safeNums(db[i]).includes(n)) { currentDelay=i; break; }
    }

    const appearanceIdx=[];
    for (let i=db.length-1;i>=0;i--) if (safeNums(db[i]).includes(n)) appearanceIdx.push(i);
    const gaps=[];
    for (let j=1;j<appearanceIdx.length;j++) gaps.push(Math.abs(appearanceIdx[j]-appearanceIdx[j-1]));
    const avgGap = gaps.length ? mean(gaps) : 25/15;
    const sdGap = gaps.length > 1 ? stddev(gaps, avgGap) : Math.max(1, avgGap*0.5);
    const z = (currentDelay - avgGap) / sdGap;
    // Hipótese de atraso: quanto mais acima do atraso típico, maior o sinal.
    raw[n] = 100 / (1 + Math.exp(-z));
  }
  return raw;
}

function buildMarkovScores(db) {
  const out=new Array(26).fill(50);
  if (db.length<2) return out;
  for(let n=1;n<=25;n++) {
    const counts=[[0,0],[0,0]];
    // mais antigo -> mais recente: db[i] (t) para db[i-1] (t+1)
    for(let i=db.length-1;i>0;i--) {
      const from=safeNums(db[i]).includes(n)?1:0;
      const to=safeNums(db[i-1]).includes(n)?1:0;
      counts[from][to]++;
    }
    const current=safeNums(db[0]).includes(n)?1:0;
    // Laplace smoothing impede extremos artificiais em bases pequenas.
    const pNext=(counts[current][1]+1)/(counts[current][0]+counts[current][1]+2);
    out[n]=pNext*100;
  }
  return out;
}

function buildCooccurrenceScores(db) {
  const N=Math.max(1,db.length);
  const single=new Array(26).fill(0);
  const pair=Array.from({length:26},()=>new Array(26).fill(0));
  for(const c of db) {
    const nums=safeNums(c);
    for(const n of nums) single[n]++;
    for(let i=0;i<nums.length;i++) for(let j=i+1;j<nums.length;j++) {
      pair[nums[i]][nums[j]]++; pair[nums[j]][nums[i]]++;
    }
  }

  const raw=[];
  const matrix=Array.from({length:26},()=>new Array(26).fill(50));
  for(let a=1;a<=25;a++) for(let b=a+1;b<=25;b++) {
    const expected=(single[a]*single[b])/N;
    const z=(pair[a][b]-expected)/Math.sqrt(Math.max(expected,1));
    raw.push(z);
  }
  const lo=quantile(raw,.05), hi=quantile(raw,.95);
  const span=Math.max(1e-9,hi-lo);
  for(let a=1;a<=25;a++) for(let b=a+1;b<=25;b++) {
    const expected=(single[a]*single[b])/N;
    const z=(pair[a][b]-expected)/Math.sqrt(Math.max(expected,1));
    const s=clamp(((clamp(z,lo,hi)-lo)/span)*100,0,100);
    matrix[a][b]=s; matrix[b][a]=s;
  }
  return matrix;
}

export function buildSmartModel(database = []) {
  const db=Array.isArray(database)?database.filter(c=>safeNums(c).length===15):[];
  return {
    size:db.length,
    lastNums:db.length?[...safeNums(db[0])]:[],
    standards:deriveStandards(db),
    frequency:buildFrequencyScores(db),
    delay:buildDelayScores(db),
    markov:buildMarkovScores(db),
    cooccurrence:buildCooccurrenceScores(db),
  };
}

function adherenceScore(nums, model) {
  const s=model.standards;
  const sum=nums.reduce((a,b)=>a+b,0);
  const evens=nums.filter(n=>n%2===0).length;
  const primes=nums.filter(n=>PRIMES.has(n)).length;
  const frame=nums.filter(n=>FRAME.has(n)).length;
  const seq=getMaxSequence(nums);
  const lastSet=new Set(model.lastNums||[]);
  const repeat=lastSet.size?nums.filter(n=>lastSet.has(n)).length:9;

  const scores=[
    scoreRange(sum,s.sumLo,s.sumHi,10),
    scoreRange(evens,s.evenLo,s.evenHi,1),
    scoreRange(primes,s.primeLo,s.primeHi,1),
    scoreRange(frame,s.frameLo,s.frameHi,1),
    scoreRange(repeat,s.repeatLo,s.repeatHi,1),
    seq<=s.seqCap?100:clamp(100-(seq-s.seqCap)*30,0,100),
  ];
  return mean(scores);
}

function averageNumberScore(nums, scores) {
  return nums.length ? mean(nums.map(n=>Number(scores[n])||0)) : 0;
}

function cooccurrenceScore(nums, matrix) {
  let total=0,count=0;
  for(let i=0;i<nums.length;i++) for(let j=i+1;j<nums.length;j++) {
    total += Number(matrix[nums[i]]?.[nums[j]]) || 0; count++;
  }
  return count?total/count:50;
}

export function normalizeSmartWeights(input = SMART_WEIGHTS) {
  const raw={};
  let total=0;
  for(const key of Object.keys(SMART_COMPONENTS)) {
    const value=clamp(Number(input?.[key] ?? SMART_WEIGHTS[key]) || 0, 0.02, 0.60);
    raw[key]=value; total+=value;
  }
  if(total<=0) return {...SMART_WEIGHTS};
  const out={};
  for(const key of Object.keys(SMART_COMPONENTS)) out[key]=raw[key]/total;
  return out;
}

export function scoreSmartComponents(components, weights = SMART_WEIGHTS, disabledComponents = []) {
  const disabled=new Set(disabledComponents || []);
  const normalized=normalizeSmartWeights(weights);
  let weighted=0,den=0;
  for(const key of Object.keys(SMART_COMPONENTS)) {
    if(disabled.has(key)) continue;
    const w=Math.max(0,Number(normalized[key])||0);
    weighted += (Number(components?.[key])||0)*w; den+=w;
  }
  return den?weighted/den:0;
}

function combineComponentScores(components, options = {}, coverageScore = null) {
  const signalScore=scoreSmartComponents(components, options.weights || SMART_WEIGHTS, options.disabledComponents || []);
  let totalScore=signalScore;
  if(Number.isFinite(coverageScore)) {
    const cw=clamp(Number(options.coverageWeight ?? 0.10),0,0.30);
    totalScore=signalScore*(1-cw)+coverageScore*cw;
  }
  return { totalScore, signalScore };
}

export function scoreSmartCandidate(nums, model, options = {}) {
  const safe=Array.isArray(nums)?nums:[];
  const components={
    frequency:averageNumberScore(safe,model.frequency),
    delay:averageNumberScore(safe,model.delay),
    markov:averageNumberScore(safe,model.markov),
    cooccurrence:cooccurrenceScore(safe,model.cooccurrence),
    adherence:adherenceScore(safe,model),
    antiCrowd:100-calculateHumanPopularity(safe),
  };

  const coverageScore=(Array.isArray(options.savedGames) && options.savedGames.length)
    ? calculateCoverageQuality(safe,options.savedGames).score
    : null;
  const combined=combineComponentScores(components,options,coverageScore);
  return { ...combined, coverageScore, components };
}

export function generateSmartCandidate(model, rng = Math.random) {
  const last=model.lastNums||[];
  if(last.length!==15) return shuffleCopy(ALL_NUMS,rng).slice(0,15).sort((a,b)=>a-b);
  const other=ALL_NUMS.filter(n=>!last.includes(n));
  // 80% mantém DNA histórico de repetição; 20% explora o espaço sem essa âncora.
  if(rng()<0.80) {
    const lo=clamp(Math.round(model.standards.repeatLo),7,11);
    const hi=clamp(Math.round(model.standards.repeatHi),lo,11);
    const repeatCount=lo+Math.floor(rng()*(hi-lo+1));
    return [...shuffleCopy(last,rng).slice(0,repeatCount),...shuffleCopy(other,rng).slice(0,15-repeatCount)].sort((a,b)=>a-b);
  }
  return shuffleCopy(ALL_NUMS,rng).slice(0,15).sort((a,b)=>a-b);
}

/**
 * Seleciona o melhor candidato do mesmo pool para o Smart completo e para
 * variantes "sem componente". Isso torna a ablação pareada e comparável.
 */
export function selectSmartVariants(database, options = {}) {
  const model=options.model || buildSmartModel(database);
  const rng=options.rng || Math.random;
  const iterations=Math.max(120,Number(options.iterations)||700);
  const savedGames=options.savedGames || [];
  const disabledSets={ full:[] };
  for(const key of Object.keys(SMART_COMPONENTS)) disabledSets[key]=[key];

  const best={};
  for(const key of Object.keys(disabledSets)) best[key]={game:null,score:-Infinity,details:null};

  for(let i=0;i<iterations;i++) {
    const candidate=generateSmartCandidate(model,rng);
    const baseDetails=scoreSmartCandidate(candidate,model,{savedGames,coverageWeight:options.coverageWeight,weights:options.weights});
    for(const [variant,disabledComponents] of Object.entries(disabledSets)) {
      const combined=combineComponentScores(baseDetails.components,{disabledComponents,coverageWeight:options.coverageWeight,weights:options.weights},baseDetails.coverageScore);
      const details={...baseDetails,...combined};
      if(details.totalScore>best[variant].score) best[variant]={game:candidate,score:details.totalScore,details};
    }
  }
  return { model, variants:best };
}


function gameKey(nums) { return [...nums].sort((a,b)=>a-b).join('-'); }
function hitCount(game, targetNums) {
  const target=new Set(targetNums || []);
  let hits=0;
  for(const n of game || []) if(target.has(n)) hits++;
  return hits;
}

/**
 * Prepara um concurso interno de calibração. Os candidatos e seus componentes
 * são calculados uma única vez; diferentes vetores de peso só reranqueiam o
 * mesmo pool. Isso reduz custo e evita comparar pesos em amostras diferentes.
 */
export function prepareSmartCalibrationRound(targetContest, trainingDatabase, options = {}) {
  const training=Array.isArray(trainingDatabase)?trainingDatabase:[];
  if(!targetContest || safeNums(targetContest).length!==15 || training.length < (options.minHistory ?? 50)) return null;
  const model=options.model || buildSmartModel(training);
  const rng=options.rng || Math.random;
  const candidateCount=Math.max(80,Math.min(600,Number(options.candidateCount)||180));
  const seen=new Set(), candidates=[];
  let attempts=0;
  while(candidates.length<candidateCount && attempts<candidateCount*5) {
    attempts++;
    const game=generateSmartCandidate(model,rng);
    const key=gameKey(game);
    if(seen.has(key)) continue;
    seen.add(key);
    const details=scoreSmartCandidate(game,model,{coverageWeight:0});
    candidates.push({game,components:details.components});
  }
  return {
    contestId:targetContest.id,
    targetNums:[...safeNums(targetContest)],
    candidates,
    trainingSize:training.length,
  };
}

export function evaluateSmartWeightsOnRounds(rounds, weights, options = {}) {
  const valid=(rounds||[]).filter(r=>r?.candidates?.length && r?.targetNums?.length===15);
  const gamesCount=Math.max(1,Math.min(5,Number(options.gamesCount)||1));
  let sumBest=0,sumAll=0,totalGames=0,hits11=0,hits12=0,hits13=0;
  const bestHits=[];
  for(const round of valid) {
    const ranked=round.candidates.map(c=>({
      game:c.game,
      score:scoreSmartComponents(c.components,weights),
    })).sort((a,b)=>b.score-a.score);
    const picked=ranked.slice(0,gamesCount);
    let best=0;
    for(const p of picked) {
      const hits=hitCount(p.game,round.targetNums);
      totalGames++; sumAll+=hits;
      if(hits>=11) hits11++;
      if(hits>=12) hits12++;
      if(hits>=13) hits13++;
      if(hits>best) best=hits;
    }
    bestHits.push(best); sumBest+=best;
  }
  const n=valid.length;
  const avgBest=n?sumBest/n:0;
  const avgAll=totalGames?sumAll/totalGames:0;
  const rate11=totalGames?hits11/totalGames:0;
  const rate12=totalGames?hits12/totalGames:0;
  const rate13=totalGames?hits13/totalGames:0;
  return {n,totalGames,avgBest,avgAll,rate11,rate12,rate13,bestHits};
}

function weightDistance(a,b=SMART_WEIGHTS) {
  const an=normalizeSmartWeights(a),bn=normalizeSmartWeights(b);
  return Object.keys(SMART_COMPONENTS).reduce((sum,k)=>sum+Math.abs(an[k]-bn[k]),0);
}

function calibrationObjective(metrics, weights, options = {}) {
  // Métrica deliberadamente conservadora: média de acertos domina; faixas de
  // prêmio só desempatem. Regularização puxa pesos para o baseline quando a
  // melhora interna é pequena, reduzindo overfitting em janelas curtas.
  const reward=metrics.avgBest
    + metrics.avgAll*0.10
    + metrics.rate11*0.08
    + metrics.rate12*0.18
    + metrics.rate13*0.35;
  const penalty=(Number(options.regularization) || 0.10) * weightDistance(weights,SMART_WEIGHTS);
  return reward-penalty;
}

/**
 * Otimiza pesos em concursos internos já preparados. Usa coordinate search
 * regularizado e nunca recebe o concurso externo que será previsto/testado.
 */
export function calibrateSmartWeightsFromRounds(rounds, options = {}) {
  // rounds chegam do mais recente para o mais antigo. O bloco mais recente é
  // reservado para VALIDAÇÃO; a busca de pesos só enxerga o bloco mais antigo.
  const valid=(rounds||[]).filter(Boolean);
  const baseline=normalizeSmartWeights(options.baseWeights || SMART_WEIGHTS);
  const minRounds=Math.max(10,Number(options.minRounds)||12);
  if(valid.length < minRounds) {
    const metrics=evaluateSmartWeightsOnRounds(valid,baseline,options);
    return {weights:baseline,baselineWeights:baseline,rounds:valid.length,changed:false,validated:false,reason:'amostra_interna_insuficiente',baselineMetrics:metrics,calibratedMetrics:metrics,tuningMetrics:metrics,objectiveDelta:0};
  }

  const requestedValidation=Number(options.validationRounds);
  const validationCount=Math.max(4,Math.min(8,Number.isFinite(requestedValidation)?requestedValidation:Math.round(valid.length*0.35)));
  const validationRounds=valid.slice(0,validationCount);   // mais recentes, intocados durante tuning
  const tuningRounds=valid.slice(validationCount);         // mais antigos
  if(tuningRounds.length<6) {
    const metrics=evaluateSmartWeightsOnRounds(valid,baseline,options);
    return {weights:baseline,baselineWeights:baseline,rounds:valid.length,changed:false,validated:false,reason:'treino_interno_insuficiente',baselineMetrics:metrics,calibratedMetrics:metrics,tuningMetrics:metrics,objectiveDelta:0};
  }

  let current={...baseline};
  let currentMetrics=evaluateSmartWeightsOnRounds(tuningRounds,current,options);
  let currentObjective=calibrationObjective(currentMetrics,current,options);
  const baselineTuningMetrics=currentMetrics,baselineTuningObjective=currentObjective;
  const factors=Array.isArray(options.factors)&&options.factors.length?options.factors:[0.70,1.30];
  const passes=Math.max(1,Math.min(3,Number(options.passes)||2));
  const minGain=Number.isFinite(Number(options.minGain))?Number(options.minGain):0.003;

  for(let pass=0;pass<passes;pass++) {
    let improved=false;
    for(const key of Object.keys(SMART_COMPONENTS)) {
      let bestLocal={weights:current,metrics:currentMetrics,objective:currentObjective};
      for(const factor of factors) {
        const trial={...current,[key]:current[key]*factor};
        const normalized=normalizeSmartWeights(trial);
        const metrics=evaluateSmartWeightsOnRounds(tuningRounds,normalized,options);
        const objective=calibrationObjective(metrics,normalized,options);
        if(objective>bestLocal.objective+minGain) bestLocal={weights:normalized,metrics,objective};
      }
      if(bestLocal.objective>currentObjective+minGain) {
        current=bestLocal.weights; currentMetrics=bestLocal.metrics; currentObjective=bestLocal.objective; improved=true;
      }
    }
    if(!improved) break;
  }

  const tuningDelta=currentObjective-baselineTuningObjective;
  const baselineValidationMetrics=evaluateSmartWeightsOnRounds(validationRounds,baseline,options);
  const candidateValidationMetrics=evaluateSmartWeightsOnRounds(validationRounds,current,options);
  const baselineValidationObjective=calibrationObjective(baselineValidationMetrics,baseline,{...options,regularization:0});
  const candidateValidationObjective=calibrationObjective(candidateValidationMetrics,current,{...options,regularization:0});
  const validationDelta=candidateValidationObjective-baselineValidationObjective;
  const avgDelta=candidateValidationMetrics.avgBest-baselineValidationMetrics.avgBest;
  const avgAllDelta=candidateValidationMetrics.avgAll-baselineValidationMetrics.avgAll;
  const minValidationAvgGain=Number.isFinite(Number(options.minValidationAvgGain))?Number(options.minValidationAvgGain):0.10;
  const minValidationGain=Number.isFinite(Number(options.minValidationGain))?Number(options.minValidationGain):0.05;

  // Guard rail real: tuning positivo não basta. O vetor novo precisa vencer os
  // pesos fixos em concursos internos MAIS RECENTES que ficaram fora da busca.
  const validated=tuningDelta>minGain
    && avgDelta>=minValidationAvgGain
    && validationDelta>=minValidationGain
    && avgAllDelta>=-0.02;

  return {
    weights:validated?current:baseline,
    baselineWeights:baseline,
    rounds:valid.length,
    tuningRounds:tuningRounds.length,
    validationRounds:validationRounds.length,
    changed:validated,
    validated,
    reason:validated?'melhora_confirmada_em_validacao':'validacao_interna_reprovada',
    baselineMetrics:baselineValidationMetrics,
    calibratedMetrics:validated?candidateValidationMetrics:baselineValidationMetrics,
    candidateValidationMetrics,
    tuningMetrics:currentMetrics,
    baselineTuningMetrics,
    objectiveDelta:validated?validationDelta:0,
    tuningObjectiveDelta:tuningDelta,
    validationObjectiveDelta:validationDelta,
  };
}

/**
 * Nested walk-forward para o uso normal do Smart: os concursos mais recentes
 * da base viram alvos INTERNOS; cada um é treinado apenas com concursos ainda
 * mais antigos. O próximo sorteio real jamais participa da calibração.
 */
export function calibrateSmartWeights(database, options = {}) {
  const db=Array.isArray(database)?database.filter(c=>safeNums(c).length===15):[];
  const minHistory=Math.max(40,Number(options.minHistory)||50);
  const window=Math.max(6,Math.min(30,Number(options.window)||16));
  const maxRounds=Math.min(window,Math.max(0,db.length-minHistory));
  const rounds=[];
  const rngFactory=typeof options.rngFactory==='function'?options.rngFactory:null;
  for(let i=0;i<maxRounds;i++) {
    const training=db.slice(i+1,Math.min(db.length,i+1+(Number(options.maxTraining)||1200)));
    if(training.length<minHistory) break;
    const rng=rngFactory?rngFactory(i,db[i]):Math.random;
    const round=prepareSmartCalibrationRound(db[i],training,{minHistory,candidateCount:options.candidateCount||160,rng});
    if(round) rounds.push(round);
  }
  return calibrateSmartWeightsFromRounds(rounds,{...options,minRounds:Math.min(8,maxRounds)});
}

export function getHeadlessSmartGame(database, savedGames = [], options = {}) {
  if (!Array.isArray(database) || database.length === 0) {
    return shuffleCopy(ALL_NUMS, options.rng || Math.random).slice(0,15).sort((a,b)=>a-b);
  }
  const selected=selectSmartVariants(database,{...options,savedGames});
  return selected.variants.full.game || shuffleCopy(ALL_NUMS, options.rng || Math.random).slice(0,15).sort((a,b)=>a-b);
}
