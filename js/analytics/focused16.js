import {mask15,combinations15} from './internalGames.js?v=5.6.0';
const bits=n=>{n-=(n>>>1)&0x55555555;n=(n&0x33333333)+((n>>>2)&0x33333333);return (((n+(n>>>4))&0x0f0f0f0f)*0x01010101)>>>24;};
export function prepareHistory(database) {
 if(!Array.isArray(database)||!database.length)throw new Error('Importe uma base histórica.');
 const seen=new Set();
 return database.map(c=>{
  if(!Number.isSafeInteger(Number(c.id))||Number(c.id)<1||seen.has(Number(c.id)))throw new Error('IDs históricos inválidos ou repetidos.');
  seen.add(Number(c.id));return mask15(c.nums);
 });
}
export function evaluate16(nums,history,cap,savedMasks=new Set()) {
 if(![12,13].includes(cap))throw new Error('Teto inválido.');
 if(nums.length!==16||new Set(nums).size!==16||nums.some(n=>!Number.isInteger(n)||n<1||n>25))throw new Error('Use 16 dezenas distintas.');
 const mask=nums.reduce((m,n)=>m|(1<<(n-1)),0),intersection=[];
 for(const h of history){const overlap=mask&h,k=bits(overlap);if(k>cap)return null;intersection.push([overlap,k]);}
 const games=nums.map(n=>({omitted:n,max:0,count12:0,count13:0}));
 let contests12=0,contests13=0;
 for(const [overlap,k] of intersection){
  let has12=false,has13=false;
  for(const g of games){
   const hit=k-((overlap&(1<<(g.omitted-1)))?1:0);
   g.max=Math.max(g.max,hit);
   if(hit===12){g.count12++;has12=true;}
   if(hit===13){g.count13++;has13=true;}
  }
  if(has12)contests12++;if(has13)contests13++;
 }
 const maxCounts={};for(const g of games)maxCounts[g.max]=(maxCounts[g.max]||0)+1;
 const occurrences12=games.reduce((s,g)=>s+g.count12,0),occurrences13=games.reduce((s,g)=>s+g.count13,0);
 const duplicates=nums.filter(n=>savedMasks.has(mask^(1<<(n-1)))).length;
 const rank=[duplicates,maxCounts[cap]||0,...(cap===13?[occurrences13,occurrences12]:[occurrences12])];
 return {nums:[...nums].sort((a,b)=>a-b),games,maxCounts,occurrences12,occurrences13,contests12,contests13,duplicates,newCombinations:16-duplicates,rank};
}
export function better(a,b){if(!b)return true;for(let i=0;i<a.rank.length;i++){if(a.rank[i]!==b.rank[i])return a.rank[i]<b.rank[i];}return false;}
export function search16({database,cap,attempts=8000,seed=1,saved=[]},progress=()=>{}) {
 if(![12,13].includes(cap)||!Number.isInteger(attempts)||attempts<1||attempts>50000)throw new Error('Parâmetros inválidos.');
 const history=prepareHistory(database),savedMasks=new Set();let expanded=0;
 for(const row of saved){const games=combinations15(row.nums);expanded+=games.length;if(expanded>10000)throw new Error('Limite de 10.000 combinações salvas.');for(const g of games)savedMasks.add(mask15(g));}
 let state=seed>>>0,best=null,valid=0;const seen=new Set();
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 for(let i=0;i<attempts;i++){
  const pool=Array.from({length:25},(_,j)=>j+1);
  for(let j=24;j>8;j--){const k=Math.floor(random()*(j+1));[pool[j],pool[k]]=[pool[k],pool[j]];}
  const nums=pool.slice(9),mask=nums.reduce((m,n)=>m|(1<<(n-1)),0);
  if(!seen.has(mask)){seen.add(mask);const r=evaluate16(nums,history,cap,savedMasks);if(r){valid++;if(better(r,best))best=r;}}
  if((i+1)%100===0||i+1===attempts)progress({done:i+1,total:attempts,examined:seen.size,valid});
 }
 return {best,examined:seen.size,valid,attempts,cap,seed:seed>>>0,historyCount:history.length};
}
