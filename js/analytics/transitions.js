// Descrição histórica. Somente concursos de IDs consecutivos, sem filtro por acertos.
export function summarizeTransitions(database) {
 const rows=[...database].sort((a,b)=>Number(a.id)-Number(b.id));
 const seen=new Set(), counts={repeats:{},sums:{},parity:{},highlow:{},primes:{},sequence:{}};
 const entry=Array(26).fill(0),exit=Array(26).fill(0);
 let total=0;
 for(const row of rows) {
  if(seen.has(Number(row.id)))throw new Error('IDs de concurso repetidos.');
  seen.add(Number(row.id));
 }
 for(let i=1;i<rows.length;i++) {
  const a=rows[i-1],b=rows[i];
  if(Number(b.id)!==Number(a.id)+1)continue;
  const before=new Set(a.nums),now=new Set(b.nums),nums=[...now].sort((a,b)=>a-b);
  let seq=1,maxSeq=1;
  for(let j=1;j<nums.length;j++){seq=nums[j]===nums[j-1]+1?seq+1:1;maxSeq=Math.max(maxSeq,seq);}
  const sum=nums.reduce((a,b)=>a+b,0),bin=Math.floor(sum/10)*10;
  const values={repeats:nums.filter(n=>before.has(n)).length,sums:bin+'–'+(bin+9),
   parity:nums.filter(n=>n%2===0).length,highlow:nums.filter(n=>n<=13).length,
   primes:nums.filter(n=>[2,3,5,7,11,13,17,19,23].includes(n)).length,sequence:maxSeq};
  for(const [key,value] of Object.entries(values))counts[key][value]=(counts[key][value]||0)+1;
  for(let n=1;n<=25;n++){if(!before.has(n)&&now.has(n))entry[n]++;if(before.has(n)&&!now.has(n))exit[n]++;}
  total++;
 }
 return {total,counts,entry,exit};
}
