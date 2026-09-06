/**
 * Backtest walk-forward puro, determinístico e sem dependência do DOM.
 * Serve como núcleo testável; o Sniper visual usa um Web Worker equivalente.
 */
import { bitCount, getMaxSequence } from '../core/utils.js';

function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

function rngFromSeed(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomGame(rng) {
  const pool = Array.from({length:25},(_,i)=>i+1);
  for (let i=pool.length-1;i>0;i--) {
    const j=Math.floor(rng()*(i+1));
    [pool[i],pool[j]]=[pool[j],pool[i]];
  }
  return pool.slice(0,15).sort((a,b)=>a-b);
}

function derivePatterns(train) {
  if (!train.length) return { sumLo:170, sumHi:220, evenLo:6, evenHi:9, seqCap:5 };
  const q=(arr,p)=>{ const s=[...arr].sort((a,b)=>a-b); return s[Math.min(s.length-1,Math.floor((s.length-1)*p))]; };
  const sums=train.map(c=>c.sum ?? c.nums.reduce((a,b)=>a+b,0));
  const evens=train.map(c=>c.nums.filter(n=>n%2===0).length);
  const seqs=train.map(c=>c.maxSeq ?? getMaxSequence(c.nums));
  return {sumLo:q(sums,.2),sumHi:q(sums,.8),evenLo:q(evens,.2),evenHi:q(evens,.8),seqCap:q(seqs,.75)};
}

function structuredCandidate(train, patterns, rng) {
  // Seleciona entre candidatos aleatórios apenas usando informação de treino.
  let best=null,bestScore=-1;
  const recent=train[train.length-1]?.nums || [];
  for(let i=0;i<180;i++){
    const game=randomGame(rng);
    const sum=game.reduce((a,b)=>a+b,0);
    const evens=game.filter(n=>n%2===0).length;
    const seq=getMaxSequence(game);
    const repeat=recent.length ? game.filter(n=>recent.includes(n)).length : 9;
    let score=0;
    if(sum>=patterns.sumLo&&sum<=patterns.sumHi) score+=3;
    if(evens>=patterns.evenLo&&evens<=patterns.evenHi) score+=3;
    if(seq<=patterns.seqCap) score+=2;
    if(repeat>=8&&repeat<=10) score+=2;
    if(score>bestScore){bestScore=score;best=game;}
    if(score===10) break;
  }
  return best || randomGame(rng);
}

/** Treina somente em [0..cutoff-1]. Não acessa o alvo por contrato. */
export function rodarBacktestParaJanela(database, cutoff) {
  const safeCutoff=Math.max(0,Math.min(Number(cutoff)||0,database.length));
  const train=database.slice(0,safeCutoff);
  return { cutoff:safeCutoff, patterns:derivePatterns(train), trainSize:train.length };
}

export function rodarBacktestWalkForward(database, cutoff) {
  if (!Array.isArray(database) || database.length < 2) return { media13Plus:0, media12Plus:0 };
  const start=Math.max(1,Math.min(Number(cutoff)||1,database.length-1));
  let n=0,h12=0,h13=0;

  for(let targetIndex=start; targetIndex<database.length; targetIndex++){
    const train=database.slice(0,targetIndex);
    const target=database[targetIndex];
    const patterns=derivePatterns(train);
    const rng=rngFromSeed(hashSeed(target.id,targetIndex,train.length));
    const game=structuredCandidate(train,patterns,rng);
    const mask=game.reduce((m,x)=>m|(1<<(x-1)),0);
    const hits=bitCount(mask & target.mask);
    if(hits>=12) h12++;
    if(hits>=13) h13++;
    n++;
  }
  return { media13Plus:n?h13/n:0, media12Plus:n?h12/n:0 };
}

export function rodarBacktestCompleto(database) {
  if (!Array.isArray(database) || database.length < 2) return { media13Plus:0, media12Plus:0 };
  const cutoff=Math.max(1,Math.floor(database.length*0.5));
  return rodarBacktestWalkForward(database,cutoff);
}
